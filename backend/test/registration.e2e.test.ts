import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { scrypt, timingSafeEqual } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import { INestApplication } from '@nestjs/common';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Model } from 'mongoose';
import request, { Response } from 'supertest';
import { AuthModule } from '../src/auth/auth.module';
import { AccountStatus } from '../src/common/enums/account-status.enum';
import { UserRole } from '../src/common/enums/user-role.enum';
import { configureApplication } from '../src/configure-application';
import { User, UserDocument } from '../src/users/schemas/user.schema';

function mongoBinaryOptions() {
  const fallback = {
    downloadDir: resolve(process.cwd(), 'node_modules/.cache/mongodb-binaries'),
  };
  if (process.platform !== 'win32') return fallback;

  const serverDirectory = join(
    process.env.ProgramFiles ?? 'C:\\Program Files',
    'MongoDB',
    'Server',
  );
  try {
    const installations = readdirSync(serverDirectory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^\d+(?:\.\d+){1,2}$/.test(entry.name))
      .sort((left, right) => right.name.localeCompare(left.name, undefined, { numeric: true }));

    for (const installation of installations) {
      const systemBinary = join(serverDirectory, installation.name, 'bin', 'mongod.exe');
      try {
        const output = execFileSync(systemBinary, ['--version'], {
          encoding: 'utf8',
          timeout: 5_000,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        const version = output.match(/\bdb version v(\d+\.\d+\.\d+)\b/)?.[1];
        // Use a modern installed server; older or unrecognized releases use the fallback.
        if (version && Number(version.split('.')[0]) >= 7) {
          return { ...fallback, systemBinary, version };
        }
      } catch {
        // Missing executables and incompatible installations are not prerequisites.
      }
    }
  } catch {
    // A local MongoDB installation is optional on every supported platform.
  }
  return fallback;
}

function registration(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Example Traveler',
    email: 'traveler@example.com',
    password: 'Travel123',
    termsAccepted: true,
    ...overrides,
  };
}

function assertValidationError(response: Response, field: string) {
  assert.equal(response.status, 400);
  assert.equal(response.body.statusCode, 400);
  assert.equal(response.body.error, 'Bad Request');
  assert.equal(response.body.message, 'Validation failed');
  assert.ok(Array.isArray(response.body.errors?.[field]));
  assert.ok(response.body.errors[field].length > 0);
}

async function independentlyVerifyHash(password: string, encodedHash: string) {
  const parts = encodedHash.split('$');
  assert.equal(parts.length, 6);
  const [algorithm, cost, blockSize, parallelization, saltHex, hashHex] = parts;
  assert.equal(algorithm, 'scrypt');
  assert.deepEqual([cost, blockSize, parallelization], ['32768', '8', '3']);
  assert.match(saltHex, /^[a-f\d]+$/i);
  assert.match(hashHex, /^[a-f\d]+$/i);
  assert.equal(saltHex.length % 2, 0);
  assert.equal(hashHex.length % 2, 0);

  const salt = Buffer.from(saltHex, 'hex');
  const expectedHash = Buffer.from(hashHex, 'hex');
  assert.ok(salt.length >= 16);
  assert.ok(expectedHash.length >= 32);

  const derivedHash = await new Promise<Buffer>((resolveHash, reject) => {
    scrypt(
      password,
      salt,
      expectedHash.length,
      {
        N: Number(cost),
        r: Number(blockSize),
        p: Number(parallelization),
        maxmem: 64 * 1024 * 1024,
      },
      (error, result) => {
        if (error) reject(error);
        else resolveHash(result);
      },
    );
  });

  assert.ok(timingSafeEqual(derivedHash, expectedHash));
}

describe('ACC-01 registration', { concurrency: false }, () => {
  let memoryMongo: MongoMemoryServer;
  let app: INestApplication;
  let users: Model<UserDocument>;

  before(async () => {
    memoryMongo = await MongoMemoryServer.create({
      // MMS always starts its own process with a fresh temporary database and port.
      binary: mongoBinaryOptions(),
    });

    const moduleRef = await Test.createTestingModule({
      imports: [MongooseModule.forRoot(memoryMongo.getUri()), AuthModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApplication(app);
    await app.init();

    users = moduleRef.get<Model<UserDocument>>(getModelToken(User.name));
    await users.init();
  }, { timeout: 30 * 60_000 });

  beforeEach(async () => {
    await users.deleteMany({}).exec();
  });

  after(async () => {
    try {
      if (app) await app.close();
    } finally {
      if (memoryMongo) await memoryMongo.stop();
    }
  }, { timeout: 30_000 });

  it('creates a normalized account with server-owned defaults and a safe response', async () => {
    const beforeRegistration = Date.now();
    const response = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send(registration({ name: '  Example Traveler  ', email: '  Traveler@Example.COM  ' }));

    assert.equal(response.status, 201);
    assert.deepEqual(Object.keys(response.body).sort(), [
      'createdAt', 'email', 'name', 'role', 'status', 'updatedAt', 'userId',
    ].sort());
    assert.match(response.body.userId, /^[a-f\d]{24}$/i);
    assert.equal(response.body.name, 'Example Traveler');
    assert.equal(response.body.email, 'traveler@example.com');
    assert.equal(response.body.role, UserRole.USER);
    assert.equal(response.body.status, AccountStatus.ACTIVE);
    assert.ok(Number.isFinite(Date.parse(response.body.createdAt)));
    assert.ok(Number.isFinite(Date.parse(response.body.updatedAt)));
    assert.equal(response.headers['set-cookie'], undefined);

    const stored = await users.findOne({ email: 'traveler@example.com' })
      .select('+failedLoginAttempts +mustChangePassword +lockedUntil +termsAcceptedAt')
      .orFail().lean().exec();
    assert.equal(stored._id.toString(), response.body.userId);
    assert.equal(stored.name, 'Example Traveler');
    assert.equal(stored.role, UserRole.USER);
    assert.equal(stored.status, AccountStatus.ACTIVE);
    assert.equal(stored.failedLoginAttempts, 0);
    assert.equal(stored.mustChangePassword, false);
    assert.equal(stored.lockedUntil, null);
    assert.ok(stored.createdAt instanceof Date);
    assert.ok(stored.updatedAt instanceof Date);
    assert.ok(stored.termsAcceptedAt instanceof Date);
    assert.ok(stored.termsAcceptedAt.getTime() >= beforeRegistration);
    assert.ok(stored.termsAcceptedAt.getTime() <= Date.now());
    assert.equal(Object.hasOwn(stored, 'passwordHash'), false);
    assert.equal(Object.hasOwn(stored, 'password'), false);
    assert.equal(Object.hasOwn(stored, 'userId'), false);
    assert.equal(await users.countDocuments(), 1);
  });

  it('accepts the exact eight-character password boundary without extra complexity rules', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send(registration({ password: 'abc12345' }));
    assert.equal(response.status, 201);
    assert.equal(await users.countDocuments(), 1);
  });

  it('rejects passwords that are too short or lack a letter or digit', async () => {
    for (const password of ['abc1234', 'abcdefgh', '12345678', '']) {
      const response = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send(registration({ password }));
      assertValidationError(response, 'password');
    }
    assert.equal(await users.countDocuments(), 0);
  });

  it('rejects missing and non-string passwords as validation errors', async () => {
    for (const password of [undefined, null, 12345678, true, [], {}]) {
      const response = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send(registration({ password }));
      assertValidationError(response, 'password');
    }
    assert.equal(await users.countDocuments(), 0);
  });

  it('requires literal boolean true for terms and privacy consent', async () => {
    for (const termsAccepted of [undefined, false, 'true', 'false', 1, null, [], {}]) {
      const response = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send(registration({ termsAccepted }));
      assertValidationError(response, 'termsAccepted');
    }
    assert.equal(await users.countDocuments(), 0);
  });

  it('rejects missing, blank, or incorrectly typed names and invalid email addresses', async () => {
    for (const name of [undefined, '', '   ', null, 42, [], {}]) {
      const response = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send(registration({ name }));
      assertValidationError(response, 'name');
    }
    for (const email of [undefined, '', '   ', 'not-an-email', null, 42, [], {}]) {
      const response = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send(registration({ email }));
      assertValidationError(response, 'email');
    }
    assert.equal(await users.countDocuments(), 0);
  });

  it('rejects role, status, identity, and security-field injection', async () => {
    const injectedFields = {
      role: UserRole.ADMIN,
      status: AccountStatus.SUSPENDED,
      _id: '507f1f77bcf86cd799439011',
      userId: '507f1f77bcf86cd799439011',
      passwordHash: 'client-controlled-hash',
      mustChangePassword: false,
      failedLoginAttempts: 0,
      lockedUntil: null,
      termsAcceptedAt: '2000-01-01T00:00:00.000Z',
    };
    const response = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send(registration(injectedFields));

    for (const field of Object.keys(injectedFields)) {
      assertValidationError(response, field);
    }
    assert.equal(await users.countDocuments(), 0);
  });

  it('rejects an already registered email after case and whitespace normalization', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send(registration())
      .expect(201);

    const response = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send(registration({ email: '  TRAVELER@EXAMPLE.COM  ' }));

    assert.equal(response.status, 409);
    assert.equal(response.body.statusCode, 409);
    assert.equal(response.body.message, 'Email is already registered');
    assert.deepEqual(response.body.errors.email, ['Email is already registered']);
    assert.equal(await users.countDocuments(), 1);
  });

  it('enforces the real unique email index during concurrent registration', async () => {
    const indexes = await users.collection.indexes();
    assert.ok(indexes.some((index) => index.unique === true && index.key.email === 1));

    const responses = await Promise.all(
      ['Race@Example.com', ' race@example.com ', 'RACE@EXAMPLE.COM'].map((email) =>
        request(app.getHttpServer())
          .post('/api/auth/register')
          .send(registration({ email })),
      ),
    );

    assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409, 409]);
    for (const response of responses.filter((result) => result.status === 409)) {
      assert.equal(response.body.message, 'Email is already registered');
      assert.deepEqual(response.body.errors.email, ['Email is already registered']);
    }
    assert.equal(await users.countDocuments(), 1);
    assert.equal(await users.countDocuments({ email: 'race@example.com' }), 1);
  });

  it('stores independent salted hashes and preserves the password exactly', async () => {
    const password = ' abc12345 ';
    const responses = await Promise.all(
      ['first@example.com', 'second@example.com'].map((email) =>
        request(app.getHttpServer())
          .post('/api/auth/register')
          .send(registration({ email, password })),
      ),
    );
    for (const response of responses) {
      assert.equal(response.status, 201);
      assert.deepEqual(Object.keys(response.body).sort(), [
        'createdAt', 'email', 'name', 'role', 'status', 'updatedAt', 'userId',
      ].sort());
      assert.equal(response.headers['set-cookie'], undefined);
    }

    const stored = await users.find({}).select('+passwordHash').lean().exec();
    assert.equal(stored.length, 2);
    assert.notEqual(stored[0].passwordHash, stored[1].passwordHash);
    assert.notEqual(stored[0].passwordHash.split('$')[4], stored[1].passwordHash.split('$')[4]);
    for (const account of stored) {
      assert.equal(Object.hasOwn(account, 'password'), false);
      assert.notEqual(account.passwordHash, password);
      await independentlyVerifyHash(password, account.passwordHash);
    }
  });

  it('publishes the registration endpoint in Swagger and serves Swagger UI', async () => {
    const specification = await request(app.getHttpServer())
      .get('/api/docs-json')
      .expect(200);
    const operation = specification.body.paths?.['/api/auth/register']?.post;
    assert.ok(operation);
    assert.ok(operation.responses?.['201']);
    assert.ok(operation.responses?.['400']);
    assert.ok(operation.responses?.['409']);

    const ui = await request(app.getHttpServer())
      .get('/api/docs')
      .expect('Content-Type', /text\/html/)
      .expect(200);
    assert.match(ui.text, /swagger-ui/i);
  });
});
