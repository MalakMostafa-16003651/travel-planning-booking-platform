import { FavoritesModule } from '../src/favorites/favorites.module';
import { ItineraryExportsModule } from '../src/itinerary-exports/itinerary-exports.module';
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AdminModule } from '../src/admin/admin.module';
import { AdminProvidersService } from '../src/admin/admin-providers.service';
import { BlogModule } from '../src/blog/blog.module';
import { CurrenciesService } from '../src/currencies/currencies.service';
import { FlightBookingsMaintenanceService } from '../src/flight-bookings/flight-bookings-maintenance.service';
import { FLIGHT_INVENTORY, FlightInventoryPort } from '../src/flight-bookings/ports/flight-inventory.port';
import { FlightBookingsService } from '../src/flight-bookings/flight-bookings.service';
import { RoomInventoryAdapter } from '../src/hotel-bookings/adapters/room-inventory.adapter';
import { HotelBookingsService } from '../src/hotel-bookings/hotel-bookings.service';
import { Hotel } from '../src/hotels/schemas/hotel.schema';
import { Room } from '../src/hotels/schemas/room.schema';
import { ItinerariesModule } from '../src/itineraries/itineraries.module';
import { ItinerariesService } from '../src/itineraries/itineraries.service';
import { ReferenceDataService } from '../src/reference-data/reference-data.service';
import { StripeService } from '../src/payments/stripe.service';
import { UserRole } from '../src/common/enums/user-role.enum';
import { FakeStripe, TEST_STRIPE_CONFIG } from './fake-stripe';
import { PaymentsFixture } from './payments-fixture';

type Session = { cookie: string; userId: string };
function latch() {
  let open!: () => void;
  const promise = new Promise<void>(resolve => { open = resolve; });
  return { open, async wait() {
    let timer!: NodeJS.Timeout;
    try { await Promise.race([promise, new Promise<void>((_, reject) => { timer = setTimeout(() => reject(new Error('Race hook not reached')), 15_000); })]); }
    finally { clearTimeout(timer); }
  } };
}

