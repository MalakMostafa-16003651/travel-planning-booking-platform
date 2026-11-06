import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { BlogService, Viewer } from './blog.service';
import { BlogPost } from './schemas/blog-post.schema';
import { Like } from './schemas/like.schema';

const DUPLICATE_KEY = 11000;

@Injectable()
export class LikesService {
  constructor(
    @InjectModel(Like.name) private readonly likes: Model<Like>,
    @InjectModel(BlogPost.name) private readonly posts: Model<BlogPost>,
    private readonly blog: BlogService,
  ) {}

  /** BLG-06: once per user per post; the unique index rejects a second like even under races. */
  async like(postId: string, viewer: Viewer) {
    const post = await this.blog.getPublicPost(postId);
    try {
      await this.likes.create({ postId: post._id, userId: new Types.ObjectId(viewer.userId) });
    } catch (error) {
      if ((error as { code?: number }).code === DUPLICATE_KEY) throw new ConflictException('You already liked this post');
      throw error;
    }
    return this.changeCount(post._id, 1, true);
  }

  /** BLG-06 */
  async unlike(postId: string, viewer: Viewer) {
    if (!Types.ObjectId.isValid(postId)) throw new NotFoundException('You have not liked this post');
    const removed = await this.likes.findOneAndDelete({ postId: new Types.ObjectId(postId), userId: new Types.ObjectId(viewer.userId) }).exec();
    if (!removed) throw new NotFoundException('You have not liked this post');
    return this.changeCount(removed.postId, -1, false);
  }

  /** Whether this viewer liked the post, for the post page. */
  async hasLiked(postId: Types.ObjectId, viewer?: Viewer): Promise<boolean> {
    if (!viewer) return false;
    return await this.likes.countDocuments({ postId, userId: new Types.ObjectId(viewer.userId) }).exec() > 0;
  }

  // Called only after a like was really added or removed.
  private async changeCount(postId: Types.ObjectId, by: 1 | -1, liked: boolean) {
    const filter = by === -1 ? { _id: postId, likesCount: { $gt: 0 } } : { _id: postId };
    const post = await this.posts.findOneAndUpdate(filter, { $inc: { likesCount: by } }, { returnDocument: 'after' }).exec();
    return { liked, likesCount: post?.likesCount ?? 0 };
  }
}
