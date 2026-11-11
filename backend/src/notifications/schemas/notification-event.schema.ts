import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { NotificationType } from '../notification-type.enum';

export type NotificationEventDocument = HydratedDocument<NotificationEvent>;

/** Business transactions record their notification obligation before committing. */
@Schema({ timestamps: true, versionKey: false })
export class NotificationEvent {
  @Prop({ required: true, unique: true }) key!: string;
  @Prop({ type: Types.ObjectId, required: true }) userId!: Types.ObjectId;
  @Prop({ type: String, enum: NotificationType, required: true }) type!: NotificationType;
  @Prop({ required: true }) message!: string;
  declare createdAt: Date;
}

export const NotificationEventSchema = SchemaFactory.createForClass(NotificationEvent);