describe('GEN-13 approved booking gates and payment recovery', { concurrency: false }, () => {
  const fixture = new PaymentsFixture();
  let owner: Session, admin: Session, mod: Session, stripe: FakeStripe;
  let hotels: Model<Hotel>, rooms: Model<Room>, inventory: RoomInventoryAdapter;
  const col = (name: string) => fixture.connection.collection(name);
  const getFlightBooking = (id: string) => col('flightbookings').findOne({ _id: new Types.ObjectId(id) });
  const hotelBooking = (id: string) => col('hotelbookings').findOne({ _id: new Types.ObjectId(id) });
  const getPayment = (bookingId: string) => col('payments').findOne({ $or: [{ flightBookingId: new Types.ObjectId(bookingId) }, { hotelBookingId: new Types.ObjectId(bookingId) }] });
  const deactive = (id: Types.ObjectId) => fixture.http().patch('/api/admin/providers/hotel/' + id + '/deactivate').set('Cookie', admin.cookie).send({});
  const removeRoom = (hotelId: Types.ObjectId, roomId: Types.ObjectId) => fixture.http().delete('/api/hotels/' + hotelId + '/rooms/' + roomId).set('Cookie', mod.cookie);
  const cancelFlightBooking = (id: string) => fixture.http().post('/api/flight-bookings/' + id + '/cancel').set('Cookie', owner.cookie);
  async function startPayment(type: 'flight' | 'hotel', bookingId: string) {
    await fixture.http().post('/api/bookings/' + type + '/' + bookingId + '/accept-policies').set('Cookie', owner.cookie).send({ accepted: true }).expect(200);
    const response = await fixture.http().post('/api/payments').set('Cookie', owner.cookie).send({ bookingType: type, bookingId }).expect(201);
    return response.body.payment.stripePaymentIntentId as string;
  }
  function success(intentId: string) {
    const event = FakeStripe.signedEvent('payment_intent.succeeded', stripe.succeed(intentId));
    return fixture.http().post('/api/payments/webhook').set('stripe-signature', event.signature).set('Content-Type', 'application/json').send(event.payload);
  }
  async function flight(paid = true) {
    const id = await fixture.holdBooking(owner.cookie), intentId = await startPayment('flight', id);
    if (paid) await success(intentId).expect(200);
    return { id, intentId, booking: (await getFlightBooking(id))! };
  }
  async function hotel() {
    const h = await hotels.create({ name: 'Gated Hotel', city: 'Cairo', countryCode: 'EG', address: 'Synthetic', cancellationTiers: [], checkInTime: '14:00', checkOutTime: '12:00' });
    const room = await rooms.create({ hotelId: h._id, name: 'Gated Room', capacity: 2, pricePerNight: 10000 });
    await col('moderatorassignments').insertOne({ moderatorId: new Types.ObjectId(mod.userId), hotelId: h._id });
    return { h, room };
  }
  const hold = (h: Hotel, room: Room) => fixture.http().post('/api/hotel-bookings').set('Cookie', owner.cookie).send({ hotelId: h._id.toString(), checkIn: '2035-01-10', checkOut: '2035-01-12', rooms: [{ roomId: room._id.toString(), adults: 1, childrenAges: [] }] });
  async function airlineMod() {
    const m = await fixture.login('airline-mod@example.com', UserRole.AIRLINE_MODERATOR);
    await col('moderatorassignments').insertOne({ moderatorId: new Types.ObjectId(m.userId), airlineId: fixture.airlineId });
    return m;
  }
  const providerCancel = (flightId: Types.ObjectId, m: Session) => fixture.http().post('/api/flights/' + flightId + '/cancel').set('Cookie', m.cookie);

  before(async () => {
    await fixture.start('booking-integration-recovery', undefined, TEST_STRIPE_CONFIG, [AdminModule, ItinerariesModule, BlogModule, FavoritesModule, ItineraryExportsModule]);
    hotels = fixture.app.get(getModelToken(Hotel.name)); rooms = fixture.app.get(getModelToken(Room.name)); inventory = fixture.app.get(RoomInventoryAdapter);
  }, { timeout: 120_000 });
  after(() => fixture.stop());
  beforeEach(async () => {
    await fixture.reset(); stripe = new FakeStripe(); stripe.install(fixture.app.get(StripeService));
    await fixture.app.get(CurrenciesService).seedSupported(); await fixture.app.get(ReferenceDataService).seedSupported();
    owner = await fixture.login('recovery-owner@example.com'); admin = await fixture.login('recovery-admin@example.com', UserRole.ADMIN); mod = await fixture.login('recovery-mod@example.com', UserRole.HOTEL_MODERATOR);
  });

  it('N1: a restarted sweep retries a failed expired-flight payment cancellation, then stops reissuing it', async (context) => {
    const gateway = fixture.app.get(StripeService), cancel = context.mock.method(gateway, 'cancelPaymentIntent', gateway.cancelPaymentIntent.bind(gateway));
    const b = await flight(false); stripe.failNextCancel = true; stripe.failNextRetrieve = true; await fixture.expireHold(b.id);
    await fixture.flightBookings.expireOverdueHolds();
    assert.equal((await getFlightBooking(b.id))!.status, 'EXPIRED'); assert.equal((await getPayment(b.id))!.status, 'PENDING');
    assert.equal(stripe.intent(b.intentId).status, 'requires_payment_method');
    await new FlightBookingsMaintenanceService(fixture.flightBookings).sweep();
    assert.equal(stripe.intent(b.intentId).status, 'canceled'); assert.equal((await getPayment(b.id))!.status, 'FAILED');
    const calls = cancel.mock.callCount(); await fixture.flightBookings.expireOverdueHolds(); assert.equal(cancel.mock.callCount(), calls);
  });
  it('N1: an expired SUCCEEDED payment with failed compensation is recovered without a duplicate refund', async () => {
    const b = await flight(false); stripe.succeed(b.intentId); stripe.failNextCancel = true; stripe.failNextRefund = true; await fixture.expireHold(b.id);
    await fixture.flightBookings.expireOverdueHolds();
    assert.equal((await getPayment(b.id))!.status, 'SUCCEEDED'); assert.equal((await getPayment(b.id))!.autoRefundedAt, undefined);
    await fixture.flightBookings.expireOverdueHolds(); assert.equal(stripe.calls.createRefund, 1);
    assert.ok((await getPayment(b.id))!.autoRefundedAt); await fixture.flightBookings.expireOverdueHolds(); assert.equal(stripe.calls.createRefund, 1);
  });
  it('N2: failed booked-seat release rolls the actual release and cancellation back, with no refund', async (context) => {
    const b = await flight(), port = fixture.app.get<FlightInventoryPort>(FLIGHT_INVENTORY, { strict: false }), original = port.releaseBookedSeats.bind(port);
    const failure = context.mock.method(port, 'releaseBookedSeats', async (...args: Parameters<FlightInventoryPort['releaseBookedSeats']>) => { await original(...args); return false; });
    try { await cancelFlightBooking(b.id).expect(409); } finally { failure.mock.restore(); }
    assert.equal((await getFlightBooking(b.id))!.status, 'CONFIRMED'); assert.equal((await col('cabininventories').findOne({ _id: b.booking.segments[0].cabinId }))!.bookedSeats, 1); assert.equal(stripe.calls.createRefund, 0);
    await cancelFlightBooking(b.id).expect(200); assert.equal(stripe.calls.createRefund, 1);
  });
  it('N2: held-seat release failure preserves a retryable pending booking and does not cancel payment early', async (context) => {
    const gateway = fixture.app.get(StripeService), cancel = context.mock.method(gateway, 'cancelPaymentIntent', gateway.cancelPaymentIntent.bind(gateway));
    const b = await flight(false), port = fixture.app.get<FlightInventoryPort>(FLIGHT_INVENTORY, { strict: false }), original = port.releaseHeldSeats.bind(port);
    await fixture.expireHold(b.id);
    const failure = context.mock.method(port, 'releaseHeldSeats', async (...args: Parameters<FlightInventoryPort['releaseHeldSeats']>) => { await original(...args); return false; });
    try { assert.equal(await fixture.flightBookings.expireOverdueHolds(), 0); } finally { failure.mock.restore(); }
    assert.equal((await getFlightBooking(b.id))!.status, 'PENDING'); assert.equal((await col('cabininventories').findOne({ _id: b.booking.segments[0].cabinId }))!.heldSeats, 1); assert.equal(cancel.mock.callCount(), 0);
    assert.equal(await fixture.flightBookings.expireOverdueHolds(), 1); assert.equal(stripe.intent(b.intentId).status, 'canceled');
  });
  it('N3: provider cancellation wins before cleanup; user quote and cancellation receive the full refund once', async (context) => {
    const b = await flight(), m = await airlineMod(), entered = latch(), release = latch(), original = fixture.flightBookings.cancelBookingsForFlight.bind(fixture.flightBookings);
    context.mock.method(fixture.flightBookings, 'cancelBookingsForFlight', async (id: string) => { entered.open(); await release.wait(); return original(id); });
    const pending = providerCancel(b.booking.segments[0].flightId, m).then(r => r);
    await entered.wait();
    try {
      const quote = await fixture.http().get('/api/flight-bookings/' + b.id + '/cancellation-quote').set('Cookie', owner.cookie).expect(200);
      assert.equal(quote.body.refundPercentage, 100); await cancelFlightBooking(b.id).expect(200);
    } finally { release.open(); }
    assert.equal((await pending).status, 201); const stored = (await getFlightBooking(b.id))!;
    assert.equal(stored.cancelledBy, 'AIRLINE'); assert.equal(stored.refundAmount, stored.totalAmount); assert.equal(stripe.calls.createRefund, 1);
  });
  it('N3: a user cancellation that holds the Flight gate first keeps its policy refund when the provider cancels later', async (context) => {
    const b = await flight(), m = await airlineMod(), entered = latch(), release = latch(), port = fixture.app.get<FlightInventoryPort>(FLIGHT_INVENTORY, { strict: false }), original = port.releaseBookedSeats.bind(port);
    context.mock.method(port, 'releaseBookedSeats', async (...args: Parameters<FlightInventoryPort['releaseBookedSeats']>) => { const result = await original(...args); entered.open(); await release.wait(); return result; });
    const user = cancelFlightBooking(b.id).then(r => r); await entered.wait(); const provider = providerCancel(b.booking.segments[0].flightId, m).then(r => r); release.open();
    assert.equal((await user).status, 200); assert.equal((await provider).status, 201);
    const stored = (await getFlightBooking(b.id))!; assert.equal(stored.cancelledBy, 'USER'); assert.equal(stored.refundAmount, 7500); assert.equal(stripe.calls.createRefund, 1);
  });
  it('a flight cancelled before an in-flight paid confirmation cannot become confirmed; the late money is refunded', async (context) => {
    const b = await flight(false), m = await airlineMod(), entered = latch(), release = latch(), port = fixture.app.get<FlightInventoryPort>(FLIGHT_INVENTORY, { strict: false }), original = port.acquireBookingGate.bind(port); let once = true;
    context.mock.method(port, 'acquireBookingGate', async (...args: Parameters<FlightInventoryPort['acquireBookingGate']>) => { if (once) { once = false; entered.open(); await release.wait(); } return original(...args); });
    const paying = success(b.intentId).then(r => r); await entered.wait();
    try { await providerCancel(b.booking.segments[0].flightId, m).expect(201); } finally { release.open(); }
    assert.equal((await paying).status, 200); assert.equal((await getFlightBooking(b.id))!.status, 'EXPIRED'); assert.equal(stripe.calls.createRefund, 1);
  });
  for (const target of ['hotel', 'room'] as const) {
    it('R3/R4: ' + target + ' deactivation wins after hold preflight; the entire hold fails without inventory', async (context) => {
      const { h, room } = await hotel(), entered = latch(), release = latch(), original = inventory.acquireBookingGate.bind(inventory); let once = true;
      context.mock.method(inventory, 'acquireBookingGate', async (...args: Parameters<RoomInventoryAdapter['acquireBookingGate']>) => { if (once) { once = false; entered.open(); await release.wait(); } return original(...args); });
      const holding = hold(h, room).then(r => r); await entered.wait();
      try { if (target === 'hotel') await deactive(h._id).expect(200); else await removeRoom(h._id, room._id).expect(204); } finally { release.open(); }
      assert.equal((await holding).status, 404); assert.equal(await col('hotelbookings').countDocuments({}), 0); assert.equal((await col('roomavailabilities').findOne({ roomId: room._id }))!.bookedRanges.length, 0);
    });
  }
  it('R3: a hold with the Hotel gate first commits before deactivation, then the real cleanup expires it', async (context) => {
    const { h, room } = await hotel(), entered = latch(), release = latch(), started = latch(), original = inventory.holdRoom.bind(inventory), providers = fixture.app.get(AdminProvidersService), deactivate = providers.deactivate.bind(providers); let once = true;
    context.mock.method(inventory, 'holdRoom', async (...args: Parameters<RoomInventoryAdapter['holdRoom']>) => { const result = await original(...args); if (once) { once = false; entered.open(); await release.wait(); } return result; });
    context.mock.method(providers, 'deactivate', (...args: Parameters<AdminProvidersService['deactivate']>) => { started.open(); return deactivate(...args); });
    const holding = hold(h, room).then(r => r); await entered.wait(); const disabling = deactive(h._id).then(r => r); await started.wait(); release.open();
    const held = await holding; assert.equal(held.status, 201); assert.equal((await disabling).status, 200); assert.equal((await hotelBooking(held.body.hotelBookingId))!.status, 'EXPIRED');
    assert.equal((await col('roomavailabilities').findOne({ roomId: room._id }))!.bookedRanges.length, 0);
  });
  it('R4: a new hold after the room eligibility read forces deactivation to retry and reject409', async (context) => {
    const { h, room } = await hotel(), service = fixture.app.get(HotelBookingsService), original = service.roomHasActiveReservations.bind(service), entered = latch(), release = latch(); let once = true;
    context.mock.method(service, 'roomHasActiveReservations', async (...args: Parameters<HotelBookingsService['roomHasActiveReservations']>) => { const active = await original(...args); if (once && !active) { once = false; entered.open(); await release.wait(); } return active; });
    const disabling = removeRoom(h._id, room._id).then(r => r); await entered.wait(); let held;
    try { held = await hold(h, room).expect(201); } finally { release.open(); }
    assert.equal((await disabling).status, 409); assert.equal((await rooms.findById(room._id))!.isActive, true); assert.equal((await hotelBooking(held.body.hotelBookingId))!.status, 'PENDING');
  });
  it('hotel deactivation before a paid confirmation wins the shared gate and causes full compensation', async (context) => {
    const { h, room } = await hotel(), held = await hold(h, room).expect(201), id = held.body.hotelBookingId, intentId = await startPayment('hotel', id), original = inventory.acquireBookingGate.bind(inventory), entered = latch(), release = latch(); let once = true;
    context.mock.method(inventory, 'acquireBookingGate', async (...args: Parameters<RoomInventoryAdapter['acquireBookingGate']>) => { if (once) { once = false; entered.open(); await release.wait(); } return original(...args); });
    const paying = success(intentId).then(r => r); await entered.wait(); try { await deactive(h._id).expect(200); } finally { release.open(); }
    assert.equal((await paying).status, 200); assert.equal((await hotelBooking(id))!.status, 'EXPIRED'); assert.equal(stripe.calls.createRefund, 1);
  });
  it('a paid hotel confirmation with the gate first remains valid after provider deactivation', async (context) => {
    const { h, room } = await hotel(), held = await hold(h, room).expect(201), id = held.body.hotelBookingId, intentId = await startPayment('hotel', id), original = inventory.confirmHeldRoom.bind(inventory), entered = latch(), release = latch(), started = latch(), providers = fixture.app.get(AdminProvidersService), deactivate = providers.deactivate.bind(providers);
    context.mock.method(inventory, 'confirmHeldRoom', async (...args: Parameters<RoomInventoryAdapter['confirmHeldRoom']>) => { const result = await original(...args); entered.open(); await release.wait(); return result; });
    context.mock.method(providers, 'deactivate', (...args: Parameters<AdminProvidersService['deactivate']>) => { started.open(); return deactivate(...args); });
    const paying = success(intentId).then(r => r); await entered.wait(); const disabling = deactive(h._id).then(r => r); await started.wait(); release.open();
    assert.equal((await paying).status, 200); assert.equal((await disabling).status, 200); assert.equal((await hotelBooking(id))!.status, 'CONFIRMED'); assert.equal(stripe.calls.createRefund, 0);
    assert.equal((await col('roomavailabilities').findOne({ roomId: room._id }))!.bookedRanges[0].status, 'BOOKED');
  });
  it('private counters are hidden on created/query documents and malformed/unsafe gate values fail closed', async () => {
    const { h, room } = await hotel(); assert.equal(h.toJSON().bookingVersion, undefined); assert.equal(room.toObject().bookingVersion, undefined);
    for (const target of ['hotels', 'rooms']) {
      const _id = target === 'hotels' ? h._id : room._id;
      for (const value of ['bad', -1, 0.5, Number.MAX_SAFE_INTEGER]) {
        await col(target).updateOne({ _id }, { $set: { bookingVersion: value } }); await hold(h, room).expect(409); assert.equal(await col('hotelbookings').countDocuments({}), 0);
      }
      await col(target).updateOne({ _id }, { $set: { bookingVersion: null } });
    }
    const held = await hold(h, room).expect(201); assert.equal(held.body.bookingVersion, undefined);
    const b = await flight(false), flightId = b.booking.segments[0].flightId;
    for (const value of ['bad', -1, 0.5, Number.MAX_SAFE_INTEGER]) {
      await col('flights').updateOne({ _id: flightId }, { $set: { bookingVersion: value } });
      await assert.rejects(fixture.flightBookings.confirmPaidBooking(b.id, new Types.ObjectId().toString()), { status: 409 });
    }
    await col('flights').updateOne({ _id: flightId }, { $unset: { bookingVersion: 1 } });
    for (const value of ['bad', -1, 0.5, Number.MAX_SAFE_INTEGER]) {
      await col('airlines').updateOne({ _id: fixture.airlineId }, { $set: { bookingVersion: value } });
      await assert.rejects(fixture.flightBookings.confirmPaidBooking(b.id, new Types.ObjectId().toString()), { status: 409 });
    }
    await col('airlines').updateOne({ _id: fixture.airlineId }, { $set: { bookingVersion: null } });

    await success(b.intentId).expect(200); const before = (await col('flights').findOne({ _id: flightId }))!.bookingVersion;
    await success(b.intentId).expect(200); assert.equal((await col('flights').findOne({ _id: flightId }))!.bookingVersion, before);
    const publicFlight = await fixture.http().get('/api/flights/' + flightId).expect(200); assert.equal(publicFlight.body.bookingVersion, undefined);
    const publicAirline = await fixture.http().get('/api/airlines/' + fixture.airlineId).expect(200); assert.equal(publicAirline.body.bookingVersion, undefined);
  });

  it('Airline gate: deactivation after flight hold preflight prevents a new pending booking', async (context) => {
    const existingId = await fixture.holdBooking(owner.cookie), existing = (await getFlightBooking(existingId))!, port = fixture.app.get<FlightInventoryPort>(FLIGHT_INVENTORY, { strict: false }), original = port.acquireAirlineBookingGate.bind(port), entered = latch(), release = latch(); let once = true;
    context.mock.method(port, 'acquireAirlineBookingGate', async (...args: Parameters<FlightInventoryPort['acquireAirlineBookingGate']>) => { if (once) { once = false; entered.open(); await release.wait(); } return original(...args); });
    const pending = fixture.http().post('/api/flight-bookings/hold').set('Cookie', owner.cookie).send({ segments: existing.segments.map((segment: any) => ({ flightId: segment.flightId.toString(), cabinId: segment.cabinId.toString() })), passengers: [{ fullName: 'Second Traveler', dateOfBirth: '1995-04-12', documentNumber: 'A12345678', type: 'ADULT' }] }).then(r => r);
    await entered.wait();
    try { await fixture.http().patch('/api/admin/providers/airline/' + fixture.airlineId + '/deactivate').set('Cookie', admin.cookie).send({}).expect(200); } finally { release.open(); }
    assert.equal((await pending).status, 409); assert.equal(await col('flightbookings').countDocuments({}), 1);
    assert.equal((await col('cabininventories').findOne({ _id: existing.segments[0].cabinId }))!.heldSeats, 1);
  });
  it('Airline gate: deactivation before a new paid confirmation rejects it and refunds the money', async (context) => {
    const b = await flight(false), port = fixture.app.get<FlightInventoryPort>(FLIGHT_INVENTORY, { strict: false }), original = port.acquireAirlineBookingGate.bind(port), entered = latch(), release = latch(); let once = true;
    context.mock.method(port, 'acquireAirlineBookingGate', async (...args: Parameters<FlightInventoryPort['acquireAirlineBookingGate']>) => { if (once) { once = false; entered.open(); await release.wait(); } return original(...args); });
    const paying = success(b.intentId).then(r => r); await entered.wait();
    try { await fixture.http().patch('/api/admin/providers/airline/' + fixture.airlineId + '/deactivate').set('Cookie', admin.cookie).send({}).expect(200); } finally { release.open(); }
    assert.equal((await paying).status, 200); assert.equal((await getFlightBooking(b.id))!.status, 'PENDING'); assert.equal(stripe.calls.createRefund, 1);
    assert.equal((await col('cabininventories').findOne({ _id: b.booking.segments[0].cabinId }))!.bookedSeats, 0);
  });
  it('Airline gate: confirmation that wins first remains valid and can still be cancelled after deactivation', async (context) => {
    const b = await flight(false), port = fixture.app.get<FlightInventoryPort>(FLIGHT_INVENTORY, { strict: false }), original = port.convertHeldToBooked.bind(port), providers = fixture.app.get(AdminProvidersService), deactivate = providers.deactivate.bind(providers), entered = latch(), release = latch(), started = latch();
    context.mock.method(port, 'convertHeldToBooked', async (...args: Parameters<FlightInventoryPort['convertHeldToBooked']>) => { const result = await original(...args); entered.open(); await release.wait(); return result; });
    context.mock.method(providers, 'deactivate', (...args: Parameters<AdminProvidersService['deactivate']>) => { started.open(); return deactivate(...args); });
    const paying = success(b.intentId).then(r => r); await entered.wait();
    const disabling = fixture.http().patch('/api/admin/providers/airline/' + fixture.airlineId + '/deactivate').set('Cookie', admin.cookie).send({}).then(r => r); await started.wait(); release.open();
    assert.equal((await paying).status, 200); assert.equal((await disabling).status, 200); assert.equal((await getFlightBooking(b.id))!.status, 'CONFIRMED'); assert.equal(stripe.calls.createRefund, 0);
    await success(b.intentId).expect(200); await cancelFlightBooking(b.id).expect(200);
    assert.equal((await getFlightBooking(b.id))!.refundAmount, 7500); assert.equal((await getFlightBooking(b.id))!.cancelledBy, 'USER');
  });
  it('R6/R7: hotel quotes meet guest capacity and reject impossible/past dates before returning results', async () => {
    const { h, room } = await hotel(); await rooms.updateOne({ _id: room._id }, { $set: { capacity: 1, pricePerNight: 1000 } });
    await rooms.create({ hotelId: h._id, name: 'Large', capacity: 4, pricePerNight: 20000 });
    const query = { city: 'Cairo', guests: 4, checkIn: '2035-01-10', checkOut: '2035-01-12' };
    assert.equal((await fixture.http().get('/api/hotels/search').query({ ...query, maxPrice: 1500 }).expect(200)).body.total, 0);
    assert.equal((await fixture.http().get('/api/hotels/search').query(query).expect(200)).body.items[0].fromPrice, 20000);
    for (const checkIn of ['2027-02-30', '2020-01-01']) {
      await fixture.http().get('/api/hotels/search').query({ ...query, checkIn }).expect(400);
      await fixture.http().get('/api/hotels/' + h._id + '/rooms/available').query({ checkIn, checkOut: '2035-01-12' }).expect(400);
    }
  });
  it('R8/blog handoff: normalizes valid author IDs and the blog reuses the public reader without private fields', async (context) => {
    const created = await fixture.http().post('/api/itineraries').set('Cookie', owner.cookie).send({ title: 'Shared reader', countries: ['EG'], startDate: '2035-01-10', currency: 'USD', visibility: 'PUBLIC' }).expect(201);
    const service = fixture.app.get(ItinerariesService), original = service.listPublicByAuthor.bind(service), probe = context.mock.method(service, 'listPublicByAuthor', (...args: Parameters<ItinerariesService['listPublicByAuthor']>) => original(...args));
    assert.equal((await service.listPublicByAuthor(owner.userId.toUpperCase())).total, 1);
    const author = await fixture.http().get('/api/authors/' + owner.userId).expect(200); assert.equal(author.body.itineraries.total, 1); assert.ok(probe.mock.callCount() >= 2);
    const summary = author.body.itineraries.items[0]; assert.equal(summary.itineraryId, created.body.itineraryId);
    for (const key of ['linkedBookings', 'transportCosts', 'activities', 'budgets']) assert.equal(summary[key], undefined);
    const attached = await fixture.http().post('/api/posts').set('Cookie', owner.cookie).send({ title: 'Shared moderation', content: 'Public itinerary attachment.', status: 'PUBLISHED', itineraryId: created.body.itineraryId }).expect(201);
    assert.equal(attached.body.itinerary.itineraryId, created.body.itineraryId);
    await fixture.http().post('/api/favorites').set('Cookie', owner.cookie).send({ itineraryId: created.body.itineraryId }).expect(201);
    await service.setItineraryHidden(created.body.itineraryId, true);
    const favorite = (await fixture.http().get('/api/favorites').set('Cookie', owner.cookie).expect(200)).body.items[0];
    assert.equal(favorite.available, false); assert.equal(favorite.itinerary, undefined);
    const pdf = await fixture.http().get('/api/itineraries/' + created.body.itineraryId + '/pdf').set('Cookie', owner.cookie).expect(200);
    assert.equal(pdf.headers['content-type'].split(';')[0], 'application/pdf');
    await fixture.http().get('/api/itineraries/' + created.body.itineraryId + '/pdf').set('Cookie', admin.cookie).expect(404);
    assert.equal((await fixture.http().get('/api/authors/' + owner.userId).expect(200)).body.itineraries.total, 0);
    for (const cookie of [undefined, owner.cookie, admin.cookie]) {
      const request = fixture.http().get('/api/posts/' + attached.body.postId);
      if (cookie) request.set('Cookie', cookie);
      assert.equal((await request.expect(200)).body.itinerary, null);
    }
    await fixture.http().post('/api/posts').set('Cookie', owner.cookie).send({ title: 'Hidden target', content: 'Refused attachment.', itineraryId: created.body.itineraryId }).expect(400);
    await service.setItineraryHidden(created.body.itineraryId, false);
    assert.equal((await fixture.http().get('/api/posts/' + attached.body.postId).expect(200)).body.itinerary.itineraryId, created.body.itineraryId);
  });
});
