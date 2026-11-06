import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { City, CitySchema, Country, CountrySchema } from './reference.schemas';
import { ReferenceDataService } from './reference-data.service';
import { ReferenceDataController } from './reference-data.controller';

@Module({
  imports: [MongooseModule.forFeature([{ name: Country.name, schema: CountrySchema }, { name: City.name, schema: CitySchema }])],
  controllers: [ReferenceDataController], providers: [ReferenceDataService], exports: [ReferenceDataService],
})
export class ReferenceDataModule {}
