import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { Types } from 'mongoose';
import { BlogService } from '../src/blog/blog.service';
import { UserRole } from '../src/common/enums/user-role.enum';
import { BlogFixture, Session } from './blog-fixture';

describe('BLG-01/02/03/04/08/09/12 blog posts', { concurrency: false }, () => {
  const fixture = new BlogFixture();
  let author: Session;
  let reader: Session;
  let admin: Session;

  const posts = () => fixture.connection.collection('blogposts');
  const setCounts = (postId: string, likesCount: number, commentsCount: number) =>
    posts().updateOne({ _id: new Types.ObjectId(postId) }, { $set: { likesCount, commentsCount } });

  before(() => fixture.start('blog-posts'), { timeout: 30 * 60_000 });
  after(() => fixture.stop());

  beforeEach(async () => {
    await fixture.reset();
    author = await fixture.login('author@example.com', UserRole.USER, 'Nour Explorer');
    reader = await fixture.login('reader@example.com', UserRole.USER, 'Reader');
    admin = await fixture.login('admin@example.com', UserRole.ADMIN, 'Admin');
  });

  it('BLG-01: creates a draft by default or a published post, with normalized tags', async () => {
    const draft = await fixture.http().post('/api/posts').set('Cookie', author.cookie)
      .send({ title: '  Cairo food  ', content: 'Koshari everywhere.', tags: [' Egypt ', 'egypt', 'FOOD'] }).expect(201);
    assert.equal(draft.body.status, 'DRAFT');
    assert.equal(draft.body.title, 'Cairo food');
    assert.deepEqual(draft.body.tags, ['egypt', 'food']);
    assert.equal(draft.body.publishedAt, undefined);
    assert.deepEqual(draft.body.author, { userId: author.userId, name: 'Nour Explorer' });
    assert.equal(JSON.stringify(draft.body).includes('@example.com'), false);

    const published = await fixture.http().post('/api/posts').set('Cookie', author.cookie)
      .send({ title: 'Aswan', content: 'Felucca at sunset.', status: 'PUBLISHED' }).expect(201);
    assert.equal(published.body.status, 'PUBLISHED');
    assert.ok(published.body.publishedAt);
    assert.equal(await posts().countDocuments(), 2);
  });

  it('BLG-01/BLG-08/GEN-13: validates every field and rejects guests and other roles', async () => {
    const create = (body: Record<string, unknown>, cookie = author.cookie) => fixture.http().post('/api/posts').set('Cookie', cookie).send(body);
    const valid = { title: 'Valid title', content: 'Body' };
    await fixture.http().post('/api/posts').send(valid).expect(401);
    await create(valid, admin.cookie).expect(403);
    for (const body of [
      { content: 'Body' },
      { title: 'Valid title' },
      { title: '   ', content: 'Body' },
      { title: 'ab', content: 'Body' },
      { title: 'Valid title', content: '   ' },
      { ...valid, tags: ['a', 'b', 'c', 'd', 'e', 'f'] },
      { ...valid, tags: ['x'.repeat(31)] },
      { ...valid, tags: [''] },
      { ...valid, tags: null },
      { ...valid, status: 'ARCHIVED' },
      { ...valid, likesCount: 100 },
      { ...valid, userId: reader.userId },
    ]) {
      await create(body).expect(400);
    }
    const errors = (await create({ ...valid, tags: ['a', 'b', 'c', 'd', 'e', 'f'] })).body.errors;
    assert.ok(errors.tags);
    // Five tags of 30 characters are fine.
    await create({ ...valid, tags: ['a', 'b', 'c', 'd', 'x'.repeat(30)] }).expect(201);
    assert.equal(await posts().countDocuments(), 1);
  });

  it('BLG-02/GEN-05: lists published posts only, newest first, 10 per page, with excerpts', async () => {
    for (let index = 0; index < 12; index += 1) await fixture.post(author, { title: `Post number ${index}`, content: 'x'.repeat(300) });
    await fixture.post(author, { title: 'My draft', status: 'DRAFT' });
    const first = await fixture.http().get('/api/posts').expect(200);
    assert.equal(first.body.items.length, 10);
    assert.equal(first.body.total, 12);
    assert.equal(first.body.totalPages, 2);
    assert.equal(first.body.pageSize, 10);
    assert.equal(first.body.items[0].title, 'Post number 11');
    assert.equal(first.body.items[0].excerpt.length, 201);
    assert.equal(first.body.items[0].content, undefined);
    assert.deepEqual(first.body.items[0].author, { userId: author.userId, name: 'Nour Explorer' });
    const second = await fixture.http().get('/api/posts?page=2').expect(200);
    assert.equal(second.body.items.length, 2);
    await fixture.http().get('/api/posts?page=0').expect(400);
    await fixture.http().get('/api/posts?limit=50').expect(400);
  });

  it('BLG-02/BLG-08: filters by tag and lists a tag page', async () => {
    await fixture.post(author, { title: 'Nile cruise', tags: ['egypt', 'nile'] });
    await fixture.post(author, { title: 'Paris', tags: ['france'] });
    const tagged = await fixture.http().get('/api/posts?tag=Egypt').expect(200);
    assert.deepEqual(tagged.body.items.map((item: { title: string }) => item.title), ['Nile cruise']);
    const tagPage = await fixture.http().get('/api/tags/nile/posts').expect(200);
    assert.equal(tagPage.body.total, 1);
    await fixture.http().get('/api/tags/%20%20/posts').expect(400);
    await fixture.http().get(`/api/tags/${'x'.repeat(31)}/posts`).expect(400);
  });

  it('BLG-09: searches title, tags or author name, ordered by likes + comments, newest first on ties', async () => {
    const titleMatch = await fixture.post(author, { title: 'Desert safari', content: 'Sand.' });
    const tagMatch = await fixture.post(author, { title: 'Dunes', content: 'Sand.', tags: ['desert'] });
    const tieOlder = await fixture.post(author, { title: 'Desert camp', content: 'Stars.' });
    const tieNewer = await fixture.post(author, { title: 'Desert stars', content: 'Night.' });
    await fixture.post(author, { title: 'Beach day', content: 'Not about the desert at all.' });
    await setCounts(titleMatch, 1, 0);
    await setCounts(tagMatch, 3, 4);
    await setCounts(tieOlder, 2, 0);
    await setCounts(tieNewer, 1, 1);

    const results = await fixture.http().get('/api/posts?q=DESERT').expect(200);
    // The body text is not searched, so "Beach day" is not a result.
    assert.deepEqual(results.body.items.map((item: { postId: string }) => item.postId), [tagMatch, tieNewer, tieOlder, titleMatch]);
    assert.ok(results.body.items.every((item: { excerpt: string; author: unknown; publishedAt: string }) => item.excerpt && item.author && item.publishedAt));

    const byAuthor = await fixture.http().get('/api/posts?q=nour').expect(200);
    assert.equal(byAuthor.body.total, 5);
    const none = await fixture.http().get('/api/posts?q=antarctica').expect(200);
    assert.deepEqual(none.body, { items: [], page: 1, pageSize: 10, total: 0, totalPages: 0 });
    // Regex characters are matched literally.
    await fixture.http().get('/api/posts?q=.*').expect(200).then((response) => assert.equal(response.body.total, 0));
    await fixture.http().get(`/api/posts?q=${'x'.repeat(101)}`).expect(400);
  });

  it('BLG-03: lists my posts, drafts included, with counts', async () => {
    const draft = await fixture.post(author, { title: 'Draft one', status: 'DRAFT' });
    const published = await fixture.post(author);
    await fixture.post(reader, { title: 'Not mine' });
    await setCounts(published, 2, 3);
    await fixture.http().get('/api/posts/mine').expect(401);
    const mine = await fixture.http().get('/api/posts/mine').set('Cookie', author.cookie).expect(200);
    assert.deepEqual(mine.body.items.map((item: { postId: string }) => item.postId), [published, draft]);
    const [first, second] = mine.body.items;
    assert.equal(first.likesCount, 2);
    assert.equal(first.commentsCount, 3);
    assert.equal(second.status, 'DRAFT');
    assert.ok(first.createdAt && first.title && first.status);
  });

  it('BLG-02/GEN-10/ACC-12: shows a post only to those allowed to read it', async () => {
    const published = await fixture.post(author);
    const draft = await fixture.post(author, { status: 'DRAFT' });
    const read = (postId: string, session?: Session) => {
      const request = fixture.http().get(`/api/posts/${postId}`);
      return session ? request.set('Cookie', session.cookie) : request;
    };
    const page = await read(published).expect(200);
    for (const field of ['title', 'content', 'tags', 'likesCount', 'commentsCount', 'publishedAt', 'author']) assert.ok(field in page.body, field);
    await read(draft).expect(404);
    await read(draft, reader).expect(404);
    await read(draft, admin).expect(404);
    await read(draft, author).expect(200);
    await read(new Types.ObjectId().toString()).expect(404);
    await read('not-an-id').expect(400);
    // An expired or invalid cookie is a guest, not an error.
    await fixture.http().get(`/api/posts/${published}`).set('Cookie', '__Host-accessToken=invalid').expect(200);

    const blog = fixture.app.get(BlogService);
    await blog.setPostHidden(published, true);
    await read(published).expect(404);
    await read(published, reader).expect(404);
    assert.equal((await read(published, author).expect(200)).body.isHidden, true);
    await read(published, admin).expect(200);
    assert.equal((await fixture.http().get('/api/posts').expect(200)).body.total, 0);
    await blog.setPostHidden(published, false);

    // ACC-12: a deactivated author's posts disappear from public view.
    await fixture.deactivate(author.userId);
    await read(published).expect(404);
    assert.equal((await fixture.http().get('/api/posts').expect(200)).body.total, 0);
    await fixture.http().get(`/api/authors/${author.userId}`).expect(404);
  });

  it('BLG-04/BLG-08: edits my post and keeps the first publication date', async () => {
    const postId = await fixture.post(author, { status: 'DRAFT', tags: ['egypt'] });
    const url = `/api/posts/${postId}`;
    const published = await fixture.http().patch(url).set('Cookie', author.cookie).send({ status: 'PUBLISHED', tags: ['Nile', 'egypt'] }).expect(200);
    assert.deepEqual(published.body.tags, ['nile', 'egypt']);
    const firstPublishedAt = published.body.publishedAt;
    assert.ok(firstPublishedAt);
    const unpublished = await fixture.http().patch(url).set('Cookie', author.cookie).send({ status: 'DRAFT', title: 'Renamed post' }).expect(200);
    assert.equal(unpublished.body.publishedAt, firstPublishedAt);
    assert.equal(unpublished.body.title, 'Renamed post');

    await fixture.http().patch(url).set('Cookie', author.cookie).send({ title: null }).expect(400);
    await fixture.http().patch(url).set('Cookie', author.cookie).send({ tags: ['1', '2', '3', '4', '5', '6'] }).expect(400);
    await fixture.http().patch(url).send({ title: 'Guest edit' }).expect(401);
    // A draft of someone else is not revealed; a published one is 403.
    await fixture.http().patch(url).set('Cookie', reader.cookie).send({ title: 'Stolen post' }).expect(404);
    await fixture.http().patch(url).set('Cookie', author.cookie).send({ status: 'PUBLISHED' }).expect(200);
    await fixture.http().patch(url).set('Cookie', reader.cookie).send({ title: 'Stolen post' }).expect(403);
    assert.equal((await posts().findOne({ _id: new Types.ObjectId(postId) }))!.title, 'Renamed post');
  });

  it('BLG-04: deletes my post only', async () => {
    const postId = await fixture.post(author);
    await fixture.http().delete(`/api/posts/${postId}`).expect(401);
    await fixture.http().delete(`/api/posts/${postId}`).set('Cookie', reader.cookie).expect(403);
    await fixture.http().delete(`/api/posts/${postId}`).set('Cookie', author.cookie).expect(204);
    await fixture.http().delete(`/api/posts/${postId}`).set('Cookie', author.cookie).expect(404);
    assert.equal(await posts().countDocuments(), 0);
  });

  it("BLG-12: shows an author's name, join date and published posts", async () => {
    await fixture.post(author, { title: 'Published one' });
    await fixture.post(author, { title: 'Hidden draft', status: 'DRAFT' });
    const page = await fixture.http().get(`/api/authors/${author.userId}`).expect(200);
    assert.equal(page.body.userId, author.userId);
    assert.equal(page.body.name, 'Nour Explorer');
    assert.ok(page.body.joinedAt);
    assert.deepEqual(page.body.posts.items.map((item: { title: string }) => item.title), ['Published one']);
    assert.equal(JSON.stringify(page.body).includes('@example.com'), false);
    await fixture.http().get(`/api/authors/${new Types.ObjectId().toString()}`).expect(404);
    await fixture.http().get('/api/authors/nope').expect(400);
  });

  it("BLG-12: shows the author's public itineraries only, paginated, with ACC-12 clone attribution", async () => {
    const itineraries = fixture.connection.collection('itineraries');
    const base = { countries: ['EG'], startDate: new Date('2027-03-01T00:00:00Z'), currency: 'USD', transportCosts: [] };
    const day = (city: string) => ({ _id: new Types.ObjectId(), city, countryCode: 'EG', activities: [], budgets: [] });
    const original = await fixture.login('original@example.com', UserRole.USER, 'Original Planner');
    // 11 public itineraries (newest published last), one private, and one public itinerary of another user.
    for (let index = 1; index <= 11; index += 1) {
      await itineraries.insertOne({ ...base, userId: new Types.ObjectId(author.userId), title: `Trip ${index}`, visibility: 'PUBLIC',
        publishedAt: new Date(Date.UTC(2026, 10, index)), days: [day('Cairo'), day('Luxor'), day('cairo')] });
    }
    await itineraries.insertOne({ ...base, userId: new Types.ObjectId(author.userId), title: 'Secret plan', visibility: 'PRIVATE', publishedAt: null, days: [] });
    await itineraries.insertOne({ ...base, userId: new Types.ObjectId(reader.userId), title: 'Not by this author', visibility: 'PUBLIC', publishedAt: new Date(), days: [] });

    const first = await fixture.http().get(`/api/authors/${author.userId}`).expect(200);
    const list = first.body.itineraries;
    assert.equal(list.total, 11);
    assert.equal(list.totalPages, 2);
    assert.equal(list.items.length, 10);
    assert.equal(list.items[0].title, 'Trip 11');
    assert.deepEqual(list.items[0].author, { userId: author.userId, name: 'Nour Explorer' });
    assert.deepEqual(list.items[0].cities, ['Cairo', 'Luxor']);
    assert.equal(list.items[0].dayCount, 3);
    assert.equal(list.items[0].startDate, '2027-03-01');
    assert.equal(JSON.stringify(first.body).includes('Secret plan'), false);
    assert.equal(JSON.stringify(first.body).includes('Not by this author'), false);

    const second = await fixture.http().get(`/api/authors/${author.userId}?itinerariesPage=2`).expect(200);
    assert.deepEqual(second.body.itineraries.items.map((item: { title: string }) => item.title), ['Trip 1']);
    assert.equal(second.body.posts.page, 1);
    await fixture.http().get(`/api/authors/${author.userId}?itinerariesPage=0`).expect(400);

    // A public clone names its original author, or "Deleted user" once that author is deactivated.
    await itineraries.deleteMany({ userId: new Types.ObjectId(author.userId) });
    await itineraries.insertOne({ ...base, userId: new Types.ObjectId(author.userId), title: 'Cloned trip', visibility: 'PUBLIC', publishedAt: new Date(), days: [],
      clonedFrom: { itineraryId: new Types.ObjectId(), userId: new Types.ObjectId(original.userId), authorName: 'Original Planner', title: 'Source', clonedAt: new Date() } });
    const cloned = await fixture.http().get(`/api/authors/${author.userId}`).expect(200);
    assert.equal(cloned.body.itineraries.items[0].clonedFrom.authorName, 'Original Planner');
    await fixture.deactivate(original.userId);
    const hidden = await fixture.http().get(`/api/authors/${author.userId}`).expect(200);
    assert.equal(hidden.body.itineraries.items[0].clonedFrom.authorName, 'Deleted user');
    assert.equal(JSON.stringify(hidden.body).includes('Original Planner'), false);
  });

  it('BLG-13 (bonus): attaches one of my own public itineraries to a post, and shows it only while public', async () => {
    const itineraries = fixture.connection.collection('itineraries');
    const base = { countries: ['EG'], startDate: new Date('2027-03-01T00:00:00Z'), currency: 'USD', transportCosts: [], days: [] };
    const mine = new Types.ObjectId();
    const myPrivate = new Types.ObjectId();
    const theirs = new Types.ObjectId();
    await itineraries.insertMany([
      { ...base, _id: mine, userId: new Types.ObjectId(author.userId), title: 'Nile week', visibility: 'PUBLIC', publishedAt: new Date() },
      { ...base, _id: myPrivate, userId: new Types.ObjectId(author.userId), title: 'Private plan', visibility: 'PRIVATE', publishedAt: null },
      { ...base, _id: theirs, userId: new Types.ObjectId(reader.userId), title: 'Not mine', visibility: 'PUBLIC', publishedAt: new Date() },
    ]);
    const create = (itineraryId: unknown) => fixture.http().post('/api/posts').set('Cookie', author.cookie)
      .send({ title: 'With a plan', content: 'See my itinerary.', status: 'PUBLISHED', itineraryId });

    for (const bad of [myPrivate.toString(), theirs.toString(), new Types.ObjectId().toString()]) {
      const refused = await create(bad).expect(400);
      assert.deepEqual(refused.body.errors, { itineraryId: ['Attach one of your own public itineraries'] });
    }
    await create('nope').expect(400);
    await create(null).expect(400);
    assert.equal(await posts().countDocuments(), 0);

    const created = await create(mine.toString()).expect(201);
    assert.equal(created.body.itinerary.itineraryId, mine.toString());
    assert.equal(created.body.itinerary.title, 'Nile week');
    assert.deepEqual(created.body.itinerary.author, { userId: author.userId, name: 'Nour Explorer' });
    const postId = created.body.postId as string;
    const seen = await fixture.http().get(`/api/posts/${postId}`).expect(200);
    assert.equal(seen.body.itinerary.itineraryId, mine.toString());

    // Made private later: the post stops showing it.
    await itineraries.updateOne({ _id: mine }, { $set: { visibility: 'PRIVATE' } });
    assert.equal((await fixture.http().get(`/api/posts/${postId}`).expect(200)).body.itinerary, null);
    await itineraries.updateOne({ _id: mine }, { $set: { visibility: 'PUBLIC' } });

    // Edit: another user's itinerary is refused, null removes it, a valid one attaches it again.
    const url = `/api/posts/${postId}`;
    await fixture.http().patch(url).set('Cookie', author.cookie).send({ itineraryId: theirs.toString() }).expect(400);
    const removed = await fixture.http().patch(url).set('Cookie', author.cookie).send({ itineraryId: null }).expect(200);
    assert.equal(removed.body.itinerary, null);
    assert.equal((await posts().findOne({ _id: new Types.ObjectId(postId) }))!.itineraryId, undefined);
    const again = await fixture.http().patch(url).set('Cookie', author.cookie).send({ itineraryId: mine.toString() }).expect(200);
    assert.equal(again.body.itinerary.itineraryId, mine.toString());
    // A post without an itinerary shows null.
    const plain = await fixture.http().post('/api/posts').set('Cookie', author.cookie).send({ title: 'No plan', content: 'Just words.' }).expect(201);
    assert.equal(plain.body.itinerary, null);
  });

  it('GEN-10: gives moderation the hide, delete and exists operations', async () => {
    const blog = fixture.app.get(BlogService);
    const postId = await fixture.post(author);
    assert.equal(await blog.postExists(postId), true);
    assert.equal(await blog.postExists('nope'), false);
    assert.equal((await blog.setPostHidden(postId, true)).isHidden, true);
    await blog.adminDeletePost(postId);
    assert.equal(await blog.postExists(postId), false);
    await assert.rejects(blog.adminDeletePost(postId), { status: 404 });
    await assert.rejects(blog.setPostHidden('nope', true), { status: 404 });
  });

  it('lists every endpoint in Swagger with its requirement ID', async () => {
    const document = (await fixture.http().get('/api/docs-json').expect(200)).body;
    const operations: [string, string, RegExp][] = [
      ['/api/posts', 'post', /^BLG-01/],
      ['/api/posts', 'get', /^BLG-02\/BLG-09/],
      ['/api/posts/mine', 'get', /^BLG-03/],
      ['/api/posts/{id}', 'get', /^BLG-02/],
      ['/api/posts/{id}', 'patch', /^BLG-04/],
      ['/api/posts/{id}', 'delete', /^BLG-04/],
      ['/api/tags/{tag}/posts', 'get', /^BLG-08/],
      ['/api/authors/{id}', 'get', /^BLG-12/],
    ];
    for (const [path, method, summary] of operations) assert.match(document.paths[path][method].summary, summary, `${method} ${path}`);
  });
});
