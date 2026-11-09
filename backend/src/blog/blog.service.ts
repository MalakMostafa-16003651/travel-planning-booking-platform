import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, PipelineStage, Types } from 'mongoose';
import { AccountStatus } from '../common/enums/account-status.enum';
import { UserRole } from '../common/enums/user-role.enum';
import { ItinerarySummaryDto } from '../itineraries/dto/itinerary-response.dto';
import { ItineraryVisibility } from '../itineraries/itinerary.rules';
import { Itinerary } from '../itineraries/schemas/itinerary.schema';
import { User } from '../users/schemas/user.schema';
import { BLOG_PAGE_SIZE, DELETED_USER_NAME, escapeRegex, excerpt, PostStatus } from './blog.rules';
import { CreateBlogPostDto, ListPostsQueryDto, UpdateBlogPostDto } from './dto/blog-post.dto';
import { BlogPost, BlogPostDocument } from './schemas/blog-post.schema';
import { Comment } from './schemas/comment.schema';
import { Like } from './schemas/like.schema';
import { PostImage } from './schemas/post-image.schema';

export interface Viewer {
  userId: string;
  role: UserRole;
}

export interface Author {
  userId: string | null;
  name: string;
}

type AuthorRecord = { _id: Types.ObjectId; name: string; status: AccountStatus } | null | undefined;

