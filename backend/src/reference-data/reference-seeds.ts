// Official PDF section 5.1 reference, read 2026-11-06. Preserve source identifiers.
// Countries.csv gid=2042930643; Cities.csv gid=848448030:
// https://docs.google.com/spreadsheets/d/1SlKUTRqlHuBJAMC-Z-QOZzSrzKpGHT_TgQUI5gVm-BA/edit
export const COUNTRY_SEEDS = [
  { code: 'EG', name: 'Egypt', currency: 'EGP' },
  { code: 'AE', name: 'United Arab Emirates', currency: 'AED' },
  { code: 'GB', name: 'United Kingdom', currency: 'GBP' },
  { code: 'US', name: 'United States', currency: 'USD' },
  { code: 'FR', name: 'France', currency: 'EUR' },
  { code: 'DE', name: 'Germany', currency: 'EUR' },
  { code: 'JP', name: 'Japan', currency: 'JPY' },
  { code: 'SA', name: 'Saudi Arabia', currency: 'SAR' },
] as const;

export const CITY_SEEDS = [
  { cityId: 'cairo', name: 'Cairo', countryCode: 'EG' },
  { cityId: 'dubai', name: 'Dubai', countryCode: 'AE' },
  { cityId: 'london', name: 'London', countryCode: 'GB' },
  { cityId: 'new_york', name: 'New York', countryCode: 'US' },
  { cityId: 'paris', name: 'Paris', countryCode: 'FR' },
  { cityId: 'tokyo', name: 'Tokyo', countryCode: 'JP' },
  { cityId: 'riyadh', name: 'Riyadh', countryCode: 'SA' },
  { cityId: 'frankfurt', name: 'Frankfurt', countryCode: 'DE' },
] as const;
