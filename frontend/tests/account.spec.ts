import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

// Every identity and credential below belongs to the disposable browser fixture.
const password = 'M2SmokeOnly2026';
const frontendOrigin = 'http://localhost:3101';
const fixtureOrigin = 'http://localhost:3100';

// The development server compiles new routes on first use in these multi-page journeys.
test.describe.configure({ timeout: 120_000 });

function account(key: string) {
  return `smoke-${key}@example.test`;
}

function responseFor(page: Page, path: string, method: string) {
  return page.waitForResponse((response) =>
    new URL(response.url()).pathname === path && response.request().method() === method,
  );
}

async function submitLogin(page: Page, email: string, value = password) {
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(value);
  const response = responseFor(page, '/api/auth/login', 'POST');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  return response;
}

async function signIn(page: Page, key: string, workspace = 'traveler') {
  await page.goto('/login');
  expect((await submitLogin(page, account(key))).status()).toBe(200);
  await expect(page).toHaveURL(`${frontendOrigin}/workspace/${workspace}`);
}

function profileDetails(page: Page) {
  return page.getByRole('form').filter({ has: page.getByLabel('Preferred currency') });
}

function confirmation(page: Page) {
  return page.getByRole('dialog', { name: 'Deactivate your account?' });
}

test('registration validates input and consent, then preserves the protected URL through sign-in', async ({ page }) => {
  const email = `m2-register-${randomUUID()}@example.test`;
  const query = 'source=trip+budget&view=weekly&view=monthly';
  await page.goto(`/account/profile?${query}`);
  await expect(page).toHaveURL(/\/login\?/);
  await page.getByRole('main').getByRole('link', { name: 'Create an account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Create an account', exact: true })).toBeVisible();

  const consent = page.getByRole('checkbox', { name: /accept the terms and privacy policy/i });
  const submit = page.getByRole('button', { name: 'Create account', exact: true });
  await page.getByLabel('Email', { exact: true }).fill('invalid');
  await page.getByLabel('Password', { exact: true }).fill('weak');
  await submit.click();
  for (const label of ['Name', 'Email', 'Password']) {
    await expect(page.getByLabel(label, { exact: true })).toHaveAttribute('aria-invalid', 'true');
  }
  await expect(consent).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('Accept the terms and privacy policy to continue.')).toBeVisible();

  await page.getByLabel('Name', { exact: true }).fill('M2 Registered Traveler');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await consent.check();
  const registration = responseFor(page, '/api/auth/register', 'POST');
  await submit.click();
  const created = await registration;
  expect(created.status()).toBe(201);
  expect(await created.json()).toMatchObject({ email, role: 'USER' });
  await expect(page.getByText('Account created. Sign in to continue.')).toBeVisible();

  expect((await submitLogin(page, email)).status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Account profile', exact: true })).toBeVisible();
  const restored = new URL(page.url());
  expect(restored.pathname).toBe('/account/profile');
  expect(restored.searchParams.get('source')).toBe('trip budget');
  expect(restored.searchParams.getAll('view')).toEqual(['weekly', 'monthly']);
});

test('registration shows a duplicate email conflict next to its field', async ({ page }) => {
  await page.goto('/register');
  await page.getByLabel('Name', { exact: true }).fill('Duplicate Traveler');
  const email = page.getByLabel('Email', { exact: true });
  await email.fill(account('traveler'));
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('checkbox', { name: /accept the terms and privacy policy/i }).check();
  const duplicate = responseFor(page, '/api/auth/register', 'POST');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  expect((await duplicate).status()).toBe(409);
  await expect(email).toHaveAttribute('aria-invalid', 'true');
  await expect(email).toHaveAccessibleDescription(/email is already registered/i);
  await expect(page).toHaveURL(`${frontendOrigin}/register`);
});

