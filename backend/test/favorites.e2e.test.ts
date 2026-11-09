import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it, mock } from 'node:test';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AccountStatus } from '../src/common/enums/account-status.enum';
import { UserRole } from '../src/common/enums/user-role.enum';
import { FavoritesModule } from '../src/favorites/favorites.module';
import { Favorite } from '../src/favorites/schemas/favorite.schema';
import { HotelsService } from '../src/hotels/hotels.service';
import { Hotel } from '../src/hotels/schemas/hotel.schema';
import { ItinerariesService } from '../src/itineraries/itineraries.service';
import { ReferenceDataService } from '../src/reference-data/reference-data.service';
import { AdminFixture, Session } from './admin-fixture';

describe('BON-02 standalone owner-only favorites', { concurrency: false }, () => {
  const fixture = new AdminFixture([FavoritesModule]);
  let alice: Session, bob: Session, hotelId: string, itineraryId: string;
  let favorites: Model<Favorite>, hotels: Model<Hotel>;
  const save = (input: object, actor = alice) => fixture.http().post('/api/favorites').set('Cookie', actor.cookie).send(input);
  const list = (actor = alice, query = '') => fixture.http().get('/api/favorites' + query).set('Cookie', actor.cookie);
  const remove = (id: string, actor = alice) => fixture.http().delete('/api/favorites/' + id).set('Cookie', actor.cookie);
  const itineraryCollection = () => fixture.connection.collection('itineraries');

  before(async () => {
    await fixture.start('bon02-favorites');
    favorites = fixture.app.get(getModelToken(Favorite.name));
    hotels = fixture.app.get(getModelToken(Hotel.name));
  }, { timeout: 120_000 });
  after(() => fixture.stop());
  beforeEach(async () => {
    await fixture.reset();
    await fixture.app.get(ReferenceDataService).seedSupported();
    await fixture.connection.collection('currencies').insertOne({ code: 'USD', name: 'US dollar' });
    alice = await fixture.login('favorite-alice@example.com');
    bob = await fixture.login('favorite-bob@example.com');
    const hotel = await hotels.create({ name: 'Nile View', city: 'Cairo', countryCode: 'EG', address: '1 Synthetic St' });
    hotelId = hotel._id.toString();
    const itinerary = await fixture.http().post('/api/itineraries').set('Cookie', bob.cookie).send({
      title: 'Public London plan', countries: ['GB'], startDate: '2035-12-10', visibility: 'PUBLIC', currency: 'USD',
    }).expect(201);
    itineraryId = itinerary.body.itineraryId;
  });

  it('saves both target types through real owner services without storing target snapshots', async () => {
    const hotelBefore = await hotels.findById(hotelId).lean().exec();
    const itineraryBefore = await itineraryCollection().findOne({ _id: new Types.ObjectId(itineraryId) });
    const hotel = await save({ hotelId }).expect(201);
    const itinerary = await save({ itineraryId }).expect(201);
    assert.equal(hotel.headers['cache-control'], 'no-store');
    assert.equal(hotel.body.userId, alice.userId);
    assert.equal(hotel.body.available, true);
    assert.deepEqual(hotel.body.hotel, { hotelId, name: 'Nile View', city: 'Cairo', countryCode: 'EG' });
    assert.equal(hotel.body.itineraryId, undefined);
    assert.equal(itinerary.body.itinerary.title, 'Public London plan');
    assert.equal(itinerary.body.itinerary.days, undefined);
    assert.equal(itinerary.body.hotelId, undefined);
    const saved = await favorites.findById(hotel.body.favoriteId).lean().exec();
    assert.deepEqual(Object.keys(saved!).sort(), ['_id', 'createdAt', 'hotelId', 'updatedAt', 'userId']);
    assert.deepEqual(await hotels.findById(hotelId).lean().exec(), hotelBefore);
    assert.deepEqual(await itineraryCollection().findOne({ _id: new Types.ObjectId(itineraryId) }), itineraryBefore);
  });

  it('rejects absent, multiple, null, malformed and spoofed target/ownership inputs atomically', async () => {
    const invalid = [{}, { hotelId, itineraryId }, { hotelId: null }, { itineraryId: null },
      { hotelId: null, itineraryId }, { hotelId: '' }, { itineraryId: 42 }, { hotelId: [hotelId] },
      { hotelId: { $ne: null } }, { hotelId, userId: bob.userId }, { itineraryId, role: 'ADMIN' }, { ownerId: bob.userId }];
    for (const body of invalid) {
      const response = await save(body).expect(400);
      assert.equal(response.body.message, 'Validation failed');
      assert.ok(Object.values(response.body.errors).flat().length > 0);
    }
    assert.equal(await favorites.countDocuments(), 0);
  });

  it('rejects nonexistent and inactive hotels and private itineraries, including the author own private plan', async () => {
    await save({ hotelId: new Types.ObjectId().toString() }).expect(404);
    await save({ itineraryId: new Types.ObjectId().toString() }).expect(404);
    await hotels.updateOne({ _id: hotelId }, { $set: { isActive: false } });
    await save({ hotelId }).expect(404);
    await itineraryCollection().updateOne({ _id: new Types.ObjectId(itineraryId) }, { $set: { visibility: 'PRIVATE' } });
    await save({ itineraryId }).expect(404);
    await save({ itineraryId }, bob).expect(404);
    assert.equal(await favorites.countDocuments(), 0);
  });

  it('follows the existing author-status rules: suspended authors remain visible, deactivated/missing authors do not', async () => {
    await fixture.users.updateOne({ _id: bob.userId }, { $set: { status: AccountStatus.SUSPENDED } });
    const visible = await save({ itineraryId }).expect(201);
    await remove(visible.body.favoriteId).expect(204);
    await fixture.users.updateOne({ _id: bob.userId }, { $set: { status: AccountStatus.DEACTIVATED } });
    await save({ itineraryId }).expect(404);
    await fixture.users.deleteOne({ _id: bob.userId });
    await save({ itineraryId }).expect(404);
  });

  it('rejects repeated and differently-cased IDs without changing the original favorite', async () => {
    const saved = await save({ hotelId }).expect(201);
    const before = await favorites.findById(saved.body.favoriteId).lean().exec();
    await save({ hotelId: hotelId.toUpperCase() }).expect(409);
    assert.deepEqual(await favorites.findById(saved.body.favoriteId).lean().exec(), before);
    assert.equal(await favorites.countDocuments(), 1);
  });

  it('enforces both owner/target unique indexes under concurrent saves', async () => {
    for (const body of [{ hotelId }, { itineraryId }]) {
      const responses = await Promise.all(Array.from({ length: 5 }, () => save(body)));
      assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409, 409, 409, 409]);
    }
    assert.equal(await favorites.countDocuments(), 2);
    const indexes = await favorites.collection.indexes();
    assert.ok(indexes.some((index) => index.name === 'favorites_unique_user_hotel' && index.unique));
    assert.ok(indexes.some((index) => index.name === 'favorites_unique_user_itinerary' && index.unique));
  });

  it('lets different users save the same targets while keeping their lists separate', async () => {
    const a = await save({ hotelId }).expect(201);
    const b = await save({ hotelId }, bob).expect(201);
    await save({ itineraryId }, bob).expect(201);
    const own = await list().expect(200);
    assert.equal(own.headers['cache-control'], 'no-store');
    assert.equal(own.body.total, 1);
    assert.equal(own.body.items[0].favoriteId, a.body.favoriteId);
    const other = await list(bob).expect(200);
    assert.equal(other.body.total, 2);
    assert.ok(other.body.items.some((item: { favoriteId: string }) => item.favoriteId === b.body.favoriteId));
    assert.ok(other.body.items.every((item: { userId: string }) => item.userId === bob.userId));
  });

  it('paginates ten references at a time, newest first with a deterministic ID tie-break and correct totals', async () => {
    const records: Favorite[] = [];
    for (let n = 0; n < 12; n++) {
      const hotel = await hotels.create({ name: 'Hotel ' + n, city: 'Cairo', countryCode: 'EG', address: 'Synthetic' });
      records.push(await favorites.create({ userId: new Types.ObjectId(alice.userId), hotelId: hotel._id }));
    }
    await favorites.updateMany({}, { $set: { createdAt: new Date('2026-01-01T00:00:00Z') } });
    const expected = records.map((row) => row._id.toString()).sort().reverse();
    const first = await list().expect(200), second = await list(alice, '?page=2').expect(200), empty = await list(alice, '?page=3').expect(200);
    assert.equal(first.body.items.length, 10); assert.equal(second.body.items.length, 2);
    assert.equal(first.body.pageSize, 10); assert.equal(first.body.total, 12); assert.equal(first.body.totalPages, 2);
    assert.deepEqual([...first.body.items, ...second.body.items].map((item: { favoriteId: string }) => item.favoriteId), expected);
    assert.deepEqual(empty.body.items, []); assert.equal(empty.body.total, 12);
    const bobPage = await list(bob).expect(200); assert.equal(bobPage.body.total, 0); assert.equal(bobPage.body.totalPages, 0);
  });

  it('retains unavailable references without exposing private or inactive content or corrupting pagination', async () => {
    const hotel = await save({ hotelId }).expect(201), itinerary = await save({ itineraryId }).expect(201);
    await hotels.updateOne({ _id: hotelId }, { $set: { isActive: false, name: 'HIDDEN hotel name' } });
    await itineraryCollection().updateOne({ _id: new Types.ObjectId(itineraryId) }, { $set: { visibility: 'PRIVATE', title: 'HIDDEN private title' } });
    const page = await list().expect(200);
    assert.equal(page.body.total, 2); assert.equal(page.body.items.length, 2);
    assert.ok(page.body.items.every((item: { available: boolean }) => item.available === false));
    assert.doesNotMatch(JSON.stringify(page.body), /HIDDEN|Nile View|Public London plan/);
    assert.ok(page.body.items.every((item: { hotel?: unknown; itinerary?: unknown }) => item.hotel === undefined && item.itinerary === undefined));
    await remove(hotel.body.favoriteId).expect(204); await remove(itinerary.body.favoriteId).expect(204);
    assert.equal(await favorites.countDocuments(), 0);
  });

  it('hides saved itinerary content after author deactivation and target deletion', async () => {
    const item = await save({ itineraryId }).expect(201);
    await fixture.users.updateOne({ _id: bob.userId }, { $set: { status: AccountStatus.DEACTIVATED } });
    assert.equal((await list().expect(200)).body.items[0].available, false);
    await itineraryCollection().deleteOne({ _id: new Types.ObjectId(itineraryId) });
    assert.equal((await list().expect(200)).body.items[0].itinerary, undefined);
    await remove(item.body.favoriteId).expect(204);
  });

  it('uses current target names and public summaries rather than stale stored content', async () => {
    await save({ hotelId }).expect(201); await save({ itineraryId }).expect(201);
    await hotels.updateOne({ _id: hotelId }, { $set: { name: 'Updated hotel' } });
    await itineraryCollection().updateOne({ _id: new Types.ObjectId(itineraryId) }, { $set: { title: 'Updated public plan' } });
    const page = await list().expect(200);
    assert.ok(page.body.items.some((item: { hotel?: { name: string } }) => item.hotel?.name === 'Updated hotel'));
    assert.ok(page.body.items.some((item: { itinerary?: { title: string } }) => item.itinerary?.title === 'Updated public plan'));
  });

  it('rechecks visibility after saving so a concurrent private transition does not return an earlier public snapshot', async (context) => {
    const reader = fixture.app.get(ItinerariesService), original = reader.getPublic.bind(reader); let calls = 0;
    const hooked = mock.method(reader, 'getPublic', async (id: string) => {
      if (++calls === 2) await itineraryCollection().updateOne({ _id: new Types.ObjectId(id) }, { $set: { visibility: 'PRIVATE' } });
      return original(id);
    });
    context.after(() => hooked.mock.restore());
    const saved = await save({ itineraryId }).expect(201);
    assert.equal(saved.body.available, false); assert.equal(saved.body.itinerary, undefined);
    assert.doesNotMatch(JSON.stringify(saved.body), /Public London plan/);
    assert.equal(await favorites.countDocuments(), 1);
  });

  it('removes only an owned reference, preserving both targets and another user favorite', async () => {
    const own = await save({ hotelId }).expect(201), other = await save({ hotelId }, bob).expect(201);
    const response = await remove(own.body.favoriteId).expect(204); assert.equal(response.text, '');
    assert.equal(await favorites.countDocuments(), 1);
    assert.ok(await favorites.findById(other.body.favoriteId)); assert.ok(await hotels.findById(hotelId));
    assert.ok(await itineraryCollection().findOne({ _id: new Types.ObjectId(itineraryId) }));
    await remove(own.body.favoriteId).expect(404);
  });

  it('does not reveal or delete another user favorite even with spoofed owner query identifiers', async () => {
    const saved = await save({ hotelId }, bob).expect(201);
    const denied = await fixture.http().delete('/api/favorites/' + saved.body.favoriteId + '?userId=' + bob.userId).set('Cookie', alice.cookie).expect(404);
    const missing = await remove(new Types.ObjectId().toString()).expect(404);
    assert.deepEqual(denied.body, missing.body);
    assert.ok(await favorites.findById(saved.body.favoriteId));
    await list(alice, '?userId=' + bob.userId).expect(400);
    const own = await fixture.http().post('/api/favorites?userId=' + bob.userId).set('Cookie', alice.cookie).send({ itineraryId }).expect(201);
    assert.equal(own.body.userId, alice.userId);
  });

  it('rejects malformed favorite IDs and invalid/unsafe pagination', async () => {
    await remove('not-an-id').expect(400);
    for (const value of ['0', '-1', '1.5', 'NaN', '', '9007199254740991', '1&page=2']) await list(alice, '?page=' + value).expect(400);
    const empty = await list().expect(200); assert.deepEqual(empty.body.items, []);
  });

  it('requires a real session and rejects every non-USER role for every favorite operation', async () => {
    const saved = await save({ hotelId }).expect(201);
    await fixture.http().get('/api/favorites').expect(401);
    await fixture.http().post('/api/favorites').send({ hotelId }).expect(401);
    await fixture.http().delete('/api/favorites/' + saved.body.favoriteId).expect(401);
    for (const role of [UserRole.ADMIN, UserRole.AIRLINE_MODERATOR, UserRole.HOTEL_MODERATOR]) {
      await fixture.users.updateOne({ _id: alice.userId }, { $set: { role } });
      await list().expect(403); await save({ itineraryId }).expect(403); await remove(saved.body.favoriteId).expect(403);
    }
    assert.equal(await favorites.countDocuments(), 1);
  });

  it('rejects suspended/deactivated accounts even when they retain formerly valid cookies', async () => {
    const saved = await save({ hotelId }).expect(201);
    for (const [actor, status] of [[alice, AccountStatus.SUSPENDED], [bob, AccountStatus.DEACTIVATED]] as const) {
      await fixture.users.updateOne({ _id: actor.userId }, { $set: { status } });
      await list(actor).expect(401); await save({ itineraryId }, actor).expect(401); await remove(saved.body.favoriteId, actor).expect(401);
    }
    assert.equal(await favorites.countDocuments(), 1);
  });

  it('rejects cross-origin browser save/delete before any favorite mutation', async () => {
    const saved = await save({ hotelId }).expect(201);
    await fixture.http().post('/api/favorites').set('Cookie', alice.cookie).set('Origin', 'https://untrusted.example').send({ itineraryId }).expect(403);
    await fixture.http().delete('/api/favorites/' + saved.body.favoriteId).set('Cookie', alice.cookie).set('Sec-Fetch-Site', 'cross-site').expect(403);
    assert.equal(await favorites.countDocuments(), 1);
  });

  it('propagates owner-reader failures as sanitized errors instead of mislabelling them as missing targets', async (context) => {
    await save({ hotelId }).expect(201);
    const reader = fixture.app.get(HotelsService);
    const hooked = mock.method(reader, 'getById', async () => { throw new Error('synthetic private database failure'); });
    context.after(() => hooked.mock.restore());
    const page = await list().expect(500), create = await save({ hotelId }).expect(500);
    assert.equal(page.body.message, 'An unexpected error occurred'); assert.deepEqual(page.body, create.body);
    assert.doesNotMatch(JSON.stringify(page.body), /synthetic|database/);
    assert.equal(await favorites.countDocuments(), 1);
  });

  it('enforces exactly one non-null target in the Mongoose schema too', async () => {
    const userId = new Types.ObjectId(alice.userId);
    await assert.rejects(() => favorites.create({ userId }));
    await assert.rejects(() => favorites.create({ userId, hotelId: new Types.ObjectId(hotelId), itineraryId: new Types.ObjectId(itineraryId) }));
    await assert.rejects(() => favorites.create({ userId, hotelId: null, itineraryId: new Types.ObjectId(itineraryId) } as unknown as Favorite));
    assert.equal(await favorites.countDocuments(), 0);
  });

  it('publishes all three owner-only endpoints, DTOs, cookie security and errors in Swagger', async () => {
    const document = (await fixture.http().get('/api/docs-json').expect(200)).body;
    for (const [path, method, status] of [['/api/favorites', 'post', '201'], ['/api/favorites', 'get', '200'], ['/api/favorites/{favoriteId}', 'delete', '204']]) {
      const route = document.paths[path][method];
      assert.match(route.summary, /BON-02/); assert.ok(route.responses[status]);
      assert.ok(route.security.some((security: object) => 'accessToken' in security));
      for (const error of ['400', '401', '403', '500']) assert.ok(route.responses[error]);
    }
    assert.match(document.paths['/api/favorites'].get.description, /available=false/);
    assert.ok(document.paths['/api/favorites'].post.responses['409']);
    assert.ok(document.paths['/api/favorites/{favoriteId}'].delete.responses['404']);
    assert.ok(document.components.schemas.CreateFavoriteDto);
    assert.ok(document.components.schemas.FavoritePageDto);
  });
});
