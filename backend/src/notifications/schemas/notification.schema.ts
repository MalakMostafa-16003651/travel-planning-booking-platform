import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { NotificationType } from '../notification-type.enum';

export type NotificationDocument = HydratedDocument<Notification>;

/** GEN-01: one in-app notification for one user. */
@Schema({ collection: 'notifications', timestamps: true, versionKey: false })
export class Notification {
  declare _id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId!: Types.ObjectId;

  @Prop({ type: String, enum: NotificationType, required: true })
  type!: NotificationType;

  @Prop({ type: String, required: true, trim: true, minlength: 1, maxlength: 500 })
  message!: string;

  @Prop({ type: Boolean, required: true, default: false })
  isRead!: boolean;

  @Prop({ type: Date, default: null })
  readAt!: Date | null;

  declare createdAt: Date;
  declare updatedAt: Date;
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);
NotificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 }, { name: 'notifications_inbox' });
