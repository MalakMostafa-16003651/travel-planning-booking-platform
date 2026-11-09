import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { AuthSession } from '../auth/schemas/auth-session.schema';
import { EmailVerification } from '../auth/schemas/email-verification.schema';
import { PasswordReset } from '../auth/schemas/password-reset.schema';
import { FlightBookingsService } from '../flight-bookings/flight-bookings.service';
import { HotelBookingsService } from '../hotel-bookings/hotel-bookings.service';
import { UsersService } from './users.service';

@Injectable()
export class AccountDeactivationService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly users: UsersService,
    private readonly flights: FlightBookingsService,
    private readonly hotels: HotelBookingsService,
    @InjectModel(AuthSession.name) private readonly sessions: Model<AuthSession>,
    @InjectModel(PasswordReset.name) private readonly resets: Model<PasswordReset>,
    @InjectModel(EmailVerification.name) private readonly verifications: Model<EmailVerification>,
  ) {}

  async deactivate(userId: string, credentialVersion: number): Promise<void> {
    await this.connection.transaction(async session => {
      // First operation establishes the common write conflict with both NEW confirmation paths.
      await this.users.acquireBookingGate(userId, session);
      if (await this.flights.hasUpcomingConfirmedBookings(userId, session)
        || await this.hotels.hasUpcomingConfirmedBookings(userId, session))
        throw new ConflictException('Cancel your upcoming Confirmed bookings before deactivating your account');
      if (!await this.users.deactivateUnderBookingGate(userId, credentialVersion, session))
        throw new UnauthorizedException('Invalid or expired session');
      const owner = { userId: new Types.ObjectId(userId) };
      await this.sessions.updateMany({ ...owner, revokedAt: null },
        { $currentDate: { revokedAt: true, updatedAt: true } }, { session, timestamps: false }).exec();
      await this.resets.deleteMany(owner, { session }).exec();
      await this.verifications.deleteMany(owner, { session }).exec();
    });
  }
}