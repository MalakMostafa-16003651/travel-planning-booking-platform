import { expect, test, type Page } from '@playwright/test';
import { confirmed, fillTraveler, fixture, hold, main, newTraveler, noSidewaysScroll, nour, review, signIn, type Account, type Flight } from './support';

// Joined journeys on the merged pages: Gamila's search and results (PR #130) into the booking pages.
// Each test uses its own route or date, so one test's flights never appear in another's results.

type Search = { from: string; to: string; date: string; returnDate?: string; adults?: number; children?: number; infants?: number };

function searchUrl({ from, to, date, returnDate, adults = 1, children = 0, infants = 0 }: Search) {
  const params = new URLSearchParams({ departureAirportCode: from, arrivalAirportCode: to, departureDate: date, adults: String(adults) });
  if (returnDate) { params.set('roundTrip', 'true'); params.set('returnDate', returnDate); }
  if (children) params.set('children', String(children));
  if (infants) params.set('infants', String(infants));
  return `/flights?${params}`;
}

/** The innermost block holding both the flight number and its cabin button. */
const card = (page: Page, flight: Flight) => main(page).locator('div, article')
  .filter({ hasText: flight.flightNumber }).filter({ has: page.getByRole('button', { name: /^Select/ }) }).last();
const selectButton = (page: Page, flight: Flight) => card(page, flight).getByRole('button', { name: /^Select/ });
const continueButton = (page: Page) => main(page).getByRole('button', { name: 'Continue to booking' });

async function fillSearch(page: Page, { from, to, date, returnDate }: Search) {
  if (returnDate) await main(page).getByRole('radio', { name: 'Round trip' }).check();
  await main(page).getByLabel('From', { exact: true }).selectOption(from);
  await main(page).getByLabel('To', { exact: true }).selectOption(to);
  await main(page).getByLabel('Departure date').fill(date);
  if (returnDate) await main(page).getByLabel('Return date').fill(returnDate);
}

let pageErrors: string[] = [];
test.beforeEach(({ page }) => {
  pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && /hydrat|Minified React/i.test(message.text())) pageErrors.push(message.text()); });
});
test.afterEach(() => { expect(pageErrors).toEqual([]); });

