import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { BookingStatus } from '../src/common/enums/booking-status.enum';
import { UserRole } from '../src/common/enums/user-role.enum';
import { HotelBookingsModule } from '../src/hotel-bookings/hotel-bookings.module';
import { HotelBookingsService } from '../src/hotel-bookings/hotel-bookings.service';
import { HotelBooking } from '../src/hotel-bookings/schemas/hotel-booking.schema';
import { AdminFixture, Session } from './admin-fixture';

const HOTEL_A = new Types.ObjectId();
const HOTEL_B = new Types.ObjectId();

/** A stored reservation as the future hold/confirm steps will write it; tests insert them directly. */
function booking(userId: string, overrides: Partial<Record<keyof HotelBooking, unknown>> = {}): Partial<HotelBooking> {
  // Cast: some tests deliberately pass invalid values to check the schema rejects them.
  return {
    userId: new Types.ObjectId(userId),
    hotelId: HOTEL_A,
    hotelName: 'Nile View Hotel',
    rooms: [
      { roomId: new Types.ObjectId(), roomName: 'Deluxe King 204', pricePerNight: 12500, adults: 2, childrenAges: [7], subtotal: 37500 },
      { roomId: new Types.ObjectId(), roomName: 'Twin 105', pricePerNight: 9000, adults: 1, childrenAges: [], subtotal: 27000 },
    ],
    checkIn: '2026-12-20',
    checkOut: '2026-12-23',
    nights: 3,
    totalPrice: 64500,
    currency: 'USD',
    status: BookingStatus.CONFIRMED,
    bookingReference: `R${new Types.ObjectId().toString().slice(-7).toUpperCase()}`,
    paymentId: new Types.ObjectId(),
    policySnapshot: { cancellationTiers: [{ daysBeforeCheckIn: 7, refundPercentage: 50 }], checkInTime: '14:00', checkOutTime: '11:00' },
    ...overrides,
  } as Partial<HotelBooking>;
}

