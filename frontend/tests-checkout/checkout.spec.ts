import { expect, request as playwrightRequest, test, type Page } from '@playwright/test';

// PAY-01..PAY-04 checkout journeys: real Chrome, real Next proxy, real Nest app on a disposable database
// (scripts/payments-backend.cjs). Only Stripe is faked: the backend uses its FakeStripe with signed
// webhooks, and the browser gets the small fake Stripe.js below because js.stripe.com is not reachable here.

type Flight = { flightId: string; cabinId: string; date: string; flightNumber: string };
type Account = { email: string; password: string };
type FixturePayment = { found: boolean; paymentId?: string; intent?: string; status?: string };
type Hotel = { hotelId: string; roomId: string; hotelName: string; checkIn: string; checkOut: string };

async function fixture<T = Record<string, never>>(control: string, query: Record<string, string | number> = {}): Promise<T> {
  const context = await playwrightRequest.newContext();
  const params = new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]));
  const response = await context.post(`http://127.0.0.1:3120/__m2-payments-fixture/${control}?${params}`, { headers: { 'X-M2-Payments-Fixture': 'payments' } });
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

const adult = { fullName: 'Nour Hassan', dateOfBirth: '1995-04-12', documentNumber: 'A12345678', type: 'ADULT' };

async function hold(page: Page, flights: Flight[]): Promise<string> {
  const held = await api<{ flightBookingId: string }>(page, 'POST', '/flight-bookings/hold', { segments: flights.map(({ flightId, cabinId }) => ({ flightId, cabinId })), passengers: [adult] });
  expect(held.status, JSON.stringify(held.body)).toBe(201);
  return held.body.flightBookingId;
}

/** Pays through the API (used only to set up a confirmed booking for the flight-change journey). */
async function payByApi(page: Page, id: string) {
  expect((await api(page, 'POST', `/bookings/flight/${id}/accept-policies`, { accepted: true })).status).toBe(200);
  const started = await api<{ payment: { stripePaymentIntentId: string } }>(page, 'POST', '/payments', { bookingType: 'flight', bookingId: id });
  expect(started.status, JSON.stringify(started.body)).toBe(201);
  expect((await fixture<{ status: number }>('paid', { intent: started.body.payment.stripePaymentIntentId })).status).toBe(200);
}

/**
 * Just enough of Stripe.js for @stripe/react-stripe-js: isStripe() checks elements, createToken,
 * createPaymentMethod and confirmCardPayment; <PaymentElement> calls elements.create(), mount(), on('ready').
 * window.__fakeStripe.next chooses what confirmPayment answers. Like real Stripe, a success here proves
 * nothing to our backend: the test still sends the signed webhook.
 */