test.describe('Search to booking', () => {
  test('a traveler searches, picks a cabin, and holds exactly that flight', async ({ page }) => {
    const flight = await fixture<Flight>('flight', { from: 'CAI', to: 'RUH', price: 18000 });
    await newTraveler(page);
    await page.goto('/flights');
    await fillSearch(page, { from: 'CAI', to: 'RUH', date: flight.date });
    await main(page).getByRole('button', { name: 'Search flights' }).click();
    await expect(card(page, flight)).toContainText('$180.00');
    await expect(continueButton(page)).toHaveCount(0);
    await selectButton(page, flight).click();
    await continueButton(page).click();
    await expect(page.getByRole('heading', { name: 'Who is travelling?' })).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Trip summary' })).toContainText('CAI to RUH');
    await fillTraveler(page, 'Adult 1', nour);
    await review(page);
    await page.getByRole('button', { name: 'Hold seats and continue' }).click();
    await expect(page.getByRole('timer')).toBeVisible();
    expect(await fixture('cabin', { id: flight.cabinId })).toEqual({ held: 1, booked: 0 });
  });

  test('a guest keeps the chosen flight through sign-in (ACC-10)', async ({ page }) => {
    const flight = await fixture<Flight>('flight', { from: 'CAI', to: 'RUH', days: 31 });
    const account = await fixture<Account>('user');
    await page.goto(searchUrl({ from: 'CAI', to: 'RUH', date: flight.date }));
    await selectButton(page, flight).click();
    await continueButton(page).click();
    await expect(page).toHaveURL(/\/login\?/);
    await page.getByLabel('Email', { exact: true }).fill(account.email);
    await page.getByLabel('Password', { exact: true }).fill(account.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Who is travelling?' })).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Trip summary' })).toContainText('CAI to RUH');
  });

  test('a round trip for a family carries both flights and every traveler, and goes back to the same search', async ({ page }) => {
    const outbound = await fixture<Flight>('flight', { from: 'CAI', to: 'LHR', days: 40 });
    const inbound = await fixture<Flight>('flight', { from: 'LHR', to: 'CAI', days: 47, price: 20000 });
    await newTraveler(page);
    await page.goto(searchUrl({ from: 'CAI', to: 'LHR', date: outbound.date, returnDate: inbound.date, adults: 2, children: 1, infants: 1 }));
    await selectButton(page, outbound).click();
    await expect(continueButton(page)).toHaveCount(0);
    await selectButton(page, inbound).click();
    await continueButton(page).click();
    for (const group of ['Adult 1', 'Adult 2', 'Child 1', 'Infant 1']) await expect(page.getByRole('group', { name: group, exact: true })).toBeVisible();
    await expect(page.getByRole('group', { name: /^(Adult|Child|Infant) \d$/ })).toHaveCount(4);

    await main(page).getByRole('link', { name: 'Back to flights' }).click();
    await expect(page).toHaveURL(/\/flights\?/);
    await expect(main(page).getByLabel('From', { exact: true })).toHaveValue('CAI');
    await expect(main(page).getByLabel('To', { exact: true })).toHaveValue('LHR');
    await expect(main(page).getByLabel('Departure date')).toHaveValue(outbound.date);
    await expect(main(page).getByLabel('Return date')).toHaveValue(inbound.date);
    await expect(main(page).getByLabel('Adults (12+)')).toHaveValue('2');
    await expect(main(page).getByLabel('Children (2–11)')).toHaveValue('1');
    await expect(main(page).getByLabel('Infants (under 2)')).toHaveValue('1');
    await expect(card(page, inbound)).toBeVisible();
  });

  test('an expired hold offers the same search again, with the seats back on sale', async ({ page }) => {
    const flight = await fixture<Flight>('flight', { from: 'CAI', to: 'RUH', days: 32, seats: 1 });
    await newTraveler(page);
    const id = await hold(page, [flight]);
    await page.goto(searchUrl({ from: 'CAI', to: 'RUH', date: flight.date }));
    await expect(main(page).getByText('No flights found')).toBeVisible();
    await fixture('hold-ends', { booking: id });
    await fixture('sweep');
    await page.goto(`/bookings/flights/${id}`);
    await main(page).getByRole('link', { name: 'Search flights again' }).click();
    await expect(main(page).getByLabel('Departure date')).toHaveValue(flight.date);
    await expect(selectButton(page, flight)).toBeEnabled();
  });

  test('a flight that sells out after the search is refused and nothing more is held', async ({ page, browser }) => {
    const flight = await fixture<Flight>('flight', { from: 'CAI', to: 'RUH', days: 33, seats: 1 });
    await newTraveler(page);
    await page.goto(searchUrl({ from: 'CAI', to: 'RUH', date: flight.date }));
    await selectButton(page, flight).click();
    const other = await (await browser.newContext()).newPage();
    await newTraveler(other);
    await hold(other, [flight]);
    await other.context().close();
    await continueButton(page).click();
    await expect(main(page).getByText(/no longer has 1 seat in this cabin/)).toBeVisible();
    expect(await fixture('cabin', { id: flight.cabinId })).toEqual({ held: 1, booked: 0 });
  });

  test('peer check of #130: a new search never keeps an earlier selection, even when returning to it (#132)', async ({ page }) => {
    const flight = await fixture<Flight>('flight', { from: 'CAI', to: 'RUH', days: 34 });
    const elsewhere = await fixture<Flight>('flight', { from: 'CAI', to: 'CDG', days: 34 });
    const first = { from: 'CAI', to: 'RUH', date: flight.date };
    await page.goto(searchUrl(first));
    await selectButton(page, flight).click();
    await expect(continueButton(page)).toBeVisible();
    await fillSearch(page, { ...first, to: 'CDG' });
    await main(page).getByRole('button', { name: 'Search flights' }).click();
    await expect(card(page, elsewhere)).toBeVisible();
    await expect(continueButton(page)).toHaveCount(0);
    await fillSearch(page, first);
    await main(page).getByRole('button', { name: 'Search flights' }).click();
    await expect(card(page, flight)).toBeVisible();
    await expect(continueButton(page)).toHaveCount(0);
    await expect(selectButton(page, flight)).toHaveAttribute('aria-pressed', 'false');
  });

  test('peer check of #130: price bounds are dollars and survive a reload (#131)', async ({ page }) => {
    const cheap = await fixture<Flight>('flight', { from: 'CAI', to: 'RUH', days: 35, price: 12000 });
    const dear = await fixture<Flight>('flight', { from: 'CAI', to: 'RUH', days: 35, hour: 12, price: 30000 });
    await page.goto(searchUrl({ from: 'CAI', to: 'RUH', date: cheap.date }));
    await expect(card(page, dear)).toBeVisible();
    await main(page).getByLabel('Min price (USD)').fill('100');
    await main(page).getByLabel('Max price (USD)').fill('200');
    await main(page).getByRole('button', { name: 'Apply price filter' }).click();
    await expect(card(page, dear)).toHaveCount(0);
    await expect(card(page, cheap)).toBeVisible();
    await page.reload();
    await expect(main(page).getByLabel('Max price (USD)')).toHaveValue('200');
    await expect(card(page, cheap)).toBeVisible();
    await expect(card(page, dear)).toHaveCount(0);
  });

  for (const width of [360, 768, 1024, 1440]) {
    test(`the handoff fits at ${width} pixels`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const flight = await fixture<Flight>('flight', { from: 'CAI', to: 'CDG', days: 50 + width % 50 });
      await newTraveler(page);
      await page.goto(searchUrl({ from: 'CAI', to: 'CDG', date: flight.date }));
      await selectButton(page, flight).click();
      await noSidewaysScroll(page);
      await page.screenshot({ path: `test-results/bookings-screens/search-${width}.png`, fullPage: true });
      await continueButton(page).click();
      await expect(page.getByRole('heading', { name: 'Who is travelling?' })).toBeVisible();
      await noSidewaysScroll(page);
      await page.screenshot({ path: `test-results/bookings-screens/travelers-${width}.png`, fullPage: true });
    });
  }
});

