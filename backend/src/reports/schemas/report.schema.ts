import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { ReportStatus, ReportTargetType } from '../report.enums';

export type ReportDocument = HydratedDocument<Report>;

/** GEN-09/GEN-10: one user's report about one item of content. */
@Schema({ collection: 'reports', timestamps: true, versionKey: false })
export class Report {
  declare _id: Types.ObjectId;

  /** The reporting user (team ownership naming). */
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId!: Types.ObjectId;

  @Prop({ type: String, enum: ReportTargetType, required: true })
  targetType!: ReportTargetType;

  @Prop({ type: Types.ObjectId, required: true })
  targetId!: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true, minlength: 5, maxlength: 500 })
  reason!: string;

  @Prop({ type: String, enum: ReportStatus, required: true, default: ReportStatus.OPEN })
  status!: ReportStatus;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  resolvedBy!: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  resolvedAt!: Date | null;

  declare createdAt: Date;
  declare updatedAt: Date;
}

export const ReportSchema = SchemaFactory.createForClass(Report);
// GEN-09: a user may report a particular item at most once, even under concurrent requests.
ReportSchema.index({ userId: 1, targetType: 1, targetId: 1 }, { unique: true, name: 'reports_once_per_user_and_item' });
ReportSchema.index({ status: 1, createdAt: -1 }, { name: 'reports_by_status' });
ReportSchema.index({ targetType: 1, targetId: 1, status: 1 }, { name: 'reports_by_target' });
