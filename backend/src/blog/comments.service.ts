import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, isValidObjectId, Model, Types } from 'mongoose';
import { UserRole } from '../common/enums/user-role.enum';
import { User } from '../users/schemas/user.schema';
import { BLOG_PAGE_SIZE } from './blog.rules';
import { BlogService, toAuthor, Viewer } from './blog.service';
import { CreateCommentDto, UpdateCommentDto } from './dto/comment.dto';
import { BlogPost } from './schemas/blog-post.schema';
import { Comment, CommentDocument } from './schemas/comment.schema';

@Injectable()
export class CommentsService {
  constructor(
    @InjectModel(Comment.name) private readonly comments: Model<Comment>,
    @InjectModel(BlogPost.name) private readonly posts: Model<BlogPost>,
    @InjectModel(User.name) private readonly users: Model<User>,
    private readonly blog: BlogService,
  ) {}

  /** BLG-05: only on a published post that the public can see. */
  async create(postId: string, dto: CreateCommentDto, viewer: Viewer) {
    return this.comments.db.transaction(async (session) => {
      const post = await this.blog.getPublicPost(postId, session);
      const [comment] = await this.comments.create([{ postId: post._id, userId: new Types.ObjectId(viewer.userId), content: dto.content }], { session });
      const commentsCount = await this.comments.countDocuments({ postId: post._id }).session(session).exec();
      const counted = await this.posts.updateOne({ _id: post._id }, { $set: { commentsCount } }, { session }).exec();
      if (counted.matchedCount === 0) throw new NotFoundException('Post not found');
      return this.toResponse(comment);
    });
  }

  /**
   * BLG-05: oldest first, page size 10. Hidden comments (GEN-10) are shown only to their own
   * author and to admins. Needs a post the viewer may read.
   */
  async listForPost(postId: string, pageNumber: number, viewer?: Viewer) {
    const post = await this.blog.getReadablePost(postId, viewer);
    const filter: Record<string, unknown> = { postId: post._id };
    if (viewer?.role !== UserRole.ADMIN) {
      filter.$or = viewer ? [{ isHidden: false }, { userId: new Types.ObjectId(viewer.userId) }] : [{ isHidden: false }];
    }
    const [comments, total] = await Promise.all([
      this.comments.find(filter).sort({ createdAt: 1, _id: 1 }).skip((pageNumber - 1) * BLOG_PAGE_SIZE).limit(BLOG_PAGE_SIZE).exec(),
      this.comments.countDocuments(filter).exec(),
    ]);
    // One users query for the whole page.
    const users = await this.users.find({ _id: { $in: comments.map((comment) => comment.userId) } }, { name: 1, status: 1 }).exec();
    const authors = new Map(users.map((user) => [user._id.toString(), user]));
    const items = comments.map((comment) => this.shape(comment, toAuthor(authors.get(comment.userId.toString()))));
    return { items, page: pageNumber, pageSize: BLOG_PAGE_SIZE, total, totalPages: Math.ceil(total / BLOG_PAGE_SIZE) };
  }

  /** BLG-07 */
  async update(commentId: string, dto: UpdateCommentDto, viewer: Viewer) {
    const comment = await this.getOwnedComment(commentId, viewer);
    comment.content = dto.content;
    await comment.save();
    return this.toResponse(comment);
  }

  /** BLG-07 */
  async remove(commentId: string, viewer: Viewer): Promise<void> {
    await this.deleteComment(await this.getOwnedComment(commentId, viewer));
  }

  // GEN-10: for Person 2's moderation. No HTTP routes here.

  async setCommentHidden(commentId: string, hidden: boolean, session?: ClientSession) {
    const comment = isValidObjectId(commentId) ? await this.comments.findByIdAndUpdate(commentId, { isHidden: hidden }, { returnDocument: 'after', session }).exec() : null;
    if (!comment) throw new NotFoundException('Comment not found');
    return this.toResponse(comment);
  }

  async adminDeleteComment(commentId: string, session?: ClientSession): Promise<void> {
    if (!session) return this.comments.db.transaction((active) => this.adminDeleteComment(commentId, active));
    const comment = isValidObjectId(commentId) ? await this.comments.findById(commentId).session(session).exec() : null;
    if (!comment) throw new NotFoundException('Comment not found');
    await this.deleteComment(comment, session);
  }

  /** For reports (GEN-09): false for unknown or invalid ids. */
  async commentExists(commentId: string): Promise<boolean> {
    return isValidObjectId(commentId) && await this.comments.countDocuments({ _id: commentId }).exec() > 0;
  }

  private async getOwnedComment(commentId: string, viewer: Viewer): Promise<CommentDocument> {
    const comment = await this.comments.findById(commentId).exec();
    if (!comment) throw new NotFoundException('Comment not found');
    if (comment.userId.toString() !== viewer.userId) throw new ForbiddenException('You can only change your own comments');
    return comment;
  }

  private async deleteComment(comment: CommentDocument, session?: ClientSession): Promise<void> {
    if (!session) return this.comments.db.transaction((active) => this.deleteComment(comment, active));
    const deleted = await this.comments.deleteOne({ _id: comment._id }, { session }).exec();
    if (deleted.deletedCount === 1) {
      const commentsCount = await this.comments.countDocuments({ postId: comment.postId }).session(session).exec();
      await this.posts.updateOne({ _id: comment.postId }, { $set: { commentsCount } }, { session }).exec();
    }
  }

  private async toResponse(comment: CommentDocument) {
    return this.shape(comment, toAuthor(await this.users.findById(comment.userId, { name: 1, status: 1 }).exec()));
  }

  // ACC-12: the raw userId is not returned, so a deactivated author stays anonymous ("Deleted user").
  private shape(comment: CommentDocument, author: ReturnType<typeof toAuthor>) {
    return {
      commentId: comment._id.toString(),
      postId: comment.postId.toString(),
      content: comment.content,
      isHidden: comment.isHidden,
      createdAt: comment.createdAt,
      updatedAt: comment.updatedAt,
      author,
    };
  }
}
