import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { resolve } from 'node:path';
import { AuthModule } from './auth/auth.module';
import { validateEnvironment } from './config/validate-environment';
import { FlightBookingsModule } from './flight-bookings/flight-bookings.module';
import { ItinerariesModule } from './itineraries/itineraries.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: resolve(process.cwd(), '../.env'),
      validate: validateEnvironment,
    }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.getOrThrow<string>('MONGODB_URI'),
        serverSelectionTimeoutMS: 10000,
        retryAttempts: 1,
      }),
    }),
    AuthModule,
    FlightBookingsModule,
    ItinerariesModule,
  ],
})
export class AppModule {}