/** ACC-12: a deactivated or missing user is shown as "Deleted user", without an id. */
export function toAuthor(user: AuthorRecord): Author {
  if (!user || user.status === AccountStatus.DEACTIVATED) return { userId: null, name: DELETED_USER_NAME };
  return { userId: user._id.toString(), name: user.name };
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

function page<T>(items: T[], pageNumber: number, total: number): Page<T> {
  return { items, page: pageNumber, pageSize: BLOG_PAGE_SIZE, total, totalPages: Math.ceil(total / BLOG_PAGE_SIZE) };
}

@Injectable()
export class BlogService {
  constructor(
    @InjectModel(BlogPost.name) private readonly posts: Model<BlogPost>,
    @InjectModel(Comment.name) private readonly comments: Model<Comment>,
    @InjectModel(Like.name) private readonly likes: Model<Like>,
    @InjectModel(PostImage.name) private readonly images: Model<PostImage>,
    // Read-only: author name, status and join date.
    @InjectModel(User.name) private readonly users: Model<User>,
    // Read-only: Person 7's itineraries, for the author page (BLG-12).
    @InjectModel(Itinerary.name) private readonly itineraries: Model<Itinerary>,
  ) {}

  /** BLG-01: saved as DRAFT unless published. */
  async create(dto: CreateBlogPostDto, viewer: Viewer) {
    const status = dto.status ?? PostStatus.DRAFT;
    const post = await this.posts.create({
      userId: new Types.ObjectId(viewer.userId),
      title: dto.title,
      content: dto.content,
      tags: dto.tags ?? [],
      status,
      publishedAt: status === PostStatus.PUBLISHED ? new Date() : undefined,
    });
    return this.toResponse(post);
  }

  /** BLG-02 browse (newest first, optional tag) and BLG-09 search (title, tags or author name; by likes + comments). */
  listPublic(query: ListPostsQueryDto) {
    const filter: Record<string, unknown> = {};
    if (query.tag) filter.tags = query.tag.toLowerCase();
    return this.findPublicPosts(filter, query.page, query.q);
  }

  /** BLG-08: a clickable tag lists its published posts. */
  listByTag(tag: string, pageNumber: number) {
    return this.findPublicPosts({ tags: tag.toLowerCase() }, pageNumber);
  }

  /** BLG-03: all of my posts, drafts included, with like and comment counts. */
  async listMine(viewer: Viewer, pageNumber: number) {
    const filter = { userId: new Types.ObjectId(viewer.userId) };
    const [posts, total] = await Promise.all([
      this.posts.find(filter).sort({ createdAt: -1, _id: -1 }).skip((pageNumber - 1) * BLOG_PAGE_SIZE).limit(BLOG_PAGE_SIZE).exec(),
      this.posts.countDocuments(filter).exec(),
    ]);
    return page(posts.map((post) => ({
      postId: post._id.toString(),
      title: post.title,
      status: post.status,
      isHidden: post.isHidden,
      tags: post.tags,
      likesCount: post.likesCount,
      commentsCount: post.commentsCount,
      publishedAt: post.publishedAt,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
    })), pageNumber, total);
  }

  /** BLG-02: a post page. Drafts only for their owner; hidden posts for their owner and admins (GEN-10). */
  async findOne(postId: string, viewer?: Viewer) {
    return this.toResponse(await this.getReadablePost(postId, viewer));
  }

  /** BLG-04 / BLG-08: the author edits title, content, tags or status. */
  async update(postId: string, dto: UpdateBlogPostDto, viewer: Viewer) {
    const post = await this.getOwnedPost(postId, viewer);
    if (dto.title !== undefined) post.title = dto.title;
    if (dto.content !== undefined) post.content = dto.content;
    if (dto.tags !== undefined) post.tags = dto.tags;
    if (dto.status !== undefined) post.status = dto.status;
    if (post.status === PostStatus.PUBLISHED && !post.publishedAt) post.publishedAt = new Date();
    await post.save();
    return this.toResponse(post);
  }

  /** BLG-04 */
  async remove(postId: string, viewer: Viewer): Promise<void> {
    const post = await this.getOwnedPost(postId, viewer);
    await this.deletePost(post);
  }

  /**
   * BLG-12: public author page with name, join date, published posts and public itineraries.
   * Deactivated or unknown authors are 404 (ACC-12). Each list has its own page number.
   */
  async getAuthor(userId: string, pageNumber: number, itinerariesPage = 1) {
    const user = await this.users.findById(userId, { name: 1, status: 1, createdAt: 1 }).exec();
    if (!user || user.status === AccountStatus.DEACTIVATED) throw new NotFoundException('Author not found');
    const [posts, itineraries] = await Promise.all([
      this.findPublicPosts({ userId: user._id }, pageNumber),
      this.findPublicItineraries(user, itinerariesPage),
    ]);
    return { userId: user._id.toString(), name: user.name, joinedAt: user.createdAt, posts, itineraries };
  }

  /**
   * BLG-12: the author's PUBLIC itineraries (ITN-20), newest published first, in Person 7's list shape.
   * Read-only query on Person 7's collection: private itineraries never appear. A clone's original
   * author is shown as "Deleted user" when deactivated or missing (ACC-12), as Person 7 does.
   */
  private async findPublicItineraries(author: { _id: Types.ObjectId; name: string }, pageNumber: number) {
    const filter = { userId: author._id, visibility: ItineraryVisibility.PUBLIC };
    const projection = { title: 1, description: 1, countries: 1, startDate: 1, visibility: 1, currency: 1, userId: 1,
      clonedFrom: 1, publishedAt: 1, createdAt: 1, updatedAt: 1, 'days._id': 1, 'days.city': 1, 'days.countryCode': 1 };
    const [rows, total] = await Promise.all([
      this.itineraries.find(filter, projection).sort({ publishedAt: -1, _id: -1 })
        .skip((pageNumber - 1) * BLOG_PAGE_SIZE).limit(BLOG_PAGE_SIZE).lean<Itinerary[]>().exec(),
      this.itineraries.countDocuments(filter).exec(),
    ]);
    const originalAuthorIds = rows.flatMap((row) => (row.clonedFrom ? [row.clonedFrom.userId] : []));
    const originalAuthors = await this.users.find({ _id: { $in: originalAuthorIds } }, { name: 1, status: 1 }).exec();
    const names = new Map<string, string>([[author._id.toString(), author.name]]);
    for (const id of originalAuthorIds) names.set(id.toString(), DELETED_USER_NAME);
    for (const original of originalAuthors) names.set(original._id.toString(), toAuthor(original).name);
    return page(rows.map((row) => ItinerarySummaryDto.from(row, names)), pageNumber, total);
  }

  // GEN-10: for Person 2's moderation. No HTTP routes here; Person 2 owns /api/admin.

  async setPostHidden(postId: string, hidden: boolean) {
    if (!isValidObjectId(postId)) throw new NotFoundException('Post not found');
    const post = await this.posts.findByIdAndUpdate(postId, { isHidden: hidden }, { returnDocument: 'after' }).exec();
    if (!post) throw new NotFoundException('Post not found');
    return this.toResponse(post);
  }

  async adminDeletePost(postId: string): Promise<void> {
    const post = isValidObjectId(postId) ? await this.posts.findById(postId).exec() : null;
    if (!post) throw new NotFoundException('Post not found');
    await this.deletePost(post);
  }

  /** For reports (GEN-09): false for unknown or invalid ids. */
  async postExists(postId: string): Promise<boolean> {
    return isValidObjectId(postId) && await this.posts.countDocuments({ _id: postId }).exec() > 0;
  }

  // Shared with comments, likes and images.

  /** The post if this viewer may read it, else 404, so drafts and hidden posts are not revealed. */
  async getReadablePost(postId: string, viewer?: Viewer): Promise<BlogPostDocument> {
    const post = await this.posts.findById(postId).exec();
    if (!post) throw new NotFoundException('Post not found');
    if (viewer && post.userId.toString() === viewer.userId) return post;
    if (viewer?.role === UserRole.ADMIN && post.status === PostStatus.PUBLISHED) return post;
    if (!await this.isPublic(post)) throw new NotFoundException('Post not found');
    return post;
  }

  /** Published, not hidden, by an author who exists and is not deactivated. */
  async getPublicPost(postId: string): Promise<BlogPostDocument> {
    const post = await this.posts.findById(postId).exec();
    if (!post || !await this.isPublic(post)) throw new NotFoundException('Post not found');
    return post;
  }

  /** 404 when the viewer cannot read it at all, 403 when they can read but do not own it. */
  async getOwnedPost(postId: string, viewer: Viewer): Promise<BlogPostDocument> {
    const post = await this.getReadablePost(postId, viewer);
    if (post.userId.toString() !== viewer.userId) throw new ForbiddenException('You can only change your own posts');
    return post;
  }

  async isPublic(post: BlogPostDocument): Promise<boolean> {
    if (post.status !== PostStatus.PUBLISHED || post.isHidden) return false;
    const author = await this.users.findById(post.userId, { status: 1 }).exec();
    return !!author && author.status !== AccountStatus.DEACTIVATED;
  }

  async toResponse(post: BlogPostDocument) {
    const author = toAuthor(await this.users.findById(post.userId, { name: 1, status: 1 }).exec());
    return {
      postId: post._id.toString(),
      title: post.title,
      content: post.content,
      status: post.status,
      tags: post.tags,
      // BLG-10: each image is served by URL with the post's visibility.
      images: post.images.map((image) => ({
        imageId: image._id.toString(),
        url: `/api/posts/${post._id.toString()}/images/${image._id.toString()}`,
        contentType: image.contentType,
        size: image.size,
        uploadedAt: image.uploadedAt,
      })),
      likesCount: post.likesCount,
      commentsCount: post.commentsCount,
      isHidden: post.isHidden,
      publishedAt: post.publishedAt,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
      author,
    };
  }

  // Deleting a post also deletes its comments, likes and images. The post goes first: a comment, like
  // or image written after that finds no post and removes itself, and one written before is removed here.
  private async deletePost(post: BlogPostDocument): Promise<void> {
    await this.posts.deleteOne({ _id: post._id }).exec();
    await this.comments.deleteMany({ postId: post._id }).exec();
    await this.likes.deleteMany({ postId: post._id }).exec();
    await this.images.deleteMany({ postId: post._id }).exec();
  }

  // Author visibility is checked at read time with a $lookup, so deactivating a user hides their
  // posts without copying data (ACC-12). A keyword search orders by likes + comments (BLG-09).
  private async findPublicPosts(filter: Record<string, unknown>, pageNumber: number, keyword?: string) {
    const pipeline: PipelineStage[] = [
      { $match: { ...filter, status: PostStatus.PUBLISHED, isHidden: false } },
      { $lookup: { from: this.users.collection.name, localField: 'userId', foreignField: '_id', as: 'author', pipeline: [{ $project: { name: 1, status: 1 } }] } },
      { $unwind: '$author' },
      { $match: { 'author.status': { $ne: AccountStatus.DEACTIVATED } } },
    ];
    if (keyword) {
      const pattern = { $regex: escapeRegex(keyword), $options: 'i' };
      pipeline.push({ $match: { $or: [{ title: pattern }, { tags: pattern }, { 'author.name': pattern }] } });
    }
    const sort: Record<string, 1 | -1> = keyword
      ? { interactionScore: -1, publishedAt: -1, _id: -1 }
      : { publishedAt: -1, _id: -1 };
    pipeline.push({
      $facet: {
        items: [
          { $addFields: { interactionScore: { $add: ['$likesCount', '$commentsCount'] } } },
          { $sort: sort },
          { $skip: (pageNumber - 1) * BLOG_PAGE_SIZE },
          { $limit: BLOG_PAGE_SIZE },
        ],
        total: [{ $count: 'count' }],
      },
    });
    const [result] = await this.posts.aggregate<{ items: (BlogPost & { author: { _id: Types.ObjectId; name: string; status: AccountStatus } })[]; total: { count: number }[] }>(pipeline).exec();
    const items = result.items.map((post) => ({
      postId: post._id.toString(),
      title: post.title,
      excerpt: excerpt(post.content),
      tags: post.tags,
      likesCount: post.likesCount,
      commentsCount: post.commentsCount,
      publishedAt: post.publishedAt,
      author: toAuthor(post.author),
    }));
    return page(items, pageNumber, result.total[0]?.count ?? 0);
  }
}
