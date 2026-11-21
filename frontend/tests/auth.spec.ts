import { expect, test, type Page } from '@playwright/test';

// These accounts exist only in scripts/auth-backend.cjs's disposable local DB.
// They are unrelated to shared Atlas users or any developer's private .env.
const smokePassword = 'M2SmokeOnly2026';
const roles = [
  { key: 'traveler', role: 'USER', slug: 'traveler' },
  { key: 'administrator', role: 'ADMIN', slug: 'admin' },
  { key: 'airline', role: 'AIRLINE_MODERATOR', slug: 'airline' },
  { key: 'hotel', role: 'HOTEL_MODERATOR', slug: 'hotel' },
] as const;

async function signIn(page: Page, key: string, password = smokePassword) {
  await page.getByLabel('Email', { exact: true }).fill(`smoke-${key}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill(password);
  const login = page.waitForResponse((response) =>
    response.url().endsWith('/api/auth/login') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  expect((await login).status()).toBe(200);
}

async function currentIdentity(page: Page) {
  return page.evaluate(async () => {
    const response = await fetch('/api/auth/me', { credentials: 'include', cache: 'no-store' });
    return { status: response.status, body: await response.json() };
  });
}

test('guest returns to the original protected page after real cookie login', async ({ page }) => {
  await page.goto('/account/profile');
  await expect(page).toHaveURL(/\/login(?:\?|$)/);
  await signIn(page, 'traveler');
  await expect(page).toHaveURL(/\/account\/profile(?:\?|$)/);
  await expect(page.getByRole('heading', { name: 'Account profile', exact: true })).toBeVisible();
  const identity = await currentIdentity(page);
  expect(identity.status).toBe(200);
  expect(identity.body.role).toBe('USER');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Account profile', exact: true })).toBeVisible();
});

for (const account of roles) {
  test(`${account.role}: login, /me, protected role route, refresh and logout`, async ({ page, context }) => {
    await page.goto('/login');
    await signIn(page, account.key);
    await expect(page).toHaveURL(new RegExp(`/workspace/${account.slug}(?:\\?|$)`));
    await expect(page.getByRole('heading', { name: 'Your workspace', exact: true })).toBeVisible();
    const identity = await currentIdentity(page);
    expect(identity.status).toBe(200);
    expect(identity.body.role).toBe(account.role);
    expect(identity.body.email).toBe(`smoke-${account.key}@example.test`);
    expect(identity.body).not.toHaveProperty('accessToken');
    expect(identity.body).not.toHaveProperty('refreshToken');

    const cookies = (await context.cookies()).filter((cookie) =>
      ['__Host-accessToken', '__Host-refreshToken'].includes(cookie.name));
    expect(cookies).toHaveLength(2);
    for (const cookie of cookies) {
      expect(cookie.httpOnly).toBe(true);
      expect(cookie.secure).toBe(true);
      expect(cookie.sameSite).toBe('Lax');
      expect(cookie.path).toBe('/');
    }
    const visibleStorage = await page.evaluate(() => JSON.stringify({
      cookie: document.cookie,
      local: Object.entries(localStorage),
      session: Object.entries(sessionStorage),
    }));
    expect(visibleStorage).not.toMatch(/accessToken|refreshToken|passwordChangeToken|M2SmokeOnly2026|eyJ[A-Za-z0-9_-]+\./);

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Your workspace', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page).toHaveURL(/\/login(?:\?|$)/);
    expect((await currentIdentity(page)).status).toBe(401);
    expect((await context.cookies()).filter((cookie) => cookie.name.startsWith('__Host-'))).toHaveLength(0);
    await page.goto(`/workspace/${account.slug}`);
    await expect(page).toHaveURL(/\/login(?:\?|$)/);
  });
}

test('a traveler cannot read an administrator workspace', async ({ page }) => {
  await page.goto('/login');
  await signIn(page, 'traveler');
  await expect(page).toHaveURL(/\/workspace\/traveler(?:\?|$)/);
  await page.goto('/workspace/admin');
  await expect(page.getByRole('heading', { name: 'Access denied', exact: true })).toBeVisible();
  expect((await currentIdentity(page)).body.role).toBe('USER');
  const adminResponse = await page.evaluate(async () => {
    const response = await fetch('/api/admin/accounts', { credentials: 'include', cache: 'no-store' });
    return { status: response.status, body: await response.json() };
  });
  expect(adminResponse.status).toBe(403);
  expect(adminResponse.body).not.toHaveProperty('items');
});

test('wrong current password shows the backend error without ending a normal session', async ({ page }) => {
  await page.goto('/login');
  await signIn(page, 'traveler');
  await expect(page).toHaveURL(/\/workspace\/traveler(?:\?|$)/);
  await page.goto('/account/security');
  await expect(page.getByLabel('Current password', { exact: true })).toBeVisible();
  await page.getByLabel('Current password', { exact: true }).fill('WrongCurrentPassword2026');
  await page.getByLabel('New password', { exact: true }).fill('M2UnusedNewPassword2026');
  const change = page.waitForResponse((response) =>
    response.url().endsWith('/api/auth/change-password') && response.request().method() === 'PATCH');
  await page.getByRole('button', { name: 'Change password', exact: true }).click();
  const response = await change;
  expect(response.status()).toBe(401);
  const body = await response.json();
  await expect(page.getByRole('alert').filter({ hasText: body.message })).toBeVisible();
  await expect(page).toHaveURL(/\/account\/security(?:\?|$)/);
  await expect(page.getByLabel('Current password', { exact: true })).toBeVisible();
  expect((await currentIdentity(page)).status).toBe(200);
});

test('invalid login displays the generic backend credentials error', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill('unknown-smoke-account@example.test');
  await page.getByLabel('Password', { exact: true }).fill('WrongPassword2026');
  const login = page.waitForResponse((response) =>
    response.url().endsWith('/api/auth/login') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const response = await login;
  expect(response.status()).toBe(401);
  expect((await response.json()).message).toBe('Invalid email or password');
  await expect(page.getByRole('alert').filter({ hasText: 'Invalid email or password' })).toBeVisible();
  await expect(page).toHaveURL(/\/login(?:\?|$)/);
  expect((await currentIdentity(page)).status).toBe(401);
});

test('hostile returnTo values cannot redirect outside the local role workspace', async ({ page }) => {
  for (const returnTo of ['https://untrusted.example/steal', '//untrusted.example/steal', '/\\untrusted.example/steal', '/%2f%2funtrusted.example/steal']) {
    await page.goto(`/login?returnTo=${encodeURIComponent(returnTo)}`);
    await signIn(page, 'traveler');
    await expect(page).toHaveURL('http://localhost:3101/workspace/traveler');
    await expect(page.getByRole('heading', { name: 'Your workspace', exact: true })).toBeVisible();
  }
});

test('a delayed guest /me response cannot clear a newer successful login', async ({ page }) => {
  let releaseStale!: () => void;
  let confirmStaleFetched!: () => void;
  const staleFetched = new Promise<void>((resolve) => { confirmStaleFetched = resolve; });
  const release = new Promise<void>((resolve) => { releaseStale = resolve; });
  let first = true;
  await page.route('**/api/auth/me', async (route) => {
    if (!first) { await route.continue(); return; }
    first = false;
    // Delay a real guest401 response to reproduce the overlapping refresh race.
    const response = await route.fetch();
    expect(response.status()).toBe(401);
    confirmStaleFetched();
    await release;
    await route.fulfill({ response });
  });
  await page.goto('/login');
  await staleFetched;
  await signIn(page, 'traveler');
  await expect(page).toHaveURL(/\/workspace\/traveler(?:\?|$)/);
  await expect(page.getByRole('heading', { name: 'Your workspace', exact: true })).toBeVisible();
  const staleDelivered = page.waitForResponse((response) => response.url().endsWith('/api/auth/me') && response.status() === 401);
  releaseStale();
  await staleDelivered;
  // A fresh real response ensures the stale response and React updates are settled.
  expect((await currentIdentity(page)).status).toBe(200);
  await expect(page).toHaveURL(/\/workspace\/traveler(?:\?|$)/);
  await expect(page.getByRole('heading', { name: 'Your workspace', exact: true })).toBeVisible();
});

test('login and authenticated workspace fit all four shared viewport widths', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const widths = [360, 768, 1024, 1440];
  const assertFits = async () => {
    const size = await page.evaluate(() => ({
      viewport: innerWidth,
      content: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
    }));
    expect(size.content).toBeLessThanOrEqual(size.viewport);
  };
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/login');
    await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
    await expect(page.getByText('Checking session...', { exact: true })).toHaveCount(0);
    await page.evaluate(() => document.fonts.ready);
    await assertFits();
    await page.screenshot({ path: testInfo.outputPath(`login-${width}.png`), fullPage: true });
  }
  await signIn(page, 'airline');
  await expect(page).toHaveURL(/\/workspace\/airline(?:\?|$)/);
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole('heading', { name: 'Your workspace', exact: true })).toBeVisible();
    await assertFits();
    await page.screenshot({ path: testInfo.outputPath(`workspace-${width}.png`), fullPage: true });
  }
});

test('forced password change survives refresh, blocks /me and requires a fresh login', async ({ page, context }) => {
  await page.goto('/login');
  await signIn(page, 'password-change');
  await expect(page).toHaveURL(/\/account\/security(?:\?|$)/);
  await expect(page.getByRole('heading', { name: 'Account security', exact: true })).toBeVisible();
  expect((await currentIdentity(page)).status).toBe(401);
  const restricted = (await context.cookies()).filter((cookie) => cookie.name.startsWith('__Host-'));
  expect(restricted.map((cookie) => cookie.name)).toEqual(['__Host-passwordChangeToken']);
  expect(restricted[0].httpOnly).toBe(true);
  expect(restricted[0].secure).toBe(true);
  await page.reload();
  await expect(page.getByLabel('Current password', { exact: true })).toBeVisible();
  await page.getByLabel('Current password', { exact: true }).fill(smokePassword);
  await page.getByLabel('New password', { exact: true }).fill('M2SmokeChanged2026');
  await page.getByRole('button', { name: 'Change password', exact: true }).click();
  await expect(page).toHaveURL(/\/login(?:\?|$)/);
  expect((await currentIdentity(page)).status).toBe(401);
  await signIn(page, 'password-change', 'M2SmokeChanged2026');
  await expect(page).toHaveURL(/\/workspace\/airline(?:\?|$)/);
  expect((await currentIdentity(page)).body.role).toBe('AIRLINE_MODERATOR');
});

test('proxy preserves backend CSRF rejection and validation errors', async ({ request }) => {
  const hostile = await request.post('/api/auth/login', {
    headers: { Origin: 'https://untrusted.example', 'Sec-Fetch-Site': 'cross-site' },
    data: { email: 'smoke-traveler@example.test', password: smokePassword },
  });
  expect(hostile.status()).toBe(403);
  const invalid = await request.post('/api/auth/login', {
    headers: { Origin: 'http://localhost:3101', 'Sec-Fetch-Site': 'same-origin' },
    data: { email: 'invalid-email', password: '' },
  });
  expect(invalid.status()).toBe(400);
  const body = await invalid.json();
  expect(body.statusCode).toBe(400);
  expect(body.errors.email).toBeInstanceOf(Array);
  expect(body.errors.password).toBeInstanceOf(Array);
});
