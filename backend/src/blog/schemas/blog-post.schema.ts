import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { CONTENT_LENGTH, MAX_IMAGES_PER_POST, MAX_TAGS_PER_POST, PostStatus, TITLE_LENGTH } from '../blog.rules';

export type BlogPostDocument = HydratedDocument<BlogPost>;

/** BLG-10: what the post lists about each image. Its _id is the imageId of the PostImage holding the bytes. */
@Schema({ _id: false, versionKey: false })
export class PostImageRef {
  @Prop({ type: Types.ObjectId, required: true })
  _id!: Types.ObjectId;

  @Prop({ type: String, required: true })
  contentType!: string;

  @Prop({ type: Number, required: true })
  size!: number;

  @Prop({ type: Date, required: true })
  uploadedAt!: Date;
}
const PostImageRefSchema = SchemaFactory.createForClass(PostImageRef);

@Schema({ timestamps: true, versionKey: false })
export class BlogPost {
  declare _id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId!: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true, minlength: TITLE_LENGTH.min, maxlength: TITLE_LENGTH.max })
  title!: string;

  @Prop({ type: String, required: true, minlength: CONTENT_LENGTH.min, maxlength: CONTENT_LENGTH.max })
  content!: string;

  @Prop({ type: String, enum: PostStatus, default: PostStatus.DRAFT, required: true })
  status!: PostStatus;

  @Prop({
    type: [String],
    default: [],
    validate: { validator: (tags: string[]) => tags.length <= MAX_TAGS_PER_POST, message: `A post can have at most ${MAX_TAGS_PER_POST} tags` },
  })
  tags!: string[];

  @Prop({
    type: [PostImageRefSchema],
    default: [],
    validate: { validator: (images: PostImageRef[]) => images.length <= MAX_IMAGES_PER_POST, message: `A post can have at most ${MAX_IMAGES_PER_POST} images` },
  })
  images!: PostImageRef[];

  // Counters kept with the post for list ordering (BLG-09 interaction score); updated by likes and comments.
  @Prop({ type: Number, default: 0, min: 0 })
  likesCount!: number;

  @Prop({ type: Number, default: 0, min: 0 })
  commentsCount!: number;

  // The first time the post was published; kept if it goes back to draft.
  @Prop({ type: Date })
  publishedAt?: Date;

  // BLG-13 (bonus): one of the author's own public itineraries, attached to the post.
  @Prop({ type: Types.ObjectId, ref: 'Itinerary' })
  itineraryId?: Types.ObjectId;

  // GEN-10: set by Person 2's moderation through BlogService.setPostHidden.
  @Prop({ type: Boolean, default: false })
  isHidden!: boolean;

  declare createdAt: Date;
  declare updatedAt: Date;
}

export const BlogPostSchema = SchemaFactory.createForClass(BlogPost);
BlogPostSchema.index({ status: 1, isHidden: 1, publishedAt: -1 });
BlogPostSchema.index({ tags: 1 });
BlogPostSchema.index({ userId: 1, createdAt: -1 });
