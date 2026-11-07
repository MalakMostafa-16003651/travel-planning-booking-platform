import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { ConfigService } from '@nestjs/config';
import { FxRatesClient, FxRatesUnavailableError } from '../src/itineraries/currency/fx-rates.client';

const realFetch = globalThis.fetch;

function respondWith(body: unknown, status = 200): void {
  globalThis.fetch = (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
}

describe('FxRatesClient (ITN-18 currency validation)', () => {
  const client = new FxRatesClient(new ConfigService({}));

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('keeps only requested codes with positive finite rates, normalised to upper case', async () => {
    respondWith({ success: true, base: 'USD', date: '2026-11-04', rates: { eur: 0.9, EGP: 50, CHF: 0.88, GBP: 0, JPY: 'x' } });
    const result = await client.latest('USD', ['EUR', 'EGP', 'GBP', 'JPY']);
    assert.deepEqual(result.rates, { EUR: 0.9, EGP: 50 });
  });

  it('rejects rates quoted against a different base currency', async () => {
    respondWith({ success: true, base: 'EUR', rates: { USD: 1.1 } });
    await assert.rejects(client.latest('USD', ['EUR']), FxRatesUnavailableError);
  });

  it('reports provider errors and bad responses as unavailable', async () => {
    respondWith({ success: false, error: 'invalid_base' });
    await assert.rejects(client.latest('USD', ['EUR']), FxRatesUnavailableError);
    respondWith({}, 500);
    await assert.rejects(client.latest('USD', ['EUR']), FxRatesUnavailableError);
    globalThis.fetch = (async () => { throw new TypeError('network down'); }) as typeof fetch;
    await assert.rejects(client.latest('USD', ['EUR']), FxRatesUnavailableError);
  });
});