test('profile edits validate and persist name, phone and a seeded currency', async ({ page }) => {
  await signIn(page, 'profile-edit');
  await page.goto('/account/profile');
  const name = page.getByLabel('Name', { exact: true });
  const phone = page.getByLabel('Phone number', { exact: true });
  const currency = page.getByLabel('Preferred currency', { exact: true });
  await expect(name).toHaveValue('M2 profile-edit fixture');
  const form = profileDetails(page);
  const save = page.getByRole('button', { name: 'Save changes', exact: true });

  await phone.fill('01234');
  await save.click();
  await expect(phone).toHaveAttribute('aria-invalid', 'true');
  await expect(phone).toHaveAccessibleDescription(/international number with \+ and 8 to 15 digits/);
  await expect(form.getByRole('alert')).toHaveText(/Check the highlighted fields and try again/);

  await name.fill('M2 Updated Traveler');
  await phone.fill('+201012345678');
  await currency.selectOption('EGP');
  const saved = responseFor(page, '/api/users/me', 'PATCH');
  await save.click();
  const response = await saved;
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({
    name: 'M2 Updated Traveler', phoneNumber: '+201012345678', preferredCurrency: 'EGP',
  });
  await expect(page.getByText('Profile saved.', { exact: true })).toBeVisible();
  await page.reload();
  await expect(name).toHaveValue('M2 Updated Traveler');
  await expect(phone).toHaveValue('+201012345678');
  await expect(currency).toHaveValue('EGP');
  await expect(page.getByText(account('profile-edit'), { exact: true })).toBeVisible();
});

test('deactivation confirmation cancels safely and surfaces an actual upcoming-booking block', async ({ page }) => {
  await signIn(page, 'deactivate-blocked');
  await page.goto('/account/profile');
  const trigger = page.getByRole('button', { name: 'Deactivate account', exact: true });
  await trigger.click();
  const dialog = confirmation(page);
  const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true });
  await expect(cancel).toBeFocused();
  await cancel.click();
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  expect((await page.request.get('/api/auth/me')).status()).toBe(200);

  await trigger.click();
  const blocked = responseFor(page, '/api/users/me/deactivate', 'POST');
  await dialog.getByRole('button', { name: 'Confirm deactivation', exact: true }).click();
  const response = await blocked;
  expect(response.status()).toBe(409);
  await expect(dialog.getByRole('alert')).toContainText(/Cancel your upcoming Confirmed bookings/i);
  expect((await page.request.get('/api/auth/me')).status()).toBe(200);
});

test('successful deactivation replaces the private page, clears cookies and prevents another login', async ({ page, context }) => {
  await signIn(page, 'deactivate');
  await page.goto('/account/profile');
  await page.getByRole('button', { name: 'Deactivate account', exact: true }).click();
  const deactivation = responseFor(page, '/api/users/me/deactivate', 'POST');
  await confirmation(page).getByRole('button', { name: 'Confirm deactivation', exact: true }).click();
  expect((await deactivation).status()).toBe(204);
  await expect(page).toHaveURL(`${frontendOrigin}/login?deactivated=1`);
  await expect(page.getByText('Your account has been deactivated.')).toBeVisible();
  expect((await context.cookies()).filter(({ name }) => name.startsWith('__Host-'))).toHaveLength(0);
  expect((await page.request.get('/api/auth/me')).status()).toBe(401);
  expect((await submitLogin(page, account('deactivate'))).status()).toBe(401);
  await expect(page.getByText('Invalid email or password', { exact: true })).toBeVisible();
});

test('a stale profile cannot edit or deactivate a different account signed in through another tab', async ({ page }) => {
  await signIn(page, 'deactivate-blocked');
  await page.goto('/account/profile');
  const name = page.getByLabel('Name', { exact: true });
  await expect(name).toHaveValue('M2 deactivate-blocked fixture');
  await name.fill('Stale profile edit');
  await page.getByRole('button', { name: 'Deactivate account', exact: true }).click();
  const dialog = confirmation(page);
  await expect(dialog).toBeVisible();

  // Request through the same context to replace its cookie jar without focusing the tab.
  const switchAccount = await page.request.post('/api/auth/login', {
    headers: { Origin: frontendOrigin },
    data: { email: account('profile-edit'), password },
  });
  expect(switchAccount.status()).toBe(200);
  const newAccount = await switchAccount.json() as { name: string; email: string };

  const blockedDeactivation = responseFor(page, '/api/users/me/deactivate', 'POST');
  await dialog.getByRole('button', { name: 'Confirm deactivation', exact: true }).click();
  expect((await blockedDeactivation).status()).toBe(409);
  await expect(dialog.getByRole('alert')).toContainText('Your account changed in another tab.');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();

  const blockedEdit = responseFor(page, '/api/users/me', 'PATCH');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  expect((await blockedEdit).status()).toBe(409);
  await expect(profileDetails(page).getByRole('alert')).toContainText('Your account changed in another tab.');
  const current = await page.request.get('/api/users/me');
  expect(current.status()).toBe(200);
  expect(await current.json()).toMatchObject({ name: newAccount.name, email: newAccount.email, status: 'ACTIVE' });
});

