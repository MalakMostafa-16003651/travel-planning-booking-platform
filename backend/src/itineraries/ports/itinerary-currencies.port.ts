export const ITINERARY_CURRENCIES = 'ITINERARY_CURRENCIES';

/** The shared currency catalog (CurrenciesService, PR #10). */
export interface ItineraryCurrenciesPort {
  listSupported(): Promise<string[]>;
  isSupported(code: string): Promise<boolean>;
}
