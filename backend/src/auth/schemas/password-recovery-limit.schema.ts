import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
@Schema({ timestamps: true, versionKey: false })
export class PasswordRecoveryLimit {
  @Prop({ type: String, required: true }) _id!: string;
  @Prop({ type: Number, required: true }) count!: number;
  @Prop({ type: Date, required: true }) expiresAt!: Date;
}
export const PasswordRecoveryLimitSchema = SchemaFactory.createForClass(PasswordRecoveryLimit);
PasswordRecoveryLimitSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'password_recovery_limits_expiry_ttl' });
