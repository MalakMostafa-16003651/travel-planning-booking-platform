import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { BookingStatus } from '../src/common/enums/booking-status.enum';
import { UserRole } from '../src/common/enums/user-role.enum';
import { todayUtc } from '../src/hotel-bookings/hotel-booking.dates';
import { HotelBookingsMaintenanceService } from '../src/hotel-bookings/hotel-bookings-maintenance.service';
import { HotelBookingsModule } from '../src/hotel-bookings/hotel-bookings.module';
import { HotelBookingsService } from '../src/hotel-bookings/hotel-bookings.service';
import { HotelBooking } from '../src/hotel-bookings/schemas/hotel-booking.schema';
import { AdminFixture, Session } from './admin-fixture';

const DAY_MS = 24 * 60 * 60 * 1000;

/** A UTC calendar date `days` away from today, so the tests hold on any day they run. */
function day(days: number): string {
  return todayUtc(new Date(Date.now() + days * DAY_MS));
}

describe('HTL-20 groups, GEN-11 completion and ACC-12 upcoming stays', { concurrency: false }, () => {
  const fixture = new AdminFixture([HotelBookingsModule]);
  let alice: Session;
  let bob: Session;
  let bookings: Model<HotelBooking>;
  let service: HotelBookingsService;
  let maintenance: HotelBookingsMaintenanceService;

  const get = (session: Session | null, query = '') => {
    const call = fixture.http().get(`/api/hotel-bookings${query}`);
    return session ? call.set('Cookie', session.cookie) : call;
  };

  async function stay(session: Session, checkIn: number, checkOut: number, status = BookingStatus.CONFIRMED, name = 'Stay'): Promise<string> {
    const nights = checkOut - checkIn;
    const [booking] = await bookings.create([{
      userId: new Types.ObjectId(session.userId),
      hotelId: new Types.ObjectId(),
      hotelName: name,
      rooms: [{ roomId: new Types.ObjectId(), roomName: 'Deluxe King 204', pricePerNight: 10000, adults: 2, childrenAges: [], subtotal: nights * 10000 }],
      checkIn: day(checkIn),
      checkOut: day(checkOut),
      nights,
      totalPrice: nights * 10000,
      currency: 'USD',
      status,
      holdExpiresAt: status === BookingStatus.PENDING ? new Date(Date.now() + 10 * 60_000) : undefined,
      policySnapshot: { cancellationTiers: [], checkInTime: '14:00', checkOutTime: '11:00' },
    } as Partial<HotelBooking>]);
    return booking._id.toString();
  }

  const names = (body: { items: { hotelName: string }[] }) => body.items.map((item) => item.hotelName);

  before(async () => {
    await fixture.start('hotel-bookings-groups');
    bookings = fixture.app.get(getModelToken(HotelBooking.name));
    service = fixture.app.get(HotelBookingsService);
    maintenance = fixture.app.get(HotelBookingsMaintenanceService);
  }, { timeout: 30 * 60_000 });
  after(() => fixture.stop());

  beforeEach(async () => {
    await fixture.reset();
    alice = await fixture.login('alice@example.com', UserRole.USER, 'Alice');
    bob = await fixture.login('bob@example.com', UserRole.USER, 'Bob');
  });

  it('L2: today is the UTC calendar date as YYYY-MM-DD', () => {
    assert.equal(todayUtc(new Date('2026-11-08T23:59:59.999Z')), '2026-11-08');
    assert.equal(todayUtc(new Date('2026-11-09T00:00:00.000Z')), '2026-11-09');
    // 01:30 in Cairo (UTC+2) on the 9th is still the 8th in UTC.
    assert.equal(todayUtc(new Date('2026-11-09T01:30:00+02:00')), '2026-11-08');
    assert.match(todayUtc(), /^\d{4}-\d{2}-\d{2}$/);
  });

  it('HTL-20: UPCOMING lists Pending and Confirmed stays not yet over, nearest check-in first, including stays in progress', async () => {
    await stay(alice, 10, 12, BookingStatus.CONFIRMED, 'Later');
    await stay(alice, 3, 5, BookingStatus.PENDING, 'Soon (pending)');
    await stay(alice, -1, 2, BookingStatus.CONFIRMED, 'In progress');
    await stay(alice, 0, 1, BookingStatus.CONFIRMED, 'Starts today');
    await stay(alice, -3, 0, BookingStatus.CONFIRMED, 'Checks out today');
    await stay(alice, 20, 22, BookingStatus.CANCELLED, 'Cancelled');
    await stay(alice, 20, 22, BookingStatus.EXPIRED, 'Expired');
    await stay(bob, 4, 6, BookingStatus.CONFIRMED, 'Bob');

    const upcoming = await get(alice, '?group=UPCOMING').expect(200);
    assert.deepEqual(names(upcoming.body), ['In progress', 'Starts today', 'Soon (pending)', 'Later']);
    assert.equal(upcoming.body.total, 4);
  });

  it('HTL-20: PAST lists Completed stays and Confirmed ones whose check-out date has arrived, latest first', async () => {
    await stay(alice, -10, -8, BookingStatus.COMPLETED, 'Old');
    await stay(alice, -3, 0, BookingStatus.CONFIRMED, 'Checks out today');
    await stay(alice, -5, -2, BookingStatus.CONFIRMED, 'Not swept yet');
    await stay(alice, -1, 2, BookingStatus.CONFIRMED, 'In progress');
    await stay(alice, -9, -7, BookingStatus.CANCELLED, 'Cancelled');
    await stay(bob, -10, -8, BookingStatus.COMPLETED, 'Bob');

    const past = await get(alice, '?group=PAST').expect(200);
    assert.deepEqual(names(past.body), ['Checks out today', 'Not swept yet', 'Old']);
    assert.equal(past.body.total, 3);
  });

  it('HTL-20: every reservation falls in exactly one group, and pages hold 10', async () => {
    for (let index = 0; index < 12; index += 1) await stay(alice, index + 1, index + 2, BookingStatus.CONFIRMED, `Future ${index}`);
    await stay(alice, -4, -2, BookingStatus.COMPLETED, 'Past');
    await stay(alice, 5, 6, BookingStatus.CANCELLED, 'Cancelled');

    const first = await get(alice, '?group=UPCOMING').expect(200);
    assert.equal(first.body.items.length, 10);
    assert.equal(first.body.total, 12);
    assert.equal(first.body.items[0].hotelName, 'Future 0');
    assert.deepEqual(names((await get(alice, '?group=UPCOMING&page=2').expect(200)).body), ['Future 10', 'Future 11']);
    const totals = await Promise.all(['UPCOMING', 'PAST', 'CANCELLED'].map(async (group) => (await get(alice, `?group=${group}`).expect(200)).body.total));
    assert.deepEqual(totals, [12, 1, 1]);
    assert.equal((await get(alice).expect(200)).body.total, 14);
  });

  it('HTL-20: rejects an unknown group, and guests or other roles cannot list', async () => {
    await get(alice, '?group=FUTURE').expect(400);
    await get(alice, '?group=upcoming').expect(400);
    await get(null, '?group=UPCOMING').expect(401);
    const moderator = await fixture.login('hotel@example.com', UserRole.HOTEL_MODERATOR);
    await get(moderator, '?group=PAST').expect(403);
  });

  it('GEN-11: the sweep completes Confirmed stays once their check-out date arrives, and nothing else', async () => {
    const done = await stay(alice, -5, -2);
    const checkoutToday = await stay(alice, -2, 0);
    const inProgress = await stay(alice, -1, 1);
    const future = await stay(alice, 3, 4);
    const cancelled = await stay(alice, -6, -4, BookingStatus.CANCELLED);
    const pending = await stay(alice, 2, 3, BookingStatus.PENDING);

    await maintenance.sweep();

    const status = async (id: string) => (await bookings.findById(id).lean().exec())!;
    for (const id of [done, checkoutToday]) {
      const booking = await status(id);
      assert.equal(booking.status, BookingStatus.COMPLETED);
      assert.ok(booking.completedAt instanceof Date);
    }
    for (const [id, expected] of [[inProgress, BookingStatus.CONFIRMED], [future, BookingStatus.CONFIRMED], [cancelled, BookingStatus.CANCELLED], [pending, BookingStatus.PENDING]] as const) {
      const booking = await status(id);
      assert.equal(booking.status, expected);
      assert.equal(booking.completedAt, undefined);
    }
    // Running again changes nothing (the write is conditional on CONFIRMED).
    const firstCompletion = (await status(done)).completedAt;
    assert.equal(await service.completeFinishedStays(), 0);
    assert.deepEqual((await status(done)).completedAt, firstCompletion);
    // The stay in progress completes on its check-out date.
    assert.equal(await service.completeFinishedStays(day(1)), 1);
    assert.equal((await status(inProgress)).status, BookingStatus.COMPLETED);
  });

  it('ACC-12: a Confirmed stay that has not checked out blocks deactivation; others do not', async () => {
    assert.equal(await service.hasUpcomingConfirmedBookings(alice.userId), false);

    await stay(alice, -5, -2, BookingStatus.CONFIRMED);
    await stay(alice, -3, 0, BookingStatus.CONFIRMED);
    await stay(alice, 2, 4, BookingStatus.PENDING);
    await stay(alice, 2, 4, BookingStatus.CANCELLED);
    await stay(alice, -10, -8, BookingStatus.COMPLETED);
    assert.equal(await service.hasUpcomingConfirmedBookings(alice.userId), false);

    const ongoing = await stay(alice, -1, 1, BookingStatus.CONFIRMED);
    assert.equal(await service.hasUpcomingConfirmedBookings(alice.userId), true);
    await bookings.deleteOne({ _id: ongoing }).exec();
    await stay(alice, 30, 31, BookingStatus.CONFIRMED);
    assert.equal(await service.hasUpcomingConfirmedBookings(alice.userId), true);

    assert.equal(await service.hasUpcomingConfirmedBookings(bob.userId), false);
    assert.equal(await service.hasUpcomingConfirmedBookings('not-an-id'), false);
  });

  it('lists the UPCOMING and PAST groups in Swagger', async () => {
    const document = (await fixture.http().get('/api/docs-json').expect(200)).body;
    const group = document.paths['/api/hotel-bookings'].get.parameters.find((parameter: { name: string }) => parameter.name === 'group');
    assert.deepEqual(group.schema.enum, ['UPCOMING', 'PAST', 'CANCELLED']);
  });
});
