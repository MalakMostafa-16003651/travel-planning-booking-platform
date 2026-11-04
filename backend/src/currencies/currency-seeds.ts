// Initial codes are the distinct currency values in the project's official
// Countries.csv reference, linked from project PDF section 5.1:
// https://docs.google.com/spreadsheets/d/1SlKUTRqlHuBJAMC-Z-QOZzSrzKpGHT_TgQUI5gVm-BA/edit?gid=2042930643
// Readable currency labels are maintained here for the shared catalog.
export const SUPPORTED_CURRENCY_SEEDS = [
  { code: 'AED', name: 'United Arab Emirates dirham' },
  { code: 'EGP', name: 'Egyptian pound' },
  { code: 'EUR', name: 'Euro' },
  { code: 'GBP', name: 'Pound sterling' },
  { code: 'JPY', name: 'Japanese yen' },
  { code: 'SAR', name: 'Saudi riyal' },
  { code: 'USD', name: 'US dollar' },
] as const;
