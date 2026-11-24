import { readFile } from 'node:fs/promises';
import { expect, request as playwrightRequest, test, type Page } from '@playwright/test';

// Real Chrome, real Next proxy, real Nest app and transactions, on a disposable database.
// Payments go through the real endpoints and a signed webhook; only Stripe's network calls are faked.

type Flight = { flightId: string; cabinId: string; date: string; flightNumber: string };
type Account = { email: string; password: string };

async function fixture<T = Record<string, never>>(control: string, query: Record<string, string | number> = {}): Promise<T> {
  const context = await playwrightRequest.newContext();
  const params = new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]));
  const response = await context.post(`http://127.0.0.1:3110/__m2-booking-fixture/${control}?${params}`, { headers: { 'X-M2-Booking-Fixture': 'flight-bookings' } });
  const body = await response.json();
  expect(response.status(), JSON.stringify(body)).toBe(200);
  await context.dispose();
  return body as T;
}

/** Calls the API as the page does: same origin, browser cookies, through the Next proxy. */
async function api<T>(page: Page, method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> {
  return page.evaluate(async ([m, p, b]) => {
    const response = await fetch(`/api${p}`, { method: m as string, headers: b ? { 'Content-Type': 'application/json' } : {}, body: b ? JSON.stringify(b) : undefined });
    return { status: response.status, body: await response.json().catch(() => null) };
  }, [method, path, body] as const) as Promise<{ status: number; body: T }>;
}

async function signIn(page: Page, account: Account) {
  await page.goto('/login');
  expect((await api(page, 'POST', '/auth/login', account)).status).toBe(200);
}

async function newTraveler(page: Page, query: Record<string, string> = {}): Promise<Account> {
  const account = await fixture<Account>('user', query);
  await signIn(page, account);
  return account;
}

function newBookingUrl(flights: Flight[], counts = { adults: 1, children: 0, infants: 0 }) {
  const selection = { segments: flights.map(({ flightId, cabinId }) => ({ flightId, cabinId })), ...counts };
  return `/bookings/flights/new?selection=${encodeURIComponent(JSON.stringify(selection))}`;
}

const adult = { fullName: 'Nour Hassan', dateOfBirth: '1995-04-12', documentNumber: 'A12345678', type: 'ADULT' };

async function hold(page: Page, flights: Flight[], passengers: unknown[] = [adult]): Promise<string> {
  const held = await api<{ flightBookingId: string }>(page, 'POST', '/flight-bookings/hold', { segments: flights.map(({ flightId, cabinId }) => ({ flightId, cabinId })), passengers });
  expect(held.status, JSON.stringify(held.body)).toBe(201);
  return held.body.flightBookingId;
}

async function pay(page: Page, type: 'flight' | 'flight-change', id: string) {
  expect((await api(page, 'POST', `/bookings/${type}/${id}/accept-policies`, { accepted: true })).status).toBe(200);
  const started = await api<{ payment: { stripePaymentIntentId: string } }>(page, 'POST', '/payments', { bookingType: type, bookingId: id });
  expect(started.status, JSON.stringify(started.body)).toBe(201);
  expect((await fixture<{ status: number }>('paid', { intent: started.body.payment.stripePaymentIntentId })).status).toBe(200);
}

async function confirmed(page: Page, flights: Flight[]): Promise<string> {
  const id = await hold(page, flights);
  await pay(page, 'flight', id);
  return id;
}

async function fillTraveler(page: Page, group: string, values: { name: string; dob: string; document: string }) {
  const traveler = page.getByRole('group', { name: group, exact: true });
  await traveler.getByLabel('Full name').fill(values.name);
  await traveler.getByLabel('Date of birth').fill(values.dob);
  await traveler.getByLabel('Passport or ID number').fill(values.document);
}

const nour = { name: 'Nour Hassan', dob: '1995-04-12', document: 'A12345678' };

async function review(page: Page) {
  await page.getByRole('button', { name: 'Review trip' }).click();
  await expect(page.getByRole('heading', { name: 'Check your trip' })).toBeVisible();
}

/** Next briefly streams a hidden copy of the page outside <main>, so look only at what travelers see. */
const main = (page: Page) => page.locator('#main-content');

async function noSidewaysScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
}

