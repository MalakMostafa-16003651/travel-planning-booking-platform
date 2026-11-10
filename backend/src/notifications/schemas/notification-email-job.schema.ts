import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { NotificationType } from '../notification-type.enum';

// Private delivery states, independent of public notification and payment enums.
export enum NotificationEmailStatus {
  PENDING = 'PENDING', PROCESSING = 'PROCESSING', SENT = 'SENT', FAILED = 'FAILED',
}
export enum NotificationEmailKind {
  NOTIFICATION = 'NOTIFICATION', MODERATOR_INVITATION = 'MODERATOR_INVITATION',
}

@Schema({ collection: 'notificationemailjobs', timestamps: true, versionKey: false })
export class NotificationEmailJob {
  declare _id: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'User', required: true }) userId!: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'Notification' }) notificationId?: Types.ObjectId;
  @Prop({ required: true, enum: NotificationEmailKind }) kind!: NotificationEmailKind;
  @Prop({ enum: NotificationType }) notificationType?: NotificationType;
  @Prop({ required: true, maxlength: 128 }) dedupeKey!: string;
  @Prop({ required: true, maxlength: 500 }) message!: string;
  @Prop({ required: true, enum: NotificationEmailStatus, default: NotificationEmailStatus.PENDING }) status!: NotificationEmailStatus;
  @Prop({ required: true, min: 0, default: 0 }) attempts!: number;
  @Prop({ required: true, default: Date.now }) availableAt!: Date;
  @Prop({ type: Date, default: null }) leaseUntil!: Date | null;
  @Prop({ type: String, default: null }) leaseToken!: string | null;
  @Prop({ type: Date, default: null }) sentAt!: Date | null;
  @Prop({ type: Date, default: null }) lastFailureAt!: Date | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}
export const NotificationEmailJobSchema = SchemaFactory.createForClass(NotificationEmailJob);
NotificationEmailJobSchema.index({ dedupeKey: 1 }, { unique: true, name: 'notification_email_dedupe' });
NotificationEmailJobSchema.index({ status: 1, availableAt: 1 }, { name: 'notification_email_pending' });
NotificationEmailJobSchema.index({ status: 1, leaseUntil: 1 }, { name: 'notification_email_recovery' });
