#!/usr/bin/env node
'use strict';

/**
 * Disposable browser-auth fixture using the real compiled M1 application.
 * Run `npm run build` in backend/ first. The parent smoke test forks this script
 * with an IPC channel if desired. The fixed smoke-only password below belongs
 * solely to these disposable local accounts. Never reuse it for Atlas accounts.
 * No real credentials or .env files are used, and secrets are never logged.
 */
const { createRequire } = require('node:module');
const { resolve, join } = require('node:path');
const { existsSync, readdirSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { mailEnvironment, installMailFixture, attachMailFixture } = require('./auth-mail-fixture.cjs');

const backendDirectory = resolve(__dirname, '../../backend');
const backendRequire = createRequire(join(backendDirectory, 'package.json'));
const port = Number(process.env.PORT || 3100);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535');
}

let app;
let replicaSet;
let stopping = false;

function mongoBinaryOptions() {
  const options = { downloadDir: join(backendDirectory, 'node_modules/.cache/mongodb-binaries') };
  if (process.platform !== 'win32') return options;
  const serverDirectory = join(process.env.ProgramFiles || 'C:\\Program Files', 'MongoDB', 'Server');
  if (!existsSync(serverDirectory)) return options;
  const versions = readdirSync(serverDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d+(?:\.\d+){1,2}$/.test(entry.name))
    .sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }));
  for (const version of versions) {
    const systemBinary = join(serverDirectory, version.name, 'bin/mongod.exe');
    try {
      const output = execFileSync(systemBinary, ['--version'], {
        encoding: 'utf8', timeout: 5000, windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const number = output.match(/\bdb version v(\d+\.\d+\.\d+)\b/)?.[1];
      if (number && Number(number.split('.')[0]) >= 7) return { ...options, systemBinary, version: number };
    } catch { /* Optional installed binary: use the normal test dependency fallback. */ }
  }
  return options;
}

async function stop() {
  if (stopping) return;
  stopping = true;
  await app?.close();
  await replicaSet?.stop();
}

async function main() {
  backendRequire('reflect-metadata');
  const { MongoMemoryReplSet } = backendRequire('mongodb-memory-server');
  const { ConfigModule } = backendRequire('@nestjs/config');
  const { getConnectionToken } = backendRequire('@nestjs/mongoose');
  const { Test } = backendRequire('@nestjs/testing');

  replicaSet = await MongoMemoryReplSet.create({
    binary: mongoBinaryOptions(),
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  Object.assign(process.env, {
    MONGODB_URI: replicaSet.getUri('m2-browser-auth'),
    JWT_SECRET: randomBytes(48).toString('hex'),
    PORT: String(port),
    STRIPE_SECRET_KEY: '', STRIPE_WEBHOOK_SECRET: '', FXRATES_API_KEY: '',
    ...mailEnvironment('http://localhost:3101'),
  });

  // Match the repository's production-module integration test. Disable all .env
  // loading BEFORE importing AppModule, so this fixture cannot read Atlas or mail
  // credentials from a developer's local configuration.
  const originalForRoot = ConfigModule.forRoot;
  ConfigModule.forRoot = function (options) {
    return originalForRoot.call(this, { ...options, ignoreEnvFile: true });
  };
  let AppModule;
  try {
    ({ AppModule } = backendRequire('./dist/app.module.js'));
  } finally {
    ConfigModule.forRoot = originalForRoot;
  }
  const { configureApplication } = backendRequire('./dist/configure-application.js');
  const { PasswordService } = backendRequire('./dist/auth/password.service.js');
  const { CurrenciesService } = backendRequire('./dist/currencies/currencies.service.js');
  const builder = Test.createTestingModule({ imports: [AppModule] });
  const mailFixture = installMailFixture(backendRequire, builder);
  const testing = await builder.compile();
  app = testing.createNestApplication({ rawBody: true, logger: false });
  configureApplication(app);
  const connection = testing.get(getConnectionToken());
  attachMailFixture(app, mailFixture);
  // A fixture-only control backdates one disposable user's sessions to exercise the
  // actual inactivity rule without changing application clocks or waiting 30 minutes.
  const fixtureServer = app.getHttpAdapter().getInstance();
  fixtureServer.post('/__m2-browser-fixture/expire-idle-session', async (request, response) => {
    if (request.socket.remoteAddress !== '127.0.0.1' || request.get('X-M2-Browser-Fixture') !== 'account-e2e') {
      response.sendStatus(404);
      return;
    }
    const user = await connection.models.User.findOne({ email: 'smoke-idle-session@example.test' }).select('_id');
    if (!user) {
      response.sendStatus(404);
      return;
    }
    const result = await connection.models.AuthSession.updateMany(
      { userId: user._id, revokedAt: null },
      { $set: { lastActivityAt: new Date(Date.now() - 31 * 60_000) } },
    );
    response.sendStatus(result.modifiedCount > 0 ? 204 : 404);
  });
  await app.init();
  await Promise.all(Object.values(connection.models).map((model) => model.init()));
  await app.get(CurrenciesService).seedSupported();

  const accountDefinitions = [
    ['traveler', 'USER', false],
    ['administrator', 'ADMIN', false],
    ['airline', 'AIRLINE_MODERATOR', false],
    ['hotel', 'HOTEL_MODERATOR', false],
    ['password-change', 'AIRLINE_MODERATOR', true],
    ['profile-edit', 'USER', false],
    ['deactivate', 'USER', false],
    ['deactivate-blocked', 'USER', false],
    ['lockout', 'USER', false],
    ['suspended', 'USER', false, 'SUSPENDED'],
    ['admin-reset', 'USER', false],
    ['idle-session', 'USER', false],
  ];
  const accounts = [];
  for (const [key, role, passwordChangeRequired, status = 'ACTIVE'] of accountDefinitions) {
    const password = 'M2SmokeOnly2026';
    const email = `smoke-${key}@example.test`;
    const created = await connection.models.User.create({
      name: `M2 ${key} fixture`, email,
      passwordHash: await app.get(PasswordService).hash(password),
      role, status, mustChangePassword: passwordChangeRequired,
      termsAcceptedAt: new Date(), emailVerifiedAt: new Date(),
    });
    accounts.push({ key, email, password, role, passwordChangeRequired, userId: created._id.toString() });
    if (key === 'deactivate-blocked') {
      const departureAt = new Date(Date.now() + 86_400_000);
      // This fixture needs only the fields queried by the actual eligibility check.
      await connection.models.FlightBooking.collection.insertOne({
        userId: created._id, status: 'CONFIRMED', lastDepartureAt: departureAt,
        segments: [{ departureAt }],
      });
    }
  }

  await app.listen(port, '127.0.0.1');
  const ready = { type: 'ready', backendUrl: `http://localhost:${port}`, accounts };
  if (process.send) process.send(ready);
  // No credential values are printed, including when run manually.
  process.stdout.write(`Disposable real NestJS auth backend ready at http://localhost:${port}\n`);
}

process.on('message', (message) => {
  if (message?.type === 'stop' || message === 'stop') {
    void stop().then(() => process.exit(0));
  }
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { void stop().then(() => process.exit(0)); });
}
if (process.send) process.on('disconnect', () => { void stop().then(() => process.exit(0)); });

void main().catch(async () => {
  // Full dependency/config errors can contain private environment details.
  process.stderr.write('Disposable auth fixture failed to start; check backend build, port, and local MongoDB support.\n');
  if (process.send) process.send({ type: 'error', message: 'Disposable auth fixture failed to start' });
  await stop();
  process.exitCode = 1;
});
