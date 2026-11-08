import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongoSchema, Types } from 'mongoose';
@Schema({ timestamps: true, versionKey: false })
export class EmailVerification {
  declare _id: Types.ObjectId;
  @Prop({ type: MongoSchema.Types.ObjectId, required: true, select: false }) userId!: Types.ObjectId;
  @Prop({ required: true, select: false }) emailDigest!: string;
  @Prop({ required: true, select: false }) tokenHash!: string;
  @Prop({ type: Date, required: true }) expiresAt!: Date;
  declare createdAt: Date;
  declare updatedAt: Date;
}
export const EmailVerificationSchema = SchemaFactory.createForClass(EmailVerification);
EmailVerificationSchema.index({ userId: 1 }, { unique: true, name: 'email_verifications_user_unique' });
EmailVerificationSchema.index({ tokenHash: 1 }, { unique: true, name: 'email_verifications_hash_unique' });
EmailVerificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'email_verifications_expiry_ttl' });
