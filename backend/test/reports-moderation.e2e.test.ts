import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { Types } from 'mongoose';
import { UserRole } from '../src/common/enums/user-role.enum';
import { ReportsModule } from '../src/reports/reports.module';
import { AdminFixture, Session } from './admin-fixture';

describe('GEN-09/GEN-10 reports and moderation', { concurrency: false }, () => {
  const fixture = new AdminFixture([ReportsModule]);
  let admin: Session;
  let author: Session;
  let reporter: Session;
  let secondReporter: Session;
  let postId: string;
  let commentId: string;

  const collection = (name: string) => fixture.connection.collection(name);
  const report = (session: Session, body: Record<string, unknown>) =>
    fixture.http().post('/api/reports').set('Cookie', session.cookie).send(body);
  const reportPost = (session: Session, reason = 'Offensive language here') => report(session, { targetType: 'POST', targetId: postId, reason });
  const resolve = (reportId: string, action: string, session = admin) =>
    fixture.http().patch(`/api/admin/reports/${reportId}`).set('Cookie', session.cookie).send({ action });
  const moderate = (method: 'patch' | 'delete', path: string, session = admin) =>
    fixture.http()[method](`/api/admin/content/${path}`).set('Cookie', session.cookie).send({});
  const viewPost = (session?: Session) => {
    const call = fixture.http().get(`/api/posts/${postId}`);
    return session ? call.set('Cookie', session.cookie) : call;
  };
  const auditActions = async () => (await collection('auditlogs').find().toArray()).map((entry) => entry.action).sort();

  before(() => fixture.start('reports-moderation'), { timeout: 30 * 60_000 });
  after(() => fixture.stop());

  beforeEach(async () => {
    await fixture.reset();
    admin = await fixture.login('admin@example.com', UserRole.ADMIN, 'Main Admin');
    author = await fixture.login('author@example.com', UserRole.USER, 'Author');
    reporter = await fixture.login('reporter@example.com', UserRole.USER, 'Careful Reader');
    secondReporter = await fixture.login('second@example.com', UserRole.USER, 'Second Reader');
    postId = (await fixture.http().post('/api/posts').set('Cookie', author.cookie)
      .send({ title: 'A trip to Luxor', content: 'Temples and the Nile.', status: 'PUBLISHED' }).expect(201)).body.postId;
    const comment = await fixture.http().post(`/api/posts/${postId}/comments`).set('Cookie', author.cookie).send({ content: 'Rude reply' }).expect(201);
    commentId = comment.body.commentId ?? comment.body.id;
  });

  it('GEN-09: a registered user reports a post with a reason, at most once', async () => {
    const created = await reportPost(reporter).expect(201);
    assert.equal(created.body.status, 'OPEN');
    assert.equal(created.body.targetType, 'POST');
    assert.equal(created.body.targetId, postId);
    assert.equal(created.body.userId, reporter.userId);
    assert.equal(created.body.reason, 'Offensive language here');

    await reportPost(reporter, 'Reporting it again').expect(409);
    await reportPost(secondReporter).expect(201);
    await report(reporter, { targetType: 'COMMENT', targetId: commentId, reason: 'Insulting reply' }).expect(201);
    assert.equal(await collection('reports').countDocuments(), 3);
  });

  it('GEN-09: the same user reporting twice at once is stored once', async () => {
    const results = await Promise.all([reportPost(reporter), reportPost(reporter)]);
    assert.deepEqual(results.map((result) => result.status).sort(), [201, 409]);
    assert.equal(await collection('reports').countDocuments(), 1);
  });

  it('GEN-09/GEN-13: validates reports', async () => {
    await report(reporter, { targetType: 'POST', targetId: postId, reason: 'bad' }).expect(400);
    await report(reporter, { targetType: 'POST', targetId: postId }).expect(400);
    await report(reporter, { targetType: 'PHOTO', targetId: postId, reason: 'Offensive content' }).expect(400);
    await report(reporter, { targetType: 'POST', targetId: 'nope', reason: 'Offensive content' }).expect(400);
    await report(reporter, { targetType: 'POST', targetId: new Types.ObjectId().toString(), reason: 'Offensive content' }).expect(404);
    await report(reporter, { targetType: 'REVIEW', targetId: new Types.ObjectId().toString(), reason: 'Offensive content' }).expect(400);
    await report(reporter, { targetType: 'ITINERARY', targetId: new Types.ObjectId().toString(), reason: 'Offensive content' }).expect(400);
    await report(reporter, { targetType: 'POST', targetId: postId, reason: 'Offensive content', status: 'DISMISSED' }).expect(400);
    assert.equal(await collection('reports').countDocuments(), 0);
  });

  it('GEN-09: only registered users can report', async () => {
    await fixture.http().post('/api/reports').send({ targetType: 'POST', targetId: postId, reason: 'Offensive content' }).expect(401);
    await reportPost(admin).expect(403);
    const moderator = await fixture.login('desk@hotel.com', UserRole.HOTEL_MODERATOR);
    await reportPost(moderator).expect(403);
  });

  it('GEN-10: admins list open reports with the reporter name, newest first', async () => {
    await reportPost(reporter).expect(201);
    await report(secondReporter, { targetType: 'COMMENT', targetId: commentId, reason: 'Insulting reply' }).expect(201);

    const response = await fixture.http().get('/api/admin/reports').set('Cookie', admin.cookie).expect(200);
    assert.equal(response.body.total, 2);
    assert.equal(response.body.pageSize, 10);
    assert.equal(response.body.items[0].targetType, 'COMMENT');
    assert.equal(response.body.items[0].userName, 'Second Reader');
    assert.equal(response.body.items[1].userName, 'Careful Reader');
    const comments = await fixture.http().get('/api/admin/reports?targetType=COMMENT').set('Cookie', admin.cookie).expect(200);
    assert.equal(comments.body.total, 1);
  });

  it('GEN-10: dismissing closes only that report and leaves the content visible', async () => {
    const first = (await reportPost(reporter).expect(201)).body.reportId;
    await reportPost(secondReporter).expect(201);

    const response = await resolve(first, 'DISMISS').expect(200);
    assert.equal(response.body.status, 'DISMISSED');
    assert.equal(response.body.resolvedBy, admin.userId);
    assert.ok(response.body.resolvedAt);
    await viewPost().expect(200);
    assert.equal((await fixture.http().get('/api/admin/reports').set('Cookie', admin.cookie).expect(200)).body.total, 1);
    assert.equal((await fixture.http().get('/api/admin/reports?status=DISMISSED').set('Cookie', admin.cookie).expect(200)).body.total, 1);
    assert.deepEqual(await auditActions(), ['REPORT_DISMISSED']);
    await resolve(first, 'HIDE').expect(409);
  });

  it('GEN-10: hiding from a report hides the post from everyone but its author and admins, and closes all its reports', async () => {
    const first = (await reportPost(reporter).expect(201)).body.reportId;
    await reportPost(secondReporter).expect(201);

    const response = await resolve(first, 'HIDE').expect(200);
    assert.equal(response.body.status, 'CONTENT_HIDDEN');
    await viewPost().expect(404);
    await viewPost(reporter).expect(404);
    await viewPost(author).expect(200);
    await viewPost(admin).expect(200);
    assert.equal(await collection('reports').countDocuments({ status: 'CONTENT_HIDDEN' }), 2);
    assert.equal(await collection('reports').countDocuments({ status: 'OPEN' }), 0);

    const [entry] = await collection('auditlogs').find().toArray();
    assert.equal(entry.action, 'CONTENT_HIDDEN');
    assert.equal(entry.targetType, 'POST');
    assert.equal(entry.targetId.toString(), postId);
  });

  it('GEN-10: deleting from a report removes the comment and closes its reports', async () => {
    const reportId = (await report(reporter, { targetType: 'COMMENT', targetId: commentId, reason: 'Insulting reply' }).expect(201)).body.reportId;
    const response = await resolve(reportId, 'DELETE').expect(200);
    assert.equal(response.body.status, 'CONTENT_DELETED');
    assert.equal(await collection('comments').countDocuments({ _id: new Types.ObjectId(commentId) }), 0);
    assert.deepEqual(await auditActions(), ['CONTENT_DELETED']);
  });

  it('GEN-10: a report about content that is already gone is closed as deleted', async () => {
    const reportId = (await report(reporter, { targetType: 'COMMENT', targetId: commentId, reason: 'Insulting reply' }).expect(201)).body.reportId;
    // The author deletes the whole post, which deletes its comments.
    await fixture.http().delete(`/api/posts/${postId}`).set('Cookie', author.cookie).expect((response) => assert.ok([200, 204].includes(response.status)));
    const response = await resolve(reportId, 'HIDE').expect(200);
    assert.equal(response.body.status, 'CONTENT_DELETED');
  });

  it('GEN-10: two admins resolving the same report at once act once', async () => {
    const reportId = (await reportPost(reporter).expect(201)).body.reportId;
    const results = await Promise.all([resolve(reportId, 'DISMISS'), resolve(reportId, 'HIDE')]);
    assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
    assert.equal((await collection('auditlogs').find().toArray()).length, 1);
  });

  it('GEN-10: admins hide, unhide and delete content directly, closing open reports', async () => {
    await reportPost(reporter).expect(201);
    const hidden = await moderate('patch', `post/${postId}/hide`).expect(200);
    assert.deepEqual(hidden.body, { type: 'post', id: postId, state: 'HIDDEN', closedReports: 1 });
    await viewPost().expect(404);

    const visible = await moderate('patch', `post/${postId}/unhide`).expect(200);
    assert.equal(visible.body.state, 'VISIBLE');
    await viewPost().expect(200);

    const deleted = await moderate('delete', `comment/${commentId}`).expect(200);
    assert.equal(deleted.body.state, 'DELETED');
    assert.deepEqual(await auditActions(), ['CONTENT_DELETED', 'CONTENT_HIDDEN', 'CONTENT_UNHIDDEN']);
  });

  it('GEN-10/GEN-13: rejects invalid moderation requests without side effects', async () => {
    const reportId = (await reportPost(reporter).expect(201)).body.reportId;
    await resolve(reportId, 'BAN').expect(400);
    await resolve(new Types.ObjectId().toString(), 'DISMISS').expect(404);
    await resolve('nope', 'DISMISS').expect(400);
    await moderate('patch', `photo/${postId}/hide`).expect(400);
    await moderate('patch', `post/nope/hide`).expect(400);
    await moderate('patch', `post/${new Types.ObjectId().toString()}/hide`).expect(404);
    await moderate('patch', `review/${new Types.ObjectId().toString()}/hide`).expect(400);
    await moderate('delete', `itinerary/${new Types.ObjectId().toString()}`).expect(400);
    assert.equal(await collection('auditlogs').countDocuments(), 0);
    assert.equal(await collection('reports').countDocuments({ status: 'OPEN' }), 1);
  });

  it('GEN-10: only administrators can see reports and moderate', async () => {
    const reportId = (await reportPost(reporter).expect(201)).body.reportId;
    await fixture.http().get('/api/admin/reports').set('Cookie', reporter.cookie).expect(403);
    await resolve(reportId, 'HIDE', author).expect(403);
    await moderate('patch', `post/${postId}/hide`, author).expect(403);
    await moderate('delete', `post/${postId}`, reporter).expect(403);
    await fixture.http().get('/api/admin/reports').expect(401);
    await viewPost().expect(200);
  });

  it('lists every endpoint in Swagger with its requirement ID', async () => {
    const document = (await fixture.http().get('/api/docs-json').expect(200)).body;
    const operations: [string, string, RegExp][] = [
      ['/api/reports', 'post', /^GEN-09/],
      ['/api/admin/reports', 'get', /^GEN-09\/GEN-10/],
      ['/api/admin/reports/{id}', 'patch', /^GEN-10/],
      ['/api/admin/content/{type}/{id}/hide', 'patch', /^GEN-10/],
      ['/api/admin/content/{type}/{id}/unhide', 'patch', /^GEN-10/],
      ['/api/admin/content/{type}/{id}', 'delete', /^GEN-10/],
    ];
    for (const [path, method, summary] of operations) assert.match(document.paths[path][method].summary, summary, `${method} ${path}`);
  });
});