let pageErrors: string[] = [];
test.beforeEach(({ page }) => {
  pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && /hydrat|Minified React/i.test(message.text())) pageErrors.push(message.text()); });
});
test.afterEach(() => { expect(pageErrors).toEqual([]); });

test.describe('FLT-19, FLT-21 and FLT-22: booking and holding', () => {
  test('a guest signs in and returns to the same flights (ACC-10)', async ({ page }) => {
    const flight = await fixture<Flight>('flight');
    const account = await fixture<Account>('user');
    await page.goto(newBookingUrl([flight]));
    await expect(page).toHaveURL(/\/login\?/);
    await page.getByLabel('Email', { exact: true }).fill(account.email);
    await page.getByLabel('Password', { exact: true }).fill(account.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Who is travelling?' })).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Trip summary' })).toContainText('CAI to DXB');
  });

  test('shows field errors, then the server price, then one 10-minute hold that survives refresh', async ({ page }) => {
    const flight = await fixture<Flight>('flight');
    await newTraveler(page);
    await page.goto(newBookingUrl([flight], { adults: 1, children: 0, infants: 1 }));

    await page.getByRole('button', { name: 'Review trip' }).click();
    await expect(main(page).getByText('Enter the full name.', { exact: true })).toHaveCount(2);
    await expect(page.getByRole('group', { name: 'Adult 1' }).getByLabel('Full name')).toBeFocused();

    await fillTraveler(page, 'Adult 1', { ...nour, dob: '2020-01-01' });
    await fillTraveler(page, 'Infant 1', { name: 'Sami Hassan', dob: '2026-03-01', document: 'B7654321' });
    await page.getByRole('button', { name: 'Review trip' }).click();
    await expect(main(page).getByText('This traveler counts as child on the departure date.')).toBeVisible();

    const adultGroup = page.getByRole('group', { name: 'Adult 1' });
    await adultGroup.getByLabel('Date of birth').fill(nour.dob);
    await adultGroup.getByLabel('Extra bags').fill('2');
    await adultGroup.getByLabel('Total weight of extra bags (kg)').fill('60');
    await page.getByRole('button', { name: 'Review trip' }).click();
    await expect(main(page).getByText('At most 46 kg for 2 bags (23 kg each).')).toBeVisible();
    await adultGroup.getByLabel('Total weight of extra bags (kg)').fill('40');
    await review(page);

    // 150.00 adult + 15.00 infant (10%) + 2 bags at 30.00.
    const summary = page.getByRole('complementary', { name: 'Trip summary' });
    await expect(summary).toContainText('$225.00');
    await expect(summary).toContainText('We hold 1 seat for 10 minutes');

    await page.getByRole('button', { name: 'Edit' }).click();
    await expect(adultGroup.getByLabel('Full name')).toHaveValue('Nour Hassan');
    await review(page);

    await page.getByRole('button', { name: 'Hold seats and continue' }).click();
    await expect(page).toHaveURL(/\/bookings\/flights\/[0-9a-f]{24}$/);
    await expect(page.getByRole('timer')).toHaveText(/^(10:00|9:5\d)$/);
    await expect(page.getByRole('link', { name: /Continue to payment/ })).toHaveAttribute('href', /^\/checkout\/flight\/[0-9a-f]{24}$/);
    expect(await fixture('cabin', { id: flight.cabinId })).toEqual({ held: 1, booked: 0 });
    await page.reload();
    await expect(page.getByRole('timer')).toHaveText(/^9:\d\d$/);
    expect(await fixture('cabin', { id: flight.cabinId })).toEqual({ held: 1, booked: 0 });
  });

  test('a double click makes one hold, and an existing hold is offered instead of a second one', async ({ page }) => {
    const flight = await fixture<Flight>('flight');
    await newTraveler(page);
    await page.goto(newBookingUrl([flight]));
    await fillTraveler(page, 'Adult 1', nour);
    await review(page);
    await page.getByRole('button', { name: 'Hold seats and continue' }).dblclick();
    await expect(page.getByRole('timer')).toBeVisible();
    expect(await fixture('cabin', { id: flight.cabinId })).toEqual({ held: 1, booked: 0 });
    await page.goto(newBookingUrl([flight]));
    await expect(main(page).getByText('You already hold seats on this flight.')).toBeVisible();
    await page.getByRole('link', { name: 'Continue that booking' }).click();
    await expect(page.getByRole('timer')).toBeVisible();
  });

  test('a lost answer finds the hold that was made instead of making another', async ({ page }) => {
    const flight = await fixture<Flight>('flight');
    await newTraveler(page);
    await page.goto(newBookingUrl([flight]));
    await fillTraveler(page, 'Adult 1', nour);
    await review(page);
    await page.route('**/api/flight-bookings/hold', async route => { await route.fetch(); await route.abort('connectionreset'); });
    await page.getByRole('button', { name: 'Hold seats and continue' }).click();
    await expect(page.getByRole('timer')).toBeVisible();
    expect(await fixture('cabin', { id: flight.cabinId })).toEqual({ held: 1, booked: 0 });
  });

  test('losing the last seat is explained and holds nothing', async ({ page, browser }) => {
    const flight = await fixture<Flight>('flight', { seats: 1 });
    await newTraveler(page);
    await page.goto(newBookingUrl([flight]));
    await fillTraveler(page, 'Adult 1', nour);
    await review(page);
    const rival = await (await browser.newContext()).newPage();
    await newTraveler(rival);
    await hold(rival, [flight]);
    await rival.context().close();

    await page.getByRole('button', { name: 'Hold seats and continue' }).click();
    await expect(main(page).getByText('Not enough seats are available on this flight')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Choose other flights' })).toBeVisible();
    expect(await fixture('cabin', { id: flight.cabinId })).toEqual({ held: 1, booked: 0 });
  });

  test('the hold ends on screen when the server deadline passes, and the booking becomes Expired', async ({ page }) => {
    const flight = await fixture<Flight>('flight');
    await newTraveler(page);
    const id = await hold(page, [flight]);
    await fixture('hold-ends', { booking: id, seconds: 6 });
    await page.goto(`/bookings/flights/${id}`);
    await expect(page.getByRole('timer')).toBeVisible();
    await expect(page.getByRole('link', { name: /Continue to payment/ })).toHaveCount(0, { timeout: 12_000 });
    await expect(main(page).getByText('This booking was not paid in time')).toBeVisible();
    await fixture('sweep');
    expect(await fixture('cabin', { id: flight.cabinId })).toEqual({ held: 0, booked: 0 });
    await page.goto('/bookings/flights?group=CANCELLED');
    await expect(main(page).getByText('Expired', { exact: true })).toBeVisible();
  });

  test('a session that ends mid-form keeps what was typed', async ({ page }) => {
    const flight = await fixture<Flight>('flight');
    const account = await newTraveler(page);
    await page.goto(newBookingUrl([flight]));
    await fillTraveler(page, 'Adult 1', nour);
    await fixture('end-sessions', { email: account.email });
    await page.getByRole('button', { name: 'Review trip' }).click();
    await expect(main(page).getByText('Your session has ended').first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Sign in (opens in a new tab)' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Adult 1' }).getByLabel('Full name')).toHaveValue('Nour Hassan');
  });

  test('an unverified email stops the hold (ACC-02)', async ({ page }) => {
    const flight = await fixture<Flight>('flight');
    await newTraveler(page, { verified: 'false' });
    await page.goto(newBookingUrl([flight]));
    await fillTraveler(page, 'Adult 1', nour);
    await review(page);
    await expect(main(page).getByText('Verify your email before booking.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Hold seats and continue' })).toHaveCount(0);
  });

  test('broken selections, other roles and other travelers’ bookings are refused', async ({ page, browser }) => {
    const flight = await fixture<Flight>('flight');
    await newTraveler(page);
    for (const selection of ['', 'nonsense', '{"segments":[],"adults":1}', JSON.stringify({ segments: [{ flightId: 'x', cabinId: 'y' }], adults: 1 }), JSON.stringify({ segments: [flight], adults: 1, infants: 2 })]) {
      await page.goto(`/bookings/flights/new?selection=${encodeURIComponent(selection)}`);
      await expect(main(page).getByText('Choose your flight first')).toBeVisible();
    }
    const id = await hold(page, [flight]);

    const other = await (await browser.newContext()).newPage();
    await newTraveler(other);
    for (const path of ['', '/ticket', '/change']) {
      await other.goto(`/bookings/flights/${id}${path}`);
      await expect(other.getByRole('heading', { name: 'Booking not found' })).toBeVisible();
    }
    await other.goto('/bookings/flights/not-an-id');
    await expect(other.getByRole('heading', { name: 'Booking not found' })).toBeVisible();
    await other.context().close();

    const moderator = await (await browser.newContext()).newPage();
    await newTraveler(moderator, { role: 'AIRLINE_MODERATOR' });
    for (const path of ['/bookings', '/bookings/flights', newBookingUrl([flight]), `/bookings/flights/${id}`]) {
      await moderator.goto(path);
      await expect(moderator.getByRole('heading', { name: 'Access denied' })).toBeVisible();
    }
    await moderator.context().close();

    const guest = await (await browser.newContext()).newPage();
    await guest.goto(`/bookings/flights/${id}`);
    await expect(guest).toHaveURL(/\/login\?returnTo=/);
    await guest.context().close();
  });
});

