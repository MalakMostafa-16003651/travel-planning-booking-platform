import { Transform } from 'class-transformer';

/** Trims strings; leaves other values for the validators to reject. */
export const Trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));

/** Trims and upper-cases strings (country and currency codes). */
export const TrimUpper = () => Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value));

export const TrimUpperEach = () => Transform(({ value }) => (
  Array.isArray(value) ? value.map((item) => (typeof item === 'string' ? item.trim().toUpperCase() : item)) : value
));

export const DATE_ONLY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
export const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d$/;
export const COUNTRY_CODE = /^[A-Z]{2}$/;
export const CURRENCY_CODE = /^[A-Z]{3}$/;
