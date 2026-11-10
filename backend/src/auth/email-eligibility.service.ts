import { ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientSession } from 'mongoose';
import { UsersService } from '../users/users.service';
import { readEmailVerificationRequired } from './email-verification.config';
@Injectable()
export class EmailEligibilityService {
  readonly required: boolean;
  constructor(private readonly users: UsersService, config: ConfigService) { this.required = readEmailVerificationRequired(config); }
  async canBook(userId: string, session?: ClientSession): Promise<boolean> { return !this.required || this.users.hasVerifiedEmail(userId, session); }
  async assertCanBook(userId: string, session?: ClientSession): Promise<void> {
    if (!await this.canBook(userId, session)) throw new ForbiddenException('Verify your email before booking');
  }
  /** Existing guarded HTTP creation/payment routes; no teammate controller is changed. */
  async assertHttpBookingAccess(method: string, path: string, userId: string): Promise<void> {
    if (!this.required || method.toUpperCase() !== 'POST') return;
    const route = path.toLowerCase().replace(/\/+$/, '');
    if (['/api/flight-bookings/hold', '/api/hotel-bookings', '/api/hotel-bookings/hold', '/api/payments'].includes(route) || /^\/api\/payments\/[^/]+\/retry$/.test(route)) await this.assertCanBook(userId);
  }
}
