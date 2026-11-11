import { PayableBooking } from '../payments/bookings-port';
import { expiredBookingPaymentPipeline } from '../payments/expired-booking-payments';
import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { BookingStatus } from '../common/enums/booking-status.enum';
import { EmailEligibilityService } from '../auth/email-eligibility.service';
import { UsersService } from '../users/users.service';
import { BOOKING_HOLD_MS, passengerTypeOn } from './flight-booking.rules';
import { FlightBookingsService } from './flight-bookings.service';
import { bookingChangeFingerprint, FlightBookingChangesStore } from './flight-booking-changes.store';
import { CreateFlightBookingChangeDto } from './dto/create-flight-booking-change.dto';
import { BOOKING_PAYMENTS, BookingPaymentsPort } from './ports/booking-payments.port';
import { FLIGHT_INVENTORY, FlightInventoryPort } from './ports/flight-inventory.port';
import { FlightBooking, PassengerType } from './schemas/flight-booking.schema';
import { FlightBookingChangeDocument } from './schemas/flight-booking-change.schema';
import { FlightSeatAssignmentsService } from './flight-seat-assignments.service';

@Injectable()
export class FlightBookingChangesService {
  private readonly logger = new Logger(FlightBookingChangesService.name);
  constructor(private readonly store: FlightBookingChangesStore,
    @InjectModel(FlightBooking.name) private readonly bookings: Model<FlightBooking>,
    @InjectConnection() private readonly connection: Connection,
    private readonly bookingService: FlightBookingsService,
    @Inject(FLIGHT_INVENTORY) private readonly inventory: FlightInventoryPort,
    @Inject(BOOKING_PAYMENTS) private readonly payments: BookingPaymentsPort,
    private readonly users: UsersService, private readonly email: EmailEligibilityService,
    private readonly seats: FlightSeatAssignmentsService) {}