describe('HTL-20 hotel reservation records', { concurrency: false }, () => {
  const fixture = new AdminFixture([HotelBookingsModule]);
  let alice: Session;
  let bob: Session;
  let bookings: Model<HotelBooking>;
  let service: HotelBookingsService;

  const get = (session: Session | null, path = '') => {
    const call = fixture.http().get(`/api/hotel-bookings${path}`);
    return session ? call.set('Cookie', session.cookie) : call;
  };

  before(async () => {
    await fixture.start('hotel-bookings-records');
    bookings = fixture.app.get(getModelToken(HotelBooking.name));
    service = fixture.app.get(HotelBookingsService);
  }, { timeout: 30 * 60_000 });
  after(() => fixture.stop());

  beforeEach(async () => {
    await fixture.reset();
    alice = await fixture.login('alice@example.com', UserRole.USER, 'Alice');
    bob = await fixture.login('bob@example.com', UserRole.USER, 'Bob');
  });

  it('HTL-20: lists only your own reservations with rooms, dates, guests, total and status', async () => {
    const [mine] = await bookings.create([booking(alice.userId)]);
    await bookings.create([booking(bob.userId)]);

    const response = await get(alice).expect(200);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(response.body.total, 1);
    assert.equal(response.body.pageSize, 10);
    const [item] = response.body.items;
    assert.equal(item.hotelBookingId, mine._id.toString());
    assert.equal(item.userId, alice.userId);
    assert.equal(item.hotelName, 'Nile View Hotel');
    assert.equal(item.bookingReference, mine.bookingReference);
    assert.equal(item.checkIn, '2026-12-20');
    assert.equal(item.checkOut, '2026-12-23');
    assert.equal(item.nights, 3);
    assert.equal(item.guestCount, 4);
    assert.equal(item.totalPrice, 64500);
    assert.equal(item.currency, 'USD');
    assert.equal(item.status, 'CONFIRMED');
    assert.deepEqual(item.rooms.map((room: { roomName: string; childrenAges: number[] }) => [room.roomName, room.childrenAges]), [['Deluxe King 204', [7]], ['Twin 105', []]]);
  });

  it('HTL-20: group=CANCELLED lists cancelled and expired reservations only', async () => {
    await bookings.create([
      booking(alice.userId, { status: BookingStatus.CONFIRMED }),
      booking(alice.userId, { status: BookingStatus.COMPLETED }),
      booking(alice.userId, { status: BookingStatus.PENDING, bookingReference: undefined, paymentId: undefined, holdExpiresAt: new Date(Date.now() + 60_000) }),
      booking(alice.userId, { status: BookingStatus.CANCELLED, checkIn: '2026-12-01', checkOut: '2026-12-02', nights: 1, cancelledAt: new Date(), cancelledBy: 'USER', refundAmount: 32250 }),
      booking(alice.userId, { status: BookingStatus.EXPIRED, checkIn: '2026-12-10', checkOut: '2026-12-11', nights: 1, bookingReference: undefined, paymentId: undefined }),
    ]);

    const cancelled = await get(alice, '?group=CANCELLED').expect(200);
    assert.equal(cancelled.body.total, 2);
    assert.deepEqual(cancelled.body.items.map((item: { status: string }) => item.status), ['EXPIRED', 'CANCELLED']);
    assert.equal(cancelled.body.items[1].cancelledBy, 'USER');
    assert.equal(cancelled.body.items[1].refundAmount, 32250);
    assert.equal((await get(alice).expect(200)).body.total, 5);
  });

  it('GEN-05: lists newest first, 10 per page', async () => {
    for (let index = 0; index < 12; index += 1) {
      await bookings.create([booking(alice.userId, { hotelName: `Hotel ${index}` })]);
    }
    const first = await get(alice).expect(200);
    assert.equal(first.body.items.length, 10);
    assert.equal(first.body.total, 12);
    assert.equal(first.body.items[0].hotelName, 'Hotel 11');
    const second = await get(alice, '?page=2').expect(200);
    assert.deepEqual(second.body.items.map((item: { hotelName: string }) => item.hotelName), ['Hotel 1', 'Hotel 0']);
  });

  it('HTL-20: opens full details of your own reservation', async () => {
    const [mine] = await bookings.create([booking(alice.userId)]);
    const response = await get(alice, `/${mine._id.toString()}`).expect(200);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(response.body.hotelBookingId, mine._id.toString());
    assert.equal(response.body.hotelId, HOTEL_A.toString());
    assert.equal(response.body.paymentId, mine.paymentId!.toString());
    assert.deepEqual(response.body.policy, { cancellationTiers: [{ daysBeforeCheckIn: 7, refundPercentage: 50 }], checkInTime: '14:00', checkOutTime: '11:00' });
    assert.equal(response.body.rooms[0].pricePerNight, 12500);
    assert.equal(response.body.rooms[0].subtotal, 37500);
  });

  it("ACC-11: another user's reservation, or one that does not exist, is not found", async () => {
    const [mine] = await bookings.create([booking(alice.userId)]);
    const forBob = await get(bob, `/${mine._id.toString()}`).expect(404);
    assert.equal(forBob.body.message, 'Hotel booking not found');
    await get(alice, `/${new Types.ObjectId().toString()}`).expect(404);
    // A query identifier cannot select another user's list.
    assert.equal((await get(bob, `?userId=${alice.userId}`).expect(400)).body.message, 'Validation failed');
  });

  it('GEN-13: rejects invalid input', async () => {
    await get(alice, '/not-an-id').expect(400);
    await get(alice, '?group=FUTURE').expect(400);
    await get(alice, '?group=cancelled').expect(400);
    await get(alice, '?page=0').expect(400);
    await get(alice, '?page=abc').expect(400);
  });

  it('ACC-10: guests must log in', async () => {
    const [mine] = await bookings.create([booking(alice.userId)]);
    await get(null).expect(401);
    await get(null, `/${mine._id.toString()}`).expect(401);
  });

  it('ACC-11: only role USER has hotel reservations', async () => {
    const [mine] = await bookings.create([booking(alice.userId)]);
    for (const [email, role] of [['admin@example.com', UserRole.ADMIN], ['hotel@example.com', UserRole.HOTEL_MODERATOR], ['air@example.com', UserRole.AIRLINE_MODERATOR]] as const) {
      const session = await fixture.login(email, role);
      await get(session).expect(403);
      await get(session, `/${mine._id.toString()}`).expect(403);
    }
  });

  it('reading changes nothing in the database', async () => {
    const [mine] = await bookings.create([booking(alice.userId)]);
    const before = await bookings.findById(mine._id).lean().exec();
    await get(alice).expect(200);
    await get(alice, `/${mine._id.toString()}`).expect(200);
    await get(bob, `/${mine._id.toString()}`).expect(404);
    assert.deepEqual(await bookings.findById(mine._id).lean().exec(), before);
    assert.equal(await bookings.countDocuments(), 1);
  });

  it('HTL-16/PAY-04: the schema refuses invalid reservations and stores nothing', async () => {
    const invalid = [
      booking(alice.userId, { rooms: [] }),
      booking(alice.userId, { rooms: [{ roomId: new Types.ObjectId(), roomName: 'A', pricePerNight: 100, adults: 1, childrenAges: [18], subtotal: 100 }] }),
      booking(alice.userId, { totalPrice: 645.5 }),
      booking(alice.userId, { checkIn: '20/12/2026' }),
      booking(alice.userId, { status: 'BOOKED' }),
    ];
    for (const document of invalid) await assert.rejects(bookings.create([document]));
    assert.equal(await bookings.countDocuments(), 0);
  });

  it('booking references are unique', async () => {
    await bookings.create([booking(alice.userId, { bookingReference: 'H7K2M9QX' })]);
    await assert.rejects(bookings.create([booking(bob.userId, { bookingReference: 'H7K2M9QX' })]));
    // Unconfirmed reservations have no reference yet, and several may coexist.
    await bookings.create([
      booking(alice.userId, { status: BookingStatus.PENDING, bookingReference: undefined }),
      booking(bob.userId, { status: BookingStatus.PENDING, bookingReference: undefined }),
    ]);
    assert.equal(await bookings.countDocuments(), 3);
  });

  it("HTL-22: lists one hotel's reservations for the moderator view, nearest check-in first, without expired holds", async () => {
    await bookings.create([
      booking(alice.userId, { checkIn: '2026-12-20', checkOut: '2026-12-23' }),
      booking(bob.userId, { checkIn: '2026-12-05', checkOut: '2026-12-06', nights: 1, status: BookingStatus.CANCELLED }),
      booking(bob.userId, { status: BookingStatus.EXPIRED, bookingReference: undefined }),
      booking(alice.userId, { hotelId: HOTEL_B }),
    ]);
    const page = await service.listForHotel(HOTEL_A.toString());
    assert.equal(page.total, 2);
    assert.equal(page.pageSize, 10);
    assert.deepEqual(page.items.map((item) => [item.checkIn, item.status]), [['2026-12-05', 'CANCELLED'], ['2026-12-20', 'CONFIRMED']]);
    assert.equal(page.items[1].guestCount, 4);
    assert.equal(page.items[1].rooms.length, 2);
    assert.equal(page.items[1].userId, alice.userId);
    await assert.rejects(service.listForHotel('not-an-id'), { status: 404 });
  });

  it('HTL-22 (team leader decision): an active hold is listed as PENDING; a hold that has ended is hidden even before the sweep', async () => {
    const [active, ended, completed] = await bookings.create([
      booking(bob.userId, { checkIn: '2026-12-10', checkOut: '2026-12-12', nights: 2, status: BookingStatus.PENDING, bookingReference: undefined, paymentId: undefined, holdExpiresAt: new Date(Date.now() + 5 * 60_000) }),
      // Ended a minute ago, but still PENDING because the expiry sweep has not run yet.
      booking(alice.userId, { checkIn: '2026-12-11', checkOut: '2026-12-13', nights: 2, status: BookingStatus.PENDING, bookingReference: undefined, paymentId: undefined, holdExpiresAt: new Date(Date.now() - 60_000) }),
      booking(alice.userId, { checkIn: '2026-11-01', checkOut: '2026-11-03', nights: 2, status: BookingStatus.COMPLETED }),
      booking(alice.userId, { status: BookingStatus.EXPIRED, bookingReference: undefined, paymentId: undefined }),
    ]);
    const page = await service.listForHotel(HOTEL_A.toString());
    assert.deepEqual(page.items.map((item) => [item.hotelBookingId, item.status]), [
      [completed._id.toString(), 'COMPLETED'],
      [active._id.toString(), 'PENDING'],
    ]);
    assert.equal(page.total, 2);
    assert.equal(page.items.some((item) => item.hotelBookingId === ended._id.toString()), false);
  });

  it('ACC-17: lists all reservations for admins, filtered by status and an inclusive check-in range', async () => {
    await bookings.create([
      booking(alice.userId, { checkIn: '2026-12-01', checkOut: '2026-12-02', nights: 1 }),
      booking(bob.userId, { checkIn: '2026-12-15', checkOut: '2026-12-16', nights: 1 }),
      booking(bob.userId, { checkIn: '2026-12-31', checkOut: '2027-01-01', nights: 1, status: BookingStatus.CANCELLED }),
    ]);
    assert.equal((await service.listForAdmin({})).total, 3);
    assert.equal((await service.listForAdmin({ status: BookingStatus.CANCELLED })).total, 1);
    const range = await service.listForAdmin({ from: '2026-12-01', to: '2026-12-15' });
    assert.deepEqual(range.items.map((item) => item.checkIn).sort(), ['2026-12-01', '2026-12-15']);
    assert.equal((await service.listForAdmin({ from: '2026-12-16' })).total, 1);
    await assert.rejects(service.listForAdmin({ from: '2026/12/01' }), { status: 400 });
  });

  it('lists both endpoints in Swagger with HTL-20', async () => {
    const document = (await fixture.http().get('/api/docs-json').expect(200)).body;
    assert.match(document.paths['/api/hotel-bookings'].get.summary, /^HTL-20/);
    assert.match(document.paths['/api/hotel-bookings/{id}'].get.summary, /^HTL-20/);
    assert.ok(document.components.schemas.HotelBookingDto.properties.rooms);
  });
});
