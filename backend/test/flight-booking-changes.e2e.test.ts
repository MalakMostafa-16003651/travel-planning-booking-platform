import { readBookingId } from '../src/payments/booking-ref';
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { Types } from 'mongoose';
import { FlightBookingChangesService } from '../src/flight-bookings/flight-booking-changes.service';
import { FlightBookingChangesStore } from '../src/flight-bookings/flight-booking-changes.store';
import { FlightBookingsMaintenanceService } from '../src/flight-bookings/flight-bookings-maintenance.service';
import { FlightsModule } from '../src/flights/flights.module';
import { AdminAnalyticsModule } from '../src/admin-analytics/admin-analytics.module';
import { StripeService } from '../src/payments/stripe.service';
import { PoliciesService } from '../src/payments/policies.service';
import { RefundsService } from '../src/payments/refunds.service';
import { PaymentsService } from '../src/payments/payments.service';
import { FakeStripe, TEST_STRIPE_CONFIG } from './fake-stripe';
import { PaymentsFixture } from './payments-fixture';

describe('FLT-27 replacement holds, Stripe differences and refund receipts', { concurrency:false },()=>{
  const f=new PaymentsFixture();
  let stripe:FakeStripe, owner:{cookie:string;userId:string}, id:string, original:any;
  const col=(name:string)=>f.connection.collection(name);
  const objectId=(id:string)=>new Types.ObjectId(id);
  const getBooking=()=>col('flightbookings').findOne({_id:objectId(id)});
  const service=()=>f.app.get(FlightBookingChangesService);
  const stored=(cid:string)=>col('flightbookingchanges').findOne({_id:objectId(cid)});
  const post=(url:string,body:object={})=>f.http().post('/api/'+url).set('Cookie',owner.cookie).send(body);
  async function event(type:string,object:unknown){const e=FakeStripe.signedEvent(type,object);return f.http().post('/api/payments/webhook').set('stripe-signature',e.signature).set('Content-Type','application/json').send(e.payload).expect(200);}
  async function payment(type:string,bid:string){
    await post('bookings/'+type+'/'+bid+'/accept-policies',{accepted:true}).expect(200);
    return (await post('payments',{bookingType:type,bookingId:bid}).expect(201)).body.payment;
  }
  async function replacement(price=20000,extra:Record<string,unknown>={}) {
    const current=(await getBooking())!;
    const old=(await col('flights').findOne({_id:current.segments[0].flightId}))!;
    const flightId=new Types.ObjectId(),cabinId=new Types.ObjectId();
    const departureAt=new Date(old.departureAt.getTime()+86400000);
    await col('flights').insertOne({...old,_id:flightId,flightNumber:'MS'+flightId.toString().slice(-4),departureAt,arrivalAt:new Date(departureAt.getTime()+14400000),...extra});
    await col('cabininventories').insertOne({_id:cabinId,flightId,cabinClass:'ECONOMY',totalSeats:10,heldSeats:0,bookedSeats:0,price,baggageMaxWeightKg:23});
    return {flightId:flightId.toString(),cabinId:cabinId.toString()};
  }
  async function proposal(price=20000) {
    const selection=await replacement(price);
    const change=(await post('flight-bookings/'+id+'/changes',{segments:[selection]}).expect(201)).body;
    return {cid:change.flightBookingChangeId as string,selection,change};
  }
  async function applyPaid(cid:string) {
    const pay=await payment('flight-change',cid);
    await event('payment_intent.succeeded',stripe.succeed(pay.stripePaymentIntentId));
    return pay;
  }
  const confirm=(cid:string)=>post('flight-booking-changes/'+cid+'/confirm');
  before(async()=>{await f.start('flight-changes',undefined,TEST_STRIPE_CONFIG,[FlightsModule,AdminAnalyticsModule]);f.app.get(FlightBookingsMaintenanceService).onModuleDestroy();},{timeout:120000});
  after(()=>f.stop());
  beforeEach(async()=>{
    await f.reset();stripe=new FakeStripe();stripe.install(f.app.get(StripeService));stripe.refundStatus='succeeded';
    owner=await f.login('change-owner@example.com');
    id=await f.holdBooking(owner.cookie);
    const pay=await payment('flight',id);await event('payment_intent.succeeded',stripe.succeed(pay.stripePaymentIntentId));
    original=(await getBooking())!;
  });

  it('holds only the replacement capacity while preserving original confirmation and reference',async()=>{
    const {cid,selection,change}=await proposal();
    assert.equal(change.differenceAmount,5000);assert.equal(change.amountToPay,5000);
    assert.equal((await getBooking())!.bookingReference,original.bookingReference);
    assert.equal((await getBooking())!.segments[0].flightId.toString(),original.segments[0].flightId.toString());
    assert.equal((await col('cabininventories').findOne({_id:objectId(selection.cabinId)}))!.heldSeats,1);
    assert.equal((await col('cabininventories').findOne({_id:original.segments[0].cabinId}))!.bookedSeats,1);
    assert.equal((await stored(cid))!.status,'PENDING');
    await post('flight-bookings/'+id+'/changes',{segments:[await replacement()]}).expect(409);
  });
  it('charges only the positive difference and atomically switches once on signed success',async()=>{
    const {cid,selection}=await proposal(25000);
    await confirm(cid).expect(409);
    const pay=await applyPaid(cid);assert.equal(pay.amount,100);assert.equal(pay.flightBookingId,undefined);
    assert.equal(pay.flightBookingChangeId,cid);
    const booking=(await getBooking())!;assert.equal(booking._id.toString(),id);assert.equal(booking.bookingReference,original.bookingReference);
    assert.equal(booking.totalAmount,25000);assert.equal(booking.segments[0].flightId.toString(),selection.flightId);
    assert.equal((await col('cabininventories').findOne({_id:original.segments[0].cabinId}))!.bookedSeats,0);
    const cabin=(await col('cabininventories').findOne({_id:objectId(selection.cabinId)}))!;
    assert.equal(cabin.bookedSeats,1);assert.equal(cabin.heldSeats,0);
    await event('payment_intent.succeeded',stripe.succeed(pay.stripePaymentIntentId));
    assert.equal(stripe.calls.createRefund,0);
  });
  it('requires accepted policies for equal fares and avoids zero-value payments',async()=>{
    const {cid}=await proposal(15000);
    await confirm(cid).expect(409);
    await post('bookings/flight-change/'+cid+'/accept-policies',{accepted:true}).expect(200);
    await post('payments',{bookingType:'flight-change',bookingId:cid}).expect(409);
    await confirm(cid).expect(201);await confirm(cid).expect(201);
    assert.equal(stripe.calls.createIntent,1);assert.equal((await stored(cid))!.status,'CONFIRMED');
  });
  it('refunds a lower fare, then cancellations against original plus applied change receipts',async()=>{
    await col('airlines').updateOne({_id:f.airlineId},{$set:{cancellationTiers:[{daysBeforeDeparture:0,refundPercentage:100}]}});
    const up=await proposal(30000);await applyPaid(up.cid);
    const down=await proposal(10000);
    await post('bookings/flight-change/'+down.cid+'/accept-policies',{accepted:true}).expect(200);
    const response=(await confirm(down.cid).expect(201)).body;
    assert.equal(response.refund.amount,20000);assert.equal(response.refund.status,'REFUNDED');
    assert.equal((await getBooking())!.totalAmount,10000);assert.equal((await stored(down.cid))!.refundDue,false);
    assert.equal([...stripe.refunds.values()].reduce((sum,r)=>sum+r.amount,0),20000);
    for (const refund of await col('refunds').find({flightBookingId:objectId(id)}).toArray()) assert.equal(readBookingId(refund as any),id);
    await post('flight-bookings/'+id+'/cancel').expect(200);
    assert.equal([...stripe.refunds.values()].reduce((sum,r)=>sum+r.amount,0),30000);
    const details=(await f.http().get('/api/flight-bookings/'+id).set('Cookie',owner.cookie).expect(200)).body;
    assert.equal(details.refund.amount,10000);assert.equal(details.refund.status,'REFUNDED');
    await service().sweep();
    assert.equal([...stripe.refunds.values()].reduce((sum,r)=>sum+r.amount,0),30000);
  });
  it('expires an unpaid change and compensates a late successful charge without replacing the original',async()=>{
    const {cid,selection}=await proposal();const pay=await payment('flight-change',cid);
    await col('flightbookingchanges').updateOne({_id:objectId(cid)},{$set:{holdExpiresAt:new Date(Date.now()-1000)}});
    await service().sweep();
    assert.equal((await stored(cid))!.status,'EXPIRED');
    assert.equal((await col('cabininventories').findOne({_id:objectId(selection.cabinId)}))!.heldSeats,0);
    await event('payment_intent.succeeded',stripe.succeed(pay.stripePaymentIntentId));
    assert.equal((await getBooking())!.segments[0].flightId.toString(),original.segments[0].flightId.toString());
    assert.equal([...stripe.refunds.values()].reduce((sum,r)=>sum+r.amount,0),5000);
  });
  it('cancels a pending replacement and leaves the original booked seats intact',async()=>{
    const {cid,selection}=await proposal();
    await post('flight-booking-changes/'+cid+'/cancel').expect(201);
    assert.equal((await stored(cid))!.status,'CANCELLED');assert.equal((await getBooking())!.status,'CONFIRMED');
    assert.equal((await col('cabininventories').findOne({_id:objectId(selection.cabinId)}))!.heldSeats,0);
    assert.equal((await col('cabininventories').findOne({_id:original.segments[0].cabinId}))!.bookedSeats,1);
  });
  it('original cancellation releases a pending replacement and late money is fully compensated',async()=>{
    const {cid,selection}=await proposal();const pay=await payment('flight-change',cid);
    await post('flight-bookings/'+id+'/cancel').expect(200);
    assert.equal((await stored(cid))!.status,'CANCELLED');
    assert.equal((await col('cabininventories').findOne({_id:objectId(selection.cabinId)}))!.heldSeats,0);
    await event('payment_intent.succeeded',stripe.succeed(pay.stripePaymentIntentId));
    const refund=await col('refunds').findOne({flightBookingChangeId:objectId(cid)});
    assert.equal(refund!.amount,50);assert.equal((await getBooking())!.status,'CANCELLED');
  });
  it('rejects wrong routes, cabin classes, legs, identical selections and client prices',async()=>{
    await post('flight-bookings/'+id+'/changes',{segments:original.segments.map((s:any)=>({flightId:s.flightId.toString(),cabinId:s.cabinId.toString()}))}).expect(400);
    const bad=await replacement();await col('cabininventories').updateOne({_id:objectId(bad.cabinId)},{$set:{cabinClass:'BUSINESS'}});
    await post('flight-bookings/'+id+'/changes',{segments:[bad]}).expect(400);
    const route=await replacement(20000,{departureAirportId:new Types.ObjectId()});
    await post('flight-bookings/'+id+'/changes',{segments:[route]}).expect(404);
    await post('flight-bookings/'+id+'/changes',{segments:[await replacement()],totalAmount:1}).expect(400);
    assert.equal(await col('flightbookingchanges').countDocuments({}),0);
  });
  it('enforces auth, ownership and origin checks on all change operations',async()=>{
    const selection=await replacement();
    await f.http().post('/api/flight-bookings/'+id+'/changes').send({segments:[selection]}).expect(401);
    const other=await f.login('change-other@example.com');
    await f.http().post('/api/flight-bookings/'+id+'/changes').set('Cookie',other.cookie).send({segments:[selection]}).expect(404);
    const {cid}=await proposal();
    await f.http().get('/api/flight-booking-changes/'+cid).set('Cookie',other.cookie).expect(404);
    await f.http().post('/api/flight-booking-changes/'+cid+'/cancel').set('Cookie',owner.cookie).set('Origin','https://evil.example').send({}).expect(403);
  });
  it('rolls inventory and booking changes back when replacement conversion fails',async context=>{
    const {cid,selection}=await proposal(15000);
    await post('bookings/flight-change/'+cid+'/accept-policies',{accepted:true}).expect(200);
    const assignments=f.app.get(FlightBookingChangesStore).changes;
    const originalUpdate=assignments.updateOne.bind(assignments);
    const hook=context.mock.method(assignments,'updateOne',((...args:any[])=>{if(args[1]?.$set?.appliedAt)throw new Error('Injected apply write failure');return (originalUpdate as any)(...args);}) as typeof assignments.updateOne);
    await confirm(cid).expect(500);hook.mock.restore();
    assert.equal((await getBooking())!.totalAmount,15000);assert.equal((await stored(cid))!.status,'PENDING');
    const cabin=(await col('cabininventories').findOne({_id:objectId(selection.cabinId)}))!;
    assert.equal(cabin.heldSeats,1);assert.equal(cabin.bookedSeats,0);
    await confirm(cid).expect(201);
  });
  it('migrates only the legacy policy index and permits separate later change acceptances',async()=>{
    const policies=col('policyacceptances');
    await policies.createIndex({userId:1,bookingType:1,flightBookingId:1,hotelBookingId:1},{unique:true,name:'policy_acceptances_booking_unique'});
    await f.app.get(PoliciesService).onModuleInit();
    const first=await proposal(15000);await post('bookings/flight-change/'+first.cid+'/accept-policies',{accepted:true}).expect(200);await confirm(first.cid).expect(201);
    const second=await proposal(15000);await post('bookings/flight-change/'+second.cid+'/accept-policies',{accepted:true}).expect(200);
    assert.equal(await policies.countDocuments({bookingType:'flight-change'}),2);
    assert.ok(!(await policies.indexes()).some(i=>i.name==='policy_acceptances_booking_unique'));
  });
  it('publishes all replacement and payment-type operations in Swagger',async()=>{
    const doc=(await f.http().get('/api/docs-json').expect(200)).body;
    assert.ok(doc.paths['/api/flight-bookings/{id}/changes'].post);
    assert.ok(doc.components.schemas.CreatePaymentDto.properties.bookingType.enum.includes('flight-change'));
    assert.equal(doc.components.schemas.FlightBookingChangeDto.properties.differenceAmount.type,'number');
    assert.ok(doc.components.schemas.FlightBookingChangeDto.properties.refund);
  });
  it('allows only one simultaneous replacement and never leaks the losing capacity',async()=>{
    const a=await replacement(),b=await replacement(22000);
    const results=await Promise.all([post('flight-bookings/'+id+'/changes',{segments:[a]}),post('flight-bookings/'+id+'/changes',{segments:[b]})]);
    assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
    const holds=await col('cabininventories').find({_id:{$in:[objectId(a.cabinId),objectId(b.cabinId)]}}).toArray();
    assert.equal(holds.reduce((n,c)=>n+c.heldSeats,0),1);
  });
  it('rolls a full replacement back when the target has no capacity',async()=>{
    const selection=await replacement();
    await col('cabininventories').updateOne({_id:objectId(selection.cabinId)},{$set:{totalSeats:0}});
    await post('flight-bookings/'+id+'/changes',{segments:[selection]}).expect(409);
    assert.equal(await col('flightbookingchanges').countDocuments({}),0);
    assert.equal((await getBooking())!.status,'CONFIRMED');
  });
  it('keeps equal-fare changes and the old inventory untouched if expiry passes during the transaction',async context=>{
    const {cid,selection}=await proposal(15000);
    await post('bookings/flight-change/'+cid+'/accept-policies',{accepted:true}).expect(200);
    const inventory=f.app.get<any>('FLIGHT_INVENTORY'),convert=inventory.convertHeldToBooked.bind(inventory);
    await col('flightbookingchanges').updateOne({_id:objectId(cid)},{$set:{holdExpiresAt:new Date(Date.now()+1000)}});
    const delay=context.mock.method(inventory,'convertHeldToBooked',async(...args:any[])=>{const changed=await convert(...args);await new Promise(r=>setTimeout(r,1100));return changed;});
    await confirm(cid).expect(409);assert.equal(delay.mock.calls.length,1);delay.mock.restore();
    assert.equal((await getBooking())!.segments[0].flightId.toString(),original.segments[0].flightId.toString());
    const cabin=(await col('cabininventories').findOne({_id:objectId(selection.cabinId)}))!;assert.equal(cabin.heldSeats,1);assert.equal(cabin.bookedSeats,0);
    await service().sweep();assert.equal((await stored(cid))!.status,'EXPIRED');
  });
  it('retries a lower-fare refund after lost Stripe response without paying twice',async()=>{
    const {cid}=await proposal(10000);
    await post('bookings/flight-change/'+cid+'/accept-policies',{accepted:true}).expect(200);
    stripe.loseNextRefundResponse=true;
    await confirm(cid).expect(201);assert.equal((await stored(cid))!.refundDue,true);assert.equal(stripe.calls.createRefund,1);
    await post('flight-bookings/'+id+'/changes',{segments:[await replacement()]}).expect(201);
    // create runs recovery first; the old decrease is settled before admitting another request.
    assert.equal((await stored(cid))!.refundDue,false);assert.equal(stripe.calls.createRefund,1);
  });
  it('aggregates a cancellation spanning original and change charges while refunds are pending',async()=>{
    await col('airlines').updateOne({_id:f.airlineId},{$set:{cancellationTiers:[{daysBeforeDeparture:0,refundPercentage:100}]}});
    const {cid}=await proposal(30000);await applyPaid(cid);
    stripe.refundStatus='pending';await post('flight-bookings/'+id+'/cancel').expect(200);
    const details=(await f.http().get('/api/flight-bookings/'+id).set('Cookie',owner.cookie).expect(200)).body;
    assert.equal(details.refund.amount,30000);assert.equal(details.refund.status,'PENDING');
    for(const refund of stripe.refunds.values())await event('refund.updated',stripe.setRefundStatus(refund.id,'succeeded'));
    const final=(await f.http().get('/api/flight-bookings/'+id).set('Cookie',owner.cookie).expect(200)).body;
    assert.equal(final.refund.amount,30000);assert.equal(final.refund.status,'REFUNDED');
  });
  it('serializes paid replacement with original cancellation and refunds only the losing charge',async()=>{
    const {cid,selection}=await proposal();const pay=await payment('flight-change',cid);
    const success=stripe.succeed(pay.stripePaymentIntentId);
    await Promise.all([event('payment_intent.succeeded',success),post('flight-bookings/'+id+'/cancel').expect(200)]);
    await event('payment_intent.succeeded',success);
    const b=(await getBooking())!,c=(await stored(cid))!;
    assert.equal(b.status,'CANCELLED');
    assert.equal([...stripe.refunds.values()].reduce((sum,r)=>sum+r.amount,0),b.refundAmount+(c.status==='CONFIRMED'?0:5000));
    assert.equal((await col('cabininventories').findOne({_id:objectId(selection.cabinId)}))!.bookedSeats,0);
    assert.equal((await col('cabininventories').findOne({_id:objectId(selection.cabinId)}))!.heldSeats,0);
  });
  it('preserves seats and existing inventory on an unchanged outbound while replacing only the return',async()=>{
    const outbound=(await col('flights').findOne({_id:original.segments[0].flightId}))!;
    const inbound=await replacement(15000,{departureAirportId:outbound.arrivalAirportId,arrivalAirportId:outbound.departureAirportId});
    const trip=[{flightId:original.segments[0].flightId.toString(),cabinId:original.segments[0].cabinId.toString()},inbound];
    id=(await post('flight-bookings/hold',{segments:trip,passengers:[{fullName:'Round Trip',dateOfBirth:'1990-01-01',documentNumber:'ROUND123',type:'ADULT'}]}).expect(201)).body.flightBookingId;
    const paid=await payment('flight',id);await event('payment_intent.succeeded',stripe.succeed(paid.stripePaymentIntentId));original=(await getBooking())!;
    const passengerId=original.passengers[0]._id.toString();
    await f.http().put('/api/flight-bookings/'+id+'/seats').set('Cookie',owner.cookie).send({selections:trip.map(s=>({flightId:s.flightId,passengerId,seatNumber:3}))}).expect(200);
    const next=await replacement(20000,{departureAirportId:outbound.arrivalAirportId,arrivalAirportId:outbound.departureAirportId});
    await col('flights').updateOne({_id:objectId(inbound.flightId)},{$set:{status:'CANCELLED'}});
    await post('flight-bookings/'+id+'/changes',{segments:[trip[0],next]}).expect(409);
    assert.equal(await col('flightbookingchanges').countDocuments({}),0);
    await col('flights').updateOne({_id:objectId(inbound.flightId)},{$set:{status:'SCHEDULED'}});
    const change=(await post('flight-bookings/'+id+'/changes',{segments:[trip[0],next]}).expect(201)).body;
    assert.equal((await stored(change.flightBookingChangeId))!.holds.length,1);
    await applyPaid(change.flightBookingChangeId);
    const seats=await col('flightseatassignments').find({flightBookingId:objectId(id)}).toArray();
    assert.equal(seats.length,1);assert.equal(seats[0].flightId.toString(),trip[0].flightId);
    assert.equal((await col('cabininventories').findOne({_id:objectId(trip[0].cabinId)}))!.bookedSeats,2);
    assert.equal((await col('cabininventories').findOne({_id:objectId(inbound.cabinId)}))!.bookedSeats,0);
  });
  it('includes fare-difference receipts in analytics without double-counting bookings',async()=>{
    const admin=await f.login('change-analytics@example.com','ADMIN' as any),today=new Date().toISOString().slice(0,10);
    const up=await proposal(20000);await applyPaid(up.cid);
    const report=()=>f.http().get('/api/admin/analytics').set('Cookie',admin.cookie).query({from:today,to:today,type:'airline'});
    const gross=(await report().expect(200)).body.items[0];assert.equal(gross.grossRevenueMinor,20000);assert.equal(gross.bookings,1);
    const down=await proposal(10000);await post('bookings/flight-change/'+down.cid+'/accept-policies',{accepted:true}).expect(200);await confirm(down.cid).expect(201);
    const net=(await report().expect(200)).body.items[0];assert.equal(net.grossRevenueMinor,20000);assert.equal(net.refundedMinor,10000);assert.equal(net.netRevenueMinor,10000);assert.equal(net.bookings,1);
  });
  it('can recover a completed original payment without treating its historical confirmation as a late hold',async()=>{
    await col('flightbookings').updateOne({_id:objectId(id)},{$set:{status:'COMPLETED'}});
    const pay=(await col('payments').findOne({flightBookingId:objectId(id)}))!;
    await col('payments').updateOne({_id:pay._id},{$unset:{bookingConfirmedAt:1}});
    await event('payment_intent.succeeded',stripe.succeed(pay.stripePaymentIntentId));
    assert.equal(stripe.calls.createRefund,0);assert.ok((await col('payments').findOne({_id:pay._id}))!.bookingConfirmedAt);
  });

  it('shares one idempotent change intent under concurrent checkout requests',async()=>{
    const {cid}=await proposal();await post('bookings/flight-change/'+cid+'/accept-policies',{accepted:true}).expect(200);
    const responses=await Promise.all([post('payments',{bookingType:'flight-change',bookingId:cid}),post('payments',{bookingType:'flight-change',bookingId:cid.toUpperCase()})]);
    assert.deepEqual(responses.map(r=>r.status),[201,201]);
    assert.equal(responses[0].body.payment._id,responses[1].body.payment._id);assert.equal(stripe.calls.createIntent,2);
    assert.equal(await col('payments').countDocuments({flightBookingChangeId:objectId(cid)}),1);
  });
  it('recovers initial change checkout after a lost Stripe create response without a second intent',async context=>{
    const {cid}=await proposal();await post('bookings/flight-change/'+cid+'/accept-policies',{accepted:true}).expect(200);
    const gateway=f.app.get(StripeService),create=gateway.createPaymentIntent.bind(gateway);let once=true;
    const hook=context.mock.method(gateway,'createPaymentIntent',async(...args:Parameters<StripeService['createPaymentIntent']>)=>{const intent=await create(...args);if(once){once=false;throw new Error('Lost create response');}return intent;});
    await post('payments',{bookingType:'flight-change',bookingId:cid}).expect(500);
    const retried=(await post('payments',{bookingType:'flight-change',bookingId:cid}).expect(201)).body.payment;hook.mock.restore();
    assert.equal(stripe.calls.createIntent,2);
    await event('payment_intent.succeeded',stripe.succeed(retried.stripePaymentIntentId));assert.equal((await stored(cid))!.status,'CONFIRMED');
  });
  it('recovers an initially unsaved change payment from a signed late success and compensates it',async context=>{
    const {cid}=await proposal();await post('bookings/flight-change/'+cid+'/accept-policies',{accepted:true}).expect(200);
    const model=f.connection.models.Payment,create=model.create.bind(model);
    const hook=context.mock.method(model,'create',((...args:any[])=>{if(args[0]?.bookingType==='flight-change')throw new Error('Injected Payment insert failure');return (create as any)(...args);}) as typeof model.create);
    await post('payments',{bookingType:'flight-change',bookingId:cid}).expect(500);hook.mock.restore();
    const intent=[...stripe.intents.values()].find(i=>i.metadata.bookingType==='flight-change')!;
    assert.equal(await col('payments').countDocuments({flightBookingChangeId:objectId(cid)}),0);
    await col('flightbookingchanges').updateOne({_id:objectId(cid)},{$set:{holdExpiresAt:new Date(Date.now()-1)}});
    await service().sweep();await event('payment_intent.succeeded',stripe.succeed(intent.id));
    assert.equal((await getBooking())!.segments[0].flightId.toString(),original.segments[0].flightId.toString());
    assert.equal([...stripe.refunds.values()].reduce((sum,r)=>sum+r.amount,0),5000);
    assert.ok((await col('payments').findOne({flightBookingChangeId:objectId(cid)}))!.autoRefundedAt);
  });
  it('keeps failed fare refunds retryable and finishes them before a later cancellation',async()=>{
    const {cid}=await proposal(10000);await post('bookings/flight-change/'+cid+'/accept-policies',{accepted:true}).expect(200);
    stripe.refundStatus='failed';await confirm(cid).expect(201);assert.equal((await stored(cid))!.refundDue,true);
    stripe.refundStatus='succeeded';await service().sweep();assert.equal((await stored(cid))!.refundDue,false);
    const rows=await col('refunds').find({reason:'Flight fare decrease '+cid}).toArray();
    assert.deepEqual(rows.map(r=>r.status).sort(),['FAILED','REFUNDED']);
    assert.equal(rows.filter(r=>r.status==='REFUNDED').reduce((sum,r)=>sum+r.amount,0),50);
  });
  it('does not double-refund an applied change when its payment outcome marker needs recovery after cancellation',async()=>{
    const {cid}=await proposal(20000),pay=await applyPaid(cid);
    await post('flight-bookings/'+id+'/cancel').expect(200);
    const total=[...stripe.refunds.values()].reduce((sum,r)=>sum+r.amount,0);
    await col('payments').updateOne({_id:objectId(pay._id)},{$unset:{bookingConfirmedAt:1}});
    await event('payment_intent.succeeded',stripe.succeed(pay.stripePaymentIntentId));
    assert.equal([...stripe.refunds.values()].reduce((sum,r)=>sum+r.amount,0),total);
  });
  it('recalculates an infant becoming a child on the new date and preserves passenger IDs',async()=>{
    const segment=original.segments[0],date=new Date(segment.departureAt),birth=new Date(Date.UTC(date.getUTCFullYear()-2,date.getUTCMonth(),date.getUTCDate()+1)).toISOString().slice(0,10);
    id=(await post('flight-bookings/hold',{segments:[{flightId:segment.flightId.toString(),cabinId:segment.cabinId.toString()}],passengers:[
      {fullName:'Adult',dateOfBirth:'1990-01-01',documentNumber:'ADULT123',type:'ADULT'},
      {fullName:'Infant',dateOfBirth:birth,documentNumber:'INFANT123',type:'INFANT'},
    ]}).expect(201)).body.flightBookingId;
    const paid=await payment('flight',id);await event('payment_intent.succeeded',stripe.succeed(paid.stripePaymentIntentId));original=(await getBooking())!;
    const {cid,selection}=await proposal(15000);assert.equal((await stored(cid))!.proposed.seatCount,2);
    await applyPaid(cid);const b=(await getBooking())!;assert.equal(b.seatCount,2);assert.equal(b.passengers[1].type,'CHILD');
    assert.deepEqual(b.passengers.map((p:any)=>p._id.toString()),original.passengers.map((p:any)=>p._id.toString()));
    assert.equal((await col('cabininventories').findOne({_id:objectId(selection.cabinId)}))!.bookedSeats,2);
  });
  it('releases a proposed-flight hold through the actual moderator cancellation route',async()=>{
    const {cid,selection}=await proposal(),moderator=await f.login('target-moderator@example.com','AIRLINE_MODERATOR' as any);
    await col('moderatorassignments').insertOne({moderatorId:objectId(moderator.userId),airlineId:f.airlineId});
    await f.http().post('/api/flights/'+selection.flightId+'/cancel').set('Cookie',moderator.cookie).send({}).expect(201);
    assert.equal((await stored(cid))!.status,'CANCELLED');assert.equal((await getBooking())!.status,'CONFIRMED');
    assert.equal((await col('cabininventories').findOne({_id:objectId(selection.cabinId)}))!.heldSeats,0);
  });

  it('reopens a fare-reduction obligation when a previously pending refund later fails',async()=>{
    stripe.refundStatus='pending';const {cid}=await proposal(10000);
    await post('bookings/flight-change/'+cid+'/accept-policies',{accepted:true}).expect(200);await confirm(cid).expect(201);
    assert.equal((await stored(cid))!.refundDue,false);
    const refund=[...stripe.refunds.values()][0];await event('refund.updated',stripe.setRefundStatus(refund.id,'failed'));
    assert.equal((await stored(cid))!.refundDue,true);
    stripe.refundStatus='succeeded';await service().sweep();assert.equal((await stored(cid))!.refundDue,false);
    assert.equal([...stripe.refunds.values()].filter(r=>r.status==='succeeded').reduce((sum,r)=>sum+r.amount,0),5000);
  });
  it('retries a failed late-change compensation without marking the money returned',async()=>{
    const {cid}=await proposal(),pay=await payment('flight-change',cid);
    await col('flightbookingchanges').updateOne({_id:objectId(cid)},{$set:{holdExpiresAt:new Date(Date.now()-1)}});await service().sweep();
    stripe.refundStatus='failed';const signed=FakeStripe.signedEvent('payment_intent.succeeded',stripe.succeed(pay.stripePaymentIntentId));
    await f.http().post('/api/payments/webhook').set('stripe-signature',signed.signature).set('Content-Type','application/json').send(signed.payload).expect(503);
    assert.ok(!(await col('payments').findOne({_id:objectId(pay._id)}))!.autoRefundedAt);
    stripe.refundStatus='succeeded';await service().sweep();
    assert.ok((await col('payments').findOne({_id:objectId(pay._id)}))!.autoRefundedAt);
    assert.equal([...stripe.refunds.values()].filter(r=>r.status==='succeeded').reduce((sum,r)=>sum+r.amount,0),5000);
  });
  it('rolls refund-failure status back if its durable recovery marker cannot be reopened',async context=>{
    const {cid}=await proposal(),pay=await payment('flight-change',cid);
    await col('flightbookingchanges').updateOne({_id:objectId(cid)},{$set:{holdExpiresAt:new Date(Date.now()-1)}});await service().sweep();
    stripe.refundStatus='pending';await event('payment_intent.succeeded',stripe.succeed(pay.stripePaymentIntentId));
    const refund=[...stripe.refunds.values()][0],failed=stripe.setRefundStatus(refund.id,'failed');
    const model=f.connection.models.Payment,update=model.updateOne.bind(model);
    const hook=context.mock.method(model,'updateOne',((...args:any[])=>{if(args[1]?.$unset?.autoRefundedAt)throw new Error('Injected recovery marker failure');return (update as any)(...args);}) as typeof model.updateOne);
    const signed=FakeStripe.signedEvent('refund.updated',failed);
    await f.http().post('/api/payments/webhook').set('stripe-signature',signed.signature).set('Content-Type','application/json').send(signed.payload).expect(500);hook.mock.restore();
    assert.equal((await col('refunds').findOne({stripeRefundId:refund.id}))!.status,'PENDING');
    assert.ok((await col('payments').findOne({_id:objectId(pay._id)}))!.autoRefundedAt);
    await event('refund.updated',failed);assert.ok(!(await col('payments').findOne({_id:objectId(pay._id)}))!.autoRefundedAt);
    stripe.refundStatus='succeeded';await service().sweep();assert.ok((await col('payments').findOne({_id:objectId(pay._id)}))!.autoRefundedAt);
  });

  it('authorizes before recovery and never sweeps another owner through a rejected request',async()=>{
    const {cid,selection}=await proposal();
    await col('flightbookingchanges').updateOne({_id:objectId(cid)},{$set:{holdExpiresAt:new Date(Date.now()-1)}});
    const other=await f.login('change-recovery-other@example.com');
    await f.http().post('/api/flight-bookings/'+id+'/changes').set('Cookie',other.cookie).send({segments:[selection]}).expect(404);
    assert.equal((await stored(cid))!.status,'PENDING');
    assert.equal((await col('cabininventories').findOne({_id:objectId(selection.cabinId)}))!.heldSeats,1);
    await post('flight-bookings/not-an-id/changes',{segments:[selection]}).expect(404);
    assert.equal((await stored(cid))!.status,'PENDING');
    await post('flight-bookings/'+id+'/changes',{segments:[await replacement()]}).expect(201);
    assert.equal((await stored(cid))!.status,'EXPIRED');
  });
  it('continues ordinary flight hold maintenance when replacement maintenance fails',async context=>{
    const selection=await replacement();
    const hold=(await post('flight-bookings/hold',{segments:[selection],passengers:[{fullName:'Maintenance Hold',dateOfBirth:'1990-01-01',documentNumber:'MAINT123',type:'ADULT'}]}).expect(201)).body.flightBookingId;await f.expireHold(hold);
    const hook=context.mock.method(service(),'sweep',async()=>{throw new Error('Injected change maintenance failure');});
    await new FlightBookingsMaintenanceService(f.flightBookings,service()).sweep();hook.mock.restore();
    assert.equal(await f.bookingStatus(hold),'EXPIRED');assert.equal((await getBooking())!.status,'CONFIRMED');
  });
  it('preserves a completed hotel confirmation when the shared payment marker needs recovery',async()=>{
    const hotelBookingId=new Types.ObjectId(),paymentId=new Types.ObjectId();
    const intent=await f.app.get(StripeService).createPaymentIntent({amount:12345,currency:'USD',metadata:{paymentId:paymentId.toString(),bookingType:'hotel',bookingId:hotelBookingId.toString(),userId:owner.userId}});
    await col('hotelbookings').insertOne({_id:hotelBookingId,userId:objectId(owner.userId),hotelId:new Types.ObjectId(),status:'COMPLETED',totalPrice:12345,currency:'USD',
      policySnapshot:{cancellationTiers:[],checkInTime:'14:00',checkOutTime:'11:00'},rooms:[]});
    await col('payments').insertOne({_id:paymentId,userId:objectId(owner.userId),bookingType:'hotel',hotelBookingId,amount:123.45,currency:'USD',status:'SUCCEEDED',stripePaymentIntentId:intent.id});
    await event('payment_intent.succeeded',stripe.succeed(intent.id));
    assert.equal(stripe.calls.createRefund,0);assert.ok((await col('payments').findOne({_id:paymentId}))!.bookingConfirmedAt);
    assert.equal((await col('hotelbookings').findOne({_id:hotelBookingId}))!.status,'COMPLETED');
  });

  it('attributes all receipts to the canonical replacement provider and counts the booking once',async()=>{
    const airlineId=new Types.ObjectId();await col('airlines').insertOne({_id:airlineId,code:'ZX',name:'Replacement Airline',isActive:true,baggagePolicy:{pricePerExtraBag:3000,maxExtraBagsPerPassenger:2},cancellationTiers:[{daysBeforeDeparture:0,refundPercentage:50}]});
    const selection=await replacement(20000,{airlineId});
    const cid=(await post('flight-bookings/'+id+'/changes',{segments:[selection]}).expect(201)).body.flightBookingChangeId;await applyPaid(cid);
    const admin=await f.login('change-provider-analytics@example.com','ADMIN' as any),today=new Date().toISOString().slice(0,10);
    const report=(await f.http().get('/api/admin/analytics').set('Cookie',admin.cookie).query({from:today,to:today,type:'airline'}).expect(200)).body;
    assert.equal(report.items.length,1);assert.equal(report.items[0].airlineId,airlineId.toString());assert.equal(report.items[0].grossRevenueMinor,20000);assert.equal(report.items[0].bookings,1);
  });

});
