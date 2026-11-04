import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { AccountStatus } from '../../common/enums/account-status.enum';
import { UserRole } from '../../common/enums/user-role.enum';

export type UserDocument = HydratedDocument<User>;

@Schema({ timestamps: true, versionKey: false })
export class User {
  declare _id: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ required: true, lowercase: true, trim: true })
  email!: string;

  @Prop({ required: true, select: false })
  passwordHash!: string;

  @Prop({
    type: Number,
    default: 0,
    min: 0,
    select: false,
    validate: { validator: Number.isSafeInteger, message: 'Credential version must be an integer' },
  })
  credentialVersion!: number;

  @Prop({ type: String })
  phoneNumber?: string;

  @Prop({ type: String })
  preferredCurrency?: string;

  @Prop({ type: String, enum: UserRole, default: UserRole.USER, required: true })
  role!: UserRole;

  @Prop({ type: String, enum: AccountStatus, default: AccountStatus.ACTIVE, required: true })
  status!: AccountStatus;

  @Prop({ default: false, select: false })
  mustChangePassword!: boolean;

  @Prop({ default: 0, min: 0, select: false })
  failedLoginAttempts!: number;

  @Prop({ type: Date, default: null, select: false })
  lockedUntil!: Date | null;

  @Prop({ type: Date, required: true, select: false })
  termsAcceptedAt!: Date;

  declare createdAt: Date;
  declare updatedAt: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);
UserSchema.index({ email: 1 }, { unique: true, name: 'users_email_unique' });
