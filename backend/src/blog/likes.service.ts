import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
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
    try {
      return await this.likes.db.transaction(async (session) => {
        const post = await this.blog.getPublicPost(postId, session);
        await this.likes.create([{ postId: post._id, userId: new Types.ObjectId(viewer.userId) }], { session });
        const counted = await this.changeCount(post._id, true, session);
        if (!counted) throw new NotFoundException('Post not found');
        return counted;
      });
    } catch (error) {
      if ((error as { code?: number }).code === DUPLICATE_KEY) throw new ConflictException('You already liked this post');
      throw error;
    }
  }

  /** BLG-06 */
  async unlike(postId: string, viewer: Viewer) {
    if (!Types.ObjectId.isValid(postId)) throw new NotFoundException('You have not liked this post');
    return this.likes.db.transaction(async (session) => {
      const removed = await this.likes.findOneAndDelete({ postId: new Types.ObjectId(postId), userId: new Types.ObjectId(viewer.userId) }, { session }).exec();
      if (!removed) throw new NotFoundException('You have not liked this post');
      return (await this.changeCount(removed.postId, false, session)) ?? { liked: false, likesCount: 0 };
    });
  }

  /** Whether this viewer liked the post, for the post page. */
  async hasLiked(postId: Types.ObjectId, viewer?: Viewer): Promise<boolean> {
    if (!viewer) return false;
    return await this.likes.countDocuments({ postId, userId: new Types.ObjectId(viewer.userId) }).exec() > 0;
  }

  // The post write serializes concurrent likes; recomputing also heals legacy counter drift.
  private async changeCount(postId: Types.ObjectId, liked: boolean, session: ClientSession) {
    const likesCount = await this.likes.countDocuments({ postId }).session(session).exec();
    const post = await this.posts.findOneAndUpdate({ _id: postId }, { $set: { likesCount } }, { returnDocument: 'after', session }).exec();
    return post ? { liked, likesCount: post.likesCount } : null;
  }
}
