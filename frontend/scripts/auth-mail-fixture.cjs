'use strict';

function mailEnvironment(frontendOrigin) {
  return {
    SMTP_HOST: '',
    SMTP_PORT: '',
    SMTP_USER: '',
    SMTP_PASS: '',
    SMTP_FROM: '',
    PASSWORD_RESET_URL: new URL('/reset-password', frontendOrigin).href,
    EMAIL_VERIFICATION_URL: new URL('/verify-email', frontendOrigin).href,
    EMAIL_VERIFICATION_REQUIRED: 'true',
  };
}

function installMailFixture(backendRequire, testBuilder) {
  const { MailService } = backendRequire('./dist/mail/mail.service.js');
  const inbox = new Map();

  testBuilder.overrideProvider(MailService).useValue({
    isConfigured: () => true,
    assertConfigured() {},
    async send({ to, text }) {
      if (!/^[a-z\d._-]+@example\.test$/i.test(to)) return;
      const match = text.match(/^https?:\/\/\S+\/((?:reset-password|verify-email))#token=[a-f0-9]{64}$/m);
      if (!match) return;
      const key = `${to}:${match[1]}`;
      const previous = inbox.get(key);
      inbox.set(key, { count: (previous?.count ?? 0) + 1, link: match[0] });
    },
  });

  return inbox;
}

function attachMailFixture(app, inbox) {
  const server = app.getHttpAdapter().getInstance();
  server.get('/__m2-browser-fixture/mail-link', (request, response) => {
    response.set('Cache-Control', 'no-store');
    const { email, purpose } = request.query;
    if (
      request.get('x-m2-test-fixture') !== 'm2-auth-mail-only'
      || typeof email !== 'string'
      || !/^[a-z\d._-]+@example\.test$/i.test(email)
      || !['reset-password', 'verify-email'].includes(purpose)
    ) {
      response.sendStatus(404);
      return;
    }

    // This inbox exists only in the disposable browser fixture. Its route is
    // outside /api and only the test runner requests these synthetic links.
    const record = inbox.get(`${email}:${purpose}`);
    response.json(record ?? { count: 0, link: null });
  });
}

module.exports = { mailEnvironment, installMailFixture, attachMailFixture };
