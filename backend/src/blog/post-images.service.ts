import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { detectImageType, MAX_IMAGES_PER_POST } from './blog.rules';
import { BlogService, Viewer } from './blog.service';
import { BlogPost } from './schemas/blog-post.schema';
import { PostImage } from './schemas/post-image.schema';

/** The part of a multer file this service reads (kept in memory, never written to disk). */
export interface UploadedImage {
  buffer: Buffer;
  size: number;
}

function validationFailure(message: string): BadRequestException {
  return new BadRequestException({ message: 'Validation failed', errors: { image: [message] } });
}

@Injectable()
export class PostImagesService {
  constructor(
    @InjectModel(PostImage.name) private readonly images: Model<PostImage>,
    @InjectModel(BlogPost.name) private readonly posts: Model<BlogPost>,
    private readonly blog: BlogService,
  ) {}

  /** BLG-10 / GEN-08: JPG or PNG by content, at most 5 per post. The 5 MB limit is enforced by the upload interceptor. */
  async addImage(postId: string, file: UploadedImage | undefined, viewer: Viewer) {
    const post = await this.blog.getOwnedPost(postId, viewer);
    if (!file?.buffer?.length) throw validationFailure('An image file is required');
    const contentType = detectImageType(file.buffer);
    if (!contentType) throw validationFailure('Image must be a JPG or PNG file');
    if (post.images.length >= MAX_IMAGES_PER_POST) throw validationFailure(`A post can have at most ${MAX_IMAGES_PER_POST} images`);

    const stored = await this.images.create({ postId: post._id, data: file.buffer, contentType, size: file.size });
    // The "no 5th image yet" condition keeps the limit even when uploads race.
    const updated = await this.posts.findOneAndUpdate(
      { _id: post._id, [`images.${MAX_IMAGES_PER_POST - 1}`]: { $exists: false } },
      { $push: { images: { _id: stored._id, contentType, size: file.size, uploadedAt: stored.createdAt } } },
      { returnDocument: 'after' },
    ).exec();
    if (!updated) {
      await this.images.deleteOne({ _id: stored._id }).exec();
      throw validationFailure(`A post can have at most ${MAX_IMAGES_PER_POST} images`);
    }
    return this.blog.toResponse(updated);
  }

  /** The image bytes, with the same visibility as the post. */
  async getImage(postId: string, imageId: string, viewer?: Viewer) {
    const post = await this.blog.getReadablePost(postId, viewer);
    if (!Types.ObjectId.isValid(imageId) || !post.images.some((image) => image._id.toString() === imageId)) {
      throw new NotFoundException('Image not found');
    }
    const image = await this.images.findOne({ _id: new Types.ObjectId(imageId), postId: post._id }).exec();
    if (!image) throw new NotFoundException('Image not found');
    return image;
  }

  /** BLG-10: the author removes an image. */
  async removeImage(postId: string, imageId: string, viewer: Viewer) {
    const post = await this.blog.getOwnedPost(postId, viewer);
    if (!post.images.some((image) => image._id.toString() === imageId)) throw new NotFoundException('Image not found');
    const imageObjectId = new Types.ObjectId(imageId);
    const updated = await this.posts.findOneAndUpdate({ _id: post._id }, { $pull: { images: { _id: imageObjectId } } }, { returnDocument: 'after' }).exec();
    await this.images.deleteOne({ _id: imageObjectId, postId: post._id }).exec();
    return this.blog.toResponse(updated!);
  }
}
