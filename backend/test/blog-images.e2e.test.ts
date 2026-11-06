import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { Types } from 'mongoose';
import { BlogService } from '../src/blog/blog.service';
import { UserRole } from '../src/common/enums/user-role.enum';
import { BlogFixture, Session } from './blog-fixture';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('png body')]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('jpeg body')]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);

describe('BLG-10/GEN-08 post images', { concurrency: false }, () => {
  const fixture = new BlogFixture();
  let author: Session;
  let reader: Session;
  let admin: Session;
  let postId: string;

  const upload = (data: Buffer, filename = 'photo.png', session = author, id = postId) =>
    fixture.http().post(`/api/posts/${id}/images`).set('Cookie', session.cookie).attach('image', data, filename);
  const storedImages = () => fixture.connection.collection('postimages').countDocuments();

  before(() => fixture.start('blog-images'), { timeout: 30 * 60_000 });
  after(() => fixture.stop());

  beforeEach(async () => {
    await fixture.reset();
    author = await fixture.login('author@example.com', UserRole.USER, 'Author');
    reader = await fixture.login('reader@example.com', UserRole.USER, 'Reader');
    admin = await fixture.login('admin@example.com', UserRole.ADMIN, 'Admin');
    postId = await fixture.post(author);
  });

  it('attaches JPG and PNG images and serves them by URL', async () => {
    const png = await upload(PNG).expect(201);
    assert.equal(png.body.images.length, 1);
    const [image] = png.body.images;
    assert.equal(image.contentType, 'image/png');
    assert.equal(image.size, PNG.length);
    assert.equal(image.url, `/api/posts/${postId}/images/${image.imageId}`);
    const served = await fixture.http().get(image.url).buffer(true).parse((response, callback) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => callback(null, Buffer.concat(chunks)));
    }).expect(200);
    assert.equal(served.headers['content-type'], 'image/png');
    assert.equal(served.headers['x-content-type-options'], 'nosniff');
    assert.deepEqual(served.body, PNG);

    // The type comes from the file content, not the client's filename.
    const jpeg = await upload(JPEG, 'named-wrong.png').expect(201);
    assert.equal(jpeg.body.images[1].contentType, 'image/jpeg');
    assert.equal((await fixture.http().get(`/api/posts/${postId}`).expect(200)).body.images.length, 2);
  });

  it('rejects other formats, missing files and files over 5 MB', async () => {
    const webp = await upload(WEBP, 'photo.webp').expect(400);
    assert.deepEqual(webp.body.errors, { image: ['Image must be a JPG or PNG file'] });
    await upload(Buffer.from('<script>alert(1)</script>'), 'evil.png').expect(400);
    await fixture.http().post(`/api/posts/${postId}/images`).set('Cookie', author.cookie).field('note', 'no file').expect(400);
    const tooBig = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]);
    await upload(tooBig).expect(413);
    await upload(Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024 - PNG.length)])).expect(201);
    assert.equal(await storedImages(), 1);
  });

  it('allows at most 5 images per post, even when uploads race', async () => {
    for (let index = 0; index < 4; index += 1) await upload(PNG).expect(201);
    const racing = await Promise.all([upload(PNG), upload(JPEG)]);
    assert.deepEqual(racing.map((response) => response.status).sort(), [201, 400]);
    const sixth = await upload(PNG).expect(400);
    assert.deepEqual(sixth.body.errors, { image: ['A post can have at most 5 images'] });
    assert.equal(await storedImages(), 5);
    const post = await fixture.connection.collection('blogposts').findOne({ _id: new Types.ObjectId(postId) });
    assert.equal(post!.images.length, 5);
  });

  it('lets only the author attach or remove images', async () => {
    await fixture.http().post(`/api/posts/${postId}/images`).attach('image', PNG, 'photo.png').expect(401);
    await upload(PNG, 'photo.png', reader).expect(403);
    await upload(PNG, 'photo.png', admin).expect(403);
    await upload(PNG, 'photo.png', author, new Types.ObjectId().toString()).expect(404);
    await upload(PNG, 'photo.png', author, 'nope').expect(400);
    const imageId = (await upload(PNG).expect(201)).body.images[0].imageId as string;
    const url = `/api/posts/${postId}/images/${imageId}`;

    await fixture.http().delete(url).expect(401);
    await fixture.http().delete(url).set('Cookie', reader.cookie).expect(403);
    await fixture.http().delete(`/api/posts/${postId}/images/${new Types.ObjectId().toString()}`).set('Cookie', author.cookie).expect(404);
    await fixture.http().delete(`/api/posts/${postId}/images/nope`).set('Cookie', author.cookie).expect(400);
    const removed = await fixture.http().delete(url).set('Cookie', author.cookie).expect(200);
    assert.deepEqual(removed.body.images, []);
    await fixture.http().get(url).expect(404);
    assert.equal(await storedImages(), 0);
  });

  it("gives images the post's visibility: drafts and hidden posts stay private", async () => {
    const draft = await fixture.post(author, { status: 'DRAFT' });
    const imageId = (await upload(PNG, 'photo.png', author, draft).expect(201)).body.images[0].imageId as string;
    const url = `/api/posts/${draft}/images/${imageId}`;
    await fixture.http().get(url).expect(404);
    await fixture.http().get(url).set('Cookie', reader.cookie).expect(404);
    await fixture.http().get(url).set('Cookie', author.cookie).expect(200);

    const publicImage = (await upload(PNG).expect(201)).body.images[0].imageId as string;
    const publicUrl = `/api/posts/${postId}/images/${publicImage}`;
    await fixture.http().get(publicUrl).expect(200);
    await fixture.app.get(BlogService).setPostHidden(postId, true);
    await fixture.http().get(publicUrl).expect(404);
    await fixture.http().get(publicUrl).set('Cookie', admin.cookie).expect(200);
    // An image id of another post is not served through this post.
    await fixture.http().get(`/api/posts/${postId}/images/${imageId}`).set('Cookie', author.cookie).expect(404);
  });

  it('deletes the images with their post', async () => {
    await upload(PNG).expect(201);
    await upload(JPEG).expect(201);
    await fixture.http().delete(`/api/posts/${postId}`).set('Cookie', author.cookie).expect(204);
    assert.equal(await storedImages(), 0);
  });

  it('lists the image endpoints in Swagger with BLG-10', async () => {
    const document = (await fixture.http().get('/api/docs-json').expect(200)).body;
    assert.match(document.paths['/api/posts/{id}/images'].post.summary, /^BLG-10/);
    assert.match(document.paths['/api/posts/{id}/images/{imageId}'].get.summary, /^BLG-10/);
    assert.match(document.paths['/api/posts/{id}/images/{imageId}'].delete.summary, /^BLG-10/);
  });
});
