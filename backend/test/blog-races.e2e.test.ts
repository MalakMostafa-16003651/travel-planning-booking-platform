import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { Types } from 'mongoose';
import { BlogService } from '../src/blog/blog.service';
import { LikesService } from '../src/blog/likes.service';
import { CommentsService } from '../src/blog/comments.service';
import { PostImagesService } from '../src/blog/post-images.service';
import { UserRole } from '../src/common/enums/user-role.enum';
import { BlogFixture, Session } from './blog-fixture';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('png body')]);

/**
 * The interleavings from the team leader's 2026-11-07 review, made deterministic: a request is paused
 * between writing its row and updating the post (or the post is deleted at that moment).
 */
describe('BLG-04/05/06/10 counters and child rows stay consistent under concurrent requests', { concurrency: false }, () => {
  const fixture = new BlogFixture();
  let author: Session;
  let reader: Session;
  let postId: string;

  const post = () => fixture.connection.collection('blogposts').findOne({ _id: new Types.ObjectId(postId) });
  const count = (collection: string) => fixture.connection.collection(collection).countDocuments({ postId: new Types.ObjectId(postId) });
  const internals = <T>(service: unknown) => service as T;

  before(() => fixture.start('blog-races'), { timeout: 30 * 60_000 });
  after(() => fixture.stop());

  beforeEach(async () => {
    await fixture.reset();
    author = await fixture.login('author@example.com', UserRole.USER, 'Author');
    reader = await fixture.login('reader@example.com', UserRole.USER, 'Reader');
    postId = await fixture.post(author);
  });

  it('BLG-06: an unlike between a like and its count update leaves the count equal to the likes', async () => {
    // The like row exists but its +1 has not run yet.
    await fixture.connection.collection('likes').insertOne({ postId: new Types.ObjectId(postId), userId: new Types.ObjectId(reader.userId), createdAt: new Date(), updatedAt: new Date() });
    await fixture.http().delete(`/api/posts/${postId}/like`).set('Cookie', reader.cookie).expect(200);
    // The paused +1 now runs.
    await fixture.connection.collection('blogposts').updateOne({ _id: new Types.ObjectId(postId) }, { $inc: { likesCount: 1 } });
    assert.equal(await count('likes'), 0);
    assert.equal((await post())!.likesCount, 0);
  });

  it('BLG-05: a delete between a comment and its count update leaves the count equal to the comments', async () => {
    const commentId = new Types.ObjectId();
    await fixture.connection.collection('comments').insertOne({ _id: commentId, postId: new Types.ObjectId(postId), userId: new Types.ObjectId(reader.userId), content: 'Paused', isHidden: false, createdAt: new Date(), updatedAt: new Date() });
    await fixture.http().delete(`/api/comments/${commentId.toString()}`).set('Cookie', reader.cookie).expect(204);
    await fixture.connection.collection('blogposts').updateOne({ _id: new Types.ObjectId(postId) }, { $inc: { commentsCount: 1 } });
    assert.equal(await count('comments'), 0);
    assert.equal((await post())!.commentsCount, 0);
  });

  it('BLG-04: a like or comment that passed the post check just before the post was deleted is not left behind', async () => {
    const blog = fixture.app.get(BlogService);
    const captured = await blog.getPublicPost(postId);
    await fixture.http().delete(`/api/posts/${postId}`).set('Cookie', author.cookie).expect(204);
    // Both requests already read the post before it was deleted.
    const patched = internals<{ getPublicPost: (id: string) => Promise<unknown> }>(blog);
    const original = patched.getPublicPost;
    patched.getPublicPost = async () => captured;
    try {
      await assert.rejects(fixture.app.get(LikesService).like(postId, { userId: reader.userId, role: UserRole.USER }), { status: 404 });
      await assert.rejects(fixture.app.get(CommentsService).create(postId, { content: 'Too late' }, { userId: reader.userId, role: UserRole.USER }), { status: 404 });
    } finally {
      patched.getPublicPost = original;
    }
    assert.equal(await count('likes'), 0);
    assert.equal(await count('comments'), 0);
  });

  it('BLG-10: an upload during the deletion of its post leaves no image behind', async () => {
    const blog = fixture.app.get(BlogService);
    const images = fixture.app.get(PostImagesService);
    const captured = await blog.getOwnedPost(postId, { userId: author.userId, role: UserRole.USER });
    const blogInternals = internals<{ images: { deleteMany: (filter: unknown) => { exec: () => Promise<unknown> } }; getOwnedPost: (id: string, viewer: unknown) => Promise<unknown> }>(blog);
    const originalDeleteMany = blogInternals.images.deleteMany.bind(blogInternals.images);
    const originalGetOwnedPost = blogInternals.getOwnedPost;
    let uploadOutcome: unknown;
    // Right after the deletion clears the post's images, an upload that already checked the post runs.
    blogInternals.images.deleteMany = (filter: unknown) => ({
      exec: async () => {
        const result = await originalDeleteMany(filter).exec();
        blogInternals.images.deleteMany = originalDeleteMany;
        blogInternals.getOwnedPost = async () => captured;
        uploadOutcome = await images.addImage(postId, { buffer: PNG, size: PNG.length }, { userId: author.userId, role: UserRole.USER }).catch((error: unknown) => error);
        blogInternals.getOwnedPost = originalGetOwnedPost;
        return result;
      },
    });
    try {
      await fixture.http().delete(`/api/posts/${postId}`).set('Cookie', author.cookie).expect(204);
    } finally {
      blogInternals.images.deleteMany = originalDeleteMany;
      blogInternals.getOwnedPost = originalGetOwnedPost;
    }
    assert.equal(await post(), null);
    assert.equal(await fixture.connection.collection('postimages').countDocuments(), 0);
    assert.equal((uploadOutcome as { status?: number }).status, 404);
  });
});
