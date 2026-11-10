import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { Airline, AirlineSchema } from '../airlines/schemas/airline.schema';
import { Hotel, HotelSchema } from '../hotels/schemas/hotel.schema';
import { Payment, PaymentSchema } from '../payments/schemas/payment.schema';
import { AdminAnalyticsController } from './admin-analytics.controller';
import { AdminAnalyticsService } from './admin-analytics.service';

/** BON-01: read-only reporting, with existing schemas and no changes to owner modules. */
@Module({ imports: [AuthModule, MongooseModule.forFeature([
  { name: Airline.name, schema: AirlineSchema }, { name: Hotel.name, schema: HotelSchema }, { name: Payment.name, schema: PaymentSchema },
])], controllers: [AdminAnalyticsController], providers: [AdminAnalyticsService] })
export class AdminAnalyticsModule {}
