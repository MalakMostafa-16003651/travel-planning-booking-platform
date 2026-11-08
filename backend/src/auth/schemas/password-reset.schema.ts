import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongoSchema, Types } from 'mongoose';
@Schema({ timestamps: true, versionKey: false })
export class PasswordReset {
  declare _id: Types.ObjectId;
  @Prop({ required: true, select: false }) emailDigest!: string;
  @Prop({ required: true, select: false }) tokenHash!: string;
  @Prop({ type: MongoSchema.Types.ObjectId, select: false }) userId?: Types.ObjectId;
  @Prop({ type: Number, select: false }) credentialVersion?: number;
  @Prop({ type: Date }) issuedAt?: Date;
  @Prop({ type: Date, required: true }) expiresAt!: Date;
  declare createdAt: Date;
  declare updatedAt: Date;
}
export const PasswordResetSchema = SchemaFactory.createForClass(PasswordReset);
PasswordResetSchema.index({ emailDigest: 1 }, { unique: true, name: 'password_resets_email_digest_unique' });
PasswordResetSchema.index({ tokenHash: 1 }, { unique: true, name: 'password_resets_token_hash_unique' });
PasswordResetSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'password_resets_expiry_ttl' });
