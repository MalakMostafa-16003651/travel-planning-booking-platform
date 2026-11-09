import { UserRole } from '../src/common/enums/user-role.enum';
import { CreateFlightBookingDto } from '../src/flight-bookings/dto/create-flight-booking.dto';
import { PaymentsService } from '../src/payments/payments.service';
import { PoliciesService } from '../src/payments/policies.service';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { after, before, beforeEach, describe, it, mock } from 'node:test';
import { ConfigService } from '@nestjs/config';
import { ExecutionContext } from '@nestjs/common';
import { Types } from 'mongoose';
import { AuthActionLimitsService } from '../src/auth/auth-action-limits.service';
import { AuthMailQueueService } from '../src/auth/auth-mail-queue.service';
import { EmailEligibilityService } from '../src/auth/email-eligibility.service';
import { readEmailVerificationRequired } from '../src/auth/email-verification.config';
import { EMAIL_VERIFICATION_TTL_MS, EmailVerificationService } from '../src/auth/email-verification.service';
import { EmailVerification } from '../src/auth/schemas/email-verification.schema';
import { VerifiedEmailGuard } from '../src/auth/verified-email.guard';
import { AccountStatus } from '../src/common/enums/account-status.enum';
import { MailService } from '../src/mail/mail.service';
import { StripeService } from '../src/payments/stripe.service';
import { UsersService } from '../src/users/users.service';
import { FakeStripe, TEST_STRIPE_CONFIG } from './fake-stripe';
import { PaymentsFixture } from './payments-fixture';

