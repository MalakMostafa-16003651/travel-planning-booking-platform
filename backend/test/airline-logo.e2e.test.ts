import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getConnectionToken, getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Model, Types } from 'mongoose';
import request, { Response } from 'supertest';

import { AuthSession } from '../src/auth/schemas/auth-session.schema';
import { UserRole } from '../src/common/enums/user-role.enum';
import { configureApplication } from '../src/configure-application';
import { FlightsModule } from '../src/flights/flights.module';
import { User, UserDocument } from '../src/users/schemas/user.schema';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)]);

function cookiesFrom(response: Response): string {
  return (response.headers['set-cookie'] as unknown as string[]).map((cookie) => cookie.split(';')[0]).join('; ');
}

describe('Airline logo and public airline view (GEN-08, e2e)', { concurrency: false }, () => {
  let replicaSet: MongoMemoryReplSet;
  let app: INestApplication;
  let connection: Connection;
  let users: Model<UserDocument>;
  let sessions: Model<AuthSession>;
  const airlineId = new Types.ObjectId();
  let moderatorCookie: string;
  let userCookie: string;

  async function login(email: string, role: UserRole): Promise<string> {
    await request(app.getHttpServer()).post('/api/auth/register')
      .send({ name: 'Test Person', email, password: 'Travel123', termsAccepted: true }).expect(201);
    await users.updateOne({ email }, { $set: { role } }).exec();
    const response = await request(app.getHttpServer()).post('/api/auth/login')
      .set('Sec-Fetch-Site', 'same-origin').send({ email, password: 'Travel123' }).expect(200);
    return cookiesFrom(response);
  }

  const upload = (cookie: string | undefined, file: Buffer | undefined, name = 'logo.png') => {
    const call = request(app.getHttpServer()).post('/api/airlines/me/logo').set('Sec-Fetch-Site', 'same-origin');
    if (cookie) call.set('Cookie', cookie);
    if (file) call.attach('logo', file, name);
    return call;
  };

  before(async () => {
    replicaSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
      binary: { downloadDir: resolve(process.cwd(), 'node_modules/.cache/mongodb-binaries') },
    });
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, skipProcessEnv: true, load: [() => ({ JWT_SECRET: randomBytes(48).toString('hex') })] }),
        MongooseModule.forRoot(replicaSet.getUri('airline-logo')),
        FlightsModule,
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApplication(app);
    await app.init();
    connection = moduleRef.get(getConnectionToken());
    users = moduleRef.get(getModelToken(User.name));
    sessions = moduleRef.get(getModelToken(AuthSession.name));
    await Promise.all([users.init(), sessions.init()]);
  }, { timeout: 30 * 60_000 });

  beforeEach(async () => {
    await Promise.all([
      users.deleteMany({}).exec(), sessions.deleteMany({}).exec(),
      ...['airlines', 'moderatorassignments'].map((name) => connection.collection(name).deleteMany({})),
    ]);
    await connection.collection('airlines').insertOne({
      _id: airlineId, name: 'Test Airline', code: 'TA', isActive: true, logo: null,
      baggagePolicy: { pricePerExtraBag: 3000, maxExtraBagsPerPassenger: 2 }, cancellationTiers: [],
    });
    moderatorCookie = await login('mod@example.com', UserRole.AIRLINE_MODERATOR);
    userCookie = await login('user@example.com', UserRole.USER);
    const moderator = await users.findOne({ email: 'mod@example.com' }).orFail().exec();
    await connection.collection('moderatorassignments').insertOne({ moderatorId: moderator._id, airlineId });
  });

  after(async () => {
    try {
      await rm(join(process.cwd(), 'uploads', 'airline-logos', `${airlineId.toString()}.png`), { force: true });
      await rm(join(process.cwd(), 'uploads', 'airline-logos', `${airlineId.toString()}.jpg`), { force: true });
      if (app) await app.close();
    } finally {
      if (replicaSet) await replicaSet.stop();
    }
  }, { timeout: 30_000 });

  it('stores a PNG logo and serves it by URL', async () => {
    const response = await upload(moderatorCookie, PNG).expect(200);
    assert.equal(response.body.logo, `/api/airlines/${airlineId.toString()}/logo`);
    const image = await request(app.getHttpServer()).get(response.body.logo).expect(200);
    assert.match(image.headers['content-type'], /image\/png/);
  });

  it('a second upload in another format replaces the first (one logo per airline)', async () => {
    await upload(moderatorCookie, PNG).expect(200);
    await upload(moderatorCookie, JPG, 'logo.jpg').expect(200);
    const image = await request(app.getHttpServer()).get(`/api/airlines/${airlineId.toString()}/logo`).expect(200);
    assert.match(image.headers['content-type'], /image\/jpeg/);
  });

  it('rejects non-images even when named .png, a missing file, and files over 5 MB', async () => {
    await upload(moderatorCookie, Buffer.from('not an image'), 'logo.png').expect(400);
    await upload(moderatorCookie, undefined).expect(400);
    await upload(moderatorCookie, Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)])).expect(413);
  });

  it('rejects uploads without a session (401) and from normal users (403)', async () => {
    await upload(undefined, PNG).expect(401);
    await upload(userCookie, PNG).expect(403);
  });

  it('shows an airline publicly with its policies, and hides a deactivated one', async () => {
    const view = await request(app.getHttpServer()).get(`/api/airlines/${airlineId.toString()}`).expect(200);
    assert.equal(view.body.baggagePolicy.pricePerExtraBag, 3000);
    await connection.collection('airlines').updateOne({ _id: airlineId }, { $set: { isActive: false } });
    await request(app.getHttpServer()).get(`/api/airlines/${airlineId.toString()}`).expect(404);
    await request(app.getHttpServer()).get(`/api/airlines/${airlineId.toString()}/logo`).expect(404);
    await request(app.getHttpServer()).get('/api/airlines/not-an-id').expect(404);
  });
});