test.describe('FLT-23 and FLT-25: ticket and lists', () => {
  test('confirms only after the signed webhook, then offers the PDF and calendar', async ({ page }) => {
    const outbound = await fixture<Flight>('flight', { days: 30 });
    const inbound = await fixture<Flight>('flight', { from: 'DXB', to: 'CAI', days: 37 });
    await newTraveler(page);
    const id = await hold(page, [outbound, inbound]);
    await page.goto(`/bookings/flights/${id}/ticket`);
    await expect(page.getByRole('heading', { name: 'Almost there' })).toBeVisible();
    await expect(main(page).getByText('You’re booked.')).toHaveCount(0);

    await pay(page, 'flight', id);
    // No reload: the page picks up the server's status by itself.
    await expect(page.getByRole('heading', { name: 'You’re booked.' })).toBeVisible();
    await expect(main(page).getByText(/^[A-Z2-9]{8}$/)).toBeVisible();
    await expect(page.getByRole('article', { name: /Outbound flight .* Cairo to Dubai/ })).toBeVisible();
    await expect(page.getByRole('article', { name: /Return flight .* Dubai to Cairo/ })).toBeVisible();
    expect(await fixture('cabin', { id: outbound.cabinId })).toEqual({ held: 0, booked: 1 });
    expect(await fixture('cabin', { id: inbound.cabinId })).toEqual({ held: 0, booked: 1 });

    const pdf = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download e-ticket (PDF)' }).click();
    const ticket = await pdf;
    expect(ticket.suggestedFilename()).toMatch(/^e-ticket-[A-Z2-9]{8}\.pdf$/);
    expect((await readFile(await ticket.path())).subarray(0, 5).toString()).toBe('%PDF-');

    const ics = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Add to calendar' }).click();
    const calendar = (await readFile(await (await ics).path())).toString();
    expect(calendar.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(calendar).toContain(`SUMMARY:Flight ${outbound.flightNumber}: CAI to DXB`);

    // GEN-06: 08:00 UTC is 10:00 in Cairo and 15:30 on arrival in Dubai.
    const article = page.getByRole('article', { name: /Outbound flight/ });
    await expect(article).toContainText('10:00');
    await expect(article).toContainText('15:30');
  });

  test('groups bookings, keeps the group and page in the URL, and pages by ten', async ({ page }) => {
    const flight = await fixture<Flight>('flight', { seats: 30 });
    await newTraveler(page);
    await page.goto('/bookings/flights');
    await expect(main(page).getByText('No upcoming flights')).toBeVisible();
    const id = await confirmed(page, [flight]);
    await fixture('copies', { booking: id, count: 11 });

    await page.goto('/bookings/flights');
    await expect(main(page).getByText('12 bookings')).toBeVisible();
    await expect(page.getByRole('article')).toHaveCount(10);
    await page.getByRole('link', { name: 'Next', exact: true }).click();
    await expect(page).toHaveURL(/group=UPCOMING&page=2/);
    await expect(page.getByRole('article')).toHaveCount(2);
    await page.reload();
    await expect(page.getByRole('article')).toHaveCount(2);
    await page.getByRole('navigation', { name: 'Booking groups' }).getByRole('link', { name: 'Past' }).click();
    await expect(main(page).getByText('No past flights yet')).toBeVisible();
    await page.goto('/bookings/flights?group=UPCOMING&page=99');
    await expect(main(page).getByText('This page is empty')).toBeVisible();

    await page.goto('/bookings');
    await expect(page.getByRole('heading', { name: 'Next flight' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Flight bookings by group' })).toContainText('12');
  });
});

test.describe('FLT-26: cancellation', () => {
  test('shows the refund first, cancels the whole trip once and follows the refund', async ({ page }) => {
    const outbound = await fixture<Flight>('flight', { days: 10 });
    const inbound = await fixture<Flight>('flight', { from: 'DXB', to: 'CAI', days: 17 });
    await newTraveler(page);
    const id = await confirmed(page, [outbound, inbound]);
    await page.goto(`/bookings/flights/${id}`);
    await page.getByRole('button', { name: 'Check my refund' }).click();
    await expect(main(page).getByText('50% of $300.00')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel booking' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('You get $150.00 back');
    await dialog.getByRole('button', { name: 'Keep booking' }).click();
    await expect(dialog).toBeHidden();
    expect(await fixture('cabin', { id: outbound.cabinId })).toEqual({ held: 0, booked: 1 });

    await page.getByRole('button', { name: 'Cancel booking' }).click();
    await page.getByRole('button', { name: 'Yes, cancel booking' }).click();
    await expect(main(page).getByText('Refund pending')).toBeVisible();
    await expect(page.getByRole('button', { name: /Cancel booking|Check my refund/ })).toHaveCount(0);
    expect(await fixture('cabin', { id: outbound.cabinId })).toEqual({ held: 0, booked: 0 });
    expect(await fixture('cabin', { id: inbound.cabinId })).toEqual({ held: 0, booked: 0 });
    await fixture('refunded', { booking: id });
    await page.reload();
    await expect(main(page).getByText('Refunded', { exact: true })).toBeVisible();
    await page.goto(`/bookings/flights/${id}/ticket`);
    await expect(main(page).getByText('This booking was cancelled, so its ticket is no longer valid.')).toBeVisible();
  });

  test('is refused once the flight has departed while the page was open', async ({ page }) => {
    const flight = await fixture<Flight>('flight', { days: 2 });
    await newTraveler(page);
    const id = await confirmed(page, [flight]);
    await page.goto(`/bookings/flights/${id}`);
    await page.getByRole('button', { name: 'Check my refund' }).click();
    await expect(page.getByRole('button', { name: 'Cancel booking' })).toBeVisible();
    await fixture('departs', { flight: flight.flightId });
    await page.getByRole('button', { name: 'Cancel booking' }).click();
    await page.getByRole('button', { name: 'Yes, cancel booking' }).click();
    await expect(page.getByRole('dialog')).toContainText('A booking cannot be cancelled after departure');
    expect(await fixture('cabin', { id: flight.cabinId })).toEqual({ held: 0, booked: 1 });
    await page.reload();
    await expect(page.getByRole('button', { name: 'Check my refund' })).toHaveCount(0);
  });
});

test.describe('FLT-27: changing a flight', () => {
  async function openChange(page: Page, price: number) {
    const current = await fixture<Flight>('flight', { days: 30 });
    const next = await fixture<Flight>('flight', { days: 33, hour: 11, price });
    const other = await fixture<Flight>('flight', { days: 33, hour: 13, cabinClass: 'BUSINESS', price: 90000 });
    await newTraveler(page);
    const id = await confirmed(page, [current]);
    await page.goto(`/bookings/flights/${id}/change`);
    await main(page).getByLabel('New date from Cairo').fill(next.date);
    await page.getByRole('button', { name: 'Find flights' }).click();
    await expect(page.getByRole('button', { name: `Choose ${next.flightNumber}` })).toBeVisible();
    await expect(page.getByRole('button', { name: `Choose ${other.flightNumber}` })).toHaveCount(0); // Same cabin only.
    await page.getByRole('button', { name: `Choose ${next.flightNumber}` }).click();
    await page.getByRole('button', { name: 'Hold and see the difference' }).click();
    await expect(page.getByRole('heading', { name: 'Review the change' })).toBeVisible();
    const changeId = new URL(page.url()).searchParams.get('change')!;
    return { id, current, next, changeId };
  }

  test('equal fare: policies must be accepted, the reference stays and seats move', async ({ page }) => {
    const { id, current, next } = await openChange(page, 15000);
    const before = (await api<{ bookingReference: string }>(page, 'GET', `/flight-bookings/${id}`)).body.bookingReference;
    expect(await fixture('cabin', { id: next.cabinId })).toEqual({ held: 1, booked: 0 });
    await page.reload();
    await expect(page.getByRole('timer')).toBeVisible();
    await expect(main(page).getByText('Nothing to pay')).toBeVisible();
    await page.getByRole('button', { name: 'Confirm change' }).click();
    await expect(main(page).getByText('Accept the new flight’s policies to continue.')).toBeVisible();
    expect(await fixture('cabin', { id: current.cabinId })).toEqual({ held: 0, booked: 1 });
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Confirm change' }).click();
    await expect(page.getByRole('heading', { name: 'Your flight is changed' })).toBeVisible();
    await expect(main(page).getByText(`Your booking reference stays ${before}`)).toBeVisible();
    expect(await fixture('cabin', { id: current.cabinId })).toEqual({ held: 0, booked: 0 });
    expect(await fixture('cabin', { id: next.cabinId })).toEqual({ held: 0, booked: 1 });
    await page.getByRole('link', { name: 'View your new ticket' }).click();
    await expect(page.getByRole('article', { name: new RegExp(next.flightNumber) })).toBeVisible();
    await expect(main(page).getByText(before, { exact: true })).toBeVisible();
  });

  test('higher fare: goes to checkout, and the old flight is kept until the payment is verified', async ({ page }) => {
    const { id, current, next, changeId } = await openChange(page, 21000);
    await expect(page.getByRole('complementary', { name: 'Fare difference' })).toContainText('$60.00');
    await expect(page.getByRole('link', { name: 'Pay the difference' })).toHaveAttribute('href', `/checkout/flight-change/${changeId}`);
    expect(await fixture('cabin', { id: current.cabinId })).toEqual({ held: 0, booked: 1 });
    await pay(page, 'flight-change', changeId);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Your flight is changed' })).toBeVisible();
    expect(await fixture('cabin', { id: next.cabinId })).toEqual({ held: 0, booked: 1 });
    await page.goto(`/bookings/flights/${id}`);
    await expect(main(page).getByText(next.flightNumber).first()).toBeVisible();
  });

  test('lower fare: the difference is refunded', async ({ page }) => {
    await openChange(page, 9000);
    const difference = page.getByRole('complementary', { name: 'Fare difference' });
    await expect(difference).toContainText('To be refunded');
    await expect(difference).toContainText('$60.00');
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Confirm change' }).click();
    await expect(main(page).getByText('Refund pending')).toBeVisible();
  });

  test('released or expired replacements leave the original booking untouched', async ({ page }) => {
    const { id, current, next, changeId } = await openChange(page, 15000);
    await page.getByRole('button', { name: 'Release new seats' }).click();
    await page.getByRole('button', { name: 'Yes, release them' }).click();
    await expect(page.getByRole('heading', { name: 'This change has ended' })).toBeVisible();
    expect(await fixture('cabin', { id: next.cabinId })).toEqual({ held: 0, booked: 0 });
    expect(await fixture('cabin', { id: current.cabinId })).toEqual({ held: 0, booked: 1 });

    const again = await api<{ flightBookingChangeId: string }>(page, 'POST', `/flight-bookings/${id}/changes`, { segments: [{ flightId: next.flightId, cabinId: next.cabinId }] });
    expect(again.status).toBe(201);
    expect(again.body.flightBookingChangeId).not.toBe(changeId);
    await fixture('hold-ends', { change: again.body.flightBookingChangeId });
    await page.goto(`/bookings/flights/${id}/change?change=${again.body.flightBookingChangeId}`);
    await expect(page.getByRole('heading', { name: 'This change has ended' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Confirm change' })).toHaveCount(0);
    expect(await fixture('cabin', { id: current.cabinId })).toEqual({ held: 0, booked: 1 });
  });
});

test.describe('Layout, GEN-16', () => {
  for (const width of [360, 768, 1024, 1440]) {
    test(`fits at ${width} pixels`, async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width, height: 900 });
      const outbound = await fixture<Flight>('flight', { days: 30 });
      const inbound = await fixture<Flight>('flight', { from: 'DXB', to: 'CAI', days: 37 });
      const another = await fixture<Flight>('flight', { days: 33, price: 21000 });
      await newTraveler(page);
      const shot = async (name: string) => {
        await noSidewaysScroll(page);
        await page.screenshot({ path: `test-results/bookings-screens/${name}-${width}.png`, fullPage: true });
      };

      await page.goto(newBookingUrl([outbound, inbound], { adults: 1, children: 1, infants: 0 }));
      await page.getByRole('button', { name: 'Review trip' }).click();
      await expect(main(page).getByText('Enter the date of birth.').first()).toBeVisible();
      await shot('1-travelers-errors');
      await fillTraveler(page, 'Adult 1', nour);
      await fillTraveler(page, 'Child 1', { name: 'Layla Hassan-Abdelrahman', dob: '2019-06-01', document: 'C99887766' });
      await review(page);
      await shot('2-review');
      await page.getByRole('button', { name: 'Hold seats and continue' }).click();
      await expect(page.getByRole('timer')).toBeVisible();
      await shot('3-hold');
      const id = page.url().split('/').pop()!;
      await pay(page, 'flight', id);
      await page.goto(`/bookings/flights/${id}/ticket`);
      await expect(page.getByRole('heading', { name: 'You’re booked.' })).toBeVisible();
      await shot('4-ticket');
      await page.goto(`/bookings/flights/${id}`);
      await page.getByRole('button', { name: 'Check my refund' }).click();
      await expect(main(page).getByText(/% of \$/)).toBeVisible();
      await shot('5-booking');
      await page.goto('/bookings/flights');
      await shot('6-list');
      await page.goto('/bookings');
      await shot('7-hub');
      await page.goto(`/bookings/flights/${id}/change`);
      await main(page).getByLabel('New date from Cairo').fill(another.date);
      await main(page).getByRole('region', { name: 'Outbound' }).getByRole('button', { name: 'Find flights' }).click();
      await page.getByRole('button', { name: `Choose ${another.flightNumber}` }).click();
      await shot('8-change-search');
      await page.getByRole('button', { name: 'Hold and see the difference' }).click();
      await expect(page.getByRole('heading', { name: 'Review the change' })).toBeVisible();
      await shot('9-change-review');
    });
  }
});
