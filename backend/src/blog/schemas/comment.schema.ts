import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { MAX_COMMENT_LENGTH } from '../blog.rules';

export type CommentDocument = HydratedDocument<Comment>;

@Schema({ timestamps: true, versionKey: false })
export class Comment {
  declare _id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'BlogPost', required: true })
  postId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId!: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true, minlength: 1, maxlength: MAX_COMMENT_LENGTH })
  content!: string;

  // GEN-10: set by Person 2's moderation through CommentsService.setCommentHidden.
  @Prop({ type: Boolean, default: false })
  isHidden!: boolean;

  declare createdAt: Date;
  declare updatedAt: Date;
}

export const CommentSchema = SchemaFactory.createForClass(Comment);
CommentSchema.index({ postId: 1, createdAt: 1, _id: 1 });
