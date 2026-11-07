import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { AuditAction, AuditTargetType } from '../audit-log.enums';

export type AuditLogDocument = HydratedDocument<AuditLog>;

/** GEN-07: one append-only record per admin action. There is no update or delete endpoint. */
@Schema({ collection: 'auditlogs', timestamps: { createdAt: true, updatedAt: false }, versionKey: false })
export class AuditLog {
  declare _id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  adminId!: Types.ObjectId;

  @Prop({ type: String, enum: AuditAction, required: true })
  action!: AuditAction;

  @Prop({ type: String, enum: AuditTargetType, required: true })
  targetType!: AuditTargetType;

  @Prop({ type: Types.ObjectId, required: true })
  targetId!: Types.ObjectId;

  @Prop({ type: String, trim: true, maxlength: 500 })
  details?: string;

  declare createdAt: Date;
}

export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);
AuditLogSchema.index({ createdAt: -1, _id: -1 }, { name: 'auditlogs_newest_first' });
AuditLogSchema.index({ adminId: 1, createdAt: -1 }, { name: 'auditlogs_by_admin' });
AuditLogSchema.index({ targetType: 1, targetId: 1 }, { name: 'auditlogs_by_target' });