const FAKE_STRIPE_JS = `(() => {
  window.__fakeStripe = { next: 'succeed', confirmations: [] };
  function Stripe() {
    let clientSecret = '';
    return {
      _registerWrapper() {}, registerAppInfo() {},
      createToken() {}, createPaymentMethod() {}, confirmCardPayment() {},
      // Like Stripe, the intent's state outlives the page: kept per clientSecret in this tab.
      async retrievePaymentIntent(secret) {
        const status = sessionStorage.getItem('fake-intent:' + secret) || 'requires_payment_method';
        return { paymentIntent: { id: secret.split('_secret')[0], status } };
      },
      elements(options) {
        clientSecret = options && options.clientSecret;
        return {
          update() {}, getElement() { return null; }, async submit() { return {}; }, async fetchUpdates() { return {}; },
          create(type) {
            const handlers = {};
            let mounted = false;
            const fire = (event, value) => (handlers[event] || []).forEach(handler => setTimeout(() => handler(value), 0));
            return {
              mount(node) {
                const input = document.createElement('input');
                input.setAttribute('aria-label', 'Test card number');
                input.value = '4242 4242 4242 4242';
                node.appendChild(input);
                mounted = true;
                fire('ready', { elementType: type });
              },
              on(event, handler) {
                (handlers[event] = handlers[event] || []).push(handler);
                if (event === 'ready' && mounted) setTimeout(() => handler({ elementType: type }), 0);
              },
              off(event, handler) { handlers[event] = (handlers[event] || []).filter(h => h !== handler); },
              update() {}, unmount() {}, destroy() {},
            };
          },
        };
      },
      async confirmPayment({ confirmParams }) {
        window.__fakeStripe.confirmations.push({ clientSecret, returnUrl: confirmParams && confirmParams.return_url });
        if (window.__fakeStripe.next === 'decline') return { error: { type: 'card_error', code: 'card_declined', message: 'Your card was declined.' } };
        if (sessionStorage.getItem('fake-intent:' + clientSecret)) {
          return { error: { type: 'invalid_request_error', code: 'payment_intent_unexpected_state', message: 'This PaymentIntent was already confirmed.' } };
        }
        sessionStorage.setItem('fake-intent:' + clientSecret, 'processing');
        return { paymentIntent: { id: clientSecret.split('_secret')[0], status: 'processing' } };
      },
    };
  }
  Stripe.version = 'endive';
  window.Stripe = Stripe;
})();`;

/** Next briefly streams a hidden copy of the page outside <main>, so look only at what travelers see. */
const main = (page: Page) => page.locator('#main-content');

async function acceptPolicies(page: Page) {
  await expect(page.getByRole('button', { name: /^Pay \$/ })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Accept policies' })).toBeDisabled();
  await page.getByRole('checkbox', { name: /accept these cancellation/ }).check();
  await page.getByRole('button', { name: 'Accept policies' }).click();
  await expect(main(page).getByText(/Policies accepted on \d/)).toBeVisible();
}

async function paymentFor(query: { booking?: string; change?: string; hotel?: string }): Promise<Required<FixturePayment>> {
  const payment = await fixture<FixturePayment>('payment', query);
  expect(payment.found).toBe(true);
  return payment as Required<FixturePayment>;
}

let pageErrors: string[] = [];
test.beforeEach(async ({ page }) => {
  pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && /hydrat|Minified React/i.test(message.text())) pageErrors.push(message.text()); });
  await page.route('https://js.stripe.com/**', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: FAKE_STRIPE_JS }));
});
test.afterEach(() => { expect(pageErrors).toEqual([]); });

