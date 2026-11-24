import { expect, request as playwrightRequest, test, type Page } from '@playwright/test';

// Real Chromium, real Next proxy and real Nest app on a disposable database with the official
// country/city catalog. Covers ITN-01, ITN-03, ITN-05, ITN-07, ITN-08, ITN-09, ITN-20 and ACC-11.

type Account = { email: string; password: string };

async function fixture<T>(control: string, query: Record<string, string> = {}): Promise<T> {
  const context = await playwrightRequest.newContext();
  const response = await context.post(`http://127.0.0.1:3120/__m2-itinerary-fixture/${control}?${new URLSearchParams(query)}`, { headers: { 'X-M2-Itinerary-Fixture': 'itineraries' } });
  const body = await response.json();
  expect(response.status(), JSON.stringify(body)).toBe(200);
  await context.dispose();
  return body as T;
}

async function signIn(page: Page, account: Account) {
  await page.goto('/login');
  const status = await page.evaluate(async body => (await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).status, account);
  expect(status).toBe(200);
}

async function newTraveler(page: Page, name = 'Kiki Planner'): Promise<Account> {
  const account = await fixture<Account>('user', { name });
  await signIn(page, account);
  return account;
}

async function createTrip(page: Page, title: string, countries: string[]) {
  await page.goto('/itineraries/new');
  await page.getByLabel('Title').fill(title);
  for (const country of countries) await page.getByLabel(country, { exact: true }).check();
  await page.getByLabel('Start date').fill('2027-03-10');
  await page.getByRole('button', { name: 'Create itinerary' }).click();
  await expect(page).toHaveURL(/\/itineraries\/[a-f0-9]{24}\/edit/);
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  return page.url().match(/itineraries\/([a-f0-9]{24})/)![1];
}

