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
    const counted = await this.changeCount(post._id, 1, true);
    if (!counted) {
      // The post was deleted meanwhile: do not leave a like without its post.
      await this.likes.deleteOne({ postId: post._id, userId: new Types.ObjectId(viewer.userId) }).exec();
      throw new NotFoundException('Post not found');
    }
    return counted;
  }

  /** BLG-06 */
  async unlike(postId: string, viewer: Viewer) {
    if (!Types.ObjectId.isValid(postId)) throw new NotFoundException('You have not liked this post');
    const removed = await this.likes.findOneAndDelete({ postId: new Types.ObjectId(postId), userId: new Types.ObjectId(viewer.userId) }).exec();
    if (!removed) throw new NotFoundException('You have not liked this post');
    return (await this.changeCount(removed.postId, -1, false)) ?? { liked: false, likesCount: 0 };
  }

  /** Whether this viewer liked the post, for the post page. */
  async hasLiked(postId: Types.ObjectId, viewer?: Viewer): Promise<boolean> {
    if (!viewer) return false;
    return await this.likes.countDocuments({ postId, userId: new Types.ObjectId(viewer.userId) }).exec() > 0;
  }

  // Called only after a like was really added or removed. Unconditional, so every removed row cancels
  // exactly the increment of its creation whatever the order. Null when the post no longer exists.
  private async changeCount(postId: Types.ObjectId, by: 1 | -1, liked: boolean) {
    const post = await this.posts.findOneAndUpdate({ _id: postId }, { $inc: { likesCount: by } }, { returnDocument: 'after' }).exec();
    return post ? { liked, likesCount: Math.max(0, post.likesCount) } : null;
  }
}
