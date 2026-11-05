import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Airport, AirportSchema } from './schemas/airport.schema';
import { AirportsService } from './airports.service';

@Module({
  imports: [MongooseModule.forFeature([{ name: Airport.name, schema: AirportSchema }])],
  providers: [AirportsService],
  exports: [AirportsService],
})
export class AirportSeedModule {}
