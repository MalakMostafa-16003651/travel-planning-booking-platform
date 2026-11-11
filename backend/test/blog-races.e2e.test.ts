import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { Model, Types } from 'mongoose';
import { BlogPost } from '../src/blog/schemas/blog-post.schema';
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

  it('BLG-06: a failed counter write rolls back the like and a retry counts it once', async () => {
    const service = fixture.app.get(LikesService);
    const model = internals<{ posts: Model<BlogPost> }>(service).posts;
    const original = model.findOneAndUpdate;
    model.findOneAndUpdate = (() => ({ exec: async () => { throw new Error('Counter unavailable'); } })) as unknown as typeof original;
    try {
      await assert.rejects(service.like(postId, { userId: reader.userId, role: UserRole.USER }), /Counter unavailable/);
    } finally { model.findOneAndUpdate = original; }
    assert.equal(await count('likes'), 0);
    assert.equal((await post())!.likesCount, 0);
    await service.like(postId, { userId: reader.userId, role: UserRole.USER });
    assert.equal(await count('likes'), 1);
    assert.equal((await post())!.likesCount, 1);
  });

  it('BLG-05: a failed counter write rolls back the comment and a retry counts it once', async () => {
    const service = fixture.app.get(CommentsService);
    const model = internals<{ posts: Model<BlogPost> }>(service).posts;
    const original = model.updateOne;
    model.updateOne = (() => ({ exec: async () => { throw new Error('Counter unavailable'); } })) as unknown as typeof original;
    try {
      await assert.rejects(service.create(postId, { content: 'Atomic comment' }, { userId: reader.userId, role: UserRole.USER }), /Counter unavailable/);
    } finally { model.updateOne = original; }
    assert.equal(await count('comments'), 0);
    assert.equal((await post())!.commentsCount, 0);
    await service.create(postId, { content: 'Atomic comment' }, { userId: reader.userId, role: UserRole.USER });
    assert.equal(await count('comments'), 1);
    assert.equal((await post())!.commentsCount, 1);
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

  it('BLG-10: an upload that checked ownership before post deletion leaves no image behind', async () => {
    const blog = fixture.app.get(BlogService);
    const images = fixture.app.get(PostImagesService);
    const captured = await blog.getOwnedPost(postId, { userId: author.userId, role: UserRole.USER });
    const blogInternals = internals<{ getOwnedPost: (id: string, viewer: unknown) => Promise<unknown> }>(blog);
    const originalGetOwnedPost = blogInternals.getOwnedPost;
    await fixture.http().delete(`/api/posts/${postId}`).set('Cookie', author.cookie).expect(204);
    blogInternals.getOwnedPost = async () => captured;
    try {
      await assert.rejects(images.addImage(postId, { buffer: PNG, size: PNG.length }, { userId: author.userId, role: UserRole.USER }), { status: 404 });
    } finally {
      blogInternals.getOwnedPost = originalGetOwnedPost;
    }
    assert.equal(await post(), null);
    assert.equal(await fixture.connection.collection('postimages').countDocuments(), 0);
  });

  it('BLG-10: an image-reference write failure rolls back the image bytes', async () => {
    const images = fixture.app.get(PostImagesService);
    const model = internals<{ posts: Model<BlogPost> }>(images).posts;
    const original = model.findOneAndUpdate;
    model.findOneAndUpdate = (() => ({ exec: async () => { throw new Error('Parent update unavailable'); } })) as unknown as typeof original;
    try {
      await assert.rejects(images.addImage(postId, { buffer: PNG, size: PNG.length }, { userId: author.userId, role: UserRole.USER }), /Parent update unavailable/);
    } finally { model.findOneAndUpdate = original; }
    assert.equal(await count('postimages'), 0);
    assert.equal((await post())!.images.length, 0);
  });
});
