import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { Airline, AirlineSchema } from './schemas/airline.schema';
import { AirlineAssetsController } from './airline-assets.controller';
import { AirlineLogoService } from './airline-logo.service';
import { AirlinesController } from './airlines.controller';
import { AirlinesService } from './airlines.service';

@Module({
  imports: [AuthModule, MongooseModule.forFeature([{ name: Airline.name, schema: AirlineSchema }])],
  controllers: [AirlinesController, AirlineAssetsController],
  providers: [AirlinesService, AirlineLogoService],
  exports: [AirlinesService],
})
export class AirlinesModule {}
