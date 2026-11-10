import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type LikeDocument = HydratedDocument<Like>;

@Schema({ timestamps: true, versionKey: false })
export class Like {
  declare _id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'BlogPost', required: true })
  postId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId!: Types.ObjectId;

  declare createdAt: Date;
  declare updatedAt: Date;
}

export const LikeSchema = SchemaFactory.createForClass(Like);
// BLG-06: the database itself allows one like per user per post, so no race can double count.
LikeSchema.index({ postId: 1, userId: 1 }, { unique: true, name: 'likes_post_user_unique' });
