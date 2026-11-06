import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { SUPPORTED_CURRENCY_SEEDS } from './currency-seeds';
import { Currency } from './schemas/currency.schema';

@Injectable()
export class CurrenciesService implements OnModuleInit {
  constructor(@InjectModel(Currency.name) private readonly currencies: Model<Currency>) {}

  async onModuleInit(): Promise<void> {
    await this.currencies.init();
  }

  async listSupported(): Promise<Currency[]> {
    return this.currencies.find({ code: { $in: SUPPORTED_CURRENCY_SEEDS.map(({ code }) => code) } }).sort({ code: 1 }).exec();
  }

  async isSupported(code: string): Promise<boolean> {
    // Membership is exact. Do not let Mongoose's uppercase setter silently make
    // a noncanonical input match a different supplied code.
    if (typeof code !== 'string' || !SUPPORTED_CURRENCY_SEEDS.some((seed) => seed.code === code)) return false;
    return await this.currencies.exists({ code }).exec() !== null;
  }

  async seedSupported(): Promise<number> {
    // A setup command can call this explicitly; normal startup never seeds data.
    await this.currencies.init();
    let confirmed = 0;
    const insertedAt = new Date();
    for (const seed of SUPPORTED_CURRENCY_SEEDS) {
      const result = await this.currencies.updateOne(
        { code: seed.code },
        { $setOnInsert: { ...seed, createdAt: insertedAt, updatedAt: insertedAt } },
        { upsert: true, timestamps: false, runValidators: true },
      ).exec();
      if (!result.acknowledged || (result.matchedCount !== 1 && result.upsertedCount !== 1)) {
        throw new Error('Currency seed write was not confirmed');
      }
      confirmed++;
    }
    // Counts required codes confirmed present, including ones already seeded.
    // Existing names and additional currency rows are deliberately preserved.
    return confirmed;
  }
}