test('an unknown role segment shows the workspace not-found page', async ({ page }) => {
  await signIn(page, 'traveler');
  const response = await page.goto('/workspace/constructor');
  // Next may send an HTTP 200 shell before this segment resolves under Suspense.
  expect([200, 404]).toContain(response?.status());
  await expect(page.getByRole('heading', { name: 'Page not found', exact: true })).toBeVisible();
  await expect(page.locator('meta[name="robots"][content="noindex"]').first()).toBeAttached();
});

test('the fifth consecutive failed sign-in locks the account and blocks its correct password', async ({ page }) => {
  await page.goto('/login');
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const failed = await submitLogin(page, account('lockout'), 'WrongPassword2026');
    expect(failed.status()).toBe(401);
    await expect(page.getByText(attempt === 5 ? 'Account temporarily locked. Try again later.' : 'Invalid email or password', { exact: true })).toBeVisible();
  }
  const blocked = await submitLogin(page, account('lockout'));
  expect(blocked.status()).toBe(401);
  await expect(page.getByText('Account temporarily locked. Try again later.', { exact: true })).toBeVisible();
  expect((await page.request.get('/api/auth/me')).status()).toBe(401);
});

test('a suspended account sees its suspension notice after valid credentials', async ({ page }) => {
  await page.goto('/login');
  expect((await submitLogin(page, account('suspended'))).status()).toBe(403);
  await expect(page.getByText(/account is suspended/i)).toBeVisible();
  expect((await page.request.get('/api/auth/me')).status()).toBe(401);
});

test('an actual administrator reset revokes the old session and requires a new password', async ({ page, browser }) => {
  await signIn(page, 'admin-reset');
  const target = await (await page.request.get('/api/auth/me')).json() as { userId: string };
  const temporaryPassword = 'M2Temporary2026';
  const newPassword = 'M2Replacement2026';
  const adminContext = await browser.newContext({ baseURL: frontendOrigin });
  try {
    const admin = await adminContext.newPage();
    await signIn(admin, 'administrator', 'admin');
    const reset = await admin.evaluate(async ({ userId, temporaryPassword }) => {
      const response = await fetch(`/api/admin/users/${userId}/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ temporaryPassword }),
      });
      return response.status;
    }, { userId: target.userId, temporaryPassword });
    expect(reset).toBe(204);
  } finally {
    await adminContext.close();
  }

  expect((await page.request.get('/api/auth/me')).status()).toBe(401);
  await page.goto(`/login?returnTo=${encodeURIComponent('/account/profile?source=reset')}`);
  const login = await submitLogin(page, account('admin-reset'), temporaryPassword);
  expect(login.status()).toBe(200);
  expect(await login.json()).toEqual({ passwordChangeRequired: true });
  await expect(page).toHaveURL(/\/account\/security\?required=1/);
  expect((await page.request.get('/api/users/me')).status()).toBe(401);
  await page.getByLabel('Current password', { exact: true }).fill(temporaryPassword);
  await page.getByLabel('New password', { exact: true }).fill(newPassword);
  const confirm = page.getByLabel('Confirm new password', { exact: true });
  if (await confirm.count()) await confirm.fill(newPassword);
  const changed = responseFor(page, '/api/auth/change-password', 'PATCH');
  await page.getByRole('button', { name: 'Change password', exact: true }).click();
  expect((await changed).status()).toBe(204);
  await expect(page).toHaveURL(/\/login\?passwordChanged=1/);
  expect((await submitLogin(page, account('admin-reset'), newPassword)).status()).toBe(200);
  await expect(page).toHaveURL(`${frontendOrigin}/account/profile?source=reset`);
});

test('backend idle expiry ends a live browser session and protects private pages', async ({ page, request }) => {
  await signIn(page, 'idle-session');
  await expect(page.getByRole('heading', { name: 'Your workspace', exact: true })).toBeVisible();
  expect((await page.request.get('/api/auth/me')).status()).toBe(200);
  const backdated = await request.post(`${fixtureOrigin}/__m2-browser-fixture/expire-idle-session`, {
    headers: { 'X-M2-Browser-Fixture': 'account-e2e' },
  });
  expect(backdated.status()).toBe(204);
  expect((await page.request.get('/api/auth/me')).status()).toBe(401);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page).toHaveURL(/\/login\?/);
  await expect(page.getByText('Your session has ended. Sign in to continue.')).toBeVisible();
  await page.goto('/account/profile');
  await expect(page).toHaveURL(/\/login\?/);
  await expect(page.getByRole('heading', { name: 'Account profile', exact: true })).toHaveCount(0);
});
