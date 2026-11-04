import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CurrenciesController } from './currencies.controller';
import { CurrenciesService } from './currencies.service';
import { Currency, CurrencySchema } from './schemas/currency.schema';

@Module({
  imports: [MongooseModule.forFeature([{ name: Currency.name, schema: CurrencySchema }])],
  controllers: [CurrenciesController],
  providers: [CurrenciesService],
  exports: [CurrenciesService],
})
export class CurrenciesModule {}
