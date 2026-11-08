import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { Types } from 'mongoose';
import { AdminModule } from '../src/admin/admin.module';
import { UserRole } from '../src/common/enums/user-role.enum';
import { FlightsModule } from '../src/flights/flights.module';
import { HotelsModule } from '../src/hotels/hotels.module';
import { ItinerariesModule } from '../src/itineraries/itineraries.module';
import { ReferenceDataService } from '../src/reference-data/reference-data.service';
import { AdminFixture, Session } from './admin-fixture';

describe('ACC-11 cross-module booking and private-itinerary access', { concurrency: false }, () => {
  const fixture = new AdminFixture([AdminModule, FlightsModule, HotelsModule, ItinerariesModule]);
  let owner: Session, other: Session, admin: Session, airline: Session, foreignAirline: Session, hotel: Session, foreignHotel: Session;
  let airlineId: Types.ObjectId, hotelId: Types.ObjectId, flightId: Types.ObjectId, flightBookingId: Types.ObjectId, hotelBookingId: Types.ObjectId;
  const collection = (name: string) => fixture.connection.collection(name);
  const get = (path: string, session?: Session) => {
    const call = fixture.http().get(path);
    return session ? call.set('Cookie', session.cookie) : call;
  };
  function flightBooking(userId: string, flight = flightId) {
    const id = new Types.ObjectId();
    return { _id: id, userId: new Types.ObjectId(userId), status: 'CONFIRMED', bookingReference: id.toString().slice(-6).toUpperCase(),
      segments: [{ flightId: flight, airlineId, cabinId: new Types.ObjectId(), cabinClass: 'ECONOMY', fare: 15000, flightNumber: 'MS100', departureAirportCode: 'CAI', arrivalAirportCode: 'DXB', departureAt: new Date('2030-12-20T08:00:00Z'), arrivalAt: new Date('2030-12-20T12:00:00Z'), departureTimeZone: 'Africa/Cairo', arrivalTimeZone: 'Asia/Dubai' }],
      passengers: [{ _id: new Types.ObjectId(), fullName: 'Owner Passenger', documentNumber: 'PRIVATE-PASSPORT-987', dateOfBirth: new Date('1990-05-04'), type: 'ADULT', extraBags: 0, extraBaggageWeightKg: 0 }],
      seatCount: 1, baggageFee: 0, totalAmount: 15000, currency: 'USD', lastDepartureAt: new Date('2030-12-20T08:00:00Z'), paymentId: new Types.ObjectId(), createdAt: new Date(), updatedAt: new Date() };
  }
  function hotelBooking(userId: string, target = hotelId) {
    const id = new Types.ObjectId();
    return { _id: id, userId: new Types.ObjectId(userId), hotelId: target, hotelName: 'Assigned Hotel',
      rooms: [{ roomId: new Types.ObjectId(), roomName: 'Double', adults: 2, childrenAges: [7], pricePerNight: 10000, subtotal: 20000 }, { roomId: new Types.ObjectId(), roomName: 'Single', adults: 1, childrenAges: [], pricePerNight: 5000, subtotal: 10000 }],
      checkIn: '2030-12-20', checkOut: '2030-12-22', nights: 2, totalPrice: 30000, currency: 'USD', status: 'CONFIRMED', bookingReference: id.toString().slice(-8).toUpperCase(), paymentId: new Types.ObjectId(),
      policySnapshot: { cancellationTiers: [], checkInTime: '14:00', checkOutTime: '11:00' }, createdAt: new Date(), updatedAt: new Date() };
  }
  before(async () => {
    await fixture.start('acc11-cross-module');
    owner = await fixture.login('acc-owner@example.com', UserRole.USER, 'Booking Owner');
    other = await fixture.login('acc-other@example.com');
    admin = await fixture.login('acc-admin@example.com', UserRole.ADMIN);
    airline = await fixture.login('acc-air@example.com', UserRole.AIRLINE_MODERATOR);
    foreignAirline = await fixture.login('acc-air-other@example.com', UserRole.AIRLINE_MODERATOR);
    hotel = await fixture.login('acc-hotel@example.com', UserRole.HOTEL_MODERATOR);
    foreignHotel = await fixture.login('acc-hotel-other@example.com', UserRole.HOTEL_MODERATOR);
    await fixture.app.get(ReferenceDataService).seedSupported();
    await collection('currencies').updateOne({ code: 'USD' }, { $setOnInsert: { code: 'USD', name: 'US dollar' } }, { upsert: true });
  }, { timeout: 120_000 });
  after(() => fixture.stop());
  beforeEach(async () => {
    for (const name of ['flights', 'flightbookings', 'hotelbookings', 'airlines', 'hotels', 'moderatorassignments', 'itineraries']) await collection(name).deleteMany({});
    airlineId = new Types.ObjectId(); hotelId = new Types.ObjectId(); flightId = new Types.ObjectId();
    await collection('airlines').insertOne({ _id: airlineId, name: 'Assigned Air', code: 'AA', isActive: true });
    await collection('hotels').insertOne({ _id: hotelId, name: 'Assigned Hotel', city: 'Cairo', countryCode: 'EG', address: 'Test', isActive: true });
    await collection('flights').insertOne({ _id: flightId, airlineId, flightNumber: 'MS100', status: 'DEPARTED', departureAt: new Date('2020-01-01'), arrivalAt: new Date('2020-01-02') });
    await collection('moderatorassignments').insertMany([
      { moderatorId: new Types.ObjectId(airline.userId), airlineId }, { moderatorId: new Types.ObjectId(foreignAirline.userId), airlineId: new Types.ObjectId() },
      { moderatorId: new Types.ObjectId(hotel.userId), hotelId }, { moderatorId: new Types.ObjectId(foreignHotel.userId), hotelId: new Types.ObjectId() },
    ]);
    const fb = flightBooking(owner.userId), hb = hotelBooking(owner.userId);
    flightBookingId = fb._id; hotelBookingId = hb._id;
    await collection('flightbookings').insertOne(fb); await collection('hotelbookings').insertOne(hb);
  });
  it('owners read their own bookings; another user cannot select them through path or query IDs', async () => {
    for (const [path, id] of [['flight-bookings', flightBookingId], ['hotel-bookings', hotelBookingId]] as const) {
      await get('/api/' + path + '/' + id, owner).expect(200);
      await get('/api/' + path + '/' + id + '?userId=' + owner.userId, other).expect(404);
      const list = await get('/api/' + path, other).expect(200);
      assert.equal(list.body.total, 0);
      await get('/api/' + path + '/' + id).expect(401);
    }
  });
  it('admins inspect both booking types through the admin API without passenger documents', async () => {
    for (const type of ['FLIGHT', 'HOTEL']) {
      const result = await get('/api/admin/bookings?type=' + type, admin).expect(200);
      assert.equal(result.body.total, 1);
      assert.equal(result.body.items[0].userId, owner.userId);
      assert.equal(JSON.stringify(result.body).includes('PRIVATE-PASSPORT-987'), false);
      assert.equal(JSON.stringify(result.body).includes('dateOfBirth'), false);
      for (const actor of [owner, airline, hotel]) await get('/api/admin/bookings?type=' + type, actor).expect(403);
    }
  });
  it('airline moderators see only their airline flight bookings and a minimal passenger projection', async () => {
    const path = '/api/flights/' + flightId + '/bookings';
    const result = await get(path, airline).expect(200);
    assert.equal(result.body.total, 1);
    assert.deepEqual(result.body.items[0].passengerNames, ['Owner Passenger']);
    assert.equal(result.body.items[0].flightBookingId, flightBookingId.toString());
    assert.equal(result.headers['cache-control'], 'no-store');
    for (const key of ['PRIVATE-PASSPORT-987', 'dateOfBirth', 'paymentId', 'passwordHash', 'email']) assert.equal(JSON.stringify(result.body).includes(key), false);
    await get(path, foreignAirline).expect(404);
    await get('/api/flights/' + new Types.ObjectId() + '/bookings', airline).expect(404);
    assert.equal((await collection('flights').findOne({ _id: flightId }))!.status, 'DEPARTED');
  });
  it('hotel moderators receive complete multi-room reservations only for their assigned hotel', async () => {
    const path = '/api/hotels/' + hotelId + '/reservations';
    const result = await get(path, hotel).expect(200);
    const item = result.body.items[0];
    assert.equal(result.body.total, 1); assert.equal(item.rooms.length, 2);
    assert.equal(item.guestCount, 4); assert.equal(item.guestName, 'Booking Owner');
    assert.equal(item.totalAmount, 30000); assert.ok(item.bookingReference);
    assert.equal(item.hotelBookingId, hotelBookingId.toString());
    assert.equal(result.headers['cache-control'], 'no-store');
    assert.equal('roomId' in item, false); assert.equal('guests' in item, false);
    for (const key of ['paymentId', 'policySnapshot', 'phoneNumber', 'passwordHash', 'email']) assert.equal(JSON.stringify(result.body).includes(key), false);
    await get(path, foreignHotel).expect(404);
    await get('/api/hotels/' + new Types.ObjectId() + '/reservations', hotel).expect(404);
  });
  it('rejects missing or cross-provider assignments and every wrong role before returning data', async () => {
    const flight = '/api/flights/' + flightId + '/bookings', rooms = '/api/hotels/' + hotelId + '/reservations';
    await get(flight).expect(401); await get(rooms).expect(401);
    for (const actor of [owner, admin, hotel]) await get(flight, actor).expect(403);
    for (const actor of [owner, admin, airline]) await get(rooms, actor).expect(403);
    await collection('moderatorassignments').deleteMany({});
    await get(flight, airline).expect(403); await get(rooms, hotel).expect(403);
  });
  it('uses ten-item pagination and validates query/identity fields without accepting spoofed ownership', async () => {
    for (let n = 0; n < 11; n++) { await collection('flightbookings').insertOne(flightBooking(owner.userId)); await collection('hotelbookings').insertOne(hotelBooking(owner.userId)); }
    for (const [path, actor] of [['/api/flights/' + flightId + '/bookings', airline], ['/api/hotels/' + hotelId + '/reservations', hotel]] as const) {
      const first = await get(path, actor).expect(200), second = await get(path + '?page=2', actor).expect(200);
      assert.equal(first.body.total, 12); assert.equal(first.body.items.length, 10); assert.equal(second.body.items.length, 2);
      for (const query of ['?page=0', '?page=abc', '?userId=' + owner.userId, '?moderatorId=' + actor.userId]) await get(path + query, actor).expect(400);
    }
    await get('/api/flights/not-an-id/bookings', airline).expect(400);
  });
  it('uses current account role and status on every provider request', async () => {
    try {
      await fixture.users.updateOne({ _id: airline.userId }, { $set: { role: UserRole.USER } }).exec();
      await get('/api/flights/' + flightId + '/bookings', airline).expect(403);
      await fixture.users.updateOne({ _id: hotel.userId }, { $set: { status: 'SUSPENDED' } }).exec();
      await get('/api/hotels/' + hotelId + '/reservations', hotel).expect(401);
    } finally {
      await fixture.users.updateOne({ _id: airline.userId }, { $set: { role: UserRole.AIRLINE_MODERATOR } }).exec();
      await fixture.users.updateOne({ _id: hotel.userId }, { $set: { status: 'ACTIVE' } }).exec();
    }
  });
  it('keeps private itineraries owner-only even for admins and assigned moderators', async () => {
    const created = await fixture.http().post('/api/itineraries').set('Cookie', owner.cookie).send({ title: 'Private ACC-11 trip', countries: ['EG'], startDate: '2030-12-20', visibility: 'PRIVATE', currency: 'USD' }).expect(201);
    const id = created.body.itineraryId;
    assert.ok(id);
    await get('/api/itineraries/' + id, owner).expect(200);
    await get('/api/itineraries/' + id).expect(404);
    for (const actor of [other, admin, airline, hotel]) {
      await get('/api/itineraries/' + id, actor).expect(404);
      await fixture.http().patch('/api/itineraries/' + id).set('Cookie', actor.cookie).send({ title: 'Unauthorized' }).expect(404);
    }
  });
  it('documents both provider read routes with their cookie and response schemas', async () => {
    const doc = (await fixture.http().get('/api/docs-json').expect(200)).body;
    assert.ok(doc.paths['/api/flights/{flightId}/bookings'].get.security);
    assert.match(doc.paths['/api/flights/{flightId}/bookings'].get.summary, /ACC-11/);
    assert.ok(doc.components.schemas.ModeratorFlightBookingsPageDto);
    assert.ok(doc.components.schemas.HotelReservationsPageDto.properties.items);
  });
});
