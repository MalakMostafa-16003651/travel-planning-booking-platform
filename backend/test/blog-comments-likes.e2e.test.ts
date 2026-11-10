import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { Types } from 'mongoose';
import { BlogService } from '../src/blog/blog.service';
import { CommentsService } from '../src/blog/comments.service';
import { UserRole } from '../src/common/enums/user-role.enum';
import { BlogFixture, Session } from './blog-fixture';

describe('BLG-05/06/07 comments and likes', { concurrency: false }, () => {
  const fixture = new BlogFixture();
  let author: Session;
  let reader: Session;
  let admin: Session;
  let postId: string;

  const post = () => fixture.connection.collection('blogposts').findOne({ _id: new Types.ObjectId(postId) });
  const comment = (content: string, session = reader, id = postId) =>
    fixture.http().post(`/api/posts/${id}/comments`).set('Cookie', session.cookie).send({ content });

  before(() => fixture.start('blog-comments-likes'), { timeout: 30 * 60_000 });
  after(() => fixture.stop());

  beforeEach(async () => {
    await fixture.reset();
    author = await fixture.login('author@example.com', UserRole.USER, 'Author');
    reader = await fixture.login('reader@example.com', UserRole.USER, 'Reader');
    admin = await fixture.login('admin@example.com', UserRole.ADMIN, 'Admin');
    postId = await fixture.post(author);
  });

  it('BLG-05: comments on a published post and counts it', async () => {
    const created = await comment('  Great tips!  ').expect(201);
    assert.equal(created.body.content, 'Great tips!');
    assert.equal(created.body.postId, postId);
    assert.deepEqual(created.body.author, { userId: reader.userId, name: 'Reader' });
    assert.ok(created.body.commentId && created.body.createdAt);
    assert.equal((await post())!.commentsCount, 1);
  });

  it('BLG-05/GEN-13: validates comments and needs a login on a public post', async () => {
    for (const content of ['', '   ', 'x'.repeat(501)]) await comment(content).expect(400);
    await fixture.http().post(`/api/posts/${postId}/comments`).set('Cookie', reader.cookie).send({}).expect(400);
    await fixture.http().post(`/api/posts/${postId}/comments`).set('Cookie', reader.cookie).send({ content: 'ok', userId: author.userId }).expect(400);
    await comment('x'.repeat(500)).expect(201);
    await fixture.http().post(`/api/posts/${postId}/comments`).send({ content: 'Guest' }).expect(401);
    await comment('Admin comment', admin).expect(403);
    const draft = await fixture.post(author, { status: 'DRAFT' });
    await comment('On a draft', reader, draft).expect(404);
    await comment('On my own draft', author, draft).expect(404);
    await comment('Unknown', reader, new Types.ObjectId().toString()).expect(404);
    await comment('Bad id', reader, 'nope').expect(400);
    assert.equal((await post())!.commentsCount, 1);
  });

  it('BLG-05/GEN-05: lists comments oldest first, 10 per page, and the post page shows the first page', async () => {
    for (let index = 0; index < 12; index += 1) await comment(`Comment ${index}`).expect(201);
    const first = await fixture.http().get(`/api/posts/${postId}/comments`).expect(200);
    assert.equal(first.body.items.length, 10);
    assert.equal(first.body.total, 12);
    assert.equal(first.body.items[0].content, 'Comment 0');
    assert.equal(first.body.items[9].content, 'Comment 9');
    const second = await fixture.http().get(`/api/posts/${postId}/comments?page=2`).expect(200);
    assert.deepEqual(second.body.items.map((item: { content: string }) => item.content), ['Comment 10', 'Comment 11']);

    const page = await fixture.http().get(`/api/posts/${postId}`).expect(200);
    assert.equal(page.body.commentsCount, 12);
    assert.equal(page.body.comments.items.length, 10);
    assert.equal(page.body.comments.items[0].content, 'Comment 0');
    assert.equal(page.body.comments.totalPages, 2);
    assert.equal(page.body.likedByMe, false);
  });

  it('GEN-10/ACC-12: shows hidden comments only to their author and admins, and deactivated authors as "Deleted user"', async () => {
    const hidden = (await comment('Rude words').expect(201)).body.commentId as string;
    await comment('Nice', author).expect(201);
    await fixture.app.get(CommentsService).setCommentHidden(hidden, true);
    const contents = async (session?: Session) => {
      const request = fixture.http().get(`/api/posts/${postId}/comments`);
      const response = await (session ? request.set('Cookie', session.cookie) : request).expect(200);
      return response.body.items.map((item: { content: string }) => item.content);
    };
    assert.deepEqual(await contents(), ['Nice']);
    assert.deepEqual(await contents(author), ['Nice']);
    assert.deepEqual(await contents(reader), ['Rude words', 'Nice']);
    assert.deepEqual(await contents(admin), ['Rude words', 'Nice']);

    await fixture.deactivate(reader.userId);
    const items = (await fixture.http().get(`/api/posts/${postId}/comments`).set('Cookie', admin.cookie).expect(200)).body.items;
    assert.deepEqual(items[0].author, { userId: null, name: 'Deleted user' });
    assert.equal(JSON.stringify(items).includes(reader.userId), false);
  });

  it('BLG-07: edits and deletes only my own comments', async () => {
    const commentId = (await comment('First version').expect(201)).body.commentId as string;
    const url = `/api/comments/${commentId}`;
    const edited = await fixture.http().patch(url).set('Cookie', reader.cookie).send({ content: ' Second version ' }).expect(200);
    assert.equal(edited.body.content, 'Second version');
    await fixture.http().patch(url).set('Cookie', reader.cookie).send({ content: '' }).expect(400);
    await fixture.http().patch(url).set('Cookie', reader.cookie).send({ content: 'x'.repeat(501) }).expect(400);
    await fixture.http().patch(url).set('Cookie', author.cookie).send({ content: 'Not mine' }).expect(403);
    await fixture.http().patch(url).send({ content: 'Guest' }).expect(401);
    await fixture.http().delete(url).set('Cookie', author.cookie).expect(403);
    await fixture.http().delete(url).set('Cookie', reader.cookie).expect(204);
    await fixture.http().delete(url).set('Cookie', reader.cookie).expect(404);
    await fixture.http().patch('/api/comments/nope').set('Cookie', reader.cookie).send({ content: 'x' }).expect(400);
    assert.equal((await post())!.commentsCount, 0);
  });

  it('BLG-06: likes a post once, even in parallel, and removes the like', async () => {
    const like = (session: Session) => fixture.http().post(`/api/posts/${postId}/like`).set('Cookie', session.cookie);
    assert.deepEqual((await like(reader).expect(201)).body, { liked: true, likesCount: 1 });
    await like(reader).expect(409);
    const parallel = await Promise.all([like(author), like(author), like(author)]);
    assert.deepEqual(parallel.map((response) => response.status).sort(), [201, 409, 409]);
    assert.equal((await post())!.likesCount, 2);
    assert.equal((await fixture.http().get(`/api/posts/${postId}`).set('Cookie', reader.cookie).expect(200)).body.likedByMe, true);

    assert.deepEqual((await fixture.http().delete(`/api/posts/${postId}/like`).set('Cookie', reader.cookie).expect(200)).body, { liked: false, likesCount: 1 });
    await fixture.http().delete(`/api/posts/${postId}/like`).set('Cookie', reader.cookie).expect(404);
    await fixture.http().post(`/api/posts/${postId}/like`).expect(401);
    await like(admin).expect(403);
    const draft = await fixture.post(author, { status: 'DRAFT' });
    await fixture.http().post(`/api/posts/${draft}/like`).set('Cookie', reader.cookie).expect(404);
    await fixture.http().post('/api/posts/nope/like').set('Cookie', reader.cookie).expect(400);
  });

  it('BLG-09: real likes and comments drive the search order', async () => {
    const other = await fixture.post(author, { title: 'Luxor balloons' });
    await comment('One');
    await fixture.http().post(`/api/posts/${other}/like`).set('Cookie', reader.cookie).expect(201);
    await fixture.http().post(`/api/posts/${other}/like`).set('Cookie', author.cookie).expect(201);
    const results = await fixture.http().get('/api/posts?q=luxor').expect(200);
    assert.deepEqual(results.body.items.map((item: { postId: string }) => item.postId), [other, postId]);
  });

  it('BLG-04: deleting a post deletes its comments and likes', async () => {
    await comment('Bye').expect(201);
    await fixture.http().post(`/api/posts/${postId}/like`).set('Cookie', reader.cookie).expect(201);
    await fixture.http().delete(`/api/posts/${postId}`).set('Cookie', author.cookie).expect(204);
    assert.equal(await fixture.connection.collection('comments').countDocuments(), 0);
    assert.equal(await fixture.connection.collection('likes').countDocuments(), 0);

    const second = await fixture.post(author);
    await comment('Again', reader, second).expect(201);
    await fixture.app.get(BlogService).adminDeletePost(second);
    assert.equal(await fixture.connection.collection('comments').countDocuments(), 0);
  });

  it('GEN-10: gives moderation the comment hide, delete and exists operations', async () => {
    const comments = fixture.app.get(CommentsService);
    const commentId = (await comment('Reported').expect(201)).body.commentId as string;
    assert.equal(await comments.commentExists(commentId), true);
    assert.equal(await comments.commentExists('nope'), false);
    assert.equal((await comments.setCommentHidden(commentId, true)).isHidden, true);
    await comments.adminDeleteComment(commentId);
    assert.equal(await comments.commentExists(commentId), false);
    assert.equal((await post())!.commentsCount, 0);
    await assert.rejects(comments.adminDeleteComment(commentId), { status: 404 });
  });

  it('lists every endpoint in Swagger with its requirement ID', async () => {
    const document = (await fixture.http().get('/api/docs-json').expect(200)).body;
    const operations: [string, string, RegExp][] = [
      ['/api/posts/{id}/comments', 'post', /^BLG-05/],
      ['/api/posts/{id}/comments', 'get', /^BLG-05/],
      ['/api/comments/{id}', 'patch', /^BLG-07/],
      ['/api/comments/{id}', 'delete', /^BLG-07/],
      ['/api/posts/{id}/like', 'post', /^BLG-06/],
      ['/api/posts/{id}/like', 'delete', /^BLG-06/],
    ];
    for (const [path, method, summary] of operations) assert.match(document.paths[path][method].summary, summary, `${method} ${path}`);
  });
});
