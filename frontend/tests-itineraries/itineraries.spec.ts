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
  await expect(page.getByRole('main').getByText('Day 3 · Fri 12 Mar')).toBeVisible();

  // ITN-08 with the accessible buttons: Paris moves to day 2, splitting Cairo into two stops.
  await page.getByRole('button', { name: 'Move day 3 earlier' }).click();
  await expect(groupHeadings(page)).toHaveText(['Cairo', 'Paris', 'Cairo']);
  await expect(page.getByRole('main').getByText('Day 2 · Thu 11 Mar')).toBeVisible();

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
  await expect(page.getByRole('main').getByText('Day 2 · Fri 2 Apr')).toBeVisible();

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
  for (const width of [360, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `test-results/itineraries/editor-${width}.png`, fullPage: true });
  }
});