type Session = { cookie: string; userId: string };
interface Mail { to: string; subject: string; text: string }
const fixture = new PaymentsFixture();
const sent: Mail[] = [];
let configured = true, sendHook: ((message: Mail) => Promise<void>) | undefined;
const mail = { isConfigured: () => configured, assertConfigured() { if (!configured) throw new Error('Mail unavailable'); }, async send(message: Mail) { if (sendHook) await sendHook(message); sent.push(message); } };
function token(mail: Mail): string { const result = /#token=([a-f0-9]{64})/.exec(mail.text); assert.ok(result); return result[1]; }
function deferred() { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { resolve, promise }; }

describe('ACC-02 account email verification and shared HTTP booking access', { concurrency: false }, () => {
  let verification: EmailVerificationService, queue: AuthMailQueueService, stripe: FakeStripe;
  const proofs = () => fixture.connection.collection('emailverifications');
  const http = () => fixture.http();
  const verify = (value: string) => http().post('/api/auth/verify-email').send({ token: value });
  async function login(email = 'verify@example.com'): Promise<Session> { const session = await fixture.login(email); await queue.whenIdle(); return session; }
  function latest(email = 'verify@example.com', subject = 'Verify your'): string { const message = [...sent].reverse().find((item) => item.to === email && item.subject.includes(subject)); assert.ok(message); return token(message); }
  async function resend(owner: Session) { const result = await http().post('/api/auth/resend-verification').set('Cookie', owner.cookie).send({}).expect(202); await queue.whenIdle(); return result; }
  before(async () => {
    await fixture.start('email-verification', (builder) => builder.overrideProvider(MailService).useValue(mail), {
      ...TEST_STRIPE_CONFIG, EMAIL_VERIFICATION_REQUIRED: 'true', EMAIL_VERIFICATION_URL: 'https://client.example/verify-email', PASSWORD_RESET_URL: 'https://client.example/reset-password',
    });
    verification = fixture.app.get(EmailVerificationService); queue = fixture.app.get(AuthMailQueueService);
  }, { timeout: 120_000 });
  beforeEach(async () => { await queue.whenIdle(); await fixture.reset(); sent.length = 0; sendHook = undefined; configured = true; stripe = new FakeStripe(); stripe.install(fixture.app.get(StripeService)); });
  after(async () => { await queue?.whenIdle(); await fixture.stop(); });

  it('sends verification after registration, preserves the safe registration response and exposes only own boolean status', async () => {
    const owner = await login(); assert.equal(sent.length, 1); assert.equal(sent[0].to, 'verify@example.com');
    const row = (await proofs().findOne({}))!; const value = latest();
    assert.equal(row.tokenHash, createHash('sha256').update(value).digest('hex'));
    assert.equal(row.expiresAt.getTime() - row.createdAt.getTime(), EMAIL_VERIFICATION_TTL_MS);
    assert.equal(JSON.stringify(row).includes(value), false); assert.equal(JSON.stringify(row).includes('verify@example.com'), false);
    const status = await http().get('/api/auth/email-verification?userId=' + new Types.ObjectId()).set('Cookie', owner.cookie).expect(200);
    assert.deepEqual(status.body, { emailVerified: false, requiredForBooking: true }); assert.equal(status.headers['cache-control'], 'no-store');
    const me = await http().get('/api/auth/me').set('Cookie', owner.cookie).expect(200); assert.equal('emailVerifiedAt' in me.body, false);
    assert.equal('emailVerifiedAt' in (await fixture.users.findById(owner.userId).lean().exec())!, false);
    assert.ok((await proofs().indexes()).some((index) => index.expireAfterSeconds === 0));
  });
  it('verification is single-use and preserves passwords, roles, status, credential epochs and existing sessions', async () => {
    const owner = await login(), before = (await fixture.users.findById(owner.userId).select('+passwordHash +credentialVersion').exec())!;
    const result = await verify(latest()).expect(204); assert.equal(result.headers['set-cookie'], undefined);
    const after = (await fixture.users.findById(owner.userId).select('+passwordHash +credentialVersion +emailVerifiedAt').exec())!;
    assert.equal(after.passwordHash, before.passwordHash); assert.equal(after.credentialVersion, before.credentialVersion); assert.equal(after.role, before.role); assert.equal(after.status, before.status); assert.ok(after.emailVerifiedAt instanceof Date);
    await verify(latest()).expect(400);
    await http().get('/api/auth/me').set('Cookie', owner.cookie).expect(200); await http().get('/api/auth/me').expect(401);
    assert.deepEqual((await http().get('/api/auth/email-verification').set('Cookie', owner.cookie).expect(200)).body, { emailVerified: true, requiredForBooking: true });
  });
  it('allows only one concurrent verification and commits the timestamp once', async () => {
    const owner = await login(), value = latest(); const results = await Promise.all([verify(value), verify(value)]);
    assert.deepEqual(results.map((result) => result.status).sort(), [204, 400]);
    const timestamp = (await fixture.users.findById(owner.userId).select('+emailVerifiedAt').exec())!.emailVerifiedAt!.getTime();
    await verify(value).expect(400); assert.equal((await fixture.users.findById(owner.userId).select('+emailVerifiedAt').exec())!.emailVerifiedAt!.getTime(), timestamp);
  });
  it('resends only for the current user and invalidates previous links', async () => {
    const owner = await login(), first = latest(); await resend(owner); const second = latest(); assert.notEqual(first, second);
    await verify(first).expect(400); await verify(second).expect(204); const count = sent.length; await resend(owner); assert.equal(sent.length, count);
    await http().post('/api/auth/resend-verification').send({}).expect(401);
  });
  it('rejects expired links despite eventual TTL cleanup', async () => {
    const owner = await login(); await proofs().updateOne({}, { $set: { expiresAt: new Date(0) } });
    await verify(latest()).expect(400); assert.equal((await verification.status(owner.userId)).emailVerified, false);
  });
  it('rejects spoofed verification fields and never accepts a caller-selected email or user', async () => {
    const owner = await login();
    for (const field of ['emailVerified', 'emailVerifiedAt']) {
      await http().post('/api/auth/register').send({ name: 'Spoof', email: field + '@example.com', password: 'Travel123', termsAccepted: true, [field]: true }).expect(400);
      await http().patch('/api/users/me').set('Cookie', owner.cookie).send({ [field]: true }).expect(400);
    }
    await http().post('/api/auth/resend-verification').set('Cookie', owner.cookie).send({ userId: new Types.ObjectId().toString(), email: 'other@example.com' }).expect(400);
    await http().post('/api/auth/verify-email').send({ token: latest(), userId: new Types.ObjectId().toString() }).expect(400);
    for (const value of ['', 42, 'a'.repeat(63), 'z'.repeat(64)]) await http().post('/api/auth/verify-email').send({ token: value }).expect(400);
    assert.equal((await verification.status(owner.userId)).emailVerified, false);
  });
  it('binds the proof to the current email and cannot verify a changed address using an old link', async () => {
    const owner = await login(), previous = latest(); await fixture.users.updateOne({ _id: owner.userId }, { $set: { email: 'changed@example.com' } });
    await verify(previous).expect(400); await resend(owner); assert.equal(sent[sent.length - 1].to, 'changed@example.com'); await verify(latest('changed@example.com')).expect(204);
  });
  it('never reactivates suspended/deactivated accounts through a verification link', async () => {
    const owner = await login(), value = latest();
    for (const status of [AccountStatus.SUSPENDED, AccountStatus.DEACTIVATED]) {
      await fixture.users.updateOne({ _id: owner.userId }, { $set: { status } }); await verify(value).expect(400);
      assert.equal((await fixture.users.findById(owner.userId))!.status, status);
    }
  });
  it('rolls proof consumption back if the account update fails and permits a safe retry', async () => {
    const owner = await login(), value = latest(); const failure = mock.method(fixture.app.get(UsersService), 'markEmailVerified', async () => { throw new Error('injected account write failure'); });
    try { const result = await verify(value).expect(500); assert.equal(result.headers['set-cookie'], undefined); assert.equal(await proofs().countDocuments({}), 1); }
    finally { failure.mock.restore(); }
    assert.equal((await verification.status(owner.userId)).emailVerified, false); await verify(value).expect(204);
  });
  it('keeps password-reset and verification tokens purpose-separated', async () => {
    const owner = await login(), verificationToken = latest();
    await http().post('/api/auth/forgot-password').send({ email: 'verify@example.com' }).expect(202); await queue.whenIdle(); const resetToken = latest('verify@example.com', 'Reset your');
    await verify(resetToken).expect(400); await http().post('/api/auth/reset-password').send({ token: verificationToken, newPassword: 'Replacement456' }).expect(400);
    await verify(verificationToken).expect(204); await http().post('/api/auth/reset-password').send({ token: resetToken, newPassword: 'Replacement456' }).expect(204);
    assert.equal((await verification.status(owner.userId)).emailVerified, true);
  });
  it('blocks real flight holds before inventory changes and permits them after verification using the same cookie', async () => {
    const owner = await login(); await http().post('/api/flight-bookings/hold').set('Cookie', owner.cookie).send({}).expect(403);
    assert.equal(await fixture.connection.collection('flightbookings').countDocuments({}), 0);
    assert.equal(await fixture.connection.collection('cabininventories').countDocuments({}), 0);
    await verify(latest()).expect(204); const booking = await fixture.holdBooking(owner.cookie); assert.ok(booking);
    assert.equal(await fixture.connection.collection('flightbookings').countDocuments({}), 1);
  });
  it('blocks payment creation and retry before Stripe side effects while allowing existing booking reads', async () => {
    const owner = await login(); await verify(latest()).expect(204); const bookingId = await fixture.holdBooking(owner.cookie);
    await http().post('/api/bookings/flight/' + bookingId + '/accept-policies').set('Cookie', owner.cookie).send({ accepted: true }).expect(200);
    await fixture.users.updateOne({ _id: owner.userId }, { $unset: { emailVerifiedAt: '' } });
    await http().get('/api/flight-bookings/' + bookingId).set('Cookie', owner.cookie).expect(200);
    for (const path of ['/api/payments', '/API/PAYMENTS/', '/api/payments?ignored=1']) await http().post(path).set('Cookie', owner.cookie).send({ bookingType: 'flight', bookingId }).expect(403);
    assert.equal(stripe.calls.createIntent, 0); assert.equal(await fixture.connection.collection('payments').countDocuments({}), 0);
    await resend(owner); await verify(latest()).expect(204);
    const created = await http().post('/api/payments').set('Cookie', owner.cookie).send({ bookingType: 'flight', bookingId }).expect(201);
    await fixture.connection.collection('payments').updateOne({ _id: new Types.ObjectId(created.body.payment._id) }, { $set: { status: 'FAILED', failureReason: 'Test decline' } });
    await fixture.users.updateOne({ _id: owner.userId }, { $set: { emailVerifiedAt: null } });
    const intent = stripe.intent(created.body.payment.stripePaymentIntentId); const previousStatus = intent.status;
    await http().post('/api/payments/' + created.body.payment._id + '/retry').set('Cookie', owner.cookie).expect(403);
    assert.equal(stripe.calls.createIntent, 1); assert.equal(intent.status, previousStatus);
    await resend(owner); await verify(latest()).expect(204); await http().post('/api/payments/' + created.body.payment._id + '/retry').set('Cookie', owner.cookie).expect(200); assert.equal(stripe.calls.createIntent, 2);
  });
  it('keeps legacy accounts without a verification timestamp unverified', async () => {
    const owner = await login(); await fixture.users.updateOne({ _id: owner.userId }, { $unset: { emailVerifiedAt: '' } });
    assert.equal((await verification.status(owner.userId)).emailVerified, false);
    await http().post('/api/flight-bookings/hold').set('Cookie', owner.cookie).send({}).expect(403);
  });
  it('fails closed on verification lookup errors before any booking/payment side effect', async () => {
    const owner = await login(); const failure = mock.method(fixture.app.get(UsersService), 'hasVerifiedEmail', async () => { throw new Error('injected lookup outage'); });
    try { await http().post('/api/payments').set('Cookie', owner.cookie).send({}).expect(500); } finally { failure.mock.restore(); }
    assert.equal(stripe.calls.createIntent, 0); assert.equal(await fixture.connection.collection('payments').countDocuments({}), 0);
  });
  it('exports a reusable guard/service without granting access to a missing identity', async () => {
    const owner = await login(), guard = fixture.app.get(VerifiedEmailGuard);
    const context = (userId?: string) => ({ switchToHttp: () => ({ getRequest: () => ({ user: userId ? { userId } : undefined }) }) }) as unknown as ExecutionContext;
    await assert.rejects(guard.canActivate(context()), /Invalid or expired session/); await assert.rejects(guard.canActivate(context(owner.userId)), /Verify your email/);
    await verify(latest()).expect(204); assert.equal(await guard.canActivate(context(owner.userId)), true);
    await fixture.connection.transaction(async (session) => { assert.equal(await fixture.app.get(EmailEligibilityService).canBook(owner.userId, session), true); });
  });
  it('does not fail successful registration on SMTP failure; resend can recover', async () => {
    sendHook = async () => { throw new Error('injected SMTP outage'); }; const owner = await login();
    assert.equal(sent.length, 0); assert.equal(await proofs().countDocuments({}), 0); assert.equal((await verification.status(owner.userId)).emailVerified, false);
    sendHook = undefined; await resend(owner); await verify(latest()).expect(204);
  });
  it('does not remove the replacement proof when an older delivery fails late', async () => {
    const owner = await login(), gate = deferred(), started = deferred(); let calls = 0;
    sendHook = async () => { if (++calls === 1) { started.resolve(); await gate.promise; throw new Error('injected late SMTP failure'); } };
    await http().post('/api/auth/resend-verification').set('Cookie', owner.cookie).send({}).expect(202); await started.promise;
    await http().post('/api/auth/resend-verification').set('Cookie', owner.cookie).send({}).expect(202); gate.resolve(); await queue.whenIdle();
    await verify(latest()).expect(204);
  });
  it('silently limits resend requests and retains the newest accepted proof', async () => {
    const clock = mock.method(Date, 'now', () => 1_900_000_000_000);
    try { const owner = await login(); for (let n = 0; n < 4; n++) await resend(owner); const value = latest(); assert.equal(sent.length, 5);
      const result = await resend(owner); assert.equal(result.body.message.includes('If verification is needed'), true); assert.equal(sent.length, 5); await verify(value).expect(204);
    } finally { clock.mock.restore(); }
  });
  it('limits proof guessing without consuming the actual proof', async () => {
    const owner = await login(); for (let n = 0; n < 20; n++) await verify(randomBytes(32).toString('hex')).expect(400);
    await verify(latest()).expect(429); assert.equal((await verification.status(owner.userId)).emailVerified, false); assert.equal(await proofs().countDocuments({}), 1);
  });
  it('rejects cross-origin verification/resend and publishes safe schemas in Swagger', async () => {
    const owner = await login(); await verify(latest()).set('Origin', 'https://attacker.example').expect(403);
    await http().post('/api/auth/resend-verification').set('Cookie', owner.cookie).set('Origin', 'https://attacker.example').send({}).expect(403);
    const document = (await http().get('/api/docs-json').expect(200)).body;
    for (const path of ['/api/auth/email-verification', '/api/auth/resend-verification', '/api/auth/verify-email']) assert.ok(document.paths[path]);
    assert.equal(document.components.schemas.VerifyEmailDto.properties.token.writeOnly, true); assert.equal(JSON.stringify(document.components.schemas).includes('emailVerifiedAt'), false);
    await verify(latest()).expect(204);
  });
  it('blocks direct internal flight holds and payment create/retry calls before any side effects', async () => {
    const owner = await login();
    const input = { segments: [{ flightId: new Types.ObjectId().toString(), cabinId: new Types.ObjectId().toString() }], passengers: [] } as CreateFlightBookingDto;
    const forbidden = (error: unknown) => (error as { getStatus(): number }).getStatus() === 403;
    await assert.rejects(() => fixture.flightBookings.hold(input, owner.userId), forbidden);
    const payments = fixture.app.get(PaymentsService), user = { userId: owner.userId, role: UserRole.USER };
    await assert.rejects(() => payments.create({ bookingType: 'flight', bookingId: new Types.ObjectId().toString() }, user), forbidden);
    await assert.rejects(() => payments.retry(new Types.ObjectId().toString(), user), forbidden);
    assert.equal(await fixture.connection.collection('flightbookings').countDocuments({}), 0);
    assert.equal(await fixture.connection.collection('payments').countDocuments({}), 0);
    assert.equal(stripe.calls.createIntent, 0);
  });
  it('rejects internal confirmation of a newly unverified pending booking without converting seats', async () => {
    const owner = await login(); await verify(latest()).expect(204); const id = await fixture.holdBooking(owner.cookie);
    const before = await fixture.connection.collection('cabininventories').findOne({});
    await fixture.users.updateOne({ _id: owner.userId }, { $unset: { emailVerifiedAt: '' } });
    await assert.rejects(() => fixture.flightBookings.confirmPaidBooking(id, new Types.ObjectId().toString()),
      (error: unknown) => (error as { getStatus(): number }).getStatus() === 409);
    assert.equal(await fixture.bookingStatus(id), 'PENDING');
    assert.deepEqual(await fixture.connection.collection('cabininventories').findOne({}), before);
  });
  async function startVerifiedPayment() {
    const owner = await login(); await verify(latest()).expect(204); const bookingId = await fixture.holdBooking(owner.cookie);
    await http().post('/api/bookings/flight/' + bookingId + '/accept-policies').set('Cookie', owner.cookie).send({ accepted: true }).expect(200);
    const created = await http().post('/api/payments').set('Cookie', owner.cookie).send({ bookingType: 'flight', bookingId }).expect(201);
    return { owner, bookingId, paymentId: created.body.payment._id as string, intentId: created.body.payment.stripePaymentIntentId as string };
  }
  const webhook = (intent: unknown) => {
    const event = FakeStripe.signedEvent('payment_intent.succeeded', intent);
    return http().post('/api/payments/webhook').set('stripe-signature', event.signature).set('Content-Type', 'application/json').send(event.payload);
  };
  it('routes a late paid-but-unverified hold through the existing full-refund path exactly once', async () => {
    const { owner, bookingId, paymentId, intentId } = await startVerifiedPayment();
    await fixture.users.updateOne({ _id: owner.userId }, { $unset: { emailVerifiedAt: '' } });
    const paid = stripe.succeed(intentId);
    await webhook(paid).expect(200); await webhook(paid).expect(200);
    assert.equal(await fixture.bookingStatus(bookingId), 'PENDING');
    assert.equal(stripe.calls.createRefund, 1);
    const payment = (await fixture.connection.collection('payments').findOne({ _id: new Types.ObjectId(paymentId) }))!;
    assert.ok(payment.autoRefundedAt); assert.equal(payment.bookingConfirmedAt, undefined);
    const refunds = await fixture.connection.collection('refunds').find({}).toArray();
    assert.equal(refunds.length, 1); assert.equal(refunds[0].amount, payment.amount);
    assert.equal((await fixture.connection.collection('cabininventories').findOne({}))!.bookedSeats, 0);
    await http().get('/api/payments/' + paymentId).set('Cookie', owner.cookie).expect(200);
  });
  it('confirms a verified payment and preserves historical/idempotent confirmations after verification state changes', async () => {
    const { owner, bookingId, paymentId, intentId } = await startVerifiedPayment(), paid = stripe.succeed(intentId);
    await webhook(paid).expect(200); assert.equal(await fixture.bookingStatus(bookingId), 'CONFIRMED');
    await fixture.users.updateOne({ _id: owner.userId }, { $unset: { emailVerifiedAt: '' } });
    await webhook(paid).expect(200); await fixture.flightBookings.confirmPaidBooking(bookingId, paymentId);
    assert.equal(await fixture.bookingStatus(bookingId), 'CONFIRMED'); assert.equal(stripe.calls.createRefund, 0);
    await http().get('/api/flight-bookings/' + bookingId).set('Cookie', owner.cookie).expect(200);
  });
  it('retries a verification lookup outage during a signed success without treating it as grounds for a refund', async () => {
    const { bookingId, intentId } = await startVerifiedPayment(), paid = stripe.succeed(intentId);
    const failure = mock.method(fixture.app.get(UsersService), 'hasVerifiedEmail', async () => { throw new Error('injected eligibility outage'); });
    try { await webhook(paid).expect(500); } finally { failure.mock.restore(); }
    assert.equal(await fixture.bookingStatus(bookingId), 'PENDING'); assert.equal(stripe.calls.createRefund, 0);
    await webhook(paid).expect(200); assert.equal(await fixture.bookingStatus(bookingId), 'CONFIRMED');
  });
  it('rechecks verification after asynchronous policy checks before creating a Stripe intent', async () => {
    const owner = await login(); await verify(latest()).expect(204); const bookingId = await fixture.holdBooking(owner.cookie);
    await http().post('/api/bookings/flight/' + bookingId + '/accept-policies').set('Cookie', owner.cookie).send({ accepted: true }).expect(200);
    const policies = fixture.app.get(PoliciesService), original = policies.hasAccepted.bind(policies);
    const changed = mock.method(policies, 'hasAccepted', async (...args: Parameters<typeof policies.hasAccepted>) => {
      const result = await original(...args); await fixture.users.updateOne({ _id: owner.userId }, { $unset: { emailVerifiedAt: '' } }); return result;
    });
    try { await http().post('/api/payments').set('Cookie', owner.cookie).send({ bookingType: 'flight', bookingId }).expect(403); }
    finally { changed.mock.restore(); }
    assert.equal(stripe.calls.createIntent, 0); assert.equal(await fixture.connection.collection('payments').countDocuments({}), 0);
  });
  it('validates enforcement settings and refuses required verification without mail readiness', () => {
    assert.equal(readEmailVerificationRequired(new ConfigService({})), false); assert.equal(readEmailVerificationRequired(new ConfigService({ EMAIL_VERIFICATION_REQUIRED: 'false' })), false);
    assert.equal(readEmailVerificationRequired(new ConfigService({ EMAIL_VERIFICATION_REQUIRED: 'true' })), true);
    for (const value of ['yes', '0', 1]) assert.throws(() => readEmailVerificationRequired(new ConfigService({ EMAIL_VERIFICATION_REQUIRED: value })));
    configured = false;
    assert.throws(() => new EmailVerificationService(fixture.connection, fixture.connection.model<EmailVerification>(EmailVerification.name), fixture.app.get(UsersService), mail as unknown as MailService, fixture.app.get(AuthActionLimitsService), queue, fixture.app.get(EmailEligibilityService), new ConfigService({ EMAIL_VERIFICATION_URL: 'https://client.example/verify-email' })), /needs SMTP settings/);
    configured = true;
  });
});
