import { configureTestBookableRoom } from './hotel-test-data';
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { BookingStatus } from '../src/common/enums/booking-status.enum';
import { UserRole } from '../src/common/enums/user-role.enum';
import { RoomInventoryAdapter } from '../src/hotel-bookings/adapters/room-inventory.adapter';
import { HotelBookingsClock } from '../src/hotel-bookings/hotel-booking.dates';
import { HotelBookingsModule } from '../src/hotel-bookings/hotel-bookings.module';
import { HotelBookingsService } from '../src/hotel-bookings/hotel-bookings.service';
import { HotelBooking } from '../src/hotel-bookings/schemas/hotel-booking.schema';
import { Hotel } from '../src/hotels/schemas/hotel.schema';
import { BookedRangeStatus, RoomAvailability } from '../src/hotels/schemas/room-availability.schema';
import { Room } from '../src/hotels/schemas/room.schema';
import { AdminFixture, Session } from './admin-fixture';

/** Every test runs on this pinned UTC "today" (contract L2). */
const TODAY = '2026-11-15';

describe('Deactivation safety for hotel holds (ACC-15, HTL-06, HTL-18)', { concurrency: false }, () => {
  const fixture = new AdminFixture([HotelBookingsModule]);
  let alice: Session;
  let bob: Session;
  let hotels: Model<Hotel>;
  let rooms: Model<Room>;
  let availabilities: Model<RoomAvailability>;
  let bookings: Model<HotelBooking>;
  let connection: Connection;
  let service: HotelBookingsService;
  let inventory: RoomInventoryAdapter;
  let hotelId: string;
  let deluxe: string;
  let twin: string;

  const post = (body: unknown, session: Session) => fixture.http().post('/api/hotel-bookings').set('Cookie', session.cookie).send(body as object);
  const request = (overrides: Record<string, unknown> = {}) => ({
    hotelId,
    checkIn: '2026-12-20',
    checkOut: '2026-12-23',
    rooms: [{ roomId: deluxe, adults: 2, childrenAges: [] }, { roomId: twin, adults: 1, childrenAges: [] }],
    ...overrides,
  });
  const ranges = async (roomId: string) => (await availabilities.findOne({ roomId: new Types.ObjectId(roomId) }).lean().exec())?.bookedRanges ?? [];

  async function createHotel(name: string): Promise<string> {
    const [hotel] = await hotels.create([{ name, city: 'Cairo', countryCode: 'EG', address: '1 Corniche St' }]);
    return hotel._id.toString();
  }

  async function createRoom(forHotel: string, name: string): Promise<string> {
    const [room] = await rooms.create([{ hotelId: new Types.ObjectId(forHotel), name, capacity: 3, pricePerNight: 10000 }]);
    await configureTestBookableRoom(fixture.connection,room._id,forHotel);
    return room._id.toString();
  }

  /** A reservation as the lifecycle stores it after confirmation (or later), with its BOOKED range. */
  async function storedStay(session: Session, roomId: string, forHotel: string, checkIn: string, checkOut: string, status: BookingStatus): Promise<string> {
    const _id = new Types.ObjectId();
    await bookings.create([{
      _id,
      userId: new Types.ObjectId(session.userId),
      hotelId: new Types.ObjectId(forHotel),
      hotelName: 'Stored',
      rooms: [{ roomId: new Types.ObjectId(roomId), roomName: 'Room', pricePerNight: 10000, adults: 1, childrenAges: [], subtotal: 10000 }],
      checkIn,
      checkOut,
      nights: 1,
      totalPrice: 10000,
      currency: 'USD',
      status,
      bookingReference: `HTL-${_id.toString().slice(-8).toUpperCase()}`,
      policySnapshot: { cancellationTiers: [], checkInTime: '14:00', checkOutTime: '11:00' },
    } as Partial<HotelBooking>]);
    if (status === BookingStatus.CONFIRMED) {
      await availabilities.updateOne({ roomId: new Types.ObjectId(roomId) }, {
        $setOnInsert: { hotelId: new Types.ObjectId(forHotel), blockedRanges: [] },
        $push: { bookedRanges: { startDate: checkIn, endDate: checkOut, status: BookedRangeStatus.BOOKED, hotelBookingId: _id } },
      }, { upsert: true }).exec();
    }
    return _id.toString();
  }

  /**
   * Runs `change` at the exact point between hold()'s first hotel/room check and its transaction
   * (ensureAvailability runs there), reproducing a deactivation that lands in that window.
   */
  async function duringHold<T>(change: () => Promise<unknown>, action: () => Promise<T>): Promise<T> {
    const original = inventory.ensureAvailability.bind(inventory);
    inventory.ensureAvailability = async (selected) => {
      await change();
      return original(selected);
    };
    try {
      return await action();
    } finally {
      inventory.ensureAvailability = original;
    }
  }

  before(async () => {
    await fixture.start('hotel-bookings-deactivation');
    hotels = fixture.app.get(getModelToken(Hotel.name));
    rooms = fixture.app.get(getModelToken(Room.name));
    availabilities = fixture.app.get(getModelToken(RoomAvailability.name));
    bookings = fixture.app.get(getModelToken(HotelBooking.name));
    connection = fixture.app.get(getConnectionToken());
    service = fixture.app.get(HotelBookingsService);
    inventory = fixture.app.get(RoomInventoryAdapter);
    fixture.app.get(HotelBookingsClock).today = () => TODAY;
  }, { timeout: 30 * 60_000 });
  after(() => fixture.stop());

  beforeEach(async () => {
    await fixture.reset();
    alice = await fixture.login('alice@example.com', UserRole.USER, 'Alice');
    bob = await fixture.login('bob@example.com', UserRole.USER, 'Bob');
    hotelId = await createHotel('Nile View Hotel');
    deluxe = await createRoom(hotelId, 'Deluxe King 204');
    twin = await createRoom(hotelId, 'Twin 105');
  });

  it('ACC-15: a hotel deactivated during the hold aborts it with 404 and holds nothing', async () => {
    const response = await duringHold(
      () => hotels.updateOne({ _id: hotelId }, { $set: { isActive: false } }).exec(),
      () => post(request(), alice),
    );
    assert.equal(response.status, 404);
    assert.equal(response.body.message, 'Hotel not found');
    assert.equal(await bookings.countDocuments(), 0);
    assert.deepEqual(await ranges(deluxe), []);
    assert.deepEqual(await ranges(twin), []);
  });

  it('HTL-06: a room deactivated during the hold aborts the whole multi-room hold with 404', async () => {
    // The second room is switched off in the window; the first room must not stay held either.
    const response = await duringHold(
      () => rooms.updateOne({ _id: twin }, { $set: { isActive: false } }).exec(),
      () => post(request(), alice),
    );
    assert.equal(response.status, 404);
    assert.equal(response.body.message, 'Room not found in this hotel');
    assert.equal(await bookings.countDocuments(), 0);
    assert.deepEqual(await ranges(deluxe), []);
    assert.deepEqual(await ranges(twin), []);

    // Nothing changed in the window: the same request succeeds (the re-check does not block normal holds).
    await rooms.updateOne({ _id: twin }, { $set: { isActive: true } }).exec();
    const ok = await duringHold(async () => undefined, () => post(request(), alice));
    assert.equal(ok.status, 201);
  });

  it('HTL-06: roomHasActiveReservations is true only for an unexpired hold or a confirmed stay not yet checked out', async () => {
    assert.equal(await service.roomHasActiveReservations(deluxe), false);

    // An unexpired PENDING hold.
    const held = (await post(request({ rooms: [{ roomId: deluxe, adults: 1, childrenAges: [] }] }), alice).expect(201)).body.hotelBookingId;
    assert.equal(await service.roomHasActiveReservations(deluxe), true);
    assert.equal(await service.roomHasActiveReservations(twin), false, 'other rooms are not affected');
    // Once the hold has expired it no longer counts, even before the sweep runs.
    await bookings.updateOne({ _id: held }, { $set: { holdExpiresAt: new Date(Date.now() - 1000) } }).exec();
    assert.equal(await service.roomHasActiveReservations(deluxe), false);

    // Finished, cancelled and expired reservations do not count.
    await storedStay(bob, twin, hotelId, '2026-11-10', '2026-11-15', BookingStatus.CONFIRMED); // checked out today
    await storedStay(bob, twin, hotelId, '2026-10-01', '2026-10-03', BookingStatus.COMPLETED);
    await storedStay(bob, twin, hotelId, '2026-12-01', '2026-12-03', BookingStatus.CANCELLED);
    await storedStay(bob, twin, hotelId, '2026-12-05', '2026-12-07', BookingStatus.EXPIRED);
    assert.equal(await service.roomHasActiveReservations(twin), false);

    // A stay in progress, and a future confirmed stay, both count.
    const ongoing = await storedStay(bob, twin, hotelId, '2026-11-14', '2026-11-16', BookingStatus.CONFIRMED);
    assert.equal(await service.roomHasActiveReservations(twin), true);
    await bookings.deleteOne({ _id: ongoing }).exec();
    await storedStay(bob, twin, hotelId, '2027-01-10', '2027-01-12', BookingStatus.CONFIRMED);
    assert.equal(await service.roomHasActiveReservations(twin), true);

    // It can run inside the caller's transaction (Person 5 checks and deactivates atomically).
    const inside = await connection.transaction((session) => service.roomHasActiveReservations(twin, session));
    assert.equal(inside, true);
    assert.equal(await service.roomHasActiveReservations('not-an-id'), false);
  });

  it('ACC-15: releasePendingHoldsForHotel expires only that hotel\'s pending holds and never touches confirmed stays', async () => {
    const otherHotel = await createHotel('Delta Inn');
    const otherRoom = await createRoom(otherHotel, 'Delta 1');
    const pendingA = (await post(request({ rooms: [{ roomId: deluxe, adults: 1, childrenAges: [] }] }), alice).expect(201)).body.hotelBookingId;
    const pendingB = (await post(request({ checkIn: '2027-01-05', checkOut: '2027-01-07', rooms: [{ roomId: twin, adults: 1, childrenAges: [] }] }), bob).expect(201)).body.hotelBookingId;
    const elsewhere = (await post(request({ hotelId: otherHotel, rooms: [{ roomId: otherRoom, adults: 1, childrenAges: [] }] }), bob).expect(201)).body.hotelBookingId;
    const confirmed = await storedStay(alice, twin, hotelId, '2026-12-20', '2026-12-23', BookingStatus.CONFIRMED);
    const completed = await storedStay(bob, deluxe, hotelId, '2026-10-01', '2026-10-03', BookingStatus.COMPLETED);
    const before = await bookings.findById(confirmed).lean().exec();

    assert.equal(await service.releasePendingHoldsForHotel(hotelId), 2);

    const status = async (id: string) => (await bookings.findById(id).lean().exec())!;
    for (const id of [pendingA, pendingB]) {
      const released = await status(id);
      assert.equal(released.status, BookingStatus.EXPIRED);
      assert.equal(released.holdExpiresAt, undefined);
    }
    // The hotel's confirmed (and completed) reservations are untouched, including their BOOKED range.
    assert.deepEqual(await status(confirmed), before);
    assert.equal((await status(completed)).status, BookingStatus.COMPLETED);
    const twinRanges = await ranges(twin);
    assert.deepEqual(twinRanges.map((range) => [range.status, range.hotelBookingId?.toString()]), [[BookedRangeStatus.BOOKED, confirmed]]);
    assert.deepEqual(await ranges(deluxe), []);
    // Another hotel's hold is not affected.
    assert.equal((await status(elsewhere)).status, BookingStatus.PENDING);
    assert.equal((await ranges(otherRoom)).length, 1);

    // Running it again changes nothing, and an invalid id is a no-op.
    assert.equal(await service.releasePendingHoldsForHotel(hotelId), 0);
    assert.equal(await service.releasePendingHoldsForHotel('not-an-id'), 0);
    assert.equal(await bookings.countDocuments({ status: BookingStatus.EXPIRED }), 2);
  });

  it('ACC-15: after a deactivation releases its holds, a reactivated hotel\'s rooms can be held again', async () => {
    await post(request(), alice).expect(201);
    await hotels.updateOne({ _id: hotelId }, { $set: { isActive: false } }).exec();
    assert.equal(await service.releasePendingHoldsForHotel(hotelId), 1);
    // While deactivated it cannot be booked at all.
    assert.equal((await post(request(), bob).expect(404)).body.message, 'Hotel not found');
    await hotels.updateOne({ _id: hotelId }, { $set: { isActive: true } }).exec();
    await post(request(), bob).expect(201);
    assert.equal((await ranges(deluxe)).length, 1);
  });
});
