import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface FxRatesResult {
  base: string;
  rateDate: Date;
  rates: Record<string, number>;
}

/** Raised for any provider failure; the message never contains the API key. */
export class FxRatesUnavailableError extends Error {}

const FXRATES_URL = 'https://api.fxratesapi.com/latest';
const TIMEOUT_MS = 5000;

/**
 * Thin HTTP client for FXRatesAPI (https://fxratesapi.com/docs). Called only from the
 * backend, so FXRATES_API_KEY never reaches the frontend. The key is sent as a bearer
 * header rather than a query parameter, so it does not appear in URLs or proxy logs.
 */
@Injectable()
export class FxRatesClient {
  constructor(private readonly config: ConfigService) {}

  async latest(base: string, symbols: string[]): Promise<FxRatesResult> {
    const apiKey = this.config.get<string>('FXRATES_API_KEY');
    const url = `${FXRATES_URL}?base=${encodeURIComponent(base)}&currencies=${symbols.map(encodeURIComponent).join(',')}&format=json`;
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Accept: 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new FxRatesUnavailableError('Exchange-rate provider unreachable');
    }
    if (!response.ok) throw new FxRatesUnavailableError(`Exchange-rate provider returned ${response.status}`);

    let body: { success?: boolean; base?: unknown; date?: unknown; rates?: unknown };
    try {
      body = await response.json() as typeof body;
    } catch {
      throw new FxRatesUnavailableError('Exchange-rate provider returned invalid JSON');
    }
    if (body.success === false || typeof body.rates !== 'object' || body.rates === null) {
      throw new FxRatesUnavailableError('Exchange-rate provider returned an error');
    }
    // Rates quoted against another base would silently produce wrong totals.
    if (typeof body.base === 'string' && body.base.trim().toUpperCase() !== base) {
      throw new FxRatesUnavailableError('Exchange-rate provider returned rates for a different base currency');
    }
    // Keep only the supported codes that were requested, with usable positive rates.
    const requested = new Set(symbols);
    const rates: Record<string, number> = {};
    for (const [code, value] of Object.entries(body.rates as Record<string, unknown>)) {
      const normalized = code.trim().toUpperCase();
      if (requested.has(normalized) && typeof value === 'number' && Number.isFinite(value) && value > 0) rates[normalized] = value;
    }
    const rateDate = typeof body.date === 'string' ? new Date(body.date) : new Date();
    return { base, rateDate: Number.isNaN(rateDate.getTime()) ? new Date() : rateDate, rates };
  }
}
