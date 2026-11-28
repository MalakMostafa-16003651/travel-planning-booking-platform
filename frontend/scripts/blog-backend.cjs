#!/usr/bin/env node
'use strict';

/**
 * Disposable backend for the blog browser checks: the real compiled Nest application on a throwaway
 * MongoDB replica set. It never reads .env and never touches Atlas, mail, Stripe or FX.
 * Fixture controls only create starting data (users, posts, itineraries) and simulate moderation
 * (hide a post) and account deactivation, which belong to other owners' screens. Every journey under
 * test goes through the real HTTP API via the Next proxy.
 *
 * Build first, from backend/: npm run build
 */
const { createRequire } = require('node:module');
const { join, resolve } = require('node:path');
const { randomBytes } = require('node:crypto');
const { mailEnvironment, installMailFixture } = require('./auth-mail-fixture.cjs');

const backendDirectory = resolve(__dirname, '../../backend');
const backendRequire = createRequire(join(backendDirectory, 'package.json'));
const port = Number(process.env.PORT || 3130);
const frontendOrigin = process.env.FRONTEND_ORIGIN || 'http://localhost:3131';
const PASSWORD = 'M2SmokeOnly2026'; // Disposable local accounts only.
const DAY_MS = 86_400_000;

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
  const { Types } = backendRequire('mongoose');

  replicaSet = await MongoMemoryReplSet.create({
    binary: { downloadDir: join(backendDirectory, 'node_modules/.cache/mongodb-binaries') },
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  Object.assign(process.env, {
    MONGODB_URI: replicaSet.getUri('m2-blog'),
    JWT_SECRET: randomBytes(48).toString('hex'),
    PORT: String(port),
    STRIPE_SECRET_KEY: '', STRIPE_WEBHOOK_SECRET: '', FXRATES_API_KEY: '',
    ...mailEnvironment(frontendOrigin),
  });

  // Disable .env loading BEFORE importing AppModule, so this fixture cannot read real credentials.
  const originalForRoot = ConfigModule.forRoot;
  ConfigModule.forRoot = function (options) { return originalForRoot.call(this, { ...options, ignoreEnvFile: true }); };
  let AppModule;
  try { ({ AppModule } = backendRequire('./dist/app.module.js')); } finally { ConfigModule.forRoot = originalForRoot; }
  const { configureApplication } = backendRequire('./dist/configure-application.js');
  const { PasswordService } = backendRequire('./dist/auth/password.service.js');

  const builder = Test.createTestingModule({ imports: [AppModule] });
  installMailFixture(backendRequire, builder);
  const testing = await builder.compile();
  app = testing.createNestApplication({ rawBody: true, logger: false });
  configureApplication(app);
  const connection = testing.get(getConnectionToken());
  const models = connection.models;
  const id = (value) => new Types.ObjectId(String(value));

  const controls = {
    /** A verified, active account. Returns its credentials and userId. */
    async user({ name = 'Nour Hassan', role = 'USER' }) {
      const email = `m2-blog-${randomBytes(6).toString('hex')}@example.test`;
      const user = await models.User.create({
        name, email, role, status: 'ACTIVE', mustChangePassword: false, termsAcceptedAt: new Date(), emailVerifiedAt: new Date(),
        passwordHash: await app.get(PasswordService).hash(PASSWORD),
      });
      return { email, password: PASSWORD, userId: String(user._id) };
    },
    /**
     * Starting posts for one author. `likes`/`comments` set the stored counters the backend orders by,
     * and `daysAgo` backdates publishing, so ordering can be checked without dozens of accounts.
     */
    async posts({ author, count = '1', title = 'Story', content = 'A day by the river.', tags = '', status = 'PUBLISHED', likes = '0', comments = '0', daysAgo = '1' }) {
      const now = Date.now();
      const docs = Array.from({ length: Number(count) }, (_, index) => ({
        userId: id(author),
        title: Number(count) > 1 ? `${title} ${index + 1}` : title,
        content,
        status,
        tags: tags ? String(tags).split(',') : [],
        likesCount: Number(likes),
        commentsCount: Number(comments),
        // Later posts in a batch are newer.
        ...(status === 'PUBLISHED' ? { publishedAt: new Date(now - Number(daysAgo) * DAY_MS + index * 1000) } : {}),
      }));
      const created = await models.BlogPost.insertMany(docs);
      return { postIds: created.map((post) => String(post._id)) };
    },
    /** A public (or private) itinerary owned by `author`, with two days. */
    async itinerary({ author, title = 'Nile week', visibility = 'PUBLIC' }) {
      const itinerary = await models.Itinerary.create({
        userId: id(author), title, countries: ['EG'], startDate: new Date(Date.UTC(2027, 0, 10)), visibility, currency: 'USD',
        days: [{ city: 'Luxor', countryCode: 'EG' }, { city: 'Aswan', countryCode: 'EG' }],
        publishedAt: visibility === 'PUBLIC' ? new Date() : null,
      });
      return { itineraryId: String(itinerary._id) };
    },
    /** GEN-10 (Arwa's admin screen): hide or unhide a post. */
    async hide({ post, hidden = 'true' }) {
      await models.BlogPost.updateOne({ _id: id(post) }, { $set: { isHidden: hidden === 'true' } });
      return {};
    },
    /** ACC-12 (Malak's account screen): a deactivated author. */
    async deactivate({ user }) {
      await models.User.updateOne({ _id: id(user) }, { $set: { status: 'DEACTIVATED' } });
      return {};
    },
  };

  const server = app.getHttpAdapter().getInstance();
  server.post('/__m2-blog-fixture/:control', async (request, response) => {
    const control = controls[request.params.control];
    if (request.socket.remoteAddress !== '127.0.0.1' || request.get('X-M2-Blog-Fixture') !== 'blog' || !control) {
      response.sendStatus(404);
      return;
    }
    try { response.json(await control(request.query)); } catch (error) { response.status(500).json({ message: String(error && error.message) }); }
  });

  await app.init();
  await Promise.all(Object.values(models).map((model) => model.init()));
  await app.listen(port, '127.0.0.1');
  process.stdout.write(`Disposable blog backend ready at http://localhost:${port}\n`);
}

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { void stop().then(() => process.exit(0)); });

void main().catch(async (error) => {
  process.stderr.write(`Blog fixture failed to start: ${error && error.message}\n`);
  await stop();
  process.exitCode = 1;
});
