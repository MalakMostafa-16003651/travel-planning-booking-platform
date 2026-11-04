import { ConflictException, Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { FAILED_LOGIN_LIMIT, LOGIN_LOCKOUT_MS } from '../auth/auth.constants';
import { AccountStatus } from '../common/enums/account-status.enum';
import { UserRole } from '../common/enums/user-role.enum';
import { User, UserDocument } from './schemas/user.schema';

interface CreateRegisteredUser {
  name: string;
  email: string;
  passwordHash: string;
  termsAcceptedAt: Date;
}

function unlockedLoginFilter(userId: string, passwordHash: string) {
  return {
    _id: userId,
    passwordHash,
    status: AccountStatus.ACTIVE,
    // Evaluate the deadline at the database, not before an asynchronous password check.
    $expr: { $lte: [{ $ifNull: ['$lockedUntil', new Date(0)] }, '$$NOW'] },
  };
}

function incrementableCredentialVersion() {
  const version = { $ifNull: ['$credentialVersion', 0] };
  return {
    // Pipeline updates bypass schema validation. Reject malformed stored values
    // and reserve room for one exact integer increment; legacy missing means zero.
    $cond: [
      { $isNumber: version },
      {
        $and: [
          { $gte: [version, 0] },
          { $lt: [version, Number.MAX_SAFE_INTEGER] },
          { $eq: [version, { $trunc: version }] },
        ],
      },
      false,
    ],
  };
}

@Injectable()
export class UsersService implements OnModuleInit {
  constructor(@InjectModel(User.name) private readonly users: Model<User>) {}

  async onModuleInit(): Promise<void> {
    // Requests must not arrive before MongoDB enforces email uniqueness.
    await this.users.init();
  }

  async findForAuthentication(email: string): Promise<UserDocument | null> {
    // Sensitive fields are loaded only for the authentication service, never an API response.
    return this.users.findOne({ email: email.trim().toLowerCase() })
      .select('+passwordHash +mustChangePassword +credentialVersion +failedLoginAttempts +lockedUntil')
      .exec();
  }

  async findByIdForAuthentication(userId: string): Promise<UserDocument | null> {
    return this.users.findById(userId).select('+mustChangePassword +credentialVersion').exec();
  }

  async findForPasswordChange(userId: string): Promise<UserDocument | null> {
    return this.users.findById(userId)
      .select('+passwordHash +mustChangePassword +credentialVersion')
      .exec();
  }

  async isLoginLocked(userId: string, passwordHash: string): Promise<boolean> {
    const locked = await this.users.exists({
      _id: userId,
      passwordHash,
      status: AccountStatus.ACTIVE,
      $expr: { $gt: [{ $ifNull: ['$lockedUntil', new Date(0)] }, '$$NOW'] },
    }).exec();
    return locked !== null;
  }

  async recordFailedLogin(userId: string, passwordHash: string): Promise<boolean> {
    await this.users.updateOne(unlockedLoginFilter(userId, passwordHash), [
      {
        $set: {
          failedLoginAttempts: {
            $cond: [
              // The filter guarantees a non-null previous lock has already expired.
              { $ne: [{ $ifNull: ['$lockedUntil', null] }, null] },
              1,
              { $min: [FAILED_LOGIN_LIMIT, { $add: [{ $ifNull: ['$failedLoginAttempts', 0] }, 1] }] },
            ],
          },
          updatedAt: '$$NOW',
        },
      },
      {
        $set: {
          lockedUntil: {
            $cond: [
              { $gte: ['$failedLoginAttempts', FAILED_LOGIN_LIMIT] },
              { $add: ['$$NOW', LOGIN_LOCKOUT_MS] },
              null,
            ],
          },
        },
      },
    ], { updatePipeline: true, timestamps: false }).exec();
    // A separate read controls only the error text; access decisions use atomic predicates.
    return this.isLoginLocked(userId, passwordHash);
  }

  async resetFailedLoginAttempts(
    userId: string,
    passwordHash: string,
    credentialVersion = 0,
  ): Promise<UserDocument | null> {
    if (!Number.isSafeInteger(credentialVersion) || credentialVersion < 0) return null;
    const unlocked = unlockedLoginFilter(userId, passwordHash);
    return this.users.findOneAndUpdate(
      {
        ...unlocked,
        $expr: {
          $and: [
            unlocked.$expr,
            { $eq: [{ $ifNull: ['$credentialVersion', 0] }, credentialVersion] },
          ],
        },
      },
      [{ $set: { failedLoginAttempts: 0, lockedUntil: null, updatedAt: '$$NOW' } }],
      { updatePipeline: true, timestamps: false, returnDocument: 'after' },
    ).select('+mustChangePassword +credentialVersion').exec();
  }

  async replacePassword(
    userId: string,
    expectedHash: string,
    expectedVersion: number,
    newHash: string,
    expectedMustChangePassword: boolean,
  ): Promise<boolean> {
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0 || expectedVersion >= Number.MAX_SAFE_INTEGER) {
      return false;
    }
    const result = await this.users.updateOne(
      {
        _id: userId,
        passwordHash: expectedHash,
        status: AccountStatus.ACTIVE,
        mustChangePassword: expectedMustChangePassword,
        $expr: {
          $and: [
            { $eq: [{ $ifNull: ['$credentialVersion', 0] }, expectedVersion] },
            incrementableCredentialVersion(),
          ],
        },
      },
      [{
        $set: {
          passwordHash: { $literal: newHash },
          mustChangePassword: false,
          failedLoginAttempts: 0,
          lockedUntil: null,
          credentialVersion: { $add: [{ $ifNull: ['$credentialVersion', 0] }, 1] },
          updatedAt: '$$NOW',
        },
      }],
      { updatePipeline: true, timestamps: false, upsert: false },
    ).exec();
    return result.matchedCount === 1;
  }

  async setTemporaryPassword(userId: string, newHash: string): Promise<boolean> {
    const result = await this.users.updateOne(
      {
        _id: userId,
        role: { $in: [UserRole.USER, UserRole.AIRLINE_MODERATOR, UserRole.HOTEL_MODERATOR] },
        $expr: incrementableCredentialVersion(),
      },
      [{
        $set: {
          passwordHash: { $literal: newHash },
          mustChangePassword: true,
          failedLoginAttempts: 0,
          lockedUntil: null,
          credentialVersion: { $add: [{ $ifNull: ['$credentialVersion', 0] }, 1] },
          updatedAt: '$$NOW',
        },
      }],
      { updatePipeline: true, timestamps: false, upsert: false },
    ).exec();
    return result.matchedCount === 1;
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