  private id(value: string): Types.ObjectId {
    if (!/^[a-f0-9]{24}$/i.test(value)) throw new NotFoundException('Flight booking change not found');
    return new Types.ObjectId(value);
  }
  async owned(id: string, userId: string, session?: ClientSession): Promise<FlightBookingChangeDocument> {
    const change = await this.store.changes.findOne({ _id: this.id(id), userId: new Types.ObjectId(userId) }).session(session ?? null).exec();
    if (!change) throw new NotFoundException('Flight booking change not found');
    return change;
  }
  async view(change: FlightBookingChangeDocument) {
    let refund;
    if (change.status === BookingStatus.CONFIRMED && change.differenceAmount < 0) {
      try { refund = await this.payments.getChangeRefundStatus?.(change._id.toString(), change.flightBookingId.toString()) ?? undefined; }
      catch { this.logger.error('Could not read flight-change refund status'); }
    }
    return { flightBookingChangeId: change._id.toString(), flightBookingId: change.flightBookingId.toString(),
      status: change.status, previousAmount: change.previousAmount, totalAmount: change.proposed.totalAmount,
      differenceAmount: change.differenceAmount, amountToPay: Math.max(0, change.differenceAmount),
      refundAmount: Math.max(0, -change.differenceAmount), currency: change.proposed.currency,
      segments: change.proposed.segments, holdExpiresAt: change.holdExpiresAt, appliedAt: change.appliedAt,
      refundDue: change.refundDue, ...(refund ? { refund } : {}) };
  }
  private async confirmed(id: Types.ObjectId, userId: string, session: ClientSession) {
    const booking = await this.bookings.findOne({ _id: id, userId: new Types.ObjectId(userId) }).session(session).exec();
    if (!booking) throw new NotFoundException('Flight booking not found');
    if (booking.status !== BookingStatus.CONFIRMED) throw new ConflictException('Only a Confirmed future booking can be changed');
    const flight = await this.inventory.getFlight(booking.segments[0].flightId.toString(), session);
    if (!flight || flight.status !== 'SCHEDULED' || flight.departureAt <= new Date()) throw new ConflictException('The original flight has departed or is unavailable');
    return booking;
  }
  async create(id: string, userId: string, input: CreateFlightBookingChangeDto) {
    await this.email.assertCanBook(userId);
    await this.bookingService.getMine(id,userId); // Authorize before any recovery side effect.
    await this.sweep(id);
    try {
      const change = await this.connection.transaction(async session => {
        await this.users.acquireBookingGate(userId, session);
        await this.email.assertCanBook(userId, session);
        const booking = await this.confirmed(this.id(id), userId, session);
        if (await this.store.changes.exists({ flightBookingId: booking._id, $or: [{ status: BookingStatus.PENDING }, { refundDue: true }] }).session(session)) {
          throw new ConflictException('Finish the existing change or its refund before requesting another');
        }
        if (input.segments.length !== booking.segments.length) throw new BadRequestException('Keep the same number of flight legs');
        const selections = input.segments.map(s => ({ flightId: s.flightId.toLowerCase(), cabinId: s.cabinId.toLowerCase() }));
        if (selections.every((s,i) => s.flightId === booking.segments[i].flightId.toString() && s.cabinId === booking.segments[i].cabinId.toString())) throw new BadRequestException('Choose a different flight or date');
        const locked = await this.bookingService.acquireChangeFlightGates([...booking.segments.map(s=>s.flightId.toString()), ...selections.map(s=>s.flightId)], session);
        const originalFlights = locked.filter(f=>booking.segments.some(s=>s.flightId.toString()===f.flightId));
        const departure = originalFlights.find(f=>f.flightId === booking.segments[0].flightId.toString())!;
        if (originalFlights.some(f=>f.status !== 'SCHEDULED' || f.departureAt <= new Date())) throw new ConflictException('An original flight is no longer changeable');
        const nextFlight = await this.inventory.getFlight(selections[0].flightId, session);
        if (!nextFlight) throw new NotFoundException('Flight not found');
        const passengers = booking.passengers.map(p => {
          const type = passengerTypeOn(p.dateOfBirth,nextFlight.departureAt);
          if (!type) throw new BadRequestException('Passenger date of birth is after the replacement departure');
          return { fullName:p.fullName,dateOfBirth:p.dateOfBirth.toISOString(),documentNumber:p.documentNumber,type,extraBags:p.extraBags,extraBaggageWeightKg:p.extraBaggageWeightKg };
        });
        const proposed = await this.bookingService.priceBookingChange({ segments: selections, passengers }, session);
        if (![proposed.totalAmount,proposed.baggageFee,proposed.seatCount,proposed.totalAmount-booking.totalAmount].every(Number.isSafeInteger)) throw new ConflictException('Replacement amount is outside supported minor units');
        for (let i=0;i<proposed.segments.length;i++) {
          const old = booking.segments[i], next = proposed.segments[i];
          if (next.departureAirportCode !== old.departureAirportCode || next.arrivalAirportCode !== old.arrivalAirportCode || next.cabinClass !== old.cabinClass) throw new BadRequestException('Keep the same airports and cabin class for every leg');
        }
        const holds = [];
        const oldCounts = new Map(booking.segments.map(s=>[s.cabinId.toString(),booking.seatCount]));
        for (const next of proposed.segments) {
          const amount = proposed.seatCount - (oldCounts.get(next.cabinId.toString()) ?? 0);
          if (amount > 0) {
            if (!await this.inventory.reserveSeats(next.cabinId.toString(),amount,session)) throw new ConflictException('Not enough seats for the replacement trip');
            holds.push({ cabinId:next.cabinId,seats:amount });
          }
        }
        const airlines = [];
        for (const segment of proposed.segments) airlines.push(await this.inventory.getAirlinePolicy(segment.airlineId.toString(),session));
        const policies = { cancellation:{tiers:airlines[0]?.cancellationTiers ?? []},
          baggage:airlines.map((a,i)=>({airlineId:a!.airlineId,pricePerExtraBag:a!.pricePerExtraBag/100,maxExtraBagsPerPassenger:a!.maxExtraBagsPerPassenger,cabinClass:proposed.segments[i].cabinClass,
            baggageAllowanceCount:proposed.segments[i].baggageAllowanceCount,baggageMaxWeightKg:proposed.segments[i].baggageMaxWeightKg})),
          change:{previousAmount:booking.totalAmount/100,totalAmount:proposed.totalAmount/100,differenceAmount:(proposed.totalAmount-booking.totalAmount)/100,
            segments:proposed.segments.map(s=>({flightId:s.flightId.toString(),cabinId:s.cabinId.toString(),departureAt:s.departureAt}))} };
        proposed.passengers = proposed.passengers.map((p,i)=>({...p,_id:booking.passengers[i]._id}));
        const touched = await this.bookings.updateOne({ _id:booking._id,status:BookingStatus.CONFIRMED,
          $expr:{$and:originalFlights.map(f=>({$gt:[{$literal:f.departureAt},'$NOW']}))} },{$set:{updatedAt:new Date()}},{session}).exec();
        if (touched.matchedCount!==1) throw new ConflictException('Original booking is no longer changeable');
        const [created] = await this.store.changes.create([{ userId:booking.userId,flightBookingId:booking._id,
          baseFingerprint:bookingChangeFingerprint(booking),previousSegments:booking.segments.map(s=>({airlineId:s.airlineId,fare:s.fare})),proposed,policies,holds,previousAmount:booking.totalAmount,
          differenceAmount:proposed.totalAmount-booking.totalAmount,holdExpiresAt:new Date(Date.now()+BOOKING_HOLD_MS) }],{session});
        return created;
      });
      return this.view(change);
    } catch(error) {
      if ((error as {code?:number}).code===11000) throw new ConflictException('A change is already pending for this booking');
      throw error;
    }
  }
  async payable(id: string,userId:string): Promise<PayableBooking | null> {
    let change;
    try { change=await this.owned(id,userId); } catch(error) { if(error instanceof NotFoundException)return null;throw error; }
    return { bookingId:change._id.toString(),userId:change.userId.toString(),status:change.status,
      totalPrice:Math.max(0,change.differenceAmount)/100,currency:change.proposed.currency,
      policies:change.policies as PayableBooking['policies'],holdExpiresAt:change.holdExpiresAt };
  }
  /** Zero/lower fares need policy acceptance, but never a zero-value Stripe charge. */
  async confirmFree(id:string,userId:string) {
    const change=await this.owned(id,userId);
    if(change.differenceAmount>0)throw new ConflictException('Pay the fare difference through /api/payments');
    if(change.status===BookingStatus.CONFIRMED)return this.view(change);
    if(!await this.payments.hasAcceptedChangePolicies!(id,userId,change.policies))throw new ConflictException('Accept the replacement trip policies first');
    await this.apply(id);
    await this.settleRefunds(change.flightBookingId.toString());
    return this.view(await this.owned(id,userId));
  }
  async confirmPaid(id:string,paymentId:string):Promise<void> { await this.apply(id,paymentId); }