async function addDay(page: Page, city: string) {
  const form = page.getByRole('region', { name: 'Add a day' });
  await form.getByLabel('City').selectOption({ label: city });
  await form.getByRole('button', { name: 'Add day' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Day added.' })).toBeVisible();
}

const groupHeadings = (page: Page) => page.getByRole('list', { name: 'Itinerary days grouped by city' }).getByRole('heading', { level: 3 });

test('guests are sent to sign in and returned to their itineraries', async ({ page }) => {
  await page.goto('/itineraries');
  await expect(page).toHaveURL(/\/login\?returnTo=%2Fitineraries/);
});

test('create validates, then days are added, grouped, reordered and deleted with recalculated dates', async ({ page }) => {
  await newTraveler(page);
  await page.goto('/itineraries');
  await expect(page.getByRole('main').getByText('No itineraries yet')).toBeVisible();

  // ITN-01 inline validation before any request.
  await page.goto('/itineraries/new');
  await page.getByRole('button', { name: 'Create itinerary' }).click();
  await expect(page.getByRole('main').getByText('Enter a title.')).toBeVisible();
  await expect(page.getByRole('main').getByText('Choose at least one country.')).toBeVisible();

  const id = await createTrip(page, 'Nile and Seine', ['Egypt', 'France']);
  await expect(page.getByRole('main').getByText('Private', { exact: true })).toBeVisible();
  await expect(page.getByRole('main').getByText('No days yet', { exact: true })).toBeVisible();

  // ITN-05: the city list only offers the selected countries' catalog cities.
  const cityOptions = await page.getByRole('region', { name: 'Add a day' }).getByLabel('City').locator('option').allTextContents();
  expect(cityOptions.slice(1).sort()).toEqual(['Cairo', 'Paris']);

  await addDay(page, 'Cairo');
  await addDay(page, 'Cairo');
  await addDay(page, 'Paris');
  // ITN-09: consecutive Cairo days form one group.
  await expect(groupHeadings(page)).toHaveText(['Cairo', 'Paris']);
  await expect(page.getByRole('main').getByText('Days 1–2 · 2 days')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Itinerary days grouped by city' }).getByText('Day 3 · Fri 12 Mar')).toBeVisible();

  // ITN-08 with the accessible buttons: Paris moves to day 2, splitting Cairo into two stops.
  await page.getByRole('button', { name: 'Move day 3 earlier' }).click();
  await expect(groupHeadings(page)).toHaveText(['Cairo', 'Paris', 'Cairo']);
  await expect(page.getByRole('list', { name: 'Itinerary days grouped by city' }).getByText('Day 2 · Thu 11 Mar')).toBeVisible();

  // ITN-05: edit a day's notes.
  await page.getByRole('button', { name: 'Edit day 2' }).click();
  await page.getByLabel('Notes (optional)').first().fill('Louvre in the morning');
  await page.getByRole('button', { name: 'Save day' }).click();
  await expect(page.getByRole('main').getByText('Louvre in the morning')).toBeVisible();

  // ITN-07: delete after confirmation; days renumber and groups merge again.
  await page.getByRole('button', { name: 'Delete day 2', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete day 2?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Delete day' }).click();
  await expect(groupHeadings(page)).toHaveText(['Cairo']);
  await expect(page.getByRole('main').getByText('Days 1–2 · 2 days')).toBeVisible();

  // ITN-01: editing the start date moves the day dates.
  await page.getByRole('button', { name: 'Edit details' }).click();
  await page.getByLabel('Start date').fill('2027-04-01');
  await page.getByRole('button', { name: 'Save details' }).click();
  await expect(page.getByRole('main').getByText('Trip details saved.')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Itinerary days grouped by city' }).getByText('Day 2 · Fri 2 Apr')).toBeVisible();

  // ITN-03: the list shows it, and the read view matches.
  await page.goto('/itineraries');
  await expect(page.getByRole('link', { name: 'Nile and Seine' })).toBeVisible();
  await expect(page.getByRole('main').getByText('2 days')).toBeVisible();
  await page.getByRole('link', { name: 'Nile and Seine' }).click();
  await expect(page).toHaveURL(new RegExp(`/itineraries/${id}$`));
  await expect(page.getByRole('heading', { name: 'Day 1 · Thu 1 Apr' })).toBeVisible();
});

test('visibility controls who can read it, and only the owner can edit or delete', async ({ page, browser }) => {
  await newTraveler(page, 'Owner One');
  const id = await createTrip(page, 'Tokyo food week', ['Japan']);
  await addDay(page, 'Tokyo');

  const other = await browser.newPage();
  await newTraveler(other, 'Other Traveler');

  // ACC-11: private is owner-only, both for reading and editing.
  await other.goto(`/itineraries/${id}`);
  await expect(other.getByRole('heading', { name: /not found/i })).toBeVisible();

  // ITN-20: make public, after confirmation.
  await page.getByRole('button', { name: 'Make public' }).click();
  await page.getByRole('dialog', { name: 'Make this itinerary public?' }).getByRole('button', { name: 'Make public' }).click();
  await expect(page.getByRole('main').getByText('Itinerary is now public.')).toBeVisible();

  await other.goto(`/itineraries/${id}`);
  await expect(other.getByRole('heading', { level: 1, name: 'Tokyo food week' })).toBeVisible();
  await expect(other.getByRole('main').getByText('By Owner One')).toBeVisible();
  await expect(other.getByRole('link', { name: 'Edit itinerary' })).toHaveCount(0);
  await other.goto(`/itineraries/${id}/edit`);
  await expect(other.getByRole('heading', { name: /not found/i })).toBeVisible();

  // Setting it private removes access immediately.
  await page.getByRole('button', { name: 'Make private' }).click();
  await page.getByRole('dialog', { name: 'Make this itinerary private?' }).getByRole('button', { name: 'Make private' }).click();
  await expect(page.getByRole('main').getByText('Itinerary is now private.')).toBeVisible();
  await other.goto(`/itineraries/${id}`);
  await expect(other.getByRole('heading', { name: /not found/i })).toBeVisible();

  // ITN-01: delete after confirmation.
  await page.getByRole('button', { name: 'Delete itinerary' }).click();
  await page.getByRole('dialog', { name: 'Delete this itinerary?' }).getByRole('button', { name: 'Delete itinerary' }).click();
  await expect(page).toHaveURL(/\/itineraries\?deleted=1/);
  await expect(page.getByRole('main').getByText('The itinerary was deleted.')).toBeVisible();
  await expect(page.getByRole('main').getByText('No itineraries yet')).toBeVisible();
  await other.close();
});

test('the editor is usable at 360, 768, 1024 and 1440 px without page-wide overflow', async ({ page }) => {
  await newTraveler(page);
  await createTrip(page, 'Responsive check', ['Egypt', 'United Arab Emirates']);
  await addDay(page, 'Cairo');
  await addDay(page, 'Dubai');
  await page.getByText('Activities and budget for day 1').click();
  await page.getByRole('button', { name: 'Add activity to day 1' }).click();
  await page.getByRole('button', { name: 'Add budget entry to day 1' }).click();
  for (const width of [360, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `test-results/itineraries/editor-${width}.png`, fullPage: true });
  }
});

// ---------------------------------------------------------------- slice 2: ITN-09/10/12/14/16/18

// A real 1x1 PNG: the backend checks the file content, not only the name.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');

const grandTotal = (page: Page) => page.getByTestId('grand-total');

test('activities with photos, budget entries and transport feed backend-converted totals', async ({ page, browser }) => {
  await newTraveler(page, 'Budget Owner');
  await fixture('rates', { base: 'USD', rates: JSON.stringify({ EGP: 50, EUR: 0.9, GBP: 0.8 }) });
  const id = await createTrip(page, 'Cairo on a budget', ['Egypt']);
  await addDay(page, 'Cairo');
  await addDay(page, 'Cairo');
  await expect(grandTotal(page)).toHaveText('$0.00');

  // ITN-10: activity with the city's official attraction, times and a cost.
  await page.getByText('Activities and budget for day 1').click();
  const day1 = page.getByRole('region', { name: 'Activities for day 1' });
  await day1.getByRole('button', { name: 'Add activity to day 1' }).click();
  await day1.getByLabel('Activity title').fill('Pyramids at sunrise');
  await expect(day1.getByLabel('Attraction (optional)').locator('option')).toHaveText(['None', 'Giza Pyramids and Sphinx']);
  await day1.getByLabel('Attraction (optional)').selectOption({ label: 'Giza Pyramids and Sphinx' });
  await day1.getByLabel('Start time (optional)').fill('09:00');
  await day1.getByLabel('End time (optional)').fill('08:00');
  await day1.getByLabel('Cost (optional)').fill('25.5');
  await day1.getByRole('button', { name: 'Add activity' }).click();
  await expect(day1.getByText('End time cannot be before the start time.')).toBeVisible();
  await day1.getByLabel('End time (optional)').fill('12:00');
  await day1.getByRole('button', { name: 'Add activity' }).click();
  await expect(day1.getByText('Pyramids at sunrise', { exact: true })).toBeVisible();
  await expect(day1.getByText('09:00–12:00')).toBeVisible();
  await expect(grandTotal(page)).toHaveText('$25.50');

  // ITN-12/GEN-08: upload with progress, then remove; a non-image is refused before upload.
  const photos = day1.getByLabel('Photos for Pyramids at sunrise');
  await photos.setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await expect(day1.getByText('Only JPG or PNG images are accepted.')).toBeVisible();
  await photos.setInputFiles({ name: 'pyramids.png', mimeType: 'image/png', buffer: PNG });
  await expect(day1.getByRole('img', { name: 'Photos for Pyramids at sunrise' })).toHaveCount(1);
  await expect(day1.getByText('1 / 5')).toBeVisible();

  // ITN-14: entries in two currencies on two days.
  const budget1 = page.getByRole('region', { name: 'Budget for day 1' });
  await budget1.getByRole('button', { name: 'Add budget entry to day 1' }).click();
  await budget1.getByLabel('Amount').fill('-3');
  await budget1.getByRole('button', { name: 'Add entry' }).click();
  await expect(budget1.getByText('Enter a non-negative amount with at most two decimals.')).toBeVisible();
  await budget1.getByLabel('Amount').fill('500');
  await budget1.getByLabel('Currency').selectOption('EGP');
  await budget1.getByLabel('Description (optional)').fill('Koshary dinners');
  await budget1.getByRole('button', { name: 'Add entry' }).click();
  await expect(budget1.getByText('Food · EGP 500.00')).toBeVisible();

  await page.getByText('Activities and budget for day 2').click();
  const budget2 = page.getByRole('region', { name: 'Budget for day 2' });
  await budget2.getByRole('button', { name: 'Add budget entry to day 2' }).click();
  await budget2.getByLabel('Category').selectOption({ label: 'Accommodation' });
  await budget2.getByLabel('Amount').fill('100');
  await budget2.getByRole('button', { name: 'Add entry' }).click();
  await expect(budget2.getByText('Accommodation · $100.00')).toBeVisible();

  // ITN-16: any catalog city, on a travel day.
  const transport = page.getByRole('region', { name: 'Intercity transport' });
  await transport.getByRole('button', { name: 'Add intercity transport' }).click();
  await transport.getByLabel('From city').selectOption('London');
  await transport.getByLabel('To city').selectOption('Cairo');
  await transport.getByLabel('Mode').selectOption({ label: 'Flight' });
  await transport.getByLabel('Travel day').selectOption({ index: 1 });
  await transport.getByLabel('Amount').fill('300');
  await transport.getByRole('button', { name: 'Add transport' }).click();
  await expect(page.getByRole('main').getByText('London → Cairo · Flight · $300.00')).toBeVisible();

  // ITN-14/18 totals come from the backend: 25.50 + 500 EGP (=10) + 100 + 300.
  await expect(grandTotal(page)).toHaveText('$435.50');
  await expect(page.getByRole('main').getByText('Subtotal $435.50')).toBeVisible();
  await expect(page.getByRole('main').getByText(/Converted with rates from/)).toBeVisible();

  // ITN-10: clearing the optional cost and times removes them from the totals.
  await day1.getByRole('button', { name: 'Edit activity Pyramids at sunrise' }).click();
  await day1.getByLabel('Cost (optional)').fill('');
  await day1.getByLabel('Start time (optional)').fill('');
  await day1.getByLabel('End time (optional)').fill('');
  await day1.getByRole('button', { name: 'Save activity' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Activity saved.' })).toBeVisible();
  await expect(day1.getByText('09:00–12:00')).toHaveCount(0);
  await expect(grandTotal(page)).toHaveText('$410.00');

  // ITN-18: another display currency; a stale cache is flagged; no rates at all is a clear error.
  await fixture('rates', { base: 'EGP', rates: JSON.stringify({ USD: 0.02 }) });
  await page.getByLabel('Show totals in').selectOption('EGP');
  await expect(grandTotal(page)).toHaveText('EGP 20,500.00');
  await fixture('rates', { base: 'EUR', rates: JSON.stringify({ USD: 1.25, EGP: 62.5 }), stale: 'true' });
  await page.getByLabel('Show totals in').selectOption('EUR');
  await expect(grandTotal(page)).toHaveText('€328.00');
  await expect(page.getByRole('note')).toContainText('last saved rates were used');
  await page.getByLabel('Show totals in').selectOption('JPY');
  await expect(page.getByRole('main').getByText(/Exchange rates are temporarily unavailable/)).toBeVisible();
  await page.getByLabel('Show totals in').selectOption('USD');
  await expect(grandTotal(page)).toHaveText('$410.00');

  // Deleting an entry recalculates.
  await budget2.getByRole('button', { name: 'Delete entry' }).click();
  await page.getByRole('dialog', { name: 'Delete this budget entry?' }).getByRole('button', { name: 'Delete entry' }).click();
  await expect(grandTotal(page)).toHaveText('$310.00');

  // ITN-21 read-only view for another traveler: activities, photo, entries and the same totals.
  await page.getByRole('button', { name: 'Make public' }).click();
  await page.getByRole('dialog', { name: 'Make this itinerary public?' }).getByRole('button', { name: 'Make public' }).click();
  await expect(page.getByRole('main').getByText('Itinerary is now public.')).toBeVisible();
  const other = await browser.newPage();
  await newTraveler(other, 'Curious Reader');
  await other.goto(`/itineraries/${id}`);
  await expect(other.getByRole('main').getByText('Pyramids at sunrise', { exact: true })).toBeVisible();
  await expect(other.getByRole('img', { name: 'Pyramids at sunrise, photo 1' })).toBeVisible();
  await expect(other.getByRole('main').getByText('Koshary dinners')).toBeVisible();
  await expect(grandTotal(other)).toHaveText('$310.00');
  await expect(other.getByRole('button', { name: /Delete|Edit/ })).toHaveCount(0);
  await other.close();

  // Remove the photo as the owner.
  await day1.getByRole('button', { name: 'Remove photos for pyramids at sunrise' }).click();
  await expect(day1.getByText('0 / 5')).toBeVisible();
});

// ---------------------------------------------------------------- slice 3: ITN-21 discovery and clone

async function call<T>(page: Page, method: string, path: string, body?: unknown): Promise<T> {
  const result = await page.evaluate(async ([m, p, b]) => {
    const response = await fetch(`/api${p}`, { method: m as string, headers: b ? { 'Content-Type': 'application/json' } : {}, body: b ? JSON.stringify(b) : undefined });
    return { status: response.status, body: await response.json().catch(() => null) };
  }, [method, path, body] as const);
  expect(result.status, JSON.stringify(result.body)).toBeLessThan(300);
  return result.body as T;
}

async function seedTrip(page: Page, title: string, countries: string[], cities: string[], visibility: 'PUBLIC' | 'PRIVATE') {
  const created = await call<{ itineraryId: string }>(page, 'POST', '/itineraries', { title, countries, startDate: '2027-05-01', visibility });
  for (const city of cities) await call(page, 'POST', `/itineraries/${created.itineraryId}/days`, { city });
  return created.itineraryId;
}

const resultTitles = (page: Page) => page.getByRole('main').getByRole('list').getByRole('heading', { level: 3 });

test('guests search public itineraries by keyword, country and length; private ones never appear', async ({ page, browser }) => {
  await newTraveler(page, 'Zephyr Author');
  await seedTrip(page, 'Zephyr Nile week', ['EG'], ['Cairo', 'Cairo'], 'PUBLIC');
  await seedTrip(page, 'Zephyr Tokyo dash', ['JP'], ['Tokyo'], 'PUBLIC');
  await seedTrip(page, 'Zephyr secret plan', ['EG'], ['Cairo'], 'PRIVATE');

  const guest = await (await browser.newContext()).newPage();
  await guest.goto('/explore/itineraries?q=Zephyr');
  await expect(guest.getByRole('main').getByText('2 itineraries found')).toBeVisible();
  await expect(resultTitles(guest)).toHaveText(['Zephyr Tokyo dash', 'Zephyr Nile week']);
  await expect(guest.getByRole('main').getByText('By Zephyr Author').first()).toBeVisible();

  // Filters live in the URL (GET form).
  await guest.getByLabel('Country').selectOption({ label: 'Japan' });
  await guest.getByRole('button', { name: 'Search' }).click();
  await expect(guest).toHaveURL(/country=JP/);
  await expect(resultTitles(guest)).toHaveText(['Zephyr Tokyo dash']);

  await guest.goto('/explore/itineraries?q=Zephyr&minDays=2');
  await expect(resultTitles(guest)).toHaveText(['Zephyr Nile week']);
  await guest.goto('/explore/itineraries?q=Zephyr&sort=TITLE');
  await expect(resultTitles(guest)).toHaveText(['Zephyr Nile week', 'Zephyr Tokyo dash']);

  // Invalid range is explained, not sent.
  await guest.goto('/explore/itineraries?q=Zephyr&minDays=3&maxDays=2');
  await expect(guest.getByRole('main').getByText('Maximum days must not be less than minimum days.')).toBeVisible();

  await guest.goto('/explore/itineraries?q=NoSuchTripAnywhere');
  await expect(guest.getByRole('main').getByText('No itineraries match these filters')).toBeVisible();
  await guest.close();
});

test('a guest signs in to clone a public itinerary; the copy is private and independent; privacy revokes access', async ({ page, browser }) => {
  await newTraveler(page, 'Original Author');
  const id = await seedTrip(page, 'Quokka Cairo loop', ['EG'], ['Cairo', 'Cairo'], 'PUBLIC');
  await call(page, 'POST', `/itineraries/${id}/days/${(await call<{ days: { dayId: string }[] }>(page, 'GET', `/itineraries/${id}`)).days[0].dayId}/activities`, { title: 'Khan el-Khalili walk' });

  const context = await browser.newContext();
  const guest = await context.newPage();
  await guest.goto(`/explore/itineraries/${id}`);
  await expect(guest.getByRole('heading', { level: 1, name: 'Quokka Cairo loop' })).toBeVisible();
  await expect(guest.getByRole('main').getByText('Khan el-Khalili walk')).toBeVisible();
  await guest.getByRole('link', { name: 'Sign in to clone' }).click();
  await expect(guest).toHaveURL(/\/login\?returnTo=%2Fexplore%2Fitineraries%2F/);

  // Sign in on the login page, then the user is returned to the trip (ACC-10).
  const account = await fixture<Account>('user', { name: 'Cloning Traveler' });
  await guest.getByLabel('Email').fill(account.email);
  await guest.getByLabel('Password').fill(account.password);
  await guest.getByRole('button', { name: /sign in/i }).click();
  await expect(guest).toHaveURL(new RegExp(`/explore/itineraries/${id}$`));

  await guest.getByRole('button', { name: 'Clone to my itineraries' }).click();
  await expect(guest).toHaveURL(/\/itineraries\/[a-f0-9]{24}\/edit\?cloned=1/);
  const copyId = guest.url().match(/itineraries\/([a-f0-9]{24})/)![1];
  expect(copyId).not.toBe(id);
  await expect(guest.getByRole('main').getByText('Cloned. This private copy is yours to edit')).toBeVisible();
  await expect(guest.getByRole('main').getByText('Private', { exact: true })).toBeVisible();

  // Editing the copy does not change the original.
  await guest.getByRole('button', { name: 'Delete day 2', exact: true }).click();
  await guest.getByRole('dialog', { name: 'Delete day 2?' }).getByRole('button', { name: 'Delete day' }).click();
  await expect(guest.getByRole('main').getByText('1 of 60 days')).toBeVisible();
  await guest.goto(`/itineraries/${copyId}`);
  await expect(guest.getByRole('main').getByText('Cloned from “Quokka Cairo loop” by Original Author')).toBeVisible();
  expect((await call<{ dayCount: number }>(page, 'GET', `/itineraries/${id}`)).dayCount).toBe(2);

  // The author makes the original private: it disappears for everyone else at once.
  await call(page, 'PATCH', `/itineraries/${id}`, { visibility: 'PRIVATE' });
  await guest.goto(`/explore/itineraries/${id}`);
  await expect(guest.getByRole('heading', { name: /not found/i })).toBeVisible();
  await guest.goto('/explore/itineraries?q=Quokka');
  await expect(guest.getByRole('main').getByText('No itineraries match these filters')).toBeVisible();
  // The clone is unaffected.
  await guest.goto(`/itineraries/${copyId}`);
  await expect(guest.getByRole('heading', { level: 1, name: 'Quokka Cairo loop' })).toBeVisible();
  await context.close();
});