test.describe('GEN-11: transitions started elsewhere', () => {
  test('a flight the airline cancels is shown as cancelled with the full refund (FLT-06)', async ({ page, browser }) => {
    const flight = await fixture<Flight>('flight', { days: 3 });
    await newTraveler(page);
    const id = await confirmed(page, [flight]);
    const moderator = await (await browser.newContext()).newPage();
    await signIn(moderator, await fixture<Account>('user', { role: 'AIRLINE_MODERATOR' }));
    const status = await moderator.evaluate(async flightId => (await fetch(`/api/flights/${flightId}/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, flight.flightId);
    expect(status).toBe(201);
    await moderator.context().close();

    await page.goto(`/bookings/flights/${id}`);
    await expect(main(page).getByText('The airline cancelled this flight.')).toBeVisible();
    // Three days before departure the traveler's own refund would be 10%. The airline's is everything.
    await expect(main(page).getByRole('complementary')).toContainText('$150.00');
    await expect(main(page).getByRole('complementary')).not.toContainText('$15.00');
    await expect(main(page).getByRole('button', { name: 'Check my refund' })).toHaveCount(0);
    await expect(main(page).getByRole('link', { name: 'Find another flight' })).toHaveCount(0);
    await fixture('refunded', { booking: id });
    await page.reload();
    await expect(main(page).getByRole('complementary')).toContainText(/refunded/i);
    await page.goto('/bookings/flights?group=CANCELLED');
    await expect(main(page).getByText('Cancelled', { exact: true }).last()).toBeVisible();
  });

  test('a finished trip becomes Completed, moves to Past and keeps its ticket', async ({ page }) => {
    const flight = await fixture<Flight>('flight', { days: 2 });
    await newTraveler(page);
    const id = await confirmed(page, [flight]);
    await fixture('departs', { flight: flight.flightId });
    await fixture('sweep');
    await page.goto(`/bookings/flights/${id}`);
    await expect(main(page).getByText('Completed', { exact: true }).first()).toBeVisible();
    await expect(main(page).getByRole('button', { name: 'Check my refund' })).toHaveCount(0);
    await expect(main(page).getByRole('link', { name: 'Find another flight' })).toHaveCount(0);
    await page.goto('/bookings/flights?group=UPCOMING');
    await expect(main(page).getByText(/No upcoming/)).toBeVisible();
    await page.goto('/bookings/flights?group=PAST');
    await expect(main(page).getByText('Completed', { exact: true }).last()).toBeVisible();
    await page.goto(`/bookings/flights/${id}/ticket`);
    await expect(main(page).getByRole('heading', { name: 'Your ticket' })).toBeVisible();
  });
});