test.describe('PAY-01 and PAY-02: flight checkout', () => {
  test('a guest signs in and comes back to checkout (ACC-10)', async ({ page, context }) => {
    const flight = await fixture<Flight>('flight');
    const account = await newTraveler(page);
    const id = await hold(page, [flight]);
    await context.clearCookies();
    await page.goto(`/checkout/flight/${id}`);
    await expect(page).toHaveURL(/\/login\?returnTo=%2Fcheckout%2Fflight%2F[0-9a-f]{24}/);
    await page.getByLabel('Email', { exact: true }).fill(account.email);
    await page.getByLabel('Password', { exact: true }).fill(account.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Pay for your flight' })).toBeVisible();
  });

  test('policies must be accepted first; a paid booking is confirmed only by the signed webhook', async ({ page }) => {
    const flight = await fixture<Flight>('flight');
    await newTraveler(page);
    const id = await hold(page, [flight]);
    await page.goto(`/checkout/flight/${id}`);

    const summary = page.getByRole('complementary', { name: 'Payment summary' });
    await expect(summary).toContainText('$150.00');
    await expect(summary).toContainText(`CAI to DXB · ${flight.flightNumber}`);
    await expect(page.getByRole('timer')).toBeVisible();
    await expect(main(page).getByText('21 days or more before departure: 100% back')).toBeVisible();
    await expect(main(page).getByText(`Airline of ${flight.flightNumber}: $30.00 per extra bag, up to 2 per traveler`)).toBeVisible();
    for (const width of [360, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `width ${width}`).toBeLessThanOrEqual(0);
    }

    // PAY-02: the backend refuses payment before acceptance, and so does the page.
    const early = await api<{ message: string }>(page, 'POST', '/payments', { bookingType: 'flight', bookingId: id });
    expect(early.status).toBe(409);
    expect(early.body.message).toContain('accept the current booking policies');
    await acceptPolicies(page);

    const pay = page.getByRole('button', { name: 'Pay $150.00' });
    await expect(pay).toBeEnabled();
    await pay.dblclick(); // One payment confirmation, however eager the click.
    await expect(page).toHaveURL(new RegExp(`/checkout/result\\?type=flight&bookingId=${id}&paymentId=[0-9a-f]{24}$`));
    // Stripe accepted the card, but until the webhook arrives the page must not claim success.
    await expect(page.getByRole('heading', { name: 'Confirming your payment' })).toBeVisible();
    const confirmations = await page.evaluate(() => (window as unknown as { __fakeStripe: { confirmations: { returnUrl: string }[] } }).__fakeStripe?.confirmations ?? []);
    expect(confirmations).toHaveLength(1);
    expect(confirmations[0].returnUrl).toMatch(new RegExp(`^http://localhost:3121/checkout/result\\?type=flight&bookingId=${id}&paymentId=`));

    const payment = await paymentFor({ booking: id });
    expect(payment.status).toBe('PENDING');
    expect((await fixture<{ status: number }>('paid', { intent: payment.intent })).status).toBe(200);
    await expect(page.getByRole('heading', { name: 'Payment confirmed' })).toBeVisible();
    await expect(main(page).getByText('We received $150.00 and your booking is confirmed.')).toBeVisible();
    await page.getByRole('link', { name: 'View your ticket' }).click();
    await expect(page).toHaveURL(`/bookings/flights/${id}/ticket`);

    // Coming back to checkout after paying offers no second payment.
    await page.goto(`/checkout/flight/${id}`);
    await expect(page.getByRole('heading', { name: 'This booking is already paid' })).toBeVisible();
  });

  test('a declined card shows the reason and the traveler retries with a new payment attempt', async ({ page }) => {
    const flight = await fixture<Flight>('flight');
    await newTraveler(page);
    const id = await hold(page, [flight]);
    await page.goto(`/checkout/flight/${id}`);
    await acceptPolicies(page);
    await expect(page.getByRole('button', { name: 'Pay $150.00' })).toBeEnabled();
    const first = await paymentFor({ booking: id });

    await page.evaluate(() => { (window as unknown as { __fakeStripe: { next: string } }).__fakeStripe.next = 'decline'; });
    await page.getByRole('button', { name: 'Pay $150.00' }).click();
    await expect(main(page).getByText('Your payment did not go through')).toBeVisible();
    await expect(main(page).getByText('Your card was declined.')).toBeVisible();
    // Stripe's side of the decline: the signed payment_intent.payment_failed webhook.
    expect((await fixture<{ status: number }>('declined', { intent: first.intent })).status).toBe(200);
    expect((await paymentFor({ booking: id })).status).toBe('FAILED');

    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByRole('button', { name: 'Pay $150.00' })).toBeEnabled();
    const second = await paymentFor({ booking: id });
    expect(second.paymentId).toBe(first.paymentId); // Same Payment record, retried.
    expect(second.intent).not.toBe(first.intent); // New PaymentIntent.
    expect(second.status).toBe('PENDING');

    await page.evaluate(() => { (window as unknown as { __fakeStripe: { next: string } }).__fakeStripe.next = 'succeed'; });
    await page.getByRole('button', { name: 'Pay $150.00' }).click();
    await expect(page).toHaveURL(/\/checkout\/result\?/);
    await fixture('paid', { intent: second.intent });
    await expect(page.getByRole('heading', { name: 'Payment confirmed' })).toBeVisible();
  });

  test('a failed payment on the result page offers a retry through checkout', async ({ page }) => {
    const flight = await fixture<Flight>('flight');
    await newTraveler(page);
    const id = await hold(page, [flight]);
    await page.goto(`/checkout/flight/${id}`);
    await acceptPolicies(page);
    await page.getByRole('button', { name: 'Pay $150.00' }).click();
    await expect(page.getByRole('heading', { name: 'Confirming your payment' })).toBeVisible();
    const payment = await paymentFor({ booking: id });
    await fixture('declined', { intent: payment.intent, message: 'Your card has insufficient funds.' });
    await expect(page.getByRole('heading', { name: 'Your payment did not go through' })).toBeVisible();
    await expect(main(page).getByText('Your card has insufficient funds.')).toBeVisible();

    await page.getByRole('link', { name: 'Try again' }).click();
    await expect(page).toHaveURL(`/checkout/flight/${id}`);
    await acceptPolicies(page);
    // POST /payments answers "The last payment failed. Use POST /api/payments/<id>/retry"; checkout follows it.
    await expect(page.getByRole('button', { name: 'Pay $150.00' })).toBeEnabled();
    const retried = await paymentFor({ booking: id });
    expect(retried.intent).not.toBe(payment.intent);
    expect(retried.status).toBe('PENDING');
  });

  test('an expired hold blocks payment, also when it ends on the open page', async ({ page }) => {
    const flight = await fixture<Flight>('flight');
    await newTraveler(page);
    const ended = await hold(page, [flight]);
    await fixture('hold-ends', { booking: ended });
    await page.goto(`/checkout/flight/${ended}`);
    await expect(page.getByRole('heading', { name: 'Your hold has expired' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Back to booking' })).toHaveAttribute('href', `/bookings/flights/${ended}`);
    expect((await api(page, 'POST', '/payments', { bookingType: 'flight', bookingId: ended })).status).toBe(409);

    const flight2 = await fixture<Flight>('flight');
    const ending = await hold(page, [flight2]);
    await fixture('hold-ends', { booking: ending, seconds: 5 });
    await page.goto(`/checkout/flight/${ending}`);
    await expect(page.getByRole('heading', { name: 'Pay for your flight' })).toBeVisible();
    // When the countdown ends the page asks the server, which says the hold is over.
    await expect(page.getByRole('heading', { name: 'Your hold has expired' })).toBeVisible({ timeout: 20_000 });
  });
});

test.describe('ACC-10/ACC-11 and the email gate', () => {
  test('another traveler’s booking is not found, and other roles are denied', async ({ page }) => {
    const flight = await fixture<Flight>('flight');
    await newTraveler(page);
    const id = await hold(page, [flight]);
    await newTraveler(page);
    await page.goto(`/checkout/flight/${id}`);
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await page.goto(`/checkout/result?type=flight&bookingId=${id}&paymentId=${id}`);
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await page.goto('/checkout/boat/0123456789abcdef01234567');
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();

    await newTraveler(page, { role: 'ADMIN' });
    await page.goto(`/checkout/flight/${id}`);
    await expect(page.getByRole('heading', { name: 'Access denied' })).toBeVisible();
  });

  test('an unverified traveler is sent to verify before paying', async ({ page }) => {
    const flight = await fixture<Flight>('flight');
    const account = await newTraveler(page);
    const id = await hold(page, [flight]);
    // Holding needs a verified email as well, so the address stops counting as verified only now.
    await fixture('unverify', { email: account.email });
    await page.goto(`/checkout/flight/${id}`);
    await acceptPolicies(page);
    await expect(main(page).getByText('Verify your email before booking.')).toBeVisible();
    await expect(main(page).getByRole('link', { name: 'Verify your email' })).toHaveAttribute('href', `/verify-email?returnTo=${encodeURIComponent(`/checkout/flight/${id}`)}`);
    await expect(page.getByRole('button', { name: 'Pay $150.00' })).toHaveCount(0);
  });
});

test.describe('FLT-27: higher-fare flight change', () => {
  async function confirmedWithChange(page: Page, price: number) {
    const current = await fixture<Flight>('flight', { days: 30 });
    const next = await fixture<Flight>('flight', { days: 33, hour: 11, price });
    await newTraveler(page);
    const id = await hold(page, [current]);
    await payByApi(page, id);
    const change = await api<{ flightBookingChangeId: string }>(page, 'POST', `/flight-bookings/${id}/changes`, { segments: [{ flightId: next.flightId, cabinId: next.cabinId }] });
    expect(change.status, JSON.stringify(change.body)).toBe(201);
    return { id, next, changeId: change.body.flightBookingChangeId };
  }

  test('the fare difference is paid in checkout and the traveler returns to the change page', async ({ page }) => {
    const { id, next, changeId } = await confirmedWithChange(page, 21000);
    await page.goto(`/checkout/flight-change/${changeId}`);
    await expect(page.getByRole('heading', { name: 'Pay the fare difference' })).toBeVisible();
    const summary = page.getByRole('complementary', { name: 'Payment summary' });
    await expect(summary).toContainText('$60.00');
    await expect(summary).toContainText(`New flight: CAI to DXB · ${next.flightNumber}`);
    await expect(main(page).getByRole('heading', { name: 'Your change' })).toBeVisible();
    await acceptPolicies(page);
    await page.getByRole('button', { name: 'Pay $60.00' }).click();
    await expect(page).toHaveURL(new RegExp(`/checkout/result\\?type=flight-change&bookingId=${changeId}&`));
    const payment = await paymentFor({ change: changeId });
    await fixture('paid', { intent: payment.intent });
    await expect(page.getByRole('heading', { name: 'Payment confirmed' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Back to your change' })).toHaveAttribute('href', `/bookings/flights/${id}/change?change=${changeId}`);
  });

  test('an equal fare never reaches payment', async ({ page }) => {
    const { id, changeId } = await confirmedWithChange(page, 15000);
    await page.goto(`/checkout/flight-change/${changeId}`);
    await expect(page.getByRole('heading', { name: 'Nothing to pay for this change' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Back to your change' })).toHaveAttribute('href', `/bookings/flights/${id}/change?change=${changeId}`);
  });
});

test.describe('PAY-01 and PAY-02: hotel checkout', () => {
  test('hotel policies show check-in/out and tiers; payment confirmed by the webhook returns to the hotel booking', async ({ page }) => {
    const hotel = await fixture<Hotel>('hotel');
    await newTraveler(page);
    const held = await api<{ hotelBookingId: string }>(page, 'POST', '/hotel-bookings', {
      hotelId: hotel.hotelId, checkIn: hotel.checkIn, checkOut: hotel.checkOut, rooms: [{ roomId: hotel.roomId, adults: 2, childrenAges: [] }],
    });
    expect(held.status, JSON.stringify(held.body)).toBe(201);
    const id = held.body.hotelBookingId;

    await page.goto(`/checkout/hotel/${id}`);
    await expect(page.getByRole('heading', { name: 'Pay for your stay' })).toBeVisible();
    const summary = page.getByRole('complementary', { name: 'Payment summary' });
    await expect(summary).toContainText(hotel.hotelName);
    await expect(summary).toContainText('3 nights');
    await expect(summary).toContainText('$375.00');
    await expect(main(page).getByText('14 days or more before check-in: 100% back')).toBeVisible();
    await expect(main(page).getByText('3 days or more before check-in: 50% back')).toBeVisible();
    await expect(main(page).getByText('Check-in from 15:00 · Check-out by 11:00 (hotel local time)')).toBeVisible();
    await expect(main(page).getByRole('heading', { name: 'Extra baggage' })).toHaveCount(0);

    await acceptPolicies(page);
    await page.getByRole('button', { name: 'Pay $375.00' }).click();
    await expect(page).toHaveURL(new RegExp(`/checkout/result\\?type=hotel&bookingId=${id}&`));
    await expect(page.getByRole('heading', { name: 'Confirming your payment' })).toBeVisible();
    const payment = await paymentFor({ hotel: id });
    await fixture('paid', { intent: payment.intent });
    await expect(page.getByRole('heading', { name: 'Payment confirmed' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'View your booking' })).toHaveAttribute('href', `/bookings/hotels/${id}`);
  });
});

test.describe('Edge cases from review', () => {
  async function heldCheckout(page: Page) {
    const flight = await fixture<Flight>('flight');
    await newTraveler(page);
    const id = await hold(page, [flight]);
    await page.goto(`/checkout/flight/${id}`);
    await acceptPolicies(page);
    return id;
  }

  test('a payment that succeeds after the hold ended is not "confirmed": it is refunded', async ({ page }) => {
    const id = await heldCheckout(page);
    await page.getByRole('button', { name: 'Pay $150.00' }).click();
    await expect(page.getByRole('heading', { name: 'Confirming your payment' })).toBeVisible();
    const payment = await paymentFor({ booking: id });
    await fixture('hold-ends', { booking: id });
    expect((await fixture<{ status: number }>('paid', { intent: payment.intent })).status).toBe(200);
    expect((await paymentFor({ booking: id })).status).toBe('SUCCEEDED'); // The money arrived...
    await expect(page.getByRole('heading', { name: 'Your hold ended before the payment completed' })).toBeVisible();
    await expect(main(page).getByText('If you were charged, the full amount is refunded')).toBeVisible();
    await expect(main(page).getByRole('region', { name: 'Payment' })).toContainText('$150.00');
    await expect(page.getByRole('heading', { name: 'Payment confirmed' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'View your ticket' })).toHaveCount(0);
    // ...and a fresh server render says the same.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Your hold ended before the payment completed' })).toBeVisible();
  });

  test('an amount mismatch is sent to an admin, with no retry', async ({ page }) => {
    const id = await heldCheckout(page);
    await page.getByRole('button', { name: 'Pay $150.00' }).click();
    await expect(page.getByRole('heading', { name: 'Confirming your payment' })).toBeVisible();
    const payment = await paymentFor({ booking: id });
    await fixture('paid', { intent: payment.intent, amount: 100 });
    await expect(page.getByRole('heading', { name: 'We are checking this payment' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Try again' })).toHaveCount(0);
  });

  test('Back from a submitted payment does not offer to pay the same intent again', async ({ page }) => {
    const id = await heldCheckout(page);
    await page.getByRole('button', { name: 'Pay $150.00' }).click();
    await expect(page.getByRole('heading', { name: 'Confirming your payment' })).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(`/checkout/flight/${id}`);
    await acceptPolicies(page);
    // Stripe says this intent is already processing, so checkout goes straight back to the result page.
    await expect(page).toHaveURL(/\/checkout\/result\?/);
    await expect(page.getByRole('heading', { name: 'Confirming your payment' })).toBeVisible();
    const confirmations = await page.evaluate(() => (window as unknown as { __fakeStripe: { confirmations: unknown[] } }).__fakeStripe.confirmations.length);
    expect(confirmations).toBeLessThanOrEqual(1);

    await fixture('paid', { intent: (await paymentFor({ booking: id })).intent });
    await expect(page.getByRole('heading', { name: 'Payment confirmed' })).toBeVisible();
    // Back again after the confirmation: the page ends on "already paid", never on a raw 409.
    await page.goBack();
    await expect(page).toHaveURL(`/checkout/flight/${id}`);
    // The router shows its stale copy of checkout; accepting there gets a 409 and the page refreshes itself.
    const stale = page.getByRole('checkbox', { name: /accept these cancellation/ });
    await expect(stale).toBeVisible();
    await stale.check();
    await page.getByRole('button', { name: 'Accept policies' }).click();
    await expect(page.getByRole('heading', { name: 'This booking is already paid' })).toBeVisible();
  });

  test('reloading after accepting asks again and reuses the open payment', async ({ page }) => {
    const id = await heldCheckout(page);
    await expect(page.getByRole('button', { name: 'Pay $150.00' })).toBeEnabled();
    const first = await paymentFor({ booking: id });
    await page.reload();
    await expect(page.getByRole('checkbox', { name: /accept these cancellation/ })).not.toBeChecked();
    await acceptPolicies(page);
    await expect(page.getByRole('button', { name: 'Pay $150.00' })).toBeEnabled();
    expect((await paymentFor({ booking: id })).intent).toBe(first.intent);
  });

  test('the result page trusts neither the query string nor a mismatched type', async ({ page }) => {
    const id = await heldCheckout(page);
    await page.getByRole('button', { name: 'Pay $150.00' }).click();
    await expect(page).toHaveURL(/\/checkout\/result\?/);
    const paymentId = new URL(page.url()).searchParams.get('paymentId')!;
    await page.goto(`/checkout/result?type=hotel&bookingId=${id}&paymentId=${paymentId}`);
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await page.goto(`/checkout/result?type=flight&bookingId=${id}&paymentId=${paymentId}&redirect_status=succeeded`);
    await expect(page.getByRole('heading', { name: 'Confirming your payment' })).toBeVisible();
  });

  test('the result page stops and offers sign-in when the session ends', async ({ page, context }) => {
    await heldCheckout(page);
    await page.getByRole('button', { name: 'Pay $150.00' }).click();
    await expect(page.getByRole('heading', { name: 'Confirming your payment' })).toBeVisible();
    await context.clearCookies();
    await expect(main(page).getByText('Your session has ended', { exact: true })).toBeVisible();
    await expect(main(page).getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', /^\/login\?returnTo=%2Fcheckout%2Fresult/);
  });

  test('an old result link for a paid, then cancelled booking says so (not "hold ended")', async ({ page }) => {
    const id = await heldCheckout(page);
    await page.getByRole('button', { name: 'Pay $150.00' }).click();
    await expect(page.getByRole('heading', { name: 'Confirming your payment' })).toBeVisible();
    const resultUrl = new URL(page.url()).pathname + new URL(page.url()).search;
    await fixture('paid', { intent: (await paymentFor({ booking: id })).intent });
    await expect(page.getByRole('heading', { name: 'Payment confirmed' })).toBeVisible();
    const cancelled = await api(page, 'POST', `/flight-bookings/${id}/cancel`);
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);

    await page.goto(resultUrl);
    await expect(page.getByRole('heading', { name: 'This booking was paid and later cancelled' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Your hold ended before the payment completed' })).toHaveCount(0);
    await expect(main(page).getByRole('region', { name: 'Payment' })).toContainText('$150.00');
    await expect(main(page).getByRole('region', { name: 'Refund' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'View booking' })).toHaveAttribute('href', `/bookings/flights/${id}`);
  });

  test('a long wait ends in "still processing" with Check again', async ({ page }) => {
    test.setTimeout(150_000);
    const id = await heldCheckout(page);
    await page.getByRole('button', { name: 'Pay $150.00' }).click();
    await expect(page.getByRole('button', { name: 'Check again' })).toBeVisible({ timeout: 100_000 });
    await expect(main(page).getByText('Your payment is still processing')).toBeVisible();
    await fixture('paid', { intent: (await paymentFor({ booking: id })).intent });
    await page.getByRole('button', { name: 'Check again' }).click();
    await expect(page.getByRole('heading', { name: 'Payment confirmed' })).toBeVisible();
  });
});
