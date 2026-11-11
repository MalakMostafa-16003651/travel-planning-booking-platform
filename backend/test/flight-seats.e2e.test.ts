import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { pdfText } from './pdf-text-reader';
import { Types } from 'mongoose';
import { FlightsModule } from '../src/flights/flights.module';
import { UserRole } from '../src/common/enums/user-role.enum';
import { FlightSeatAssignmentsService } from '../src/flight-bookings/flight-seat-assignments.service';
import { FLIGHT_INVENTORY, FlightInventoryPort } from '../src/flight-bookings/ports/flight-inventory.port';
import { FlightBookingsMaintenanceService } from '../src/flight-bookings/flight-bookings-maintenance.service';
import { PaymentsFixture } from './payments-fixture';

const adult = { fullName: 'Seat Passenger', dateOfBirth: '1990-01-01', documentNumber: 'AB12345', type: 'ADULT' };

describe('FLT-28 transactional flight seat selection', { concurrency: false }, () => {
  const f = new PaymentsFixture();
  let alice: { cookie: string; userId: string }, bob: { cookie: string; userId: string };
  const col = (name: string) => f.connection.collection(name);
  const booking = (id: string) => col('flightbookings').findOne({ _id: new Types.ObjectId(id) });
  const map = (id: string, cookie = alice.cookie) => f.http().get('/api/flight-bookings/' + id + '/seat-map').set('Cookie', cookie);
  const select = (id: string, selections: object[], cookie = alice.cookie) => f.http().put('/api/flight-bookings/' + id + '/seats').set('Cookie', cookie).send({ selections });
  const row = (b: any, seatNumber = 1, segment = 0, passenger = 0) => ({ flightId: b.segments[segment].flightId.toString(), passengerId: b.passengers[passenger]._id.toString(), seatNumber });
  async function another(b: any, cookie: string, passengers: object[] = [adult]) {
    return (await f.http().post('/api/flight-bookings/hold').set('Cookie', cookie).send({
      segments: b.segments.map((s: any) => ({ flightId: s.flightId.toString(), cabinId: s.cabinId.toString() })), passengers,
    }).expect(201)).body.flightBookingId as string;
  }
  async function held() { const id = await f.holdBooking(alice.cookie); return { id, b: (await booking(id))! }; }
  async function moderator() {
    const mod = await f.login('seats-moderator@example.com', UserRole.AIRLINE_MODERATOR);
    await col('moderatorassignments').insertOne({ moderatorId: new Types.ObjectId(mod.userId), airlineId: f.airlineId });
    return mod;
  }
  const shrink = (b: any, cookie: string, totalSeats: number) => f.http().patch('/api/flights/' + b.segments[0].flightId + '/cabins/' + b.segments[0].cabinId).set('Cookie', cookie).send({ totalSeats });

  before(async () => { await f.start('flight-seats', undefined, {}, [FlightsModule]); f.app.get(FlightBookingsMaintenanceService).onModuleDestroy(); }, { timeout: 120_000 });
  beforeEach(async () => { await f.reset(); alice = await f.login('seat-alice@example.com'); bob = await f.login('seat-bob@example.com'); });
  after(() => f.stop());

  it('shows a compact owner-only seat map and assigns free numbered seats without changing price/counts', async () => {
    const { id, b } = await held();
    const before = await col('cabininventories').findOne({ _id: b.segments[0].cabinId });
    const response = await map(id.toUpperCase()).expect(200);
    assert.equal(response.body.flightBookingId, id);
    assert.equal(response.body.segments[0].capacity, 10);
    assert.deepEqual(response.body.segments[0].occupiedSeatNumbers, []);
    const selected = (await select(id, [row(b, 8)]).expect(200)).body;
    assert.deepEqual(selected.selections, [row(b, 8)]);
    const stored = await col('flightseatassignments').findOne({});
    assert.equal(stored!.userId.toString(), alice.userId);
    assert.equal(stored!.expiresAt.getTime(), b.holdExpiresAt.getTime());
    const after = await booking(id);
    assert.equal(after!.totalAmount, b.totalAmount);
    const cabin = await col('cabininventories').findOne({ _id: b.segments[0].cabinId });
    assert.equal(cabin!.heldSeats, before!.heldSeats); assert.equal(cabin!.bookedSeats, before!.bookedSeats);
  });

  it('exposes only occupied numbers for other bookings, never their identity or passenger details', async () => {
    const { id, b } = await held(); await select(id, [row(b, 3)]).expect(200);
    const other = await another(b, bob.cookie);
    const result = await map(other, bob.cookie).expect(200);
    assert.deepEqual(result.body.segments[0].occupiedSeatNumbers, [3]);
    assert.deepEqual(result.body.selections, []);
    assert.ok(!JSON.stringify(result.body).includes(alice.userId));
    assert.ok(!JSON.stringify(result.body).includes(b.passengers[0]._id.toString()));
  });

  it('lets only one of two users claim the same seat concurrently', async () => {
    const { id, b } = await held(); const other = await another(b, bob.cookie), ob = (await booking(other))!;
    const responses = await Promise.all([select(id, [row(b, 4)]), select(other, [row(ob, 4)], bob.cookie)]);
    assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
    assert.equal(await col('flightseatassignments').countDocuments({ seatNumber: 4 }), 1);
  });

  it('preserves the original selection when an attempted replacement conflicts', async () => {
    const { id, b } = await held(); const other = await another(b, bob.cookie), ob = (await booking(other))!;
    await select(id, [row(b, 2)]).expect(200); await select(other, [row(ob, 3)], bob.cookie).expect(200);
    await select(id, [row(b, 3)]).expect(409);
    assert.deepEqual((await map(id).expect(200)).body.selections, [row(b, 2)]);
    await select(id, []).expect(200);
    assert.equal(await col('flightseatassignments').countDocuments({ flightBookingId: b._id }), 0);
  });

  it('rejects invalid numbers, wrong passengers/legs, duplicate selections and client ownership fields', async () => {
    const { id, b } = await held();
    for (const selections of [[row(b, 0)], [row(b, 11)], [row(b, 1.5)], [row(b, 1), row(b, 2)],
      [{ ...row(b), passengerId: new Types.ObjectId().toString() }], [{ ...row(b), flightId: new Types.ObjectId().toString() }]]) {
      await select(id, selections).expect(400);
    }
    await f.http().put('/api/flight-bookings/' + id + '/seats').set('Cookie', alice.cookie).send({ selections: [row(b)], userId: bob.userId }).expect(400);
    assert.equal(await col('flightseatassignments').countDocuments({}), 0);
  });

  it('allows children but never assigns a physical seat to an infant', async () => {
    const { b } = await held();
    const date = (years: number) => { const d = new Date(); d.setUTCFullYear(d.getUTCFullYear() - years); return d.toISOString().slice(0, 10); };
    const id = await another(b, alice.cookie, [adult, { ...adult, fullName: 'Child', documentNumber: 'CH12345', type: 'CHILD', dateOfBirth: date(8) }, { ...adult, fullName: 'Infant', documentNumber: 'IF12345', type: 'INFANT', dateOfBirth: date(1) }]);
    const family = (await booking(id))!;
    await select(id, [row(family, 1, 0, 2)]).expect(400);
    await select(id, [row(family, 1), row(family, 2, 0, 1)]).expect(200);
    assert.equal(await col('flightseatassignments').countDocuments({ flightBookingId: family._id }), 2);
  });

  it('retains seats on verified confirmation, shows them in details/PDF, then releases them on cancellation', async () => {
    const { id, b } = await held(); await select(id, [row(b, 9)]).expect(200);
    await f.flightBookings.confirmPaidBooking(id, new Types.ObjectId().toString());
    assert.equal((await col('flightseatassignments').findOne({}))!.expiresAt, undefined);
    const details = await f.http().get('/api/flight-bookings/' + id).set('Cookie', alice.cookie).expect(200);
    assert.deepEqual(details.body.seatSelections, [row(b, 9)]);
    const ticket = await f.http().get('/api/flight-bookings/' + id + '/e-ticket').set('Cookie', alice.cookie).expect(200);
    assert.match(pdfText(ticket.body), /Selected seats/);
    assert.match(pdfText(ticket.body), /seat 9/);
    await f.http().post('/api/flight-bookings/' + id + '/cancel').set('Cookie', alice.cookie).expect(200);
    assert.equal(await col('flightseatassignments').countDocuments({}), 0);
    await select(id, [row(b)]).expect(409);
  });

  it('releases selections when a hold expires, without relying on TTL cleanup', async () => {
    const { id, b } = await held(); await select(id, [row(b)]).expect(200);
    await f.expireHold(id); await f.flightBookings.expireOverdueHolds();
    assert.equal(await f.bookingStatus(id), 'EXPIRED');
    assert.equal(await col('flightseatassignments').countDocuments({}), 0);
    await select(id, [row(b)]).expect(409);
  });

  it('reclaims an expired assignment even while the TTL monitor has not deleted it', async () => {
    const { id, b } = await held(); await select(id, [row(b, 4)]).expect(200);
    await f.expireHold(id);
    await col('flightseatassignments').updateMany({ flightBookingId: b._id }, { $set: { expiresAt: new Date(0) } });
    const other = await another(b, bob.cookie), ob = (await booking(other))!;
    await select(other, [row(ob, 4)], bob.cookie).expect(200);
    assert.equal((await col('flightseatassignments').findOne({ seatNumber: 4 }))!.flightBookingId.toString(), other);
  });

  it('rejects anonymous, wrong-role, other-owner, inactive and cross-origin selections', async () => {
    const { id, b } = await held();
    await map(id, bob.cookie).expect(404); await select(id, [row(b)], bob.cookie).expect(404);
    await f.http().get('/api/flight-bookings/' + id + '/seat-map').expect(401);
    const admin = await f.login('seat-admin@example.com', UserRole.ADMIN); await map(id, admin.cookie).expect(403);
    await f.http().put('/api/flight-bookings/' + id + '/seats').set('Cookie', alice.cookie).set('Sec-Fetch-Site', 'cross-site').send({ selections: [row(b)] }).expect(403);
    await f.users.updateOne({ _id: alice.userId }, { $set: { status: 'SUSPENDED' } }); await map(id).expect(401);
    assert.equal(await col('flightseatassignments').countDocuments({}), 0);
  });

  it('does not allow cabin capacity reductions to remove a held or confirmed seat number', async () => {
    const { id, b } = await held(); const mod = await moderator();
    await select(id, [row(b, 9)]).expect(200); await shrink(b, mod.cookie, 5).expect(409);
    await f.flightBookings.confirmPaidBooking(id, new Types.ObjectId().toString());
    await shrink(b, mod.cookie, 8).expect(409); await shrink(b, mod.cookie, 9).expect(200);
    assert.equal((await col('cabininventories').findOne({ _id: b.segments[0].cabinId }))!.totalSeats, 9);
  });

  it('serializes capacity reduction against a new seat selection', { timeout: 30_000 }, async (context) => {
    const { id, b } = await held(); const mod = await moderator();
    const assignments = f.app.get(FlightSeatAssignmentsService), original = assignments.highestSeat.bind(assignments);
    let entered!: () => void, release!: () => void;
    const paused = new Promise<void>(resolve => { entered = resolve; }), resume = new Promise<void>(resolve => { release = resolve; });
    let first = true;
    const hook = context.mock.method(assignments, 'highestSeat', async (...args: Parameters<FlightSeatAssignmentsService['highestSeat']>) => {
      const value = await original(...args); if (first) { first = false; entered(); await resume; } return value;
    });
    const reducing = shrink(b, mod.cookie, 5).then(r => r);
    await paused;
    const selecting = select(id, [row(b, 9)]).then(r => r);
    release();
    const [reduced, selected] = await Promise.all([reducing, selecting]); hook.mock.restore();
    assert.equal(reduced.status, 200); assert.equal(selected.status, 400);
    assert.equal(await col('flightseatassignments').countDocuments({}), 0);
  });

  it('rolls a seat replacement back if departure passes before the final booking write', async (context) => {
    const { id, b } = await held(); await select(id, [row(b, 2)]).expect(200);
    const assignments = f.app.get(FlightSeatAssignmentsService).assignments;
    const original = assignments.insertMany.bind(assignments);
    const hook = context.mock.method(assignments, 'insertMany', (async (...args: any[]) => {
      const result = await (original as any)(...args);
      await new Promise(resolve => setTimeout(resolve, 50));
      return result;
    }) as typeof assignments.insertMany);
    const inventory = f.app.get<FlightInventoryPort>(FLIGHT_INVENTORY), acquire = inventory.acquireBookingGate.bind(inventory);
    const gate = context.mock.method(inventory, 'acquireBookingGate', async (...args: Parameters<FlightInventoryPort['acquireBookingGate']>) => {
      const flight = await acquire(...args); return flight && { ...flight, departureAt: new Date(Date.now() + 25) };
    });
    await select(id, [row(b, 4)]).expect(409); hook.mock.restore(); gate.mock.restore();
    const rows = await col('flightseatassignments').find({ flightBookingId: b._id }).toArray();
    assert.equal(rows[0]?.seatNumber, 2);
  });

  it('treats round-trip seats atomically and preserves already-departed seat history', async () => {
    const { b: seed } = await held();
    const outbound = (await col('flights').findOne({ _id: seed.segments[0].flightId }))!;
    const flightId = new Types.ObjectId(), cabinId = new Types.ObjectId();
    const departureAt = new Date(outbound.departureAt.getTime() + 86_400_000);
    await col('flights').insertOne({ _id: flightId, airlineId: f.airlineId, flightNumber: 'MS200', status: 'SCHEDULED',
      departureAirportId: outbound.arrivalAirportId, arrivalAirportId: outbound.departureAirportId,
      departureAt, arrivalAt: new Date(departureAt.getTime() + 14_400_000) });
    await col('cabininventories').insertOne({ _id: cabinId, flightId, cabinClass: 'ECONOMY', totalSeats: 10, heldSeats: 0, bookedSeats: 0, price: 15000, baggageMaxWeightKg: 23 });
    const trip = { segments: [seed.segments[0], { flightId, cabinId }] };
    const id = await another(trip, alice.cookie), b = (await booking(id))!;
    const other = await another(b, bob.cookie), ob = (await booking(other))!;
    await select(id, [row(b, 1), row(b, 1, 1)]).expect(200);
    await select(other, [row(ob, 2, 1)], bob.cookie).expect(200);
    await select(id, [row(b, 3), row(b, 2, 1)]).expect(409);
    assert.equal(await col('flightseatassignments').countDocuments({ flightBookingId: b._id, seatNumber: 1 }), 2);
    assert.equal(await col('flightseatassignments').countDocuments({ seatNumber: 3 }), 0);
    await f.flightBookings.confirmPaidBooking(id, new Types.ObjectId().toString());
    const past = new Date(Date.now() - 3_600_000);
    await col('flights').updateOne({ _id: b.segments[0].flightId }, { $set: { departureAt: past, status: 'DEPARTED' } });
    await col('flightbookings').updateOne({ _id: b._id }, { $set: { 'segments.0.departureAt': past } });
    const selected = (await select(id, [row(b, 3, 1)]).expect(200)).body;
    assert.equal(selected.selections.find((r: any) => r.flightId === b.segments[0].flightId.toString()).seatNumber, 1);
    assert.equal(selected.selections.find((r: any) => r.flightId === b.segments[1].flightId.toString()).seatNumber, 3);
    assert.equal(selected.segments[0].modifiable, false);
    await select(id, [row(b, 4)]).expect(400);
  });

  it('uses actual future departure even if a schedule update has not reached the booking snapshot', async () => {
    const { id, b } = await held();
    await f.flightBookings.confirmPaidBooking(id, new Types.ObjectId().toString());
    await col('flightbookings').updateOne({ _id: b._id }, { $set: { 'segments.0.departureAt': new Date(Date.now() - 3_600_000) } });
    assert.equal((await map(id).expect(200)).body.segments[0].modifiable, true);
    assert.deepEqual((await select(id, [row(b, 6)]).expect(200)).body.selections, [row(b, 6)]);
  });

  it('releases seat assignments through the actual airline cancellation endpoint', async () => {
    const { id, b } = await held(), mod = await moderator();
    await select(id, [row(b, 5)]).expect(200);
    await f.flightBookings.confirmPaidBooking(id, new Types.ObjectId().toString());
    await f.http().post('/api/flights/' + b.segments[0].flightId + '/cancel').set('Cookie', mod.cookie).send({}).expect(201);
    assert.equal(await f.bookingStatus(id), 'CANCELLED');
    assert.equal(await col('flightseatassignments').countDocuments({ flightBookingId: b._id }), 0);
  });

  it('rolls booking and inventory cancellation back when seat release fails after deletion', async (context) => {
    const { id, b } = await held(); await select(id, [row(b)]).expect(200);
    await f.flightBookings.confirmPaidBooking(id, new Types.ObjectId().toString());
    const seats = f.app.get(FlightSeatAssignmentsService), original = seats.release.bind(seats);
    const failure = context.mock.method(seats, 'release', async (...args: Parameters<FlightSeatAssignmentsService['release']>) => {
      await original(...args); throw new Error('Injected seat release failure');
    });
    try { await f.http().post('/api/flight-bookings/' + id + '/cancel').set('Cookie', alice.cookie).expect(500); }
    finally { failure.mock.restore(); }
    assert.equal(await f.bookingStatus(id), 'CONFIRMED');
    assert.equal(await col('flightseatassignments').countDocuments({ flightBookingId: b._id }), 1);
    assert.equal((await col('cabininventories').findOne({ _id: b.segments[0].cabinId }))!.bookedSeats, 1);
    await f.http().post('/api/flight-bookings/' + id + '/cancel').set('Cookie', alice.cookie).expect(200);
    assert.equal(await col('flightseatassignments').countDocuments({ flightBookingId: b._id }), 0);
  });

  it('documents the owner seat-map and replacement APIs in Swagger', async () => {
    const document = (await f.http().get('/api/docs-json').expect(200)).body;
    assert.ok(document.paths['/api/flight-bookings/{id}/seat-map'].get);
    assert.ok(document.paths['/api/flight-bookings/{id}/seats'].put.responses['200']);
  });
});
