import { ConflictException, Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AccountStatus } from '../common/enums/account-status.enum';
import { UserRole } from '../common/enums/user-role.enum';
import { User, UserDocument } from './schemas/user.schema';

interface CreateRegisteredUser {
  name: string;
  email: string;
  passwordHash: string;
  termsAcceptedAt: Date;
}

@Injectable()
export class UsersService implements OnModuleInit {
  constructor(@InjectModel(User.name) private readonly users: Model<User>) {}

  async onModuleInit(): Promise<void> {
    // Requests must not arrive before MongoDB enforces email uniqueness.
    await this.users.init();
  }

  async createRegisteredUser(input: CreateRegisteredUser): Promise<UserDocument> {
    try {
      return await this.users.create({
        name: input.name,
        email: input.email,
        passwordHash: input.passwordHash,
        termsAcceptedAt: input.termsAcceptedAt,
        role: UserRole.USER,
        status: AccountStatus.ACTIVE,
      });
    } catch (error: unknown) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 11000) {
        throw new ConflictException({
          message: 'Email is already registered',
          errors: { email: ['Email is already registered'] },
        });
      }
      throw error;
    }
  }
}
