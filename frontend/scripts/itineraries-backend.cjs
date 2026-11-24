#!/usr/bin/env node
'use strict';

/**
 * Disposable backend for the itinerary browser checks (Person 7): the real compiled Nest
 * application on a throwaway MongoDB replica set, with the official reference catalog
 * (countries, cities, attractions, currencies) seeded. It never reads .env, Atlas, mail,
 * Stripe or the FX provider. Build first, from backend/: npm run build
 */
const { createRequire } = require('node:module');
const { join, resolve } = require('node:path');
const { randomBytes } = require('node:crypto');
const { mailEnvironment, installMailFixture } = require('./auth-mail-fixture.cjs');

const backendDirectory = resolve(__dirname, '../../backend');
const backendRequire = createRequire(join(backendDirectory, 'package.json'));
const port = Number(process.env.PORT || 3120);
const frontendOrigin = process.env.FRONTEND_ORIGIN || 'http://localhost:3121';
const PASSWORD = 'M2SmokeOnly2026'; // Disposable local accounts only.

let app;
let replicaSet;
let stopping = false;

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
    binary: { downloadDir: join(backendDirectory, 'node_modules/.cache/mongodb-binaries') },
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  Object.assign(process.env, {
    MONGODB_URI: replicaSet.getUri('m2-itineraries'),
    JWT_SECRET: randomBytes(48).toString('hex'),
    PORT: String(port),
    FXRATES_API_KEY: '',
    STRIPE_SECRET_KEY: '',
    STRIPE_WEBHOOK_SECRET: '',
    ...mailEnvironment(frontendOrigin),
  });

  const originalForRoot = ConfigModule.forRoot;
  ConfigModule.forRoot = function (options) { return originalForRoot.call(this, { ...options, ignoreEnvFile: true }); };
  let AppModule;
  try { ({ AppModule } = backendRequire('./dist/app.module.js')); } finally { ConfigModule.forRoot = originalForRoot; }
  const { configureApplication } = backendRequire('./dist/configure-application.js');
  const { PasswordService } = backendRequire('./dist/auth/password.service.js');
  const { ReferenceDataService } = backendRequire('./dist/reference-data/reference-data.service.js');
  const { CurrenciesService } = backendRequire('./dist/currencies/currencies.service.js');

  const builder = Test.createTestingModule({ imports: [AppModule] });
  installMailFixture(backendRequire, builder);
  const testing = await builder.compile();
  app = testing.createNestApplication({ rawBody: true, logger: false });
  configureApplication(app);
  const connection = testing.get(getConnectionToken());

  const controls = {
    async user({ name = 'Kiki Planner', role = 'USER' }) {
      const email = `m2-itn-${randomBytes(6).toString('hex')}@example.test`;
      await connection.models.User.create({
        name, email, role, status: 'ACTIVE', mustChangePassword: false, termsAcceptedAt: new Date(), emailVerifiedAt: new Date(),
        passwordHash: await app.get(PasswordService).hash(PASSWORD),
      });
      return { email, password: PASSWORD };
    },
  };

  const server = app.getHttpAdapter().getInstance();
  server.post('/__m2-itinerary-fixture/:control', async (request, response) => {
    const control = controls[request.params.control];
    if (request.socket.remoteAddress !== '127.0.0.1' || request.get('X-M2-Itinerary-Fixture') !== 'itineraries' || !control) {
      response.sendStatus(404);
      return;
    }
    try { response.json(await control(request.query)); } catch (error) { response.status(500).json({ message: String(error && error.message) }); }
  });

  await app.init();
  await Promise.all(Object.values(connection.models).map((model) => model.init()));
  await app.get(ReferenceDataService).seedSupported();
  await app.get(CurrenciesService).seedSupported();

  await app.listen(port, '127.0.0.1');
  process.stdout.write(`Disposable itinerary backend ready at http://localhost:${port}\n`);
}

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { void stop().then(() => process.exit(0)); });

void main().catch(async (error) => {
  process.stderr.write(`Itinerary fixture failed to start: ${error && error.message}\n`);
  await stop();
  process.exitCode = 1;
});
