import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { ConfigService } from '@nestjs/config';
import nodemailer, { SendMailOptions } from 'nodemailer';
import { readMailConfiguration, readPasswordResetUrl } from '../src/mail/mail.config';
import { MailService } from '../src/mail/mail.service';
const settings = { SMTP_HOST: 'smtp.example.com', SMTP_PORT: '587', SMTP_USER: 'test-user', SMTP_PASS: 'synthetic-test-password', SMTP_FROM: 'noreply@example.com' };

test('mail is optional, but partial/unsafe SMTP settings fail without exposing their values', () => {
  assert.equal(readMailConfiguration(new ConfigService({})), undefined);
  assert.equal(readMailConfiguration(new ConfigService({ SMTP_HOST: '', SMTP_PORT: '', SMTP_USER: '', SMTP_PASS: '', SMTP_FROM: '' })), undefined);
  for (const change of [{ SMTP_PASS: '' }, { SMTP_PORT: 'abc' }, { SMTP_PORT: '0' }, { SMTP_PORT: '65536' }, { SMTP_HOST: 'smtp://attacker.example' }, { SMTP_FROM: 'noreply@example.com\r\nBcc: attacker@example.com' }]) {
    assert.throws(() => readMailConfiguration(new ConfigService({ ...settings, ...change })), (error: Error) => !error.message.includes(settings.SMTP_PASS));
  }
  assert.equal(readMailConfiguration(new ConfigService(settings))!.port, 587);
});
test('reset URL requires a trusted HTTPS target and rejects credentials, query and fragments', () => {
  assert.equal(readPasswordResetUrl(new ConfigService({})), undefined);
  for (const value of ['https://client.example/reset-password', 'http://localhost:3000/reset-password', 'http://127.0.0.1:3000/reset-password']) assert.equal(readPasswordResetUrl(new ConfigService({ PASSWORD_RESET_URL: value })), value);
  for (const value of ['http://client.example/reset', 'https://user:password@client.example/reset', 'https://client.example/reset?redirect=bad', 'https://client.example/reset#token=bad', 'javascript:alert(1)', 42]) assert.throws(() => readPasswordResetUrl(new ConfigService({ PASSWORD_RESET_URL: value })));
});
test('SMTP transport requires TLS, bounded timeouts and no credential/protocol logging', async () => {
  const realCreate = nodemailer.createTransport.bind(nodemailer), captured: Record<string, unknown>[] = [];
  const stream = realCreate({ streamTransport: true, buffer: true, newline: 'unix' });
  let delivered = '';
  const send = mock.method(stream, 'sendMail', async (message: SendMailOptions) => { const result = await realCreate({ streamTransport: true, buffer: true }).sendMail(message); delivered = result.message.toString(); return result; });
  const transport = mock.method(nodemailer, 'createTransport', ((options: unknown) => { captured.push(options as Record<string, unknown>); return stream; }) as typeof nodemailer.createTransport);
  try {
    const service = new MailService(new ConfigService(settings)); await service.send({ to: 'recipient@example.com', subject: 'Recovery test', text: 'Reset email test body.' });
    assert.equal(captured[0].requireTLS, true); assert.equal(captured[0].secure, false); assert.equal(captured[0].logger, false); assert.equal(captured[0].debug, false);
    assert.equal(captured[0].disableFileAccess, true); assert.equal(captured[0].disableUrlAccess, true); assert.equal(captured[0].connectionTimeout, 10_000);
    assert.match(delivered, /From: noreply@example.com/); assert.match(delivered, /To: recipient@example.com/); assert.match(delivered, /Reset email test body/);
    new MailService(new ConfigService({ ...settings, SMTP_PORT: '465' })); assert.equal(captured[1].secure, true);
  } finally { transport.mock.restore(); send.mock.restore(); }
});
test('unconfigured mail cannot pretend to send successfully', async () => {
  const mail = new MailService(new ConfigService({})); assert.throws(() => mail.assertConfigured());
  await assert.rejects(mail.send({ to: 'test@example.com', subject: 'test', text: 'test' }));
});
