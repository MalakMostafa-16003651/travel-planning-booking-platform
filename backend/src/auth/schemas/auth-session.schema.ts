import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { User } from '../../users/schemas/user.schema';

export type AuthSessionDocument = HydratedDocument<AuthSession>;

@Schema({ timestamps: true, versionKey: false })
export class AuthSession {
  declare _id: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: User.name, required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ required: true, select: false })
  refreshTokenHash!: string;

  @Prop({ type: Date, required: true })
  lastActivityAt!: Date;

  @Prop({ type: Date, required: true })
  expiresAt!: Date;

  @Prop({ type: Date, default: null })
  revokedAt!: Date | null;

  declare createdAt: Date;
  declare updatedAt: Date;
}

export const AuthSessionSchema = SchemaFactory.createForClass(AuthSession);
AuthSessionSchema.index({ refreshTokenHash: 1 }, { unique: true, name: 'auth_sessions_refresh_hash_unique' });
AuthSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'auth_sessions_expiry_ttl' });
