import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { AuthSession, AuthSessionSchema } from '../auth/schemas/auth-session.schema';
import { EmailVerification, EmailVerificationSchema } from '../auth/schemas/email-verification.schema';
import { PasswordReset, PasswordResetSchema } from '../auth/schemas/password-reset.schema';
import { FlightBookingsModule } from '../flight-bookings/flight-bookings.module';
import { HotelBookingsModule } from '../hotel-bookings/hotel-bookings.module';
import { AccountDeactivationController } from './account-deactivation.controller';
import { AccountDeactivationService } from './account-deactivation.service';
import { UsersModule } from './users.module';

/** Composition belongs here, keeping persistence-only UsersModule and AuthModule free of booking cycles. */
@Module({
  imports: [AuthModule, UsersModule, FlightBookingsModule, HotelBookingsModule,
    MongooseModule.forFeature([
      { name: AuthSession.name, schema: AuthSessionSchema },
      { name: PasswordReset.name, schema: PasswordResetSchema },
      { name: EmailVerification.name, schema: EmailVerificationSchema },
    ])],
  controllers: [AccountDeactivationController],
  providers: [AccountDeactivationService],
  exports: [AccountDeactivationService],
})
export class AccountDeactivationModule {}