  private async apply(id:string,paymentId?:string):Promise<void> {
    await this.connection.transaction(async session=>{
      const change=await this.store.changes.findById(this.id(id)).session(session).exec();
      if (!change) throw new NotFoundException('Flight booking change not found');
      if(change.status===BookingStatus.CONFIRMED && (change.paymentId?.toString() ?? '')===(paymentId ?? ''))return;
      if(change.status!==BookingStatus.PENDING || change.holdExpiresAt<=new Date())throw new ConflictException('The change hold ended');
      if((change.differenceAmount>0)!==!!paymentId)throw new ConflictException('Payment does not match the change');
      await this.users.acquireBookingGate(change.userId.toString(),session);
      if (!await this.email.canBook(change.userId.toString(),session)) throw new ConflictException('Verify your email before changing bookings');
      const booking=await this.confirmed(change.flightBookingId,change.userId.toString(),session);
      if(bookingChangeFingerprint(booking)!==change.baseFingerprint)throw new ConflictException('The original booking changed');
      const proposed=change.proposed;
      const locked=await this.bookingService.acquireChangeFlightGates([...booking.segments.map(s=>s.flightId.toString()),...proposed.segments.map((s:any)=>s.flightId.toString())],session);
      for(const segment of proposed.segments) {
        const live=locked.find(f=>f.flightId===segment.flightId.toString())!;
        if(live.status!=='SCHEDULED'||live.departureAt<=new Date()||live.departureAirportCode!==segment.departureAirportCode||live.arrivalAirportCode!==segment.arrivalAirportCode)throw new ConflictException('Replacement flight is no longer available');
        segment.departureAt=live.departureAt;segment.arrivalAt=live.arrivalAt;
      }
      if(proposed.segments[1] && proposed.segments[1].departureAt<=proposed.segments[0].arrivalAt)throw new ConflictException('Replacement return no longer follows the outbound');
      const originalFlights=locked.filter(f=>booking.segments.some(s=>s.flightId.toString()===f.flightId));
      if(originalFlights.some(f=>f.status!=='SCHEDULED'||f.departureAt<=new Date()))throw new ConflictException('An original flight is no longer changeable');
      for(const hold of change.holds)if(!await this.inventory.convertHeldToBooked(hold.cabinId.toString(),hold.seats,session))throw new ConflictException('Replacement hold could not be confirmed');
      const nextCounts=new Map<string,number>(proposed.segments.map((s:any)=>[s.cabinId.toString(),proposed.seatCount]));
      for(const old of booking.segments) {
        const released=booking.seatCount-(nextCounts.get(old.cabinId.toString()) ?? 0);
        if(released>0 && !await this.inventory.releaseBookedSeats(old.cabinId.toString(),released,session))throw new ConflictException('Original inventory could not be released');
      }
      const kept=proposed.segments.filter((s:any)=>booking.segments.some(o=>o.flightId.toString()===s.flightId.toString()&&o.cabinId.toString()===s.cabinId.toString())).map((s:any)=>s.flightId);
      const infants=proposed.passengers.filter((p:any)=>p.type===PassengerType.INFANT).map((p:any)=>p._id);
      await this.seats.assignments.deleteMany({flightBookingId:booking._id,$or:[{flightId:{$nin:kept}},{passengerId:{$in:infants}}]},{session}).exec();
      const updated=await this.bookings.updateOne({_id:booking._id,status:BookingStatus.CONFIRMED,
        $expr:{$and:[...originalFlights.map(f=>({$gt:[{$literal:f.departureAt},'$NOW']})),{$gt:[{$literal:change.holdExpiresAt},'$$NOW']},...proposed.segments.map((s:any)=>({$gt:[{$literal:s.departureAt},'$$NOW']}))]}},
        {$set:{segments:proposed.segments,passengers:proposed.passengers,seatCount:proposed.seatCount,baggageFee:proposed.baggageFee,totalAmount:proposed.totalAmount,currency:proposed.currency,lastDepartureAt:proposed.segments.at(-1).departureAt}},{session}).exec();
      if(updated.matchedCount!==1)throw new ConflictException('Booking or change deadline ended');
      await this.store.changes.updateOne({_id:change._id,status:BookingStatus.PENDING},{$set:{status:BookingStatus.CONFIRMED,appliedAt:new Date(),...(paymentId?{paymentId:new Types.ObjectId(paymentId)}:{}),refundDue:change.differenceAmount<0,proposed}},{session}).exec();
    });
  }
  async cancel(id:string,userId:string) {
    const change=await this.owned(id,userId);
    if(change.status!==BookingStatus.PENDING)throw new ConflictException('Only a pending change can be cancelled');
    await this.connection.transaction(async session=>{
      await this.bookings.updateOne({_id:change.flightBookingId},{$set:{updatedAt:new Date()}},{session}).exec();
      if(!await this.store.release(change._id,BookingStatus.CANCELLED,session,this.inventory))throw new ConflictException('Change already finished');
    });
    await this.payments.cancelPendingPayment({bookingType:'FLIGHT_CHANGE',bookingId:id});
    return this.view(await this.owned(id,userId));
  }
  async settleRefunds(bookingId:string):Promise<void> {
    const due=await this.store.changes.find({flightBookingId:new Types.ObjectId(bookingId),refundDue:true,status:BookingStatus.CONFIRMED}).sort({appliedAt:1,_id:1}).exec();
    for(const change of due) {
      try {
        const refund = await this.payments.createRefund({bookingType:'FLIGHT',bookingId,amount:-change.differenceAmount,reason:'Flight fare decrease '+change._id.toString()});
        if (refund.status === 'FAILED') throw new Error('Fare refund failed; retry is due');
        await this.store.changes.updateOne({_id:change._id},{$set:{refundDue:false}}).exec();
      } catch { this.logger.error('Flight change fare refund remains due'); }
    }
  }
  /** Durable terminal records remain so sweeps can retry payment cleanup after a crash. */
  async sweep(bookingId?:string):Promise<void> {
    const scope = bookingId ? { flightBookingId: this.id(bookingId) } : {};
    const pending=await this.store.changes.find({...scope,status:BookingStatus.PENDING}).sort({holdExpiresAt:1,_id:1}).limit(100).exec();
    for(const change of pending) {
      try {
      const original=await this.bookings.findById(change.flightBookingId).exec();
      const actual=original && await this.inventory.getFlight(original.segments[0].flightId.toString());
      const targets=await Promise.all(change.proposed.segments.map((s:any)=>this.inventory.getFlight(s.flightId.toString())));
      if(change.holdExpiresAt>new Date() && original?.status===BookingStatus.CONFIRMED && actual?.status==='SCHEDULED' && actual.departureAt>new Date() && targets.every(f=>f?.status==='SCHEDULED'&&f.departureAt>new Date()))continue;
      await this.connection.transaction(async session=>{
        await this.bookings.updateOne({_id:change.flightBookingId},{$set:{updatedAt:new Date()}},{session}).exec();
        await this.store.release(change._id,BookingStatus.EXPIRED,session,this.inventory);
      });
      } catch { this.logger.error('Could not release a replacement hold; it remains retryable'); }
    }
    const pipeline = expiredBookingPaymentPipeline('flight-change',this.store.changes.collection.name,100,[BookingStatus.EXPIRED,BookingStatus.CANCELLED,BookingStatus.CONFIRMED]);
    if (bookingId) pipeline.splice(2,0,{ $match: { 'booking.flightBookingId': this.id(bookingId) } });
    const terminal=await this.connection.collection('payments').aggregate<{flightBookingChangeId:Types.ObjectId}>(pipeline).toArray();
    for(const change of terminal) {
      try { await this.payments.cancelPendingPayment({bookingType:'FLIGHT_CHANGE',bookingId:change.flightBookingChangeId.toString()}); }
      catch { this.logger.error('Flight change payment cleanup remains due'); }
    }
    const refunds=await this.store.changes.distinct('flightBookingId',{...scope,refundDue:true});
    for(const id of refunds)await this.settleRefunds(id.toString());
  }
}
