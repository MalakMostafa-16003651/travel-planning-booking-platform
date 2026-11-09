import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { BookingStatus } from '../src/common/enums/booking-status.enum';
import { UserRole } from '../src/common/enums/user-role.enum';
import { HotelBookingsClock } from '../src/hotel-bookings/hotel-booking.dates';
import { HotelBookingsMaintenanceService } from '../src/hotel-bookings/hotel-bookings-maintenance.service';
import { HotelBookingsModule } from '../src/hotel-bookings/hotel-bookings.module';
import { HotelBooking } from '../src/hotel-bookings/schemas/hotel-booking.schema';
import { Hotel } from '../src/hotels/schemas/hotel.schema';
import { BookedRangeStatus, RoomAvailability } from '../src/hotels/schemas/room-availability.schema';
import { Room } from '../src/hotels/schemas/room.schema';
import { AdminFixture, Session } from './admin-fixture';

/** Every test runs on this pinned UTC "today" (contract L2). */
const TODAY = '2026-11-15';
const HOLD_MS = 10 * 60 * 1000;

describe('HTL-16/HTL-18 hotel booking holds', { concurrency: false }, () => {
  const fixture = new AdminFixture([HotelBookingsModule]);
  let alice: Session;
  let bob: Session;
  let hotels: Model<Hotel>;
  let rooms: Model<Room>;
  let availabilities: Model<RoomAvailability>;
  let bookings: Model<HotelBooking>;
  let maintenance: HotelBookingsMaintenanceService;
  let hotelId: string;
  let deluxe: string; // capacity 3, 12500/night
  let twin: string; // capacity 2, 9000/night

  const post = (body: unknown, session?: Session) => {
    const call = fixture.http().post('/api/hotel-bookings');
    return (session ? call.set('Cookie', session.cookie) : call).send(body as object);
  };
  const request = (overrides: Record<string, unknown> = {}) => ({
    hotelId,
    checkIn: '2026-12-20',
    checkOut: '2026-12-23',
    rooms: [{ roomId: deluxe, adults: 2, childrenAges: [7] }, { roomId: twin, adults: 1, childrenAges: [] }],
    ...overrides,
  });
  const ranges = async (roomId: string) => (await availabilities.findOne({ roomId: new Types.ObjectId(roomId) }).lean().exec())?.bookedRanges ?? [];

  async function createHotel(overrides: Partial<Hotel> = {}): Promise<string> {
    const [hotel] = await hotels.create([{
      name: 'Nile View Hotel', city: 'Cairo', countryCode: 'EG', address: '1 Corniche St',
      checkInTime: '15:00', checkOutTime: '12:00',
      cancellationTiers: [{ daysBeforeCheckIn: 7, refundPercentage: 100 }, { daysBeforeCheckIn: 2, refundPercentage: 50 }],
      ...overrides,
    }]);
    return hotel._id.toString();
  }

  async function createRoom(forHotel: string, name: string, capacity: number, pricePerNight: number, overrides: Partial<Room> = {}): Promise<string> {
    const [room] = await rooms.create([{ hotelId: new Types.ObjectId(forHotel), name, capacity, pricePerNight, ...overrides }]);
    return room._id.toString();
  }

  /** Moves a reservation's hold (booking and its HELD ranges) into the past. */
  async function expireHold(hotelBookingId: string): Promise<void> {
    const past = new Date(Date.now() - 60_000);
    const id = new Types.ObjectId(hotelBookingId);
    await bookings.updateOne({ _id: id }, { $set: { holdExpiresAt: past } }).exec();
    await availabilities.updateMany(
      { 'bookedRanges.hotelBookingId': id },
      { $set: { 'bookedRanges.$[held].holdExpiresAt': past } },
      { arrayFilters: [{ 'held.hotelBookingId': id }] },
    ).exec();
  }

  before(async () => {
    await fixture.start('hotel-bookings-hold');
    hotels = fixture.app.get(getModelToken(Hotel.name));
    rooms = fixture.app.get(getModelToken(Room.name));
    availabilities = fixture.app.get(getModelToken(RoomAvailability.name));
    bookings = fixture.app.get(getModelToken(HotelBooking.name));
    maintenance = fixture.app.get(HotelBookingsMaintenanceService);
    fixture.app.get(HotelBookingsClock).today = () => TODAY;
  }, { timeout: 30 * 60_000 });
  after(() => fixture.stop());

  beforeEach(async () => {
    await fixture.reset();
    alice = await fixture.login('alice@example.com', UserRole.USER, 'Alice');
    bob = await fixture.login('bob@example.com', UserRole.USER, 'Bob');
    hotelId = await createHotel();
    deluxe = await createRoom(hotelId, 'Deluxe King 204', 3, 12500);
    twin = await createRoom(hotelId, 'Twin 105', 2, 9000);
  });

  it('HTL-16/HTL-18: holds every selected room for 10 minutes as one PENDING reservation', async () => {
    const before = Date.now();
    const response = await post(request(), alice).expect(201);
    const body = response.body;
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(body.status, 'PENDING');
    assert.equal(body.userId, alice.userId);
    assert.equal(body.hotelId, hotelId);
    assert.equal(body.hotelName, 'Nile View Hotel');
    assert.equal(body.bookingReference, undefined);
    assert.deepEqual([body.checkIn, body.checkOut, body.nights, body.guestCount], ['2026-12-20', '2026-12-23', 3, 4]);
    // Total = nights x price at booking time, per room, in minor units (USD).
    assert.deepEqual(body.rooms.map((room: { roomName: string; pricePerNight: number; subtotal: number }) => [room.roomName, room.pricePerNight, room.subtotal]),
      [['Deluxe King 204', 12500, 37500], ['Twin 105', 9000, 27000]]);
    assert.deepEqual([body.totalPrice, body.currency], [64500, 'USD']);
    assert.deepEqual(body.policy, {
      cancellationTiers: [{ daysBeforeCheckIn: 7, refundPercentage: 100 }, { daysBeforeCheckIn: 2, refundPercentage: 50 }],
      checkInTime: '15:00',
      checkOutTime: '12:00',
    });
    const expiresAt = Date.parse(body.holdExpiresAt);
    assert.ok(expiresAt >= before + HOLD_MS && expiresAt <= Date.now() + HOLD_MS);

    // The database: one PENDING booking and one HELD range per room, linked to it.
    const stored = await bookings.findById(body.hotelBookingId).lean().exec();
    assert.equal(stored!.status, BookingStatus.PENDING);
    for (const roomId of [deluxe, twin]) {
      const held = await ranges(roomId);
      assert.equal(held.length, 1);
      assert.deepEqual([held[0].startDate, held[0].endDate, held[0].status], ['2026-12-20', '2026-12-23', BookedRangeStatus.HELD]);
      assert.equal(held[0].hotelBookingId!.toString(), body.hotelBookingId);
      assert.equal(held[0].holdExpiresAt!.getTime(), expiresAt);
    }
    // The rooms had no RoomAvailability document before; it was created with Lama's upsert pattern.
    const doc = await availabilities.findOne({ roomId: new Types.ObjectId(deluxe) }).lean().exec();
    assert.equal(doc!.hotelId.toString(), hotelId);
    assert.deepEqual(doc!.blockedRanges, []);

    // It now appears in the owner's list, and later price edits do not change it (HTL-05).
    await rooms.updateOne({ _id: deluxe }, { $set: { pricePerNight: 99999 } }).exec();
    const mine = await fixture.http().get(`/api/hotel-bookings/${body.hotelBookingId}`).set('Cookie', alice.cookie).expect(200);
    assert.equal(mine.body.totalPrice, 64500);
  });

  it('HTL-16: a single room with only adults, and a check-in today, is accepted', async () => {
    const response = await post(request({ checkIn: TODAY, checkOut: '2026-11-16', rooms: [{ roomId: twin, adults: 2, childrenAges: [] }] }), alice).expect(201);
    assert.deepEqual([response.body.nights, response.body.totalPrice, response.body.guestCount], [1, 9000, 2]);
    // One adult per reservation is enough: another room may hold only a child (it still has a guest).
    const mixed = await post(request({ checkIn: '2026-12-01', checkOut: '2026-12-02', rooms: [{ roomId: deluxe, adults: 1, childrenAges: [] }, { roomId: twin, adults: 0, childrenAges: [12] }] }), alice).expect(201);
    assert.equal(mixed.body.guestCount, 2);
  });

  it('GEN-13: rejects each validation error with 400 and holds nothing', async () => {
    const one = (room: Record<string, unknown>) => ({ rooms: [{ roomId: twin, adults: 1, childrenAges: [], ...room }] });

    const cases: [string, Record<string, unknown>, string][] = [
      ['check-out equal to check-in', { checkOut: '2026-12-20' }, 'checkOut'],
      ['check-out before check-in', { checkIn: '2026-12-23', checkOut: '2026-12-20' }, 'checkOut'],
      ['check-in in the past', { checkIn: '2026-11-14', checkOut: '2026-11-16' }, 'checkIn'],
      ['impossible calendar date', { checkIn: '2026-02-31', checkOut: '2026-03-02' }, 'checkIn'],
      ['date with a time', { checkIn: '2026-12-20T10:00:00Z' }, 'checkIn'],
      ['missing dates', { checkIn: undefined, checkOut: undefined }, 'checkIn'],
      ['the same room twice', { rooms: [{ roomId: twin, adults: 1, childrenAges: [] }, { roomId: twin, adults: 1, childrenAges: [] }] }, 'rooms'],
      ['a room with no guests', { rooms: [{ roomId: deluxe, adults: 2, childrenAges: [] }, { roomId: twin, adults: 0, childrenAges: [] }] }, 'rooms.1'],
      ['no adult in the reservation', { rooms: [{ roomId: deluxe, adults: 0, childrenAges: [5] }, { roomId: twin, adults: 0, childrenAges: [9] }] }, 'rooms'],
      ['child aged 18', one({ childrenAges: [18] }), 'rooms.0.childrenAges'],
      ['negative child age', one({ childrenAges: [-1] }), 'rooms.0.childrenAges'],
      ['fractional child age', one({ childrenAges: [4.5] }), 'rooms.0.childrenAges'],
      ['negative adults', one({ adults: -1 }), 'rooms.0.adults'],
      ['room over its capacity', one({ adults: 2, childrenAges: [3] }), 'rooms.0'],
      ['invalid hotel id', { hotelId: 'not-an-id' }, 'hotelId'],
      ['invalid room id', one({ roomId: 'not-an-id' }), 'rooms.0.roomId'],
      ['no rooms', { rooms: [] }, 'rooms'],
      ['more than 10 rooms', { rooms: Array.from({ length: 11 }, () => ({ roomId: new Types.ObjectId().toString(), adults: 1, childrenAges: [] })) }, 'rooms'],
      ['client-supplied status', { status: 'CONFIRMED' }, 'status'],
      ['client-supplied price', { totalPrice: 1 }, 'totalPrice'],
    ];
    for (const [name, overrides, field] of cases) {
      const response = await post(request(overrides), alice);
      assert.equal(response.status, 400, name);
      assert.equal(response.body.message, 'Validation failed', name);
      assert.ok(Object.keys(response.body.errors ?? {}).some((key) => key === field || key.startsWith(`${field}.`)), `${name}: ${JSON.stringify(response.body.errors)}`);
    }
    assert.equal(await bookings.countDocuments(), 0);
    for (const roomId of [deluxe, twin]) assert.deepEqual(await ranges(roomId), []);
  });

  it('ACC-15: an unknown or deactivated hotel, or a room that is unknown, inactive or of another hotel, is 404', async () => {
    const otherHotel = await createHotel({ name: 'Delta Inn' });
    const foreignRoom = await createRoom(otherHotel, 'Elsewhere 1', 4, 5000);
    const inactiveRoom = await createRoom(hotelId, 'Closed 9', 4, 5000, { isActive: false });
    const inactiveHotel = await createHotel({ name: 'Closed Hotel', isActive: false });
    const roomOfInactiveHotel = await createRoom(inactiveHotel, 'Closed Hotel 1', 2, 5000);
    const withRoom = (roomId: string) => request({ rooms: [{ roomId: deluxe, adults: 1, childrenAges: [] }, { roomId, adults: 1, childrenAges: [] }] });

    const cases: [string, Record<string, unknown>, string][] = [
      ['unknown hotel', request({ hotelId: new Types.ObjectId().toString() }), 'Hotel not found'],
      ['deactivated hotel', request({ hotelId: inactiveHotel, rooms: [{ roomId: roomOfInactiveHotel, adults: 1, childrenAges: [] }] }), 'Hotel not found'],
      ['room of another hotel', withRoom(foreignRoom), 'Room not found in this hotel'],
      ['inactive room', withRoom(inactiveRoom), 'Room not found in this hotel'],
      ['unknown room', withRoom(new Types.ObjectId().toString()), 'Room not found in this hotel'],
    ];
    for (const [name, body, message] of cases) {
      const response = await post(body, alice);
      assert.equal(response.status, 404, name);
      assert.equal(response.body.message, message, name);
    }
    assert.equal(await bookings.countDocuments(), 0);
    for (const roomId of [deluxe, twin, foreignRoom, inactiveRoom, roomOfInactiveHotel]) assert.deepEqual(await ranges(roomId), []);
  });

  it('ACC-10/ACC-11: guests must log in and only role USER can book', async () => {
    await post(request()).expect(401);
    for (const [email, role] of [['admin@example.com', UserRole.ADMIN], ['hotel@example.com', UserRole.HOTEL_MODERATOR], ['air@example.com', UserRole.AIRLINE_MODERATOR]] as const) {
      await post(request(), await fixture.login(email, role)).expect(403);
    }
    assert.equal(await bookings.countDocuments(), 0);
    assert.deepEqual(await ranges(deluxe), []);
  });

  it('HTL-18: a room overlapping a blocked range, a booked range or an active hold is rejected with 409', async () => {
    const single = (roomId: string, checkIn: string, checkOut: string) => request({ checkIn, checkOut, rooms: [{ roomId, adults: 1, childrenAges: [] }] });

    // Blocked by the moderator (HTL-06).
    await availabilities.create([{ roomId: new Types.ObjectId(deluxe), hotelId: new Types.ObjectId(hotelId), blockedRanges: [{ startDate: '2026-12-22', endDate: '2026-12-25' }], bookedRanges: [] }]);
    const blocked = await post(single(deluxe, '2026-12-20', '2026-12-23'), alice).expect(409);
    assert.equal(blocked.body.message, 'Deluxe King 204 is not available for these dates');
    // Half-open: leaving on the day the block starts, or arriving on the day it ends, is free.
    await post(single(deluxe, '2026-12-20', '2026-12-22'), alice).expect(201);
    await post(single(deluxe, '2026-12-25', '2026-12-27'), alice).expect(201);

    // Booked (a Confirmed reservation).
    await availabilities.updateOne({ roomId: new Types.ObjectId(twin) }, {
      $setOnInsert: { hotelId: new Types.ObjectId(hotelId), blockedRanges: [] },
      $push: { bookedRanges: { startDate: '2026-12-10', endDate: '2026-12-12', status: BookedRangeStatus.BOOKED, hotelBookingId: new Types.ObjectId() } },
    }, { upsert: true }).exec();
    await post(single(twin, '2026-12-11', '2026-12-13'), bob).expect(409);

    // An active hold by another user.
    await post(single(twin, '2026-12-01', '2026-12-05'), alice).expect(201);
    await post(single(twin, '2026-12-04', '2026-12-06'), bob).expect(409);

    // Only the three successful holds exist; the rejected requests stored nothing.
    assert.equal(await bookings.countDocuments(), 3);
    assert.equal((await ranges(twin)).length, 2);
  });

  it('HTL-18: of parallel requests for the same room and dates, exactly one wins', async () => {
    const body = request({ rooms: [{ roomId: deluxe, adults: 1, childrenAges: [] }] });
    const results = await Promise.all(Array.from({ length: 8 }, (_, index) => post(body, index % 2 === 0 ? alice : bob)));
    assert.deepEqual(results.map((result) => result.status).sort(), [201, 409, 409, 409, 409, 409, 409, 409]);
    assert.equal(await bookings.countDocuments(), 1);
    const held = await ranges(deluxe);
    assert.equal(held.length, 1);
    assert.equal(held[0].hotelBookingId!.toString(), results.find((result) => result.status === 201)!.body.hotelBookingId);
  });

  it('HTL-18: parallel multi-room requests sharing one room never leave a partial hold', async () => {
    const third = await createRoom(hotelId, 'Suite 301', 4, 20000);
    const results = await Promise.all([
      post(request({ rooms: [{ roomId: deluxe, adults: 1, childrenAges: [] }, { roomId: twin, adults: 1, childrenAges: [] }] }), alice),
      post(request({ rooms: [{ roomId: third, adults: 1, childrenAges: [] }, { roomId: twin, adults: 1, childrenAges: [] }] }), bob),
    ]);
    assert.deepEqual(results.map((result) => result.status).sort(), [201, 409]);
    const winner = results.find((result) => result.status === 201)!.body;
    const winnerRooms = new Set(winner.rooms.map((room: { roomId: string }) => room.roomId));
    for (const roomId of [deluxe, twin, third]) {
      assert.equal((await ranges(roomId)).length, winnerRooms.has(roomId) ? 1 : 0, roomId);
    }
    assert.equal(await bookings.countDocuments(), 1);
  });

  it('HTL-18: when one room of a multi-room request is not free, no room stays held', async () => {
    await availabilities.create([{ roomId: new Types.ObjectId(twin), hotelId: new Types.ObjectId(hotelId), blockedRanges: [{ startDate: '2026-12-21', endDate: '2026-12-22' }], bookedRanges: [] }]);
    // Deluxe (listed first) is free and is pushed before Twin fails: the transaction must undo it.
    const response = await post(request(), alice).expect(409);
    assert.equal(response.body.message, 'Twin 105 is not available for these dates');
    assert.deepEqual(await ranges(deluxe), []);
    assert.deepEqual(await ranges(twin), []);
    assert.equal(await bookings.countDocuments(), 0);
    // Deluxe alone is still bookable.
    await post(request({ rooms: [{ roomId: deluxe, adults: 2, childrenAges: [] }] }), alice).expect(201);
  });

  it('HTL-18 (L3): an expired hold frees the room for a new booking, even before the sweep runs', async () => {
    const first = (await post(request({ rooms: [{ roomId: deluxe, adults: 2, childrenAges: [] }] }), alice).expect(201)).body.hotelBookingId;
    await post(request({ rooms: [{ roomId: deluxe, adults: 1, childrenAges: [] }] }), bob).expect(409);
    await expireHold(first);

    const second = (await post(request({ rooms: [{ roomId: deluxe, adults: 1, childrenAges: [] }] }), bob).expect(201)).body.hotelBookingId;
    const held = await ranges(deluxe);
    assert.equal(held.length, 1, 'the expired HELD entry was pulled in the same transaction');
    assert.equal(held[0].hotelBookingId!.toString(), second);

    // The sweep then marks the old reservation EXPIRED and leaves the new hold alone.
    await maintenance.sweep();
    assert.equal((await bookings.findById(first).lean().exec())!.status, BookingStatus.EXPIRED);
    assert.equal((await bookings.findById(second).lean().exec())!.status, BookingStatus.PENDING);
    assert.equal((await ranges(deluxe)).length, 1);
  });

  it('HTL-18/GEN-11: the expiry sweep expires overdue holds and releases only their rooms', async () => {
    const overdue = (await post(request(), alice).expect(201)).body.hotelBookingId;
    const active = (await post(request({ checkIn: '2027-01-10', checkOut: '2027-01-12' }), bob).expect(201)).body.hotelBookingId;
    const bookedId = new Types.ObjectId();
    await availabilities.updateOne({ roomId: new Types.ObjectId(twin) }, {
      $push: { bookedRanges: { startDate: '2027-02-01', endDate: '2027-02-03', status: BookedRangeStatus.BOOKED, hotelBookingId: bookedId } },
    }).exec();
    await expireHold(overdue);

    await maintenance.sweep();

    const expired = await bookings.findById(overdue).lean().exec();
    assert.equal(expired!.status, BookingStatus.EXPIRED);
    assert.equal(expired!.holdExpiresAt, undefined);
    assert.equal((await bookings.findById(active).lean().exec())!.status, BookingStatus.PENDING);
    for (const roomId of [deluxe, twin]) {
      const left = await ranges(roomId);
      assert.equal(left.some((range) => range.hotelBookingId?.toString() === overdue), false);
      assert.equal(left.some((range) => range.hotelBookingId?.toString() === active), true);
    }
    assert.equal((await ranges(twin)).some((range) => range.status === BookedRangeStatus.BOOKED), true);

    // The released dates can be booked again, and a second sweep changes nothing.
    await post(request(), bob).expect(201);
    await maintenance.sweep();
    assert.equal(await bookings.countDocuments({ status: BookingStatus.EXPIRED }), 1);
  });

  it('lists POST /api/hotel-bookings in Swagger with HTL-16/HTL-18', async () => {
    const document = (await fixture.http().get('/api/docs-json').expect(200)).body;
    const operation = document.paths['/api/hotel-bookings'].post;
    assert.match(operation.summary, /^HTL-16\/HTL-18/);
    assert.deepEqual(Object.keys(operation.responses).sort(), ['201', '400', '401', '403', '404', '409']);
    assert.ok(document.components.schemas.CreateHotelBookingDto.properties.rooms);
  });
});
