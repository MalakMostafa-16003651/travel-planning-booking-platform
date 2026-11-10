import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AccountStatus } from '../src/common/enums/account-status.enum';
import { BookingStatus } from '../src/common/enums/booking-status.enum';
import { UserRole } from '../src/common/enums/user-role.enum';
import { HotelBooking } from '../src/hotel-bookings/schemas/hotel-booking.schema';
import { Hotel } from '../src/hotels/schemas/hotel.schema';
import { ReviewsModule } from '../src/reviews/reviews.module';
import { ReviewsService } from '../src/reviews/reviews.service';
import { Review } from '../src/reviews/schemas/review.schema';
import { AdminFixture, Session } from './admin-fixture';

describe('HTL-23/HTL-24 hotel reviews and ratings', { concurrency: false }, () => {
  const fixture = new AdminFixture([ReviewsModule]);
  let alice: Session;
  let bob: Session;
  let hotels: Model<Hotel>;
  let bookings: Model<HotelBooking>;
  let reviews: Model<Review>;
  let service: ReviewsService;
  let hotelId: string;

  const http = () => fixture.http();
  const withCookie = <T extends { set: (name: string, value: string) => T }>(call: T, session?: Session) => session ? call.set('Cookie', session.cookie) : call;
  const post = (bookingId: string, body: unknown, session?: Session) => withCookie(http().post(`/api/hotel-bookings/${bookingId}/review`), session).send(body as object);
  const patch = (reviewId: string, body: unknown, session?: Session) => withCookie(http().patch(`/api/reviews/${reviewId}`), session).send(body as object);
  const remove = (reviewId: string, session?: Session) => withCookie(http().delete(`/api/reviews/${reviewId}`), session);
  const list = (id: string, session?: Session, query = '') => withCookie(http().get(`/api/hotels/${id}/reviews${query}`), session);

  async function createHotel(overrides: Partial<Hotel> = {}): Promise<string> {
    const [hotel] = await hotels.create([{ name: 'Nile View Hotel', city: 'Cairo', countryCode: 'EG', address: '1 Corniche St', ...overrides }]);
    return hotel._id.toString();
  }

  /** A reservation as the booking module stores it; status COMPLETED unless overridden. */
  async function stay(session: Session, overrides: Partial<Record<keyof HotelBooking, unknown>> = {}): Promise<string> {
    const [booking] = await bookings.create([{
      userId: new Types.ObjectId(session.userId),
      hotelId: new Types.ObjectId(hotelId),
      hotelName: 'Nile View Hotel',
      rooms: [
        { roomId: new Types.ObjectId(), roomName: 'Deluxe King 204', pricePerNight: 12500, adults: 2, childrenAges: [], subtotal: 25000 },
        { roomId: new Types.ObjectId(), roomName: 'Twin 105', pricePerNight: 9000, adults: 1, childrenAges: [5], subtotal: 18000 },
      ],
      checkIn: '2026-10-01',
      checkOut: '2026-10-03',
      nights: 2,
      totalPrice: 43000,
      currency: 'USD',
      status: BookingStatus.COMPLETED,
      bookingReference: `R${new Types.ObjectId().toString().slice(-7).toUpperCase()}`,
      policySnapshot: { cancellationTiers: [], checkInTime: '14:00', checkOutTime: '11:00' },
      ...overrides,
    } as Partial<HotelBooking>]);
    return booking._id.toString();
  }

  before(async () => {
    await fixture.start('hotel-reviews');
    hotels = fixture.app.get(getModelToken(Hotel.name));
    bookings = fixture.app.get(getModelToken(HotelBooking.name));
    reviews = fixture.app.get(getModelToken(Review.name));
    service = fixture.app.get(ReviewsService);
  }, { timeout: 30 * 60_000 });
  after(() => fixture.stop());

  beforeEach(async () => {
    await fixture.reset();
    alice = await fixture.login('alice@example.com', UserRole.USER, 'Alice');
    bob = await fixture.login('bob@example.com', UserRole.USER, 'Bob');
    hotelId = await createHotel();
  });

  it('HTL-23: rates and reviews a completed stay once, for the whole multi-room reservation', async () => {
    const bookingId = await stay(alice);
    const response = await post(bookingId, { rating: 4, comment: '  Friendly staff.  ' }, alice).expect(201);
    assert.equal(response.body.rating, 4);
    assert.equal(response.body.comment, 'Friendly staff.');
    assert.equal(response.body.hotelId, hotelId);
    assert.equal(response.body.isHidden, false);
    assert.deepEqual(response.body.author, { userId: alice.userId, name: 'Alice' });

    const stored = await reviews.findById(response.body.reviewId).lean().exec();
    assert.equal(stored!.hotelBookingId.toString(), bookingId);
    assert.equal(stored!.userId.toString(), alice.userId);
    assert.equal(await reviews.countDocuments(), 1);

    const again = await post(bookingId, { rating: 5 }, alice).expect(409);
    assert.equal(again.body.message, 'This reservation already has a review');
    assert.equal(await reviews.countDocuments(), 1);
  });

  it('HTL-23: the review text is optional; an empty text is stored as none', async () => {
    const first = await post(await stay(alice), { rating: 3 }, alice).expect(201);
    assert.equal(first.body.comment, null);
    const second = await post(await stay(alice), { rating: 5, comment: '   ' }, alice).expect(201);
    assert.equal(second.body.comment, null);
    await post(await stay(alice), { rating: 5, comment: 'x'.repeat(1000) }, alice).expect(201);
  });

  it('HTL-23: concurrent submissions for one reservation store exactly one review', async () => {
    const bookingId = await stay(alice);
    const results = await Promise.all(Array.from({ length: 6 }, (_, index) => post(bookingId, { rating: (index % 5) + 1 }, alice)));
    assert.deepEqual(results.map((result) => result.status).sort(), [201, 409, 409, 409, 409, 409]);
    assert.equal(await reviews.countDocuments({ hotelBookingId: new Types.ObjectId(bookingId) }), 1);
  });

  it('HTL-23/GEN-11: only a Completed stay can be reviewed', async () => {
    for (const status of [BookingStatus.PENDING, BookingStatus.CONFIRMED, BookingStatus.CANCELLED, BookingStatus.EXPIRED]) {
      const response = await post(await stay(alice, { status }), { rating: 5 }, alice).expect(409);
      assert.equal(response.body.message, 'Only a completed stay can be reviewed');
    }
    assert.equal(await reviews.countDocuments(), 0);
  });

  it("ACC-11: another user's reservation, or an unknown one, is not found", async () => {
    const bookingId = await stay(alice);
    assert.equal((await post(bookingId, { rating: 5 }, bob).expect(404)).body.message, 'Hotel booking not found');
    await post(new Types.ObjectId().toString(), { rating: 5 }, alice).expect(404);
    assert.equal(await reviews.countDocuments(), 0);
  });

  it('GEN-13: rejects invalid ratings, text and ids, and stores nothing', async () => {
    const bookingId = await stay(alice);
    for (const body of [{}, { rating: 0 }, { rating: 6 }, { rating: 4.5 }, { rating: '5' }, { rating: null }, { rating: 5, comment: 'x'.repeat(1001) }, { rating: 5, comment: 42 }, { rating: 5, userId: bob.userId }, { rating: 5, isHidden: true }]) {
      const response = await post(bookingId, body, alice).expect(400);
      assert.equal(response.body.message, 'Validation failed', JSON.stringify(body));
    }
    await post('not-an-id', { rating: 5 }, alice).expect(400);
    assert.equal(await reviews.countDocuments(), 0);
  });

  it('ACC-10/ACC-11: guests must log in and only role USER writes reviews', async () => {
    const bookingId = await stay(alice);
    const reviewId = (await post(bookingId, { rating: 4 }, alice).expect(201)).body.reviewId;
    await post(bookingId, { rating: 5 }).expect(401);
    await patch(reviewId, { rating: 5 }).expect(401);
    await remove(reviewId).expect(401);
    for (const [email, role] of [['admin@example.com', UserRole.ADMIN], ['hotel@example.com', UserRole.HOTEL_MODERATOR], ['air@example.com', UserRole.AIRLINE_MODERATOR]] as const) {
      const session = await fixture.login(email, role);
      await post(bookingId, { rating: 5 }, session).expect(403);
      await patch(reviewId, { rating: 5 }, session).expect(403);
      await remove(reviewId, session).expect(403);
    }
    assert.equal((await reviews.findById(reviewId).lean().exec())!.rating, 4);
  });

  it('HTL-23: the author edits the rating and text; others cannot', async () => {
    const reviewId = (await post(await stay(alice), { rating: 2, comment: 'Noisy.' }, alice).expect(201)).body.reviewId;

    const edited = await patch(reviewId, { rating: 5 }, alice).expect(200);
    assert.equal(edited.body.rating, 5);
    assert.equal(edited.body.comment, 'Noisy.');
    const text = await patch(reviewId, { comment: 'Quiet after all.' }, alice).expect(200);
    assert.equal(text.body.comment, 'Quiet after all.');
    const cleared = await patch(reviewId, { comment: null }, alice).expect(200);
    assert.equal(cleared.body.comment, null);
    assert.equal((await reviews.findById(reviewId).lean().exec())!.rating, 5);

    assert.equal((await patch(reviewId, { rating: 1 }, bob).expect(403)).body.message, 'You can only change your own reviews');
    await patch(new Types.ObjectId().toString(), { rating: 1 }, alice).expect(404);
    await patch('not-an-id', { rating: 1 }, alice).expect(400);
    await patch(reviewId, {}, alice).expect(400);
    await patch(reviewId, { rating: 0 }, alice).expect(400);
    await patch(reviewId, { comment: 'x'.repeat(1001) }, alice).expect(400);
    await patch(reviewId, { hotelId: new Types.ObjectId().toString() }, alice).expect(400);
    assert.equal((await reviews.findById(reviewId).lean().exec())!.rating, 5);
  });

  it('HTL-23: the author deletes the review and the average follows', async () => {
    const keep = (await post(await stay(alice), { rating: 2 }, alice).expect(201)).body.reviewId;
    const drop = (await post(await stay(bob), { rating: 5 }, bob).expect(201)).body.reviewId;
    assert.equal((await list(hotelId).expect(200)).body.averageRating, 3.5);

    assert.equal((await remove(drop, alice).expect(403)).body.message, 'You can only change your own reviews');
    await remove(drop, bob).expect(204);
    await remove(drop, bob).expect(404);
    assert.equal(await reviews.countDocuments({ _id: drop }), 0);

    const after = await list(hotelId).expect(200);
    assert.equal(after.body.averageRating, 2);
    assert.equal(after.body.ratingCount, 1);
    assert.equal(after.body.items[0].reviewId, keep);
  });

  it('HTL-24: anyone sees the average, the count and the reviews newest first, 10 per page', async () => {
    const ratings = [5, 4, 4, 3, 5, 5, 4, 2, 5, 4, 3, 5];
    for (const [index, rating] of ratings.entries()) {
      await post(await stay(index % 2 === 0 ? alice : bob), { rating, comment: `review ${index}` }, index % 2 === 0 ? alice : bob).expect(201);
    }
    const first = await list(hotelId).expect(200);
    assert.equal(first.headers['cache-control'], 'no-store');
    assert.equal(first.body.pageSize, 10);
    assert.equal(first.body.total, 12);
    assert.equal(first.body.ratingCount, 12);
    assert.equal(first.body.averageRating, 4.08);
    assert.equal(first.body.items.length, 10);
    assert.equal(first.body.items[0].comment, 'review 11');
    const second = await list(hotelId, undefined, '?page=2').expect(200);
    assert.deepEqual(second.body.items.map((item: { comment: string }) => item.comment), ['review 1', 'review 0']);
    assert.equal(second.body.averageRating, 4.08);
    // Logged-in users see the same list.
    assert.equal((await list(hotelId, bob).expect(200)).body.total, 12);
  });

  it('HTL-24: an unrated hotel has no average; unknown or deactivated hotels are 404 like the hotel detail', async () => {
    const empty = await list(hotelId).expect(200);
    assert.deepEqual([empty.body.items, empty.body.total, empty.body.averageRating, empty.body.ratingCount], [[], 0, null, 0]);
    await list(new Types.ObjectId().toString()).expect(404);
    await list('not-an-id').expect(400);
    await list(hotelId, undefined, '?page=0').expect(400);

    await post(await stay(alice), { rating: 4 }, alice).expect(201);
    await hotels.updateOne({ _id: hotelId }, { $set: { isActive: false } }).exec();
    await list(hotelId).expect(404);
    await list(hotelId, alice).expect(404);
    const admin = await fixture.login('admin@example.com', UserRole.ADMIN);
    assert.equal((await list(hotelId, admin).expect(200)).body.total, 1);
  });

  it('GEN-10: a hidden review is listed only for its author and admins, and never counts in the average', async () => {
    const hidden = (await post(await stay(alice), { rating: 1, comment: 'Rude.' }, alice).expect(201)).body.reviewId;
    await post(await stay(bob), { rating: 5 }, bob).expect(201);
    await service.setReviewHidden(hidden, true);

    for (const viewer of [undefined, bob]) {
      const page = await list(hotelId, viewer).expect(200);
      assert.equal(page.body.total, 1);
      assert.equal(page.body.items.some((item: { reviewId: string }) => item.reviewId === hidden), false);
      assert.deepEqual([page.body.averageRating, page.body.ratingCount], [5, 1]);
    }
    const own = await list(hotelId, alice).expect(200);
    assert.equal(own.body.total, 2);
    assert.equal(own.body.items.find((item: { reviewId: string }) => item.reviewId === hidden).isHidden, true);
    assert.deepEqual([own.body.averageRating, own.body.ratingCount], [5, 1]);
    const admin = await fixture.login('admin@example.com', UserRole.ADMIN);
    assert.equal((await list(hotelId, admin).expect(200)).body.total, 2);

    // The author can still edit it; it stays hidden.
    assert.equal((await patch(hidden, { rating: 2 }, alice).expect(200)).body.isHidden, true);
    await service.setReviewHidden(hidden, false);
    assert.equal((await list(hotelId).expect(200)).body.ratingCount, 2);
  });

  it('ACC-12: a deactivated author is shown as "Deleted user" without an id; a suspended one keeps their name', async () => {
    await post(await stay(alice), { rating: 4 }, alice).expect(201);
    await post(await stay(bob), { rating: 2 }, bob).expect(201);
    await fixture.users.updateOne({ _id: alice.userId }, { $set: { status: AccountStatus.DEACTIVATED } }).exec();
    await fixture.users.updateOne({ _id: bob.userId }, { $set: { status: AccountStatus.SUSPENDED } }).exec();

    const page = await list(hotelId).expect(200);
    const authors = page.body.items.map((item: { author: { userId: string | null; name: string } }) => item.author);
    assert.deepEqual(authors, [{ userId: bob.userId, name: 'Bob' }, { userId: null, name: 'Deleted user' }]);
    assert.equal(page.body.ratingCount, 2);
    assert.equal(JSON.stringify(page.body).includes(alice.userId), false);
  });

  it('GEN-09/GEN-10: exports reviewExists, setReviewHidden and adminDeleteReview for moderation', async () => {
    const reviewId = (await post(await stay(alice), { rating: 4 }, alice).expect(201)).body.reviewId;
    assert.equal(await service.reviewExists(reviewId), true);
    assert.equal(await service.reviewExists(new Types.ObjectId().toString()), false);
    assert.equal(await service.reviewExists('not-an-id'), false);

    await service.setReviewHidden(reviewId, true);
    assert.equal((await reviews.findById(reviewId).lean().exec())!.isHidden, true);
    await assert.rejects(service.setReviewHidden(new Types.ObjectId().toString(), true), { status: 404 });
    await assert.rejects(service.setReviewHidden('not-an-id', true), { status: 404 });

    await service.adminDeleteReview(reviewId);
    assert.equal(await reviews.countDocuments(), 0);
    await assert.rejects(service.adminDeleteReview(reviewId), { status: 404 });
    await assert.rejects(service.adminDeleteReview('not-an-id'), { status: 404 });
  });

  it('HTL-02/HTL-12: getRatingStats returns visible averages per hotel, leaving unrated hotels out', async () => {
    const other = hotelId;
    await post(await stay(alice), { rating: 5 }, alice).expect(201);
    await post(await stay(bob), { rating: 4 }, bob).expect(201);
    hotelId = await createHotel({ name: 'Delta Inn' });
    const hiddenId = (await post(await stay(alice), { rating: 1 }, alice).expect(201)).body.reviewId;
    await service.setReviewHidden(hiddenId, true);
    const unrated = await createHotel({ name: 'Empty Hotel' });

    const stats = await service.getRatingStats([other, hotelId, unrated, 'not-an-id', other.toUpperCase()]);
    assert.deepEqual(stats.get(other), { averageRating: 4.5, ratingCount: 2 });
    assert.equal(stats.has(hotelId), false);
    assert.equal(stats.has(unrated), false);
    assert.equal(stats.size, 1);
    assert.equal((await service.getRatingStats([])).size, 0);
  });

  it('lists every review endpoint in Swagger with its requirement', async () => {
    const document = (await http().get('/api/docs-json').expect(200)).body;
    const operations: [string, string, RegExp][] = [
      ['/api/hotel-bookings/{id}/review', 'post', /^HTL-23/],
      ['/api/reviews/{id}', 'patch', /^HTL-23/],
      ['/api/reviews/{id}', 'delete', /^HTL-23/],
      ['/api/hotels/{id}/reviews', 'get', /^HTL-24/],
    ];
    for (const [path, method, summary] of operations) assert.match(document.paths[path][method].summary, summary, `${method} ${path}`);
    assert.ok(document.components.schemas.HotelReviewsPageDto.properties.averageRating);
  });
});
