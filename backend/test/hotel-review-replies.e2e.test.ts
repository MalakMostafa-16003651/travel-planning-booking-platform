import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { BookingStatus } from '../src/common/enums/booking-status.enum';
import { UserRole } from '../src/common/enums/user-role.enum';
import { HotelBooking } from '../src/hotel-bookings/schemas/hotel-booking.schema';
import { Hotel } from '../src/hotels/schemas/hotel.schema';
import { ReviewsModule } from '../src/reviews/reviews.module';
import { ReviewsService } from '../src/reviews/reviews.service';
import { Review } from '../src/reviews/schemas/review.schema';
import { AdminFixture, Session } from './admin-fixture';

describe('HTL-26 (bonus) hotel replies to reviews', { concurrency: false }, () => {
  const fixture = new AdminFixture([ReviewsModule]);
  let guest: Session;
  let moderator: Session; // assigned to hotelId
  let colleague: Session; // also assigned to hotelId
  let otherModerator: Session; // assigned to otherHotelId
  let hotels: Model<Hotel>;
  let bookings: Model<HotelBooking>;
  let reviews: Model<Review>;
  let service: ReviewsService;
  let hotelId: string;
  let otherHotelId: string;
  let reviewId: string;

  const send = (method: 'post' | 'patch' | 'delete', id: string, body?: unknown, session?: Session) => {
    const call = fixture.http()[method](`/api/reviews/${id}/reply`);
    const withCookie = session ? call.set('Cookie', session.cookie) : call;
    return body === undefined ? withCookie : withCookie.send(body as object);
  };
  const reply = (id: string, body: unknown, session?: Session) => send('post', id, body, session);
  const stored = async (id: string) => (await reviews.findById(id).lean().exec())!;

  async function createHotel(name: string): Promise<string> {
    const [hotel] = await hotels.create([{ name, city: 'Cairo', countryCode: 'EG', address: '1 Corniche St' }]);
    return hotel._id.toString();
  }

  /** A completed stay of `session` at `forHotel`, then its review through the real endpoint. */
  async function review(session: Session, forHotel: string, rating = 4): Promise<string> {
    const [booking] = await bookings.create([{
      userId: new Types.ObjectId(session.userId),
      hotelId: new Types.ObjectId(forHotel),
      hotelName: 'Stay',
      rooms: [{ roomId: new Types.ObjectId(), roomName: 'Room 1', pricePerNight: 10000, adults: 1, childrenAges: [], subtotal: 10000 }],
      checkIn: '2026-10-01',
      checkOut: '2026-10-02',
      nights: 1,
      totalPrice: 10000,
      currency: 'USD',
      status: BookingStatus.COMPLETED,
      bookingReference: `HTL-${new Types.ObjectId().toString().slice(-8).toUpperCase()}`,
      policySnapshot: { cancellationTiers: [], checkInTime: '14:00', checkOutTime: '11:00' },
    } as Partial<HotelBooking>]);
    const response = await fixture.http().post(`/api/hotel-bookings/${booking._id.toString()}/review`)
      .set('Cookie', session.cookie).send({ rating, comment: 'Lovely stay.' }).expect(201);
    return response.body.reviewId;
  }

  async function assign(session: Session, forHotel: string): Promise<void> {
    await fixture.connection.collection('moderatorassignments').insertOne({
      moderatorId: new Types.ObjectId(session.userId), hotelId: new Types.ObjectId(forHotel), createdAt: new Date(), updatedAt: new Date(),
    });
  }

  before(async () => {
    await fixture.start('hotel-review-replies');
    hotels = fixture.app.get(getModelToken(Hotel.name));
    bookings = fixture.app.get(getModelToken(HotelBooking.name));
    reviews = fixture.app.get(getModelToken(Review.name));
    service = fixture.app.get(ReviewsService);
  }, { timeout: 30 * 60_000 });
  after(() => fixture.stop());

  beforeEach(async () => {
    await fixture.reset();
    guest = await fixture.login('guest@example.com', UserRole.USER, 'Alice');
    moderator = await fixture.login('mod@example.com', UserRole.HOTEL_MODERATOR, 'Nile Mod');
    colleague = await fixture.login('mod2@example.com', UserRole.HOTEL_MODERATOR, 'Nile Mod 2');
    otherModerator = await fixture.login('delta@example.com', UserRole.HOTEL_MODERATOR, 'Delta Mod');
    hotelId = await createHotel('Nile View Hotel');
    otherHotelId = await createHotel('Delta Inn');
    await assign(moderator, hotelId);
    await assign(colleague, hotelId);
    await assign(otherModerator, otherHotelId);
    reviewId = await review(guest, hotelId);
  });

  it("HTL-26: the hotel's assigned moderator replies once, and the reply appears in the public reviews", async () => {
    const response = await reply(reviewId, { text: '  Thank you for staying with us!  ' }, moderator).expect(201);
    assert.equal(response.body.reviewId, reviewId);
    assert.equal(response.body.reply.text, 'Thank you for staying with us!');
    assert.ok(response.body.reply.repliedAt);
    assert.equal(response.body.reply.editedAt, undefined);
    assert.equal(JSON.stringify(response.body.reply).includes(moderator.userId), false, 'the moderator is not exposed');

    const saved = await stored(reviewId);
    assert.equal(saved.reply!.moderatorId.toString(), moderator.userId);
    assert.equal(saved.reply!.text, 'Thank you for staying with us!');
    assert.equal(saved.rating, 4, 'the review itself is unchanged');

    // Guests see it in GET /api/hotels/:id/reviews; reviews without a reply show null.
    await review(guest, hotelId, 5);
    const page = await fixture.http().get(`/api/hotels/${hotelId}/reviews`).expect(200);
    const byId = new Map(page.body.items.map((item: { reviewId: string }) => [item.reviewId, item]));
    assert.equal((byId.get(reviewId) as { reply: { text: string } }).reply.text, 'Thank you for staying with us!');
    assert.equal(page.body.items.filter((item: { reply: unknown }) => item.reply === null).length, 1);
    assert.equal(JSON.stringify(page.body).includes(moderator.userId), false);
  });

  it('HTL-26: one reply per review; a second reply is 409 and concurrent replies store exactly one', async () => {
    await reply(reviewId, { text: 'First.' }, moderator).expect(201);
    assert.equal((await reply(reviewId, { text: 'Second.' }, colleague).expect(409)).body.message, 'This review already has a reply');
    assert.equal((await stored(reviewId)).reply!.text, 'First.');

    const fresh = await review(guest, hotelId);
    const results = await Promise.all(Array.from({ length: 6 }, (_, index) => reply(fresh, { text: `Reply ${index}` }, index % 2 ? colleague : moderator)));
    assert.deepEqual(results.map((result) => result.status).sort(), [201, 409, 409, 409, 409, 409]);
    const winner = results.find((result) => result.status === 201)!.body.reply.text;
    assert.equal((await stored(fresh)).reply!.text, winner);
  });

  it('GEN-10: a hidden review cannot be replied to (409)', async () => {
    await service.setReviewHidden(reviewId, true);
    assert.equal((await reply(reviewId, { text: 'Hello.' }, moderator).expect(409)).body.message, 'A hidden review cannot be replied to');
    assert.equal((await stored(reviewId)).reply, null);
  });

  it('GEN-13: rejects invalid reply input with 400 and stores nothing', async () => {
    for (const body of [{}, { text: '' }, { text: '   ' }, { text: 'x'.repeat(1001) }, { text: 42 }, { text: 'Hi.', moderatorId: moderator.userId }, { text: 'Hi.', repliedAt: '2026-01-01' }]) {
      const response = await reply(reviewId, body, moderator).expect(400);
      assert.equal(response.body.message, 'Validation failed', JSON.stringify(body).slice(0, 60));
    }
    await reply('not-an-id', { text: 'Hi.' }, moderator).expect(400);
    assert.equal((await stored(reviewId)).reply, null);
    // Exactly 1000 characters is accepted.
    await reply(reviewId, { text: 'x'.repeat(1000) }, moderator).expect(201);
  });

  it('ACC-10/ACC-11: guests must log in; other roles and moderators of another hotel get 403; unknown review 404', async () => {
    await reply(reviewId, { text: 'Hi.' }).expect(401);
    await send('patch', reviewId, { text: 'Hi.' }).expect(401);
    await send('delete', reviewId).expect(401);
    const admin = await fixture.login('admin@example.com', UserRole.ADMIN);
    const airline = await fixture.login('air@example.com', UserRole.AIRLINE_MODERATOR);
    for (const session of [guest, admin, airline]) await reply(reviewId, { text: 'Hi.' }, session).expect(403);

    const wrongHotel = await reply(reviewId, { text: 'Hi.' }, otherModerator).expect(403);
    assert.equal(wrongHotel.body.message, 'You can only reply to reviews of your own hotel');
    const unassigned = await fixture.login('lonely@example.com', UserRole.HOTEL_MODERATOR);
    await reply(reviewId, { text: 'Hi.' }, unassigned).expect(403);

    assert.equal((await reply(new Types.ObjectId().toString(), { text: 'Hi.' }, moderator).expect(404)).body.message, 'Review not found');
    assert.equal((await stored(reviewId)).reply, null);
  });

  it('HTL-26 (optional): only the moderator who wrote the reply edits or deletes it; then the hotel may reply again', async () => {
    await send('patch', reviewId, { text: 'Nothing yet.' }, moderator).expect(404);
    await send('delete', reviewId, undefined, moderator).expect(404);
    const original = (await reply(reviewId, { text: 'Thanks!' }, moderator).expect(201)).body.reply;

    const edited = await send('patch', reviewId, { text: 'Thanks a lot!' }, moderator).expect(200);
    assert.equal(edited.body.reply.text, 'Thanks a lot!');
    assert.equal(edited.body.reply.repliedAt, original.repliedAt);
    assert.ok(edited.body.reply.editedAt);
    await send('patch', reviewId, { text: '' }, moderator).expect(400);

    // A colleague at the same hotel, or a moderator of another hotel, cannot change it.
    assert.equal((await send('patch', reviewId, { text: 'Mine now.' }, colleague).expect(403)).body.message, 'You can only change your own reply');
    await send('delete', reviewId, undefined, colleague).expect(403);
    await send('patch', reviewId, { text: 'Mine now.' }, otherModerator).expect(403);
    await send('patch', new Types.ObjectId().toString(), { text: 'x' }, moderator).expect(404);
    assert.equal((await stored(reviewId)).reply!.text, 'Thanks a lot!');

    await send('delete', reviewId, undefined, moderator).expect(204);
    assert.equal((await stored(reviewId)).reply, null);
    await reply(reviewId, { text: 'New reply from a colleague.' }, colleague).expect(201);
  });

  it('lists the reply endpoints in Swagger with HTL-26', async () => {
    const document = (await fixture.http().get('/api/docs-json').expect(200)).body;
    const path = document.paths['/api/reviews/{id}/reply'];
    for (const method of ['post', 'patch', 'delete']) assert.match(path[method].summary, /^HTL-26/, method);
    assert.deepEqual(Object.keys(path.post.responses).sort(), ['201', '400', '401', '403', '404', '409']);
    assert.ok(document.components.schemas.ReviewDto.properties.reply);
  });
});
