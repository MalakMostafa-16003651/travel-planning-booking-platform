import { Inject, Injectable, Logger, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ITINERARY_CURRENCIES, ItineraryCurrenciesPort } from '../ports/itinerary-currencies.port';
import { ExchangeRate } from '../schemas/exchange-rate.schema';
import { FxRatesClient, FxRatesUnavailableError } from './fx-rates.client';

/** ITN-18: one successful snapshot per UTC calendar day; last cache survives outages. */
export const FX_CACHE_FRESH_MS = 24 * 60 * 60 * 1000;

export interface ConversionTable {
  baseCurrency: string;
  /** Multiply an amount in currency X by toBase[X] to get baseCurrency. */
  toBase: Map<string, number>;
  rateDate: Date | null;
  stale: boolean;
}

interface RateSnapshot {
  rates: Map<string, number>;
  rateDate: Date;
  stale: boolean;
  fromCache: boolean;
}

/** ITN-18: converts budget amounts into a display currency using FXRatesAPI. */
@Injectable()
export class ExchangeRatesService {
  private readonly logger = new Logger(ExchangeRatesService.name);
  private readonly pending = new Map<string, Promise<RateSnapshot>>();

  constructor(
    @InjectModel(ExchangeRate.name) private readonly rates: Model<ExchangeRate>,
    private readonly client: FxRatesClient,
    @Inject(ITINERARY_CURRENCIES) private readonly currencies: ItineraryCurrenciesPort,
  ) {}

  /**
   * Builds factors from every currency in `sources` to `target`.
   * 422 if the provider has no rate for a code; 503 if the provider fails with no usable cache.
   */
  async conversionTable(target: string, sources: Iterable<string>): Promise<ConversionTable> {
    const needed = [...new Set(sources)].filter((code) => code !== target);
    if (needed.length === 0) {
      return { baseCurrency: target, toBase: new Map([[target, 1]]), rateDate: null, stale: false };
    }

    let pending = this.pending.get(target);
    if (!pending) {
      pending = this.ratesFor(target).finally(() => { this.pending.delete(target); });
      this.pending.set(target, pending);
    }
    const snapshot = await pending;
    const missing = needed.filter((code) => !snapshot.rates.has(code));
    if (missing.length > 0) {
      throw new UnprocessableEntityException(`Exchange rate unavailable for ${missing.join(', ')} to ${target}`);
    }
    const toBase = new Map<string, number>([[target, 1]]);
    for (const code of needed) toBase.set(code, 1 / snapshot.rates.get(code)!);
    return { baseCurrency: target, toBase, rateDate: snapshot.rateDate, stale: snapshot.stale };
  }

  private async ratesFor(base: string): Promise<RateSnapshot> {
    const cached = await this.rates.findOne({ baseCurrency: base }).lean().exec();
    const today = new Date().toISOString().slice(0, 10);
    const freshToday = cached?.fetchedAt.toISOString().slice(0, 10) === today;
    if (cached && freshToday) {
      return { rates: toMap(cached.rates), rateDate: cached.rateDate, stale: false, fromCache: true };
    }

    try {
      const symbols = (await this.currencies.listSupported())
        .map(({ code }) => code)
        .filter((code) => code !== base);
      const fresh = await this.client.latest(base, symbols);
      await this.rates.updateOne(
        { baseCurrency: base },
        { $set: { rates: fresh.rates, rateDate: fresh.rateDate, fetchedAt: new Date() } },
        { upsert: true },
      ).exec();
      return { rates: new Map(Object.entries(fresh.rates)), rateDate: fresh.rateDate, stale: false, fromCache: false };
    } catch (error) {
      if (!(error instanceof FxRatesUnavailableError)) throw error;
      this.logger.warn(`FXRatesAPI request failed for base ${base}: ${error.message}`);
      if (cached) {
        return { rates: toMap(cached.rates), rateDate: cached.rateDate, stale: !freshToday, fromCache: true };
      }
      throw new ServiceUnavailableException('Exchange rates are temporarily unavailable. Try again later.');
    }
  }
}

function toMap(value: Map<string, number> | Record<string, number>): Map<string, number> {
  return value instanceof Map ? value : new Map(Object.entries(value));
}
