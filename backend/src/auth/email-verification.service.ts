import { BadRequestException, HttpException, HttpStatus, Injectable, Logger, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { AccountStatus } from '../common/enums/account-status.enum';
import { readTrustedMailUrl } from '../mail/mail.config';
import { MailService } from '../mail/mail.service';
import { UsersService } from '../users/users.service';
import { AuthActionLimitsService } from './auth-action-limits.service';
import { AuthMailQueueService } from './auth-mail-queue.service';
import { createEmailToken, hashEmailToken, isDuplicateKey } from './auth-mail.util';
import { EmailEligibilityService } from './email-eligibility.service';
import { EmailVerificationRequestedDto, EmailVerificationStatusDto } from './dto/email-verification.dto';
import { EmailVerification } from './schemas/email-verification.schema';
export const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const MESSAGE = 'If verification is needed, a verification link will be sent.';
function verified(value: unknown): boolean { return value instanceof Date && Number.isFinite(value.getTime()); }
@Injectable()
export class EmailVerificationService implements OnModuleInit {
  private readonly logger = new Logger(EmailVerificationService.name);
  private readonly url?: string;
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(EmailVerification.name) private readonly proofs: Model<EmailVerification>,
    private readonly users: UsersService,
    private readonly mail: MailService,
    private readonly limits: AuthActionLimitsService,
    private readonly queue: AuthMailQueueService,
    private readonly eligibility: EmailEligibilityService,
    config: ConfigService,
  ) {
    this.url = readTrustedMailUrl(config, 'EMAIL_VERIFICATION_URL');
    if (this.eligibility.required && (!this.url || !this.mail.isConfigured())) throw new Error('Required email verification needs SMTP settings and EMAIL_VERIFICATION_URL');
  }
  async onModuleInit(): Promise<void> { await this.proofs.init(); }
  private ready(): boolean { return !!this.url && this.mail.isConfigured(); }
  private invalid(): BadRequestException { return new BadRequestException('Invalid or expired email verification link'); }
  async status(userId: string): Promise<EmailVerificationStatusDto> {
    const user = await this.users.findForEmailVerification(userId);
    return { emailVerified: verified(user?.emailVerifiedAt), requiredForBooking: this.eligibility.required };
  }
  async registered(userId: string, source: string): Promise<void> {
    if (!this.ready()) return;
    // Registration is already committed. Delivery failure must not turn that success into a misleading retry/collision.
    try { await this.request(userId, source); } catch { this.logger.error('Registration verification email could not be queued'); }
  }
  async request(userId: string, source: string): Promise<EmailVerificationRequestedDto> {
    if (!this.ready()) throw new ServiceUnavailableException('Email verification is not configured');
    await this.queue.schedule(async () => {
      if (!await this.limits.allow('verification-ip', source, 20) || !await this.limits.allow('verification-user', userId, 5)) return;
      const user = await this.users.findForEmailVerification(userId);
      if (!user || user.status !== AccountStatus.ACTIVE || verified(user.emailVerifiedAt)) return;
      const token = createEmailToken(), tokenHash = hashEmailToken(token), emailDigest = this.limits.digest('verify-email:' + user.email);
      const update = [{ $set: { userId: new Types.ObjectId(userId), emailDigest, tokenHash,
        expiresAt: { $add: ['$$NOW', EMAIL_VERIFICATION_TTL_MS] }, createdAt: { $ifNull: ['$createdAt', '$$NOW'] }, updatedAt: '$$NOW' } }];
      try { await this.proofs.updateOne({ userId: user._id }, update, { upsert: true, updatePipeline: true, timestamps: false }).exec(); }
      catch (error) { if (!isDuplicateKey(error)) throw error; await this.proofs.updateOne({ userId: user._id }, update, { updatePipeline: true, timestamps: false }).exec(); }
      return async () => {
        const current = await this.users.findForEmailVerification(userId);
        if (!current || current.status !== AccountStatus.ACTIVE || verified(current.emailVerifiedAt) || this.limits.digest('verify-email:' + current.email) !== emailDigest) return;
        if (!await this.proofs.exists({ userId: current._id, tokenHash, $expr: { $gt: ['$expiresAt', '$$NOW'] } })) return;
        const link = new URL(this.url!); link.hash = 'token=' + token;
        try { await this.mail.send({ to: current.email, subject: 'Verify your Travel Planning email', text: 'Verify your email using this link. It expires 24 hours after your request and can be used once. Only the newest requested link works.\n\n' + link.toString() + '\n\nThis does not log you in or change your password.' }); }
        catch { await this.proofs.deleteOne({ userId: current._id, tokenHash }).exec(); throw new Error('Email verification delivery failed'); }
      };
    });
    return { message: MESSAGE };
  }
  whenIdle(): Promise<void> { return this.queue.whenIdle(); }
  async verify(token: string, source: string): Promise<void> {
    if (!await this.limits.allow('verification-proof-ip', source, 20)) throw new HttpException('Too many verification attempts. Try again later.', HttpStatus.TOO_MANY_REQUESTS);
    const tokenHash = hashEmailToken(token);
    const proof = await this.proofs.findOne({ tokenHash, $expr: { $gt: ['$expiresAt', '$$NOW'] } }).select('+userId +emailDigest').exec();
    if (!proof) throw this.invalid();
    const user = await this.users.findForEmailVerification(proof.userId.toString());
    if (!user || user.status !== AccountStatus.ACTIVE || verified(user.emailVerifiedAt) || this.limits.digest('verify-email:' + user.email) !== proof.emailDigest) throw this.invalid();
    await this.connection.transaction(async (session) => {
      const removed = await this.proofs.deleteOne({ _id: proof._id, tokenHash, $expr: { $gt: ['$expiresAt', '$$NOW'] } }, { session }).exec();
      if (removed.deletedCount !== 1 || !await this.users.markEmailVerified(user._id.toString(), user.email, session)) throw this.invalid();
    });
  }
}
