import { Injectable, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { createHash, randomBytes } from 'node:crypto';
import { Model, Types } from 'mongoose';
import { AccountStatus } from '../common/enums/account-status.enum';
import { UserDocument } from '../users/schemas/user.schema';
import { UsersService } from '../users/users.service';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  PASSWORD_CHANGE_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_MS,
  SESSION_IDLE_TIMEOUT_MS,
} from './auth.constants';
import { AuthSession } from './schemas/auth-session.schema';

const JWT_ISSUER = 'travel-planning-booking-platform';
const JWT_AUDIENCE = 'travel-platform-api';
type SessionPurpose = 'access' | 'password-change';

function isObjectId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{24}$/i.test(value);
}

function invalidSession(): UnauthorizedException {
  return new UnauthorizedException('Invalid or expired session');
}

function isCredentialVersion(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

@Injectable()
export class AuthSessionsService implements OnModuleInit {
  constructor(
    @InjectModel(AuthSession.name) private readonly sessions: Model<AuthSession>,
    private readonly jwt: JwtService,
    private readonly users: UsersService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.sessions.init();
  }

  async create(userId: string, credentialVersion = 0): Promise<{ accessToken: string; refreshToken: string }> {
    const issued = await this.createPurpose(userId, credentialVersion, 'access');
    return { accessToken: issued.token, refreshToken: issued.refreshToken };
  }

  async createPasswordChange(userId: string, credentialVersion: number): Promise<string> {
    const issued = await this.createPurpose(userId, credentialVersion, 'password-change');
    return issued.token;
  }

  private async createPurpose(
    userId: string,
    credentialVersion: number,
    purpose: SessionPurpose,
  ): Promise<{ token: string; refreshToken: string }> {
    if (!isObjectId(userId) || !isCredentialVersion(credentialVersion)) throw invalidSession();
    await this.currentEligibleUser(userId, credentialVersion, purpose);

    const sessionId = new Types.ObjectId();
    const userObjectId = new Types.ObjectId(userId);
    const refreshToken = randomBytes(32).toString('base64url');
    const refreshTokenHash = createHash('sha256').update(refreshToken).digest('hex');
    const now = new Date();
    const lifetime = purpose === 'access' ? ACCESS_TOKEN_TTL_SECONDS : PASSWORD_CHANGE_TOKEN_TTL_SECONDS;
    const token = await this.jwt.signAsync(
      { sub: userObjectId.toHexString(), sid: sessionId.toHexString(), tokenUse: purpose },
      {
        algorithm: 'HS256',
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
        expiresIn: lifetime,
      },
    );

    await this.sessions.create({
      _id: sessionId,
      userId: userObjectId,
      refreshTokenHash,
      // Preserve the epoch verified with the password; never stamp a newer one.
      credentialVersion,
      lastActivityAt: now,
      expiresAt: new Date(now.getTime() + (purpose === 'access' ? REFRESH_TOKEN_TTL_MS : lifetime * 1000)),
      revokedAt: null,
    });

    // A reset during issuance must not produce a usable session or successful response.
    // A reset immediately after this check is still caught by authentication's epoch check.
    await this.currentEligibleUser(userId, credentialVersion, purpose);
    return { token, refreshToken };
  }

  async authenticate(accessToken: string): Promise<UserDocument> {
    return this.authenticatePurpose(accessToken, 'access');
  }

  async authenticatePasswordChange(passwordChangeToken: string): Promise<UserDocument> {
    return this.authenticatePurpose(passwordChangeToken, 'password-change');
  }

  private async currentEligibleUser(
    userId: string,
    credentialVersion: number,
    purpose: SessionPurpose,
  ): Promise<UserDocument> {
    const user = await this.users.findByIdForAuthentication(userId);
    if (
      !user ||
      !user.isSelected('credentialVersion') ||
      user.status !== AccountStatus.ACTIVE ||
      user.mustChangePassword !== (purpose === 'password-change') ||
      !isCredentialVersion(user.credentialVersion ?? 0) ||
      (user.credentialVersion ?? 0) !== credentialVersion
    ) {
      throw invalidSession();
    }
    return user;
  }

  private async authenticatePurpose(token: string, purpose: SessionPurpose): Promise<UserDocument> {
    const { userId, sessionId } = await this.readClaims(token, purpose);
    const user = await this.users.findByIdForAuthentication(userId);
    if (!user || !user.isSelected('credentialVersion')) throw invalidSession();
    const credentialVersion = user.credentialVersion ?? 0;
    if (!isCredentialVersion(credentialVersion)) throw invalidSession();
    // Ineligible accounts must not extend their sessions by sending rejected requests.
    if (user.status !== AccountStatus.ACTIVE || user.mustChangePassword !== (purpose === 'password-change')) {
      throw invalidSession();
    }

    // Validate and touch together. $max prevents an older concurrent request
    // from moving lastActivityAt backwards. Database time controls inactivity;
    // TTL deletion is only housekeeping, not authorization.
    const session = await this.sessions.findOneAndUpdate(
      {
        _id: new Types.ObjectId(sessionId),
        userId: new Types.ObjectId(userId),
        revokedAt: null,
        $expr: {
          $and: [
            // Legacy records without a stored epoch retain the original epoch zero.
            { $eq: [{ $ifNull: ['$credentialVersion', 0] }, credentialVersion] },
            { $gt: ['$expiresAt', '$$NOW'] },
            { $gt: ['$lastActivityAt', { $subtract: ['$$NOW', SESSION_IDLE_TIMEOUT_MS] }] },
          ],
        },
      },
      [{ $set: { lastActivityAt: { $max: ['$lastActivityAt', '$$NOW'] }, updatedAt: '$$NOW' } }],
      { updatePipeline: true, timestamps: false, returnDocument: 'after' },
    ).select('+credentialVersion').exec();
    if (!session || !session.isSelected('credentialVersion') || (session.credentialVersion ?? 0) !== credentialVersion) {
      throw invalidSession();
    }

    // Password/reset writes occur in another document. A second live read closes
    // the reset-between-account-read-and-session-touch window and returns fresh roles.
    return this.currentEligibleUser(userId, credentialVersion, purpose);
  }

  async logout(accessToken?: string, refreshToken?: string, passwordChangeToken?: string): Promise<void> {
    const targets: Array<
      { refreshTokenHash: string } | { _id: Types.ObjectId; userId: Types.ObjectId }
    > = [];

    // Opaque refresh credentials can identify a session even after access expiry.
    // Bound input before hashing; user IDs from request bodies are never accepted.
    if (typeof refreshToken === 'string' && /^[A-Za-z0-9_-]{43}$/.test(refreshToken)) {
      targets.push({ refreshTokenHash: createHash('sha256').update(refreshToken).digest('hex') });
    }
    const signedTokens = [[accessToken, 'access'], [passwordChangeToken, 'password-change']] as const;
    for (const [token, purpose] of signedTokens) {
      if (typeof token !== 'string' || token.length === 0) continue;
      try {
        const { userId, sessionId } = await this.readClaims(token, purpose);
        targets.push({ _id: new Types.ObjectId(sessionId), userId: new Types.ObjectId(userId) });
      } catch (error) {
        if (!(error instanceof UnauthorizedException)) throw error;
        // Invalid/expired cookies still get cleared; they cannot target another session.
      }
    }
    if (targets.length === 0) return;

    // Each exact match is revoked atomically. An idempotent retry handles a partial
    // multi-document failure; never report success or clear cookies on a DB error.
    await this.sessions.updateMany(
      { revokedAt: null, $or: targets },
      { $currentDate: { revokedAt: true, updatedAt: true } },
      { timestamps: false, upsert: false },
    ).exec();
  }

  private async readClaims(token: string, purpose: SessionPurpose): Promise<{ userId: string; sessionId: string }> {
    if (typeof token !== 'string' || token.length === 0 || token.length > 4096) throw invalidSession();
    const lifetime = purpose === 'access' ? ACCESS_TOKEN_TTL_SECONDS : PASSWORD_CHANGE_TOKEN_TTL_SECONDS;

    let payload: unknown;
    try {
      payload = await this.jwt.verifyAsync(token, {
        algorithms: ['HS256'],
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
        ignoreExpiration: false,
        maxAge: lifetime,
      });
    } catch {
      throw invalidSession();
    }

    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) throw invalidSession();
    const { sub, sid, tokenUse, iat, exp } = payload as Record<string, unknown>;
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (
      !isObjectId(sub) ||
      !isObjectId(sid) ||
      tokenUse !== purpose ||
      typeof iat !== 'number' || !Number.isSafeInteger(iat) || iat < 0 || iat > nowSeconds ||
      typeof exp !== 'number' || !Number.isSafeInteger(exp) || exp <= nowSeconds ||
      exp <= iat || exp > iat + lifetime
    ) throw invalidSession();

    return { userId: sub, sessionId: sid };
  }
}
