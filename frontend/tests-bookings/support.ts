import { expect, request as playwrightRequest, type Page } from '@playwright/test';

// Real Chrome, real Next proxy, real Nest app and transactions, on a disposable database.
// Payments go through the real endpoints and a signed webhook; only Stripe's network calls are faked.

export type Flight = { flightId: string; cabinId: string; date: string; flightNumber: string };
export type Account = { email: string; password: string };

export async function fixture<T = Record<string, never>>(control: string, query: Record<string, string | number> = {}): Promise<T> {
  const context = await playwrightRequest.newContext();
  const params = new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]));
  const response = await context.post(`http://127.0.0.1:3110/__m2-booking-fixture/${control}?${params}`, { headers: { 'X-M2-Booking-Fixture': 'flight-bookings' } });
  const body = await response.json();
  expect(response.status(), JSON.stringify(body)).toBe(200);
  await context.dispose();
  return body as T;
}

/** Calls the API as the page does: same origin, browser cookies, through the Next proxy. */
export async function api<T>(page: Page, method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> {
  return page.evaluate(async ([m, p, b]) => {
    const response = await fetch(`/api${p}`, { method: m as string, headers: b ? { 'Content-Type': 'application/json' } : {}, body: b ? JSON.stringify(b) : undefined });
    return { status: response.status, body: await response.json().catch(() => null) };
  }, [method, path, body] as const) as Promise<{ status: number; body: T }>;
}

export async function signIn(page: Page, account: Account) {
  await page.goto('/login');
  expect((await api(page, 'POST', '/auth/login', account)).status).toBe(200);
}

export async function newTraveler(page: Page, query: Record<string, string> = {}): Promise<Account> {
  const account = await fixture<Account>('user', query);
  await signIn(page, account);
  return account;
}

export function newBookingUrl(flights: Flight[], counts = { adults: 1, children: 0, infants: 0 }) {
  const selection = { segments: flights.map(({ flightId, cabinId }) => ({ flightId, cabinId })), ...counts };
  return `/bookings/flights/new?selection=${encodeURIComponent(JSON.stringify(selection))}`;
}

export const adult = { fullName: 'Nour Hassan', dateOfBirth: '1995-04-12', documentNumber: 'A12345678', type: 'ADULT' };

export async function hold(page: Page, flights: Flight[], passengers: unknown[] = [adult]): Promise<string> {
  const held = await api<{ flightBookingId: string }>(page, 'POST', '/flight-bookings/hold', { segments: flights.map(({ flightId, cabinId }) => ({ flightId, cabinId })), passengers });
  expect(held.status, JSON.stringify(held.body)).toBe(201);
  return held.body.flightBookingId;
}

export async function pay(page: Page, type: 'flight' | 'flight-change', id: string) {
  expect((await api(page, 'POST', `/bookings/${type}/${id}/accept-policies`, { accepted: true })).status).toBe(200);
  const started = await api<{ payment: { stripePaymentIntentId: string } }>(page, 'POST', '/payments', { bookingType: type, bookingId: id });
  expect(started.status, JSON.stringify(started.body)).toBe(201);
  expect((await fixture<{ status: number }>('paid', { intent: started.body.payment.stripePaymentIntentId })).status).toBe(200);
}

export async function confirmed(page: Page, flights: Flight[]): Promise<string> {
  const id = await hold(page, flights);
  await pay(page, 'flight', id);
  return id;
}

export async function fillTraveler(page: Page, group: string, values: { name: string; dob: string; document: string }) {
  const traveler = page.getByRole('group', { name: group, exact: true });
  await traveler.getByLabel('Full name').fill(values.name);
  await traveler.getByLabel('Date of birth').fill(values.dob);
  await traveler.getByLabel('Passport or ID number').fill(values.document);
}

export const nour = { name: 'Nour Hassan', dob: '1995-04-12', document: 'A12345678' };

export async function review(page: Page) {
  await page.getByRole('button', { name: 'Review trip' }).click();
  await expect(page.getByRole('heading', { name: 'Check your trip' })).toBeVisible();
}

/** Next briefly streams a hidden copy of the page outside <main>, so look only at what travelers see. */
export const main = (page: Page) => page.locator('#main-content');

export async function noSidewaysScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
}
