import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { createHmac } from 'node:crypto';
import { Model } from 'mongoose';
import { isDuplicateKey } from './auth-mail.util';
import { PasswordRecoveryLimit } from './schemas/password-recovery-limit.schema';
const WINDOW_MS = 15 * 60 * 1000;
@Injectable()
export class AuthActionLimitsService implements OnModuleInit {
  private readonly secret: string;
  constructor(@InjectModel(PasswordRecoveryLimit.name) private readonly limits: Model<PasswordRecoveryLimit>, config: ConfigService) { this.secret = config.getOrThrow<string>('JWT_SECRET'); }
  async onModuleInit(): Promise<void> { await this.limits.init(); }
  digest(value: string): string { return createHmac('sha256', this.secret).update(value).digest('hex'); }
  async allow(scope: string, value: string, maximum: number): Promise<boolean> {
    const window = Math.floor(Date.now() / WINDOW_MS), key = this.digest(scope + ':' + window + ':' + value);
    const update = { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date((window + 1) * WINDOW_MS) } };
    let row;
    try { row = await this.limits.findOneAndUpdate({ _id: key }, update, { upsert: true, returnDocument: 'after' }).exec(); }
    catch (error) {
      if (!isDuplicateKey(error)) throw error;
      row = await this.limits.findOneAndUpdate({ _id: key }, update, { returnDocument: 'after' }).exec();
    }
    return !!row && row.count <= maximum;
  }
}
