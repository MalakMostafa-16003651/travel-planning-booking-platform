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
  REFRESH_TOKEN_TTL_MS,
  SESSION_IDLE_TIMEOUT_MS,
} from './auth.constants';
import { AuthSession } from './schemas/auth-session.schema';

const JWT_ISSUER = 'travel-planning-booking-platform';
const JWT_AUDIENCE = 'travel-platform-api';

function isObjectId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{24}$/i.test(value);
}

function invalidSession(): UnauthorizedException {
  return new UnauthorizedException('Invalid or expired session');
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

  async create(userId: string): Promise<{ accessToken: string; refreshToken: string }> {
    if (!isObjectId(userId)) throw invalidSession();

    const sessionId = new Types.ObjectId();
    const userObjectId = new Types.ObjectId(userId);
    const refreshToken = randomBytes(32).toString('base64url');
    const refreshTokenHash = createHash('sha256').update(refreshToken).digest('hex');
    const now = new Date();
    const accessToken = await this.jwt.signAsync(
      { sub: userObjectId.toHexString(), sid: sessionId.toHexString(), tokenUse: 'access' },
      {
        algorithm: 'HS256',
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
        expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      },
    );

    await this.sessions.create({
      _id: sessionId,
      userId: userObjectId,
      refreshTokenHash,
      lastActivityAt: now,
      expiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_MS),
      revokedAt: null,
    });

    return { accessToken, refreshToken };
  }

  async authenticate(accessToken: string): Promise<UserDocument> {
    const { userId, sessionId } = await this.readAccessClaims(accessToken);
    const user = await this.users.findByIdForAuthentication(userId);
    if (!user || user.status !== AccountStatus.ACTIVE || user.mustChangePassword) {
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
            { $gt: ['$expiresAt', '$$NOW'] },
            { $gt: ['$lastActivityAt', { $subtract: ['$$NOW', SESSION_IDLE_TIMEOUT_MS] }] },
          ],
        },
      },
      [{ $set: { lastActivityAt: { $max: ['$lastActivityAt', '$$NOW'] }, updatedAt: '$$NOW' } }],
      { updatePipeline: true, timestamps: false, returnDocument: 'after' },
    ).exec();
    if (!session) throw invalidSession();

    return user;
  }

  async logout(accessToken?: string, refreshToken?: string): Promise<void> {
    const targets: Array<
      { refreshTokenHash: string } | { _id: Types.ObjectId; userId: Types.ObjectId }
    > = [];

    // Opaque refresh credentials can identify a session even after access expiry.
    // Bound input before hashing; user IDs from request bodies are never accepted.
    if (typeof refreshToken === 'string' && /^[A-Za-z0-9_-]{43}$/.test(refreshToken)) {
      targets.push({ refreshTokenHash: createHash('sha256').update(refreshToken).digest('hex') });
    }
    if (typeof accessToken === 'string' && accessToken.length > 0) {
      try {
        const { userId, sessionId } = await this.readAccessClaims(accessToken);
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

  private async readAccessClaims(accessToken: string): Promise<{ userId: string; sessionId: string }> {
    if (typeof accessToken !== 'string' || accessToken.length === 0 || accessToken.length > 4096) throw invalidSession();

    let payload: unknown;
    try {
      payload = await this.jwt.verifyAsync(accessToken, {
        algorithms: ['HS256'],
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
        ignoreExpiration: false,
        maxAge: ACCESS_TOKEN_TTL_SECONDS,
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
      tokenUse !== 'access' ||
      typeof iat !== 'number' || !Number.isSafeInteger(iat) || iat < 0 || iat > nowSeconds ||
      typeof exp !== 'number' || !Number.isSafeInteger(exp) || exp <= nowSeconds ||
      exp <= iat || exp > iat + ACCESS_TOKEN_TTL_SECONDS
    ) throw invalidSession();

    return { userId: sub, sessionId: sid };
  }
}
