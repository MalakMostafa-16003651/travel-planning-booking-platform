import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const initialPassword = 'TravelFixture1234';
const resetPassword = 'TravelFixture5678';
const backendOrigin = 'http://127.0.0.1:3100';
const genericRecovery = 'If an eligible account exists, a password reset link will be sent.';

function testAddress(prefix: string): string {
  return `${prefix}-${randomUUID()}@example.test`;
}

async function registerFixtureAccount(page: Page, email: string) {
  await page.goto('/');
  const status = await page.evaluate(async ({ email, password }) => {
    const response = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'M2 email test traveler', email, password, termsAccepted: true }),
    });
    return response.status;
  }, { email, password: initialPassword });
  expect(status).toBe(201);
}

async function submitSignIn(page: Page, email: string, password: string) {
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

async function mailLink(
  request: APIRequestContext,
  email: string,
  purpose: 'reset-password' | 'verify-email',
  expectedCount: number,
): Promise<string> {
  let latestLink: string | undefined;
  await expect.poll(async () => {
    const response = await request.get(`${backendOrigin}/__m2-browser-fixture/mail-link`, {
      params: { email, purpose },
      headers: { 'x-m2-test-fixture': 'm2-auth-mail-only' },
    });
    if (!response.ok()) return 0;
    const record = await response.json() as { count: number; link: string | null };
    latestLink = record.link ?? undefined;
    return record.count;
  }).toBe(expectedCount);

  if (!latestLink) throw new Error('The fixture mailbox received no link.');
  return latestLink;
}

async function requestReset(page: Page, email: string) {
  await page.goto('/forgot-password');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  return page.getByRole('status').filter({ hasText: genericRecovery });
}

async function fillResetForm(page: Page) {
  await page.getByLabel('New password', { exact: true }).fill(resetPassword);
  await page.getByLabel('Confirm new password').fill(resetPassword);
}

async function bookingHoldStatus(page: Page) {
  return page.evaluate(async () => {
    const response = await fetch('/api/flight-bookings/hold', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    return response.status;
  });
}

test('verification opens the booking gate and accepts only the latest unused email link', async ({ page, request }) => {
  const email = testAddress('m2-verification');
  await registerFixtureAccount(page, email);
  const registrationLink = await mailLink(request, email, 'verify-email', 1);
  await page.goto('/verify-email?returnTo=%2Faccount%2Fprofile');
  await page.getByRole('link', { name: 'Sign in to resend' }).click();
  await expect(page).toHaveURL(/\/login\?returnTo=/);
  await submitSignIn(page, email, initialPassword);
  await expect(page).toHaveURL(/\/verify-email\?returnTo=%2Faccount%2Fprofile$/);

  await expect(page.getByText('Verify your email before you make a booking.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back', exact: true })).toHaveAttribute('href', '/account/profile');
  // An empty hold request cannot reserve anything. It distinguishes denial by
  // the email guard from validation after the guard allows this account.
  expect(await bookingHoldStatus(page)).toBe(403);

  await page.getByRole('button', { name: 'Resend verification email' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'If verification is needed, a verification link will be sent.' })).toBeVisible();
  const latestLink = await mailLink(request, email, 'verify-email', 2);

  await page.goto(registrationLink);
  await expect(page).toHaveURL(/\/verify-email$/);
  await page.getByRole('button', { name: 'Verify email', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'This verification link is invalid or expired.' })).toBeVisible();

  await page.goto(latestLink);
  await expect(page).toHaveURL(/\/verify-email$/);
  expect(await bookingHoldStatus(page)).toBe(403);
  await page.getByRole('button', { name: 'Verify email', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Email verified.' })).toBeVisible();
  expect(await bookingHoldStatus(page)).toBe(400);

  await page.goto(latestLink);
  await page.getByRole('button', { name: 'Verify email', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'This verification link is invalid or expired.' })).toBeVisible();
  await expect(page.getByText('Your email is verified.', { exact: true })).toBeVisible();
});

test('password recovery preserves a generic response and requires fresh sign-in after reset', async ({ page, request, context }) => {
  const email = testAddress('m2-recovery');
  await registerFixtureAccount(page, email);
  await page.goto('/login');
  await submitSignIn(page, email, initialPassword);
  await expect(page).toHaveURL(/\/workspace\/traveler(?:\?|$)/);

  await expect(await requestReset(page, testAddress('m2-unknown'))).toBeVisible();
  await expect(await requestReset(page, email)).toBeVisible();
  const firstLink = await mailLink(request, email, 'reset-password', 1);
  await expect(await requestReset(page, email)).toBeVisible();
  const latestLink = await mailLink(request, email, 'reset-password', 2);

  await page.goto(firstLink);
  await expect(page).toHaveURL(/\/reset-password$/);
  await fillResetForm(page);
  await page.getByRole('button', { name: 'Reset password', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'This password reset link is missing, invalid or expired.' })).toBeVisible();

  await page.goto(latestLink);
  await expect(page).toHaveURL(/\/reset-password$/);
  await fillResetForm(page);
  await page.getByRole('button', { name: 'Reset password', exact: true }).click();
  await expect(page).toHaveURL(/\/login\?passwordChanged=1$/);
  await expect(page.getByRole('status').filter({ hasText: 'Sign in with your new password.' })).toBeVisible();
  expect((await context.cookies()).some(cookie => cookie.name === '__Host-accessToken')).toBe(false);

  await page.goto(latestLink);
  await fillResetForm(page);
  await page.getByRole('button', { name: 'Reset password', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'This password reset link is missing, invalid or expired.' })).toBeVisible();

  await page.goto('/login');
  await submitSignIn(page, email, resetPassword);
  await expect(page).toHaveURL(/\/workspace\/traveler(?:\?|$)/);
});
