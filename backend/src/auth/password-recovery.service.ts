import { BadRequestException, HttpException, HttpStatus, Injectable, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import { AccountStatus } from '../common/enums/account-status.enum';
import { MailService } from '../mail/mail.service';
import { readPasswordResetUrl } from '../mail/mail.config';
import { UsersService } from '../users/users.service';
import { ForgotPasswordResponseDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { PasswordService } from './password.service';
import { PasswordReset } from './schemas/password-reset.schema';
import { AuthActionLimitsService } from './auth-action-limits.service';
import { AuthMailQueueService } from './auth-mail-queue.service';
import { createEmailToken, hashEmailToken, isDuplicateKey } from './auth-mail.util';

export const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;
const GENERIC_MESSAGE = 'If an eligible account exists, a password reset link will be sent.';
interface Delivery { email: string; emailDigest: string; token: string; tokenHash: string }

@Injectable()
export class PasswordRecoveryService implements OnModuleInit {
  private readonly resetUrl?: string;
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(PasswordReset.name) private readonly resets: Model<PasswordReset>,
    private readonly limits: AuthActionLimitsService,
    private readonly queue: AuthMailQueueService,
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
    private readonly mail: MailService,
    config: ConfigService,
  ) {
    this.resetUrl = readPasswordResetUrl(config);
  }
  async onModuleInit(): Promise<void> { await this.resets.init(); }
  private invalidLink(): BadRequestException { return new BadRequestException('Invalid or expired password reset link'); }

  async request(email: string, source: string): Promise<ForgotPasswordResponseDto> {
    this.mail.assertConfigured();
    if (!this.resetUrl) throw new ServiceUnavailableException('Password recovery is not configured');
    await this.queue.schedule(async () => {
      if (!await this.limits.allow('request-ip', source, 20) || !await this.limits.allow('request-email', email, 5)) return;
      const emailDigest = this.limits.digest('email:' + email), token = createEmailToken(), tokenHash = hashEmailToken(token);
      // Same indexed operation for known and unknown addresses. No account lookup or SMTP work is on the HTTP response path.
      const update = [{ $set: {
        emailDigest, tokenHash, expiresAt: { $add: ['$$NOW', PASSWORD_RESET_TTL_MS] },
        userId: '$$REMOVE', credentialVersion: '$$REMOVE', issuedAt: '$$REMOVE',
        createdAt: { $ifNull: ['$createdAt', '$$NOW'] }, updatedAt: '$$NOW',
      } }];
      try { await this.resets.updateOne({ emailDigest }, update, { upsert: true, updatePipeline: true, timestamps: false }).exec(); }
      catch (error) {
        if (!isDuplicateKey(error)) throw error;
        await this.resets.updateOne({ emailDigest }, update, { updatePipeline: true, timestamps: false }).exec();
      }
      return () => this.deliver({ email, emailDigest, token, tokenHash });
    });
    return { message: GENERIC_MESSAGE };
  }
  whenIdle(): Promise<void> { return this.queue.whenIdle(); }
  private async deliver(job: Delivery): Promise<void> {
    const user = await this.users.findForAuthentication(job.email);
    if (!user || user.status !== AccountStatus.ACTIVE) return;
    const version = user.credentialVersion ?? 0;
    if (!Number.isSafeInteger(version) || version < 0 || version >= Number.MAX_SAFE_INTEGER) return;
    const bound = await this.resets.updateOne({ emailDigest: job.emailDigest, tokenHash: job.tokenHash,
      $expr: { $gt: ['$expiresAt', '$$NOW'] },
    }, { $set: { userId: user._id, credentialVersion: version, issuedAt: new Date() } }).exec();
    if (bound.matchedCount !== 1) return; // A newer request already invalidated this queued job.
    const link = new URL(this.resetUrl!);
    link.hash = 'token=' + job.token; // Fragments are not sent in HTTP request URLs or Referer headers.
    try {
      await this.mail.send({ to: job.email, subject: 'Reset your Travel Planning password',
        text: 'Use this link to choose a new password. It expires 30 minutes after your request and can be used once. Only the newest requested link works.\n\n' + link.toString() + '\n\nIf you did not request this, you can ignore this email. Your password has not changed.' });
    } catch {
      // Never remove a newer request when an older delivery fails.
      await this.resets.deleteOne({ emailDigest: job.emailDigest, tokenHash: job.tokenHash }).exec();
      throw new Error('Password reset delivery failed');
    }
  }

  async reset(input: ResetPasswordDto, source: string): Promise<void> {
    if (!await this.limits.allow('reset-ip', source, 20)) throw new HttpException('Too many password reset attempts. Try again later.', HttpStatus.TOO_MANY_REQUESTS);
    const tokenHash = hashEmailToken(input.token);
    const reset = await this.resets.findOne({ tokenHash, issuedAt: { $exists: true }, $expr: { $gt: ['$expiresAt', '$$NOW'] } })
      .select('+userId +credentialVersion').exec();
    if (!reset?.userId || !Number.isSafeInteger(reset.credentialVersion)) throw this.invalidLink();
    const user = await this.users.findForPasswordChange(reset.userId.toString());
    if (!user || user.status !== AccountStatus.ACTIVE || (user.credentialVersion ?? 0) !== reset.credentialVersion) throw this.invalidLink();
    if (await this.passwords.verify(input.newPassword, user.passwordHash)) throw new BadRequestException('New password must be different from the current password');
    const passwordHash = await this.passwords.hash(input.newPassword);
    await this.connection.transaction(async (session) => {
      const consumed = await this.resets.deleteOne({ _id: reset._id, tokenHash, userId: user._id,
        credentialVersion: reset.credentialVersion, issuedAt: { $exists: true }, $expr: { $gt: ['$expiresAt', '$$NOW'] },
      }, { session }).exec();
      if (consumed.deletedCount !== 1) throw this.invalidLink();
      if (!await this.users.replacePassword(user._id.toString(), user.passwordHash, reset.credentialVersion!, passwordHash, user.mustChangePassword, session)) throw this.invalidLink();
    });
  }
}
