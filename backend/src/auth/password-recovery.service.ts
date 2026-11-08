import { BadRequestException, HttpException, HttpStatus, Injectable, Logger, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { Connection, Model, Types } from 'mongoose';
import { AccountStatus } from '../common/enums/account-status.enum';
import { MailService } from '../mail/mail.service';
import { readPasswordResetUrl } from '../mail/mail.config';
import { UsersService } from '../users/users.service';
import { ForgotPasswordResponseDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { PasswordService } from './password.service';
import { PasswordReset } from './schemas/password-reset.schema';
import { PasswordRecoveryLimit } from './schemas/password-recovery-limit.schema';

export const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;
const WINDOW_MS = 15 * 60 * 1000;
const MAX_PENDING = 30;
const GENERIC_MESSAGE = 'If an eligible account exists, a password reset link will be sent.';
interface Delivery { email: string; emailDigest: string; token: string; tokenHash: string }
function duplicateKey(error: unknown): boolean { return typeof error === 'object' && error !== null && 'code' in error && error.code === 11000; }

@Injectable()
export class PasswordRecoveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PasswordRecoveryService.name);
  private readonly resetUrl?: string;
  private readonly digestSecret: string;
  private readonly queue: Delivery[] = [];
  private readonly active = new Set<Promise<void>>();
  private readonly idleWaiters: (() => void)[] = [];
  private reserved = 0;
  private closing = false;
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(PasswordReset.name) private readonly resets: Model<PasswordReset>,
    @InjectModel(PasswordRecoveryLimit.name) private readonly limits: Model<PasswordRecoveryLimit>,
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
    private readonly mail: MailService,
    config: ConfigService,
  ) {
    this.resetUrl = readPasswordResetUrl(config);
    this.digestSecret = config.getOrThrow<string>('JWT_SECRET');
  }
  async onModuleInit(): Promise<void> { await this.resets.init(); await this.limits.init(); }
  async onModuleDestroy(): Promise<void> {
    this.closing = true; this.queue.length = 0;
    await Promise.allSettled([...this.active]); this.notifyIdle();
  }
  private digest(value: string): string { return createHmac('sha256', this.digestSecret).update(value).digest('hex'); }
  private hash(token: string): string { return createHash('sha256').update(token).digest('hex'); }
  private invalidLink(): BadRequestException { return new BadRequestException('Invalid or expired password reset link'); }

  private async allow(scope: string, value: string, maximum: number): Promise<boolean> {
    const window = Math.floor(Date.now() / WINDOW_MS);
    const key = this.digest(scope + ':' + window + ':' + value);
    const update = { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date((window + 1) * WINDOW_MS) } };
    let row;
    try { row = await this.limits.findOneAndUpdate({ _id: key }, update, { upsert: true, returnDocument: 'after' }).exec(); }
    catch (error) {
      if (!duplicateKey(error)) throw error;
      row = await this.limits.findOneAndUpdate({ _id: key }, update, { returnDocument: 'after' }).exec();
    }
    return !!row && row.count <= maximum;
  }

  async request(email: string, source: string): Promise<ForgotPasswordResponseDto> {
    this.mail.assertConfigured();
    if (!this.resetUrl || this.closing || this.reserved + this.queue.length + this.active.size >= MAX_PENDING) {
      throw new ServiceUnavailableException('Password recovery is temporarily unavailable');
    }
    this.reserved++;
    try {
      if (!await this.allow('request-ip', source, 20) || !await this.allow('request-email', email, 5)) return { message: GENERIC_MESSAGE };
      const emailDigest = this.digest('email:' + email), token = randomBytes(32).toString('hex'), tokenHash = this.hash(token);
      // Same indexed operation for known and unknown addresses. No account lookup or SMTP work is on the HTTP response path.
      const update = [{ $set: {
        emailDigest, tokenHash, expiresAt: { $add: ['$$NOW', PASSWORD_RESET_TTL_MS] },
        userId: '$$REMOVE', credentialVersion: '$$REMOVE', issuedAt: '$$REMOVE',
        createdAt: { $ifNull: ['$createdAt', '$$NOW'] }, updatedAt: '$$NOW',
      } }];
      try { await this.resets.updateOne({ emailDigest }, update, { upsert: true, updatePipeline: true, timestamps: false }).exec(); }
      catch (error) {
        if (!duplicateKey(error)) throw error;
        await this.resets.updateOne({ emailDigest }, update, { updatePipeline: true, timestamps: false }).exec();
      }
      this.queue.push({ email, emailDigest, token, tokenHash });
      setImmediate(() => this.pump());
      return { message: GENERIC_MESSAGE };
    } finally { this.reserved--; }
  }
  private pump(): void {
    while (!this.closing && this.queue.length && this.active.size < 4) {
      const job = this.queue.shift()!;
      const running = this.deliver(job).catch(() => { this.logger.error('Password reset delivery failed'); }).finally(() => {
        this.active.delete(running); this.pump(); this.notifyIdle();
      });
      this.active.add(running);
    }
    this.notifyIdle();
  }
  private notifyIdle(): void {
    if (this.queue.length === 0 && this.active.size === 0) this.idleWaiters.splice(0).forEach((resolve) => resolve());
  }
  /** Internal shutdown/test synchronization; never exposes tokens or a delivery status over HTTP. */
  whenIdle(): Promise<void> {
    if (!this.queue.length && !this.active.size) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }
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
    if (!await this.allow('reset-ip', source, 20)) throw new HttpException('Too many password reset attempts. Try again later.', HttpStatus.TOO_MANY_REQUESTS);
    const tokenHash = this.hash(input.token);
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
