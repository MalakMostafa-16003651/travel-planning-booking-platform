import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type PostImageDocument = HydratedDocument<PostImage>;

/**
 * BLG-10 / GEN-08 image bytes, kept out of the post document so posts stay small.
 * Its _id is the imageId listed on the post. Served by GET /api/posts/:id/images/:imageId.
 */
@Schema({ timestamps: true, versionKey: false, collection: 'postimages' })
export class PostImage {
  declare _id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'BlogPost', required: true, index: true })
  postId!: Types.ObjectId;

  @Prop({ type: Buffer, required: true })
  data!: Buffer;

  @Prop({ type: String, required: true, enum: ['image/jpeg', 'image/png'] })
  contentType!: string;

  @Prop({ type: Number, required: true, min: 1 })
  size!: number;

  declare createdAt: Date;
  declare updatedAt: Date;
}

export const PostImageSchema = SchemaFactory.createForClass(PostImage);
