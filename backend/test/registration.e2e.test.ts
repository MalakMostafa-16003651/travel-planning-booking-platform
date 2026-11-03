import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import { Controller, Get, INestApplication, Module, Req, UseGuards } from '@nestjs/common';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Model } from 'mongoose';
import request, { Response } from 'supertest';
import { AuthModule } from '../src/auth/auth.module';
import { AuthenticatedRequest, AuthGuard } from '../src/auth/auth.guard';
import { AuthService } from '../src/auth/auth.service';
import { PasswordService } from '../src/auth/password.service';
import { AuthSession } from '../src/auth/schemas/auth-session.schema';
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

function assertNoAuthCookies(response: Response) {
  assert.ok(response.headers['set-cookie'] === undefined, 'This response must not issue cookies');
}

function assertPublicAccount(response: Response) {
  assert.deepEqual(Object.keys(response.body).sort(), [
    'createdAt', 'email', 'name', 'role', 'status', 'updatedAt', 'userId',
  ].sort());
  assert.match(response.body.userId, /^[a-f\d]{24}$/i);
  assert.equal(response.headers['cache-control'], 'no-store');
}

function readAuthCookies(response: Response) {
  const headers = response.headers['set-cookie'];
  assert.ok(Array.isArray(headers), 'Login must return authentication cookies');
  const raw = headers as string[];
  const access = raw.find((cookie) => cookie.startsWith('__Host-accessToken='));
  const refresh = raw.find((cookie) => cookie.startsWith('__Host-refreshToken='));
  assert.ok(access, 'An access cookie is required');
  assert.ok(refresh, 'A refresh cookie is required');
  const accessPair = access.split(';', 1)[0];
  const refreshPair = refresh.split(';', 1)[0];
  return {
    raw,
    access,
    refresh,
    accessPair,
    refreshPair,
    accessToken: decodeURIComponent(accessPair.slice('__Host-accessToken='.length)),
    refreshToken: decodeURIComponent(refreshPair.slice('__Host-refreshToken='.length)),
    cookieHeader: `${accessPair}; ${refreshPair}`,
  };
}

function assertInvalidSession(response: Response) {
  assert.equal(response.status, 401);
  assert.ok(response.body.message === 'Invalid or expired session');
  assertNoAuthCookies(response);
}

function assertCredentialFailure(response: Response) {
  assert.equal(response.status, 401);
  assert.ok(response.body.message === 'Invalid email or password');
  assert.deepEqual(Object.keys(response.body).sort(), ['error', 'message', 'statusCode']);
  assertNoAuthCookies(response);
}

function assertLockedLogin(response: Response) {
  assert.equal(response.status, 401);
  assert.ok(response.body.message === 'Account temporarily locked. Try again later.');
  assert.deepEqual(Object.keys(response.body).sort(), ['error', 'message', 'statusCode']);
  assertNoAuthCookies(response);
}

function deferredSignal() {
  let resolveSignal!: () => void;
  const promise = new Promise<void>((resolve) => { resolveSignal = resolve; });
  return { promise, resolve: resolveSignal };
}

interface AccessClaims {
  sub: string;
  sid: string;
  tokenUse: string;
  iat: number;
  exp: number;
  iss: string;
  aud: string;
}

@Controller('test-feature')
class FeatureFixtureController {
  @Get('guarded')
  @UseGuards(AuthGuard)
  guarded(@Req() authenticatedRequest: AuthenticatedRequest) {
    return authenticatedRequest.user;
  }
}

@Module({
  imports: [AuthModule],
  controllers: [FeatureFixtureController],
})
class FeatureFixtureModule {}

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

describe('ACC-01 registration, ACC-04 login, and ACC-05 lockout', { concurrency: false }, () => {
  let memoryMongo: MongoMemoryServer;
  let app: INestApplication;
  let users: Model<UserDocument>;
  let sessions: Model<AuthSession>;

  async function readLoginState(email = 'traveler@example.com') {
    return users.findOne({ email }).select('+failedLoginAttempts +lockedUntil').orFail().lean().exec();
  }

  async function seedLoginAttempts(failedLoginAttempts: number, lockedUntil: Date | null = null) {
    await request(app.getHttpServer()).post('/api/auth/register').send(registration()).expect(201);
    await users.updateOne({ email: 'traveler@example.com' }, {
      $set: { failedLoginAttempts, lockedUntil },
    }).exec();
  }

  async function databaseTime() {
    const result = await users.aggregate<{ now: Date }>([
      { $limit: 1 },
      { $project: { _id: 0, now: '$$NOW' } },
    ]).exec();
    assert.ok(result[0]?.now instanceof Date);
    return result[0].now;
  }

  async function registerAndLogin(email = 'traveler@example.com') {
    const registered = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send(registration({ email }))
      .expect(201);
    const response = await request(app.getHttpServer())
      .post('/api/auth/login')
      .set('Sec-Fetch-Site', 'same-origin')
      .send({ email, password: 'Travel123' })
      .expect(200);
    const cookies = readAuthCookies(response);
    const claims = app.get(JwtService).decode<AccessClaims>(cookies.accessToken);
    assert.ok(claims && typeof claims === 'object');
    return { registered, response, cookies, claims };
  }

  function signedAccessToken(
    claims: AccessClaims,
    payloadChanges: Record<string, unknown> = {},
    optionChanges: JwtSignOptions = {},
  ) {
    return app.get(JwtService).sign({
      sub: claims.sub,
      sid: claims.sid,
      tokenUse: 'access',
      ...payloadChanges,
    }, {
      algorithm: 'HS256',
      issuer: 'travel-planning-booking-platform',
      audience: 'travel-platform-api',
      expiresIn: 900,
      ...optionChanges,
    });
  }

  before(async () => {
    memoryMongo = await MongoMemoryServer.create({
      // MMS always starts its own process with a fresh temporary database and port.
      binary: mongoBinaryOptions(),
    });

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          skipProcessEnv: true,
          load: [() => ({ JWT_SECRET: randomBytes(48).toString('hex') })],
        }),
        MongooseModule.forRoot(memoryMongo.getUri()),
        AuthModule,
        FeatureFixtureModule,
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApplication(app);
    await app.init();

    users = moduleRef.get<Model<UserDocument>>(getModelToken(User.name));
    sessions = moduleRef.get<Model<AuthSession>>(getModelToken(AuthSession.name));
    await users.init();
    await sessions.init();
  }, { timeout: 30 * 60_000 });

  beforeEach(async () => {
    await sessions.deleteMany({}).exec();
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
    assertNoAuthCookies(response);

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
      assertNoAuthCookies(response);
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

  it('verifies existing credentials for each agreed role without exposing security fields in normal queries', async () => {
    const auth = app.get(AuthService);
    for (const role of Object.values(UserRole)) {
      const email = `${role.toLowerCase()}@example.com`;
      await request(app.getHttpServer()).post('/api/auth/register')
        .send(registration({ email })).expect(201);
      // Controlled local fixtures exercise login for roles whose creation is a later feature.
      await users.updateOne({ email }, { $set: { role } }).exec();
      const verified = await auth.verifyCredentials({ email: `  ${email.toUpperCase()}  `, password: 'Travel123' });
      assert.equal(verified.role, role);
      assert.equal(verified.email, email);
      assert.ok(verified.passwordHash === undefined);
      const ordinaryQuery = await users.findOne({ email }).lean().exec();
      assert.ok(ordinaryQuery);
      for (const field of ['passwordHash', 'mustChangePassword', 'failedLoginAttempts', 'lockedUntil']) {
        assert.equal(Object.hasOwn(ordinaryQuery, field), false);
      }
    }
  });

  it('returns identical credential errors for wrong passwords and unknown emails', async () => {
    await request(app.getHttpServer()).post('/api/auth/register').send(registration()).expect(201);
    const auth = app.get(AuthService);
    for (const input of [
      { email: 'traveler@example.com', password: 'Wrong123' },
      { email: 'unknown@example.com', password: 'Travel123' },
    ]) {
      await assert.rejects(auth.verifyCredentials(input), (error: unknown) =>
        error instanceof UnauthorizedException && error.message === 'Invalid email or password');
    }
  });

  it('reveals suspension only after verifying the correct password', async () => {
    await request(app.getHttpServer()).post('/api/auth/register').send(registration()).expect(201);
    await users.updateOne({ email: 'traveler@example.com' }, { $set: { status: AccountStatus.SUSPENDED } }).exec();
    const auth = app.get(AuthService);
    await assert.rejects(auth.verifyCredentials({ email: 'traveler@example.com', password: 'Wrong123' }),
      (error: unknown) => error instanceof UnauthorizedException && error.message === 'Invalid email or password');
    await assert.rejects(auth.verifyCredentials({ email: 'traveler@example.com', password: 'Travel123' }),
      (error: unknown) => error instanceof ForbiddenException && error.message === 'Account is suspended');
  });

  it('denies a deactivated account even with a correct password', async () => {
    await request(app.getHttpServer()).post('/api/auth/register').send(registration()).expect(201);
    await users.updateOne({ email: 'traveler@example.com' }, { $set: { status: AccountStatus.DEACTIVATED } }).exec();
    await assert.rejects(app.get(AuthService).verifyCredentials({ email: 'traveler@example.com', password: 'Travel123' }),
      (error: unknown) => error instanceof UnauthorizedException && error.message === 'Invalid email or password');
  });

  it('does not grant unrestricted authentication when a password change is mandatory', async () => {
    await request(app.getHttpServer()).post('/api/auth/register').send(registration()).expect(201);
    await users.updateOne({ email: 'traveler@example.com' }, { $set: { mustChangePassword: true } }).exec();
    await assert.rejects(app.get(AuthService).verifyCredentials({ email: 'traveler@example.com', password: 'Travel123' }),
      (error: unknown) => error instanceof ForbiddenException && error.message === 'Password change is required');
  });

  it('preserves the exact password during credential verification', async () => {
    await request(app.getHttpServer()).post('/api/auth/register')
      .send(registration({ password: ' Travel123 ' })).expect(201);
    const auth = app.get(AuthService);
    const verified = await auth.verifyCredentials({ email: 'traveler@example.com', password: ' Travel123 ' });
    assert.equal(verified.email, 'traveler@example.com');
    await assert.rejects(auth.verifyCredentials({ email: 'traveler@example.com', password: 'Travel123' }),
      (error: unknown) => error instanceof UnauthorizedException);
  });

  it('logs in every agreed role and returns only the public current-user shape', async () => {
    for (const role of Object.values(UserRole)) {
      const email = `api-${role.toLowerCase()}@example.com`;
      const registered = await request(app.getHttpServer())
        .post('/api/auth/register').send(registration({ email })).expect(201);
      await users.updateOne({ email }, { $set: { role } }).exec();

      const login = await request(app.getHttpServer())
        .post('/api/auth/login')
        .set('Sec-Fetch-Site', 'same-origin')
        .send({ email: `  ${email.toUpperCase()}  `, password: 'Travel123' })
        .expect(200);
      assertPublicAccount(login);
      assert.equal(login.body.userId, registered.body.userId);
      assert.equal(login.body.email, email);
      assert.equal(login.body.role, role);
      assert.equal(login.body.status, AccountStatus.ACTIVE);

      const currentUser = await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Cookie', readAuthCookies(login).cookieHeader)
        .expect(200);
      assertPublicAccount(currentUser);
      assert.equal(currentUser.body.userId, registered.body.userId);
      assert.equal(currentUser.body.email, email);
      assert.equal(currentUser.body.role, role);
      assertNoAuthCookies(currentUser);
    }
    assert.equal(await sessions.countDocuments(), Object.values(UserRole).length);
  });

  it('reuses the exported guard from an independent feature module', async () => {
    const { response, cookies } = await registerAndLogin();
    const protectedResponse = await request(app.getHttpServer())
      .get('/api/test-feature/guarded')
      .set('Cookie', cookies.cookieHeader)
      .expect(200);
    assert.deepEqual(protectedResponse.body, {
      userId: response.body.userId,
      role: UserRole.USER,
    });
    assertInvalidSession(await request(app.getHttpServer()).get('/api/test-feature/guarded'));
  });

  it('returns the same API credential error for unknown email and wrong password without creating a session', async () => {
    await request(app.getHttpServer()).post('/api/auth/register').send(registration()).expect(201);
    const responses = [];
    for (const input of [
      { email: 'traveler@example.com', password: 'Wrong123' },
      { email: 'unknown@example.com', password: 'Travel123' },
    ]) {
      const response = await request(app.getHttpServer())
        .post('/api/auth/login').send(input);
      assert.equal(response.status, 401);
      assert.ok(response.body.message === 'Invalid email or password');
      assertNoAuthCookies(response);
      responses.push(response.body);
    }
    assert.deepEqual(responses[0], responses[1]);
    assert.equal(await sessions.countDocuments(), 0);
  });

  it('rejects invalid login fields and client-controlled privilege fields before session creation', async () => {
    const invalidInputs: Array<{ changes: Record<string, unknown>; field: string }> = [
      { changes: { email: undefined }, field: 'email' },
      { changes: { email: 'not-an-email' }, field: 'email' },
      { changes: { email: { address: 'traveler@example.com' } }, field: 'email' },
      { changes: { password: undefined }, field: 'password' },
      { changes: { password: '' }, field: 'password' },
      { changes: { password: 12345678 }, field: 'password' },
      { changes: { password: null }, field: 'password' },
      { changes: { role: UserRole.ADMIN }, field: 'role' },
      { changes: { status: AccountStatus.ACTIVE }, field: 'status' },
    ];
    for (const { changes, field } of invalidInputs) {
      const response = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'traveler@example.com', password: 'Travel123', ...changes });
      assertValidationError(response, field);
      assertNoAuthCookies(response);
    }
    assert.equal(await sessions.countDocuments(), 0);
  });

  it('blocks suspended, deactivated, and mandatory-password-change accounts through the login API', async () => {
    const cases = [
      { email: 'suspended@example.com', fields: { status: AccountStatus.SUSPENDED }, status: 403, message: 'Account is suspended' },
      { email: 'deactivated@example.com', fields: { status: AccountStatus.DEACTIVATED }, status: 401, message: 'Invalid email or password' },
      { email: 'temporary@example.com', fields: { mustChangePassword: true }, status: 403, message: 'Password change is required' },
    ];
    for (const entry of cases) {
      await request(app.getHttpServer()).post('/api/auth/register')
        .send(registration({ email: entry.email })).expect(201);
      await users.updateOne({ email: entry.email }, { $set: entry.fields }).exec();

      const incorrect = await request(app.getHttpServer()).post('/api/auth/login')
        .send({ email: entry.email, password: 'Wrong123' });
      assert.equal(incorrect.status, 401);
      assert.ok(incorrect.body.message === 'Invalid email or password');
      assertNoAuthCookies(incorrect);

      const correct = await request(app.getHttpServer()).post('/api/auth/login')
        .send({ email: entry.email, password: 'Travel123' });
      assert.equal(correct.status, entry.status);
      assert.ok(correct.body.message === entry.message);
      assertNoAuthCookies(correct);
    }
    assert.equal(await sessions.countDocuments(), 0);
  });

  it('issues bounded Secure host-only cookies and persists only the refresh digest', async () => {
    const startedAt = Date.now();
    const { response, cookies, claims } = await registerAndLogin();
    assertPublicAccount(response);
    assert.equal(cookies.raw.length, 2);
    for (const cookie of cookies.raw) {
      // Boolean assertions avoid printing cookie values if a check fails.
      assert.ok(/;\s*HttpOnly(?:;|$)/i.test(cookie), 'Authentication cookies must be HttpOnly');
      assert.ok(/;\s*Secure(?:;|$)/i.test(cookie), 'Authentication cookies must be Secure');
      assert.ok(/;\s*SameSite=Lax(?:;|$)/i.test(cookie), 'Authentication cookies must use SameSite=Lax');
      assert.ok(/;\s*Path=\/(?:;|$)/i.test(cookie), 'Host cookies require Path=/');
      assert.ok(!/;\s*Domain=/i.test(cookie), 'Host cookies must not specify Domain');
    }
    assert.ok(/;\s*Max-Age=900(?:;|$)/i.test(cookies.access));
    assert.ok(/;\s*Max-Age=604800(?:;|$)/i.test(cookies.refresh));
    assert.equal(claims.sub, response.body.userId);
    assert.equal(claims.tokenUse, 'access');
    assert.equal(claims.iss, 'travel-planning-booking-platform');
    assert.equal(claims.aud, 'travel-platform-api');
    assert.equal(claims.exp - claims.iat, 900);

    const stored = await sessions.findById(claims.sid)
      .select('+refreshTokenHash').orFail().lean().exec();
    assert.equal(stored.userId.toString(), response.body.userId);
    assert.equal(typeof stored.refreshTokenHash, 'string');
    assert.ok(stored.refreshTokenHash !== cookies.refreshToken);
    const expectedDigest = createHash('sha256').update(cookies.refreshToken).digest('hex');
    assert.ok(stored.refreshTokenHash === expectedDigest, 'Persist the refresh digest, not its plaintext');
    assert.ok(stored.lastActivityAt instanceof Date);
    assert.ok(stored.lastActivityAt.getTime() >= startedAt);
    assert.ok(stored.expiresAt instanceof Date);
    assert.ok(stored.expiresAt.getTime() >= startedAt + 7 * 24 * 60 * 60_000 - 1_000);
    assert.ok(stored.expiresAt.getTime() <= Date.now() + 7 * 24 * 60 * 60_000);
    assert.equal(stored.revokedAt, null);
    assert.ok(stored.createdAt instanceof Date);
    assert.ok(stored.updatedAt instanceof Date);

    const ordinary = await sessions.findById(claims.sid).orFail().lean().exec();
    assert.equal(Object.hasOwn(ordinary, 'refreshTokenHash'), false);
  });

  it('requires the access cookie and rejects bearer-only, refresh-only, and tampered credentials', async () => {
    const { cookies } = await registerAndLogin();
    assertInvalidSession(await request(app.getHttpServer()).get('/api/auth/me'));
    assertInvalidSession(await request(app.getHttpServer()).get('/api/auth/me')
      .set('Authorization', `Bearer ${cookies.accessToken}`));
    assertInvalidSession(await request(app.getHttpServer()).get('/api/auth/me')
      .set('Cookie', cookies.refreshPair));

    const segments = cookies.accessToken.split('.');
    segments[2] = `${segments[2][0] === 'a' ? 'b' : 'a'}${segments[2].slice(1)}`;
    const tampered = segments.join('.');
    assertInvalidSession(await request(app.getHttpServer()).get('/api/auth/me')
      .set('Cookie', `__Host-accessToken=${tampered}`));
    assertInvalidSession(await request(app.getHttpServer()).get('/api/auth/me')
      .set('Cookie', '__Host-accessToken=not-a-jwt'));
  });

  it('rejects signed but expired or incorrectly scoped access tokens', async () => {
    const { claims } = await registerAndLogin();
    const invalidTokens = [
      signedAccessToken(claims, {}, { expiresIn: -1 }),
      signedAccessToken(claims, { tokenUse: 'refresh' }),
      signedAccessToken(claims, {}, { algorithm: 'HS384' }),
      signedAccessToken(claims, {}, { issuer: 'another-platform' }),
      signedAccessToken(claims, {}, { audience: 'another-api' }),
      signedAccessToken(claims, { sid: 'not-an-object-id' }),
      signedAccessToken(claims, { sub: 'not-an-object-id' }),
    ];
    const beforeRequest = await sessions.findById(claims.sid).orFail().lean().exec();
    for (const token of invalidTokens) {
      assertInvalidSession(await request(app.getHttpServer()).get('/api/auth/me')
        .set('Cookie', `__Host-accessToken=${token}`));
    }
    const afterRequest = await sessions.findById(claims.sid).orFail().lean().exec();
    assert.equal(afterRequest.lastActivityAt.getTime(), beforeRequest.lastActivityAt.getTime());
  });

  it('rejects a correctly signed token whose user does not own the referenced session', async () => {
    const { claims } = await registerAndLogin();
    const other = await request(app.getHttpServer()).post('/api/auth/register')
      .send(registration({ email: 'other@example.com' })).expect(201);
    const mismatched = signedAccessToken(claims, { sub: other.body.userId });
    assertInvalidSession(await request(app.getHttpServer()).get('/api/auth/me')
      .set('Cookie', `__Host-accessToken=${mismatched}`));
  });

  it('rejects revoked, absolutely expired, idle-expired, and missing sessions', async () => {
    const changes = [
      { revokedAt: new Date() },
      { expiresAt: new Date(Date.now() - 1_000) },
      { lastActivityAt: new Date(Date.now() - 30 * 60_000 - 1_000) },
    ];
    for (let index = 0; index < changes.length; index++) {
      const { claims, cookies } = await registerAndLogin(`session-${index}@example.com`);
      await sessions.updateOne({ _id: claims.sid }, { $set: changes[index] }).exec();
      assertInvalidSession(await request(app.getHttpServer()).get('/api/auth/me')
        .set('Cookie', cookies.cookieHeader));
    }
    const missing = await registerAndLogin('missing-session@example.com');
    await sessions.deleteOne({ _id: missing.claims.sid }).exec();
    assertInvalidSession(await request(app.getHttpServer()).get('/api/auth/me')
      .set('Cookie', missing.cookies.cookieHeader));
  });

  it('rechecks live account status and temporary-password restrictions for issued sessions', async () => {
    const changes = [
      { status: AccountStatus.SUSPENDED },
      { status: AccountStatus.DEACTIVATED },
      { mustChangePassword: true },
    ];
    for (let index = 0; index < changes.length; index++) {
      const { claims, cookies } = await registerAndLogin(`changed-user-${index}@example.com`);
      await users.updateOne({ _id: claims.sub }, { $set: changes[index] }).exec();
      assertInvalidSession(await request(app.getHttpServer()).get('/api/auth/me')
        .set('Cookie', cookies.cookieHeader));
    }
    const removed = await registerAndLogin('removed-user@example.com');
    await users.deleteOne({ _id: removed.claims.sub }).exec();
    assertInvalidSession(await request(app.getHttpServer()).get('/api/auth/me')
      .set('Cookie', removed.cookies.cookieHeader));
  });

  it('uses the current account role instead of stale authorization information', async () => {
    const { response, claims, cookies } = await registerAndLogin();
    assert.equal(response.body.role, UserRole.USER);
    await users.updateOne({ _id: claims.sub }, { $set: { role: UserRole.ADMIN } }).exec();
    const currentUser = await request(app.getHttpServer()).get('/api/auth/me')
      .set('Cookie', cookies.cookieHeader).expect(200);
    assertPublicAccount(currentUser);
    assert.equal(currentUser.body.role, UserRole.ADMIN);
  });

  it('records authenticated activity without extending the absolute session lifetime', async () => {
    const { claims, cookies } = await registerAndLogin();
    const earlierActivity = new Date(Date.now() - 10 * 60_000);
    await sessions.updateOne({ _id: claims.sid }, { $set: { lastActivityAt: earlierActivity } }).exec();
    const beforeRequest = await sessions.findById(claims.sid).orFail().lean().exec();
    const startedAt = Date.now();
    const response = await request(app.getHttpServer()).get('/api/auth/me')
      .set('Cookie', cookies.cookieHeader).expect(200);
    assertPublicAccount(response);
    const afterRequest = await sessions.findById(claims.sid).orFail().lean().exec();
    assert.ok(afterRequest.lastActivityAt.getTime() >= startedAt);
    assert.ok(afterRequest.lastActivityAt.getTime() <= Date.now());
    assert.equal(afterRequest.expiresAt.getTime(), beforeRequest.expiresAt.getTime());
  });

  it('blocks cross-site browser login attempts without issuing cookies or sessions', async () => {
    await request(app.getHttpServer()).post('/api/auth/register').send(registration()).expect(201);
    const crossSite = await request(app.getHttpServer()).post('/api/auth/login')
      .set('Sec-Fetch-Site', 'cross-site')
      .send({ email: 'traveler@example.com', password: 'Travel123' });
    assert.equal(crossSite.status, 403);
    assertNoAuthCookies(crossSite);

    const foreignOrigin = await request(app.getHttpServer()).post('/api/auth/login')
      .set('Origin', 'https://attacker.invalid')
      .send({ email: 'traveler@example.com', password: 'Travel123' });
    assert.equal(foreignOrigin.status, 403);
    assertNoAuthCookies(foreignOrigin);
    assert.equal(await sessions.countDocuments(), 0);
  });

  it('documents login and current-user access without exposing deferred session routes', async () => {
    const specification = await request(app.getHttpServer()).get('/api/docs-json').expect(200);
    const login = specification.body.paths?.['/api/auth/login']?.post;
    const me = specification.body.paths?.['/api/auth/me']?.get;
    assert.ok(login);
    assert.ok(login.responses?.['200']);
    assert.ok(login.responses?.['400']);
    assert.ok(login.responses?.['401']);
    assert.ok(login.responses?.['403']);
    assert.ok(me);
    assert.ok(me.responses?.['200']);
    assert.ok(me.responses?.['401']);
    assert.equal(specification.body.paths?.['/api/auth/refresh'], undefined);
    assert.equal(specification.body.paths?.['/api/auth/logout'], undefined);
  });

  it('locks every role on its fifth consecutive failure across normalized email variants', async () => {
    for (const role of Object.values(UserRole)) {
      const email = `lock-${role.toLowerCase()}@example.com`;
      await request(app.getHttpServer()).post('/api/auth/register')
        .send(registration({ email })).expect(201);
      await users.updateOne({ email }, { $set: { role } }).exec();

      for (let attempt = 1; attempt <= 5; attempt++) {
        const beforeThreshold = attempt === 5 ? await databaseTime() : undefined;
        const response = await request(app.getHttpServer()).post('/api/auth/login').send({
          email: attempt % 2 === 0 ? email : `  ${email.toUpperCase()}  `,
          password: 'Wrong123',
        });
        if (attempt < 5) assertCredentialFailure(response);
        else assertLockedLogin(response);

        const state = await readLoginState(email);
        assert.equal(state.failedLoginAttempts, attempt);
        assert.equal(state.status, AccountStatus.ACTIVE);
        assert.equal(state.role, role);
        if (attempt < 5) {
          assert.equal(state.lockedUntil, null);
        } else {
          // Bracket the write with the database clock; no sleep or narrow timing window.
          const afterThreshold = await databaseTime();
          assert.ok(beforeThreshold instanceof Date);
          assert.ok(state.lockedUntil instanceof Date);
          assert.ok(state.lockedUntil.getTime() >= beforeThreshold.getTime() + 15 * 60_000);
          assert.ok(state.lockedUntil.getTime() <= afterThreshold.getTime() + 15 * 60_000);
        }
      }
      assert.equal(await users.countDocuments({ email }), 1);
    }
    assert.equal(await sessions.countDocuments(), 0);
  });

  it('rejects wrong and correct passwords during an active lock without extending or resetting it', async () => {
    const lockedUntil = new Date(Date.now() + 15 * 60_000);
    await seedLoginAttempts(5, lockedUntil);
    for (const password of ['Wrong123', 'Travel123', 'AnotherWrong123']) {
      const response = await request(app.getHttpServer()).post('/api/auth/login')
        .send({ email: 'traveler@example.com', password });
      assertLockedLogin(response);
      const state = await readLoginState();
      assert.equal(state.failedLoginAttempts, 5);
      assert.equal(state.lockedUntil?.getTime(), lockedUntil.getTime());
      assert.equal(state.status, AccountStatus.ACTIVE);
    }

    await users.updateOne({ email: 'traveler@example.com' }, { $set: { mustChangePassword: true } }).exec();
    const temporaryAccount = await request(app.getHttpServer()).post('/api/auth/login')
      .send({ email: 'traveler@example.com', password: 'Travel123' });
    assertLockedLogin(temporaryAccount);
    const unchanged = await readLoginState();
    assert.equal(unchanged.failedLoginAttempts, 5);
    assert.equal(unchanged.lockedUntil?.getTime(), lockedUntil.getTime());
    assert.equal(await sessions.countDocuments(), 0);
  });

  it('resets the failure streak only after a successful eligible login', async () => {
    await seedLoginAttempts(4);
    const success = await request(app.getHttpServer()).post('/api/auth/login')
      .send({ email: 'traveler@example.com', password: 'Travel123' }).expect(200);
    assertPublicAccount(success);
    readAuthCookies(success);
    const reset = await readLoginState();
    assert.equal(reset.failedLoginAttempts, 0);
    assert.equal(reset.lockedUntil, null);

    const nextFailure = await request(app.getHttpServer()).post('/api/auth/login')
      .send({ email: 'traveler@example.com', password: 'Wrong123' });
    assertCredentialFailure(nextFailure);
    const nextStreak = await readLoginState();
    assert.equal(nextStreak.failedLoginAttempts, 1);
    assert.equal(nextStreak.lockedUntil, null);
    assert.equal(await sessions.countDocuments(), 1);
  });

  it('allows a correct password after lock expiry and clears the old streak', async () => {
    await seedLoginAttempts(5, new Date('2000-01-01T00:00:00.000Z'));
    const response = await request(app.getHttpServer()).post('/api/auth/login')
      .send({ email: 'traveler@example.com', password: 'Travel123' }).expect(200);
    assertPublicAccount(response);
    readAuthCookies(response);
    const state = await readLoginState();
    assert.equal(state.failedLoginAttempts, 0);
    assert.equal(state.lockedUntil, null);
    assert.equal(state.status, AccountStatus.ACTIVE);
    assert.equal(await sessions.countDocuments(), 1);
  });

  it('starts a new one-attempt streak after an expired lock and another wrong password', async () => {
    await seedLoginAttempts(5, new Date('2000-01-01T00:00:00.000Z'));
    const response = await request(app.getHttpServer()).post('/api/auth/login')
      .send({ email: 'traveler@example.com', password: 'Wrong123' });
    assertCredentialFailure(response);
    const state = await readLoginState();
    assert.equal(state.failedLoginAttempts, 1);
    assert.equal(state.lockedUntil, null);
    assert.equal(state.status, AccountStatus.ACTIVE);
    assert.equal(await sessions.countDocuments(), 0);
  });

  it('does not lose concurrent failure increments and caps the streak at five', async () => {
    await seedLoginAttempts(0);
    const firstFailures = await Promise.all(Array.from({ length: 4 }, () =>
      request(app.getHttpServer()).post('/api/auth/login')
        .send({ email: 'traveler@example.com', password: 'Wrong123' }),
    ));
    for (const response of firstFailures) assertCredentialFailure(response);
    const beforeThreshold = await readLoginState();
    assert.equal(beforeThreshold.failedLoginAttempts, 4);
    assert.equal(beforeThreshold.lockedUntil, null);

    const remainingFailures = await Promise.all(Array.from({ length: 8 }, () =>
      request(app.getHttpServer()).post('/api/auth/login')
        .send({ email: 'traveler@example.com', password: 'Wrong123' }),
    ));
    for (const response of remainingFailures) assertLockedLogin(response);
    const locked = await readLoginState();
    assert.equal(locked.failedLoginAttempts, 5);
    assert.ok(locked.lockedUntil instanceof Date);
    assert.equal(locked.status, AccountStatus.ACTIVE);
    assert.equal(await sessions.countDocuments(), 0);
  });

  it('keeps unknown emails generic and does not count rejected DTOs as credential failures', async () => {
    await seedLoginAttempts(3);
    const unknown = await request(app.getHttpServer()).post('/api/auth/login')
      .send({ email: 'unknown@example.com', password: 'Wrong123' });
    assertCredentialFailure(unknown);
    const invalidInputs: Array<{ changes: Record<string, unknown>; field: string }> = [
      { changes: { password: undefined }, field: 'password' },
      { changes: { password: null }, field: 'password' },
      { changes: { email: 'not-an-email' }, field: 'email' },
      { changes: { role: UserRole.ADMIN }, field: 'role' },
    ];
    for (const { changes, field } of invalidInputs) {
      const response = await request(app.getHttpServer()).post('/api/auth/login')
        .send({ email: 'traveler@example.com', password: 'Wrong123', ...changes });
      assertValidationError(response, field);
      assertNoAuthCookies(response);
    }
    const unchanged = await readLoginState();
    assert.equal(unchanged.failedLoginAttempts, 3);
    assert.equal(unchanged.lockedUntil, null);
    assert.equal(await users.countDocuments(), 1);
    assert.equal(await sessions.countDocuments(), 0);
  });

  it('cannot reset or bypass a fifth failure that commits during correct-password verification', async (context) => {
    await seedLoginAttempts(4);
    const passwords = app.get(PasswordService);
    const originalVerify = passwords.verify.bind(passwords);
    const entered = deferredSignal();
    const release = deferredSignal();
    const verification = context.mock.method(passwords, 'verify', async (password: string, hash: string) => {
      const valid = await originalVerify(password, hash);
      if (password === 'Travel123' && valid) {
        entered.resolve();
        await release.promise;
      }
      return valid;
    });
    const pendingSuccess = request(app.getHttpServer()).post('/api/auth/login')
      .send({ email: 'traveler@example.com', password: 'Travel123' })
      .timeout({ deadline: 15_000 }).then((response) => response);

    try {
      await Promise.race([
        entered.promise,
        pendingSuccess.then(() => { throw new Error('Login completed before the verification barrier'); }),
      ]);
      const fifthFailure = await request(app.getHttpServer()).post('/api/auth/login')
        .send({ email: 'traveler@example.com', password: 'Wrong123' });
      assertLockedLogin(fifthFailure);
      const locked = await readLoginState();
      assert.equal(locked.failedLoginAttempts, 5);
      assert.ok(locked.lockedUntil instanceof Date);

      release.resolve();
      assertLockedLogin(await pendingSuccess);
      const unchanged = await readLoginState();
      assert.equal(unchanged.failedLoginAttempts, 5);
      assert.equal(unchanged.lockedUntil?.getTime(), locked.lockedUntil.getTime());
      assert.equal(await sessions.countDocuments(), 0);
    } finally {
      release.resolve();
      await pendingSuccess.catch(() => undefined);
      verification.mock.restore();
    }
  });

  it('counts a delayed failed verifier from the fresh streak after a successful reset', async (context) => {
    await seedLoginAttempts(4);
    const passwords = app.get(PasswordService);
    const originalVerify = passwords.verify.bind(passwords);
    const entered = deferredSignal();
    const release = deferredSignal();
    const verification = context.mock.method(passwords, 'verify', async (password: string, hash: string) => {
      const valid = await originalVerify(password, hash);
      if (password === 'Wrong123' && !valid) {
        entered.resolve();
        await release.promise;
      }
      return valid;
    });
    const pendingFailure = request(app.getHttpServer()).post('/api/auth/login')
      .send({ email: 'traveler@example.com', password: 'Wrong123' })
      .timeout({ deadline: 15_000 }).then((response) => response);

    try {
      await Promise.race([
        entered.promise,
        pendingFailure.then(() => { throw new Error('Login completed before the verification barrier'); }),
      ]);
      const success = await request(app.getHttpServer()).post('/api/auth/login')
        .send({ email: 'traveler@example.com', password: 'Travel123' }).expect(200);
      assertPublicAccount(success);
      readAuthCookies(success);
      const reset = await readLoginState();
      assert.equal(reset.failedLoginAttempts, 0);
      assert.equal(reset.lockedUntil, null);

      release.resolve();
      assertCredentialFailure(await pendingFailure);
      const nextStreak = await readLoginState();
      assert.equal(nextStreak.failedLoginAttempts, 1);
      assert.equal(nextStreak.lockedUntil, null);
      assert.equal(await sessions.countDocuments(), 1);
    } finally {
      release.resolve();
      await pendingFailure.catch(() => undefined);
      verification.mock.restore();
    }
  });

  it('keeps existing sessions valid when failed logins temporarily lock the account', async () => {
    const { response: login, cookies } = await registerAndLogin();
    for (let attempt = 1; attempt <= 5; attempt++) {
      const response = await request(app.getHttpServer()).post('/api/auth/login')
        .send({ email: 'traveler@example.com', password: 'Wrong123' });
      if (attempt < 5) assertCredentialFailure(response);
      else assertLockedLogin(response);
    }
    const locked = await readLoginState();
    assert.equal(locked.failedLoginAttempts, 5);
    assert.equal(locked.status, AccountStatus.ACTIVE);
    const currentUser = await request(app.getHttpServer()).get('/api/auth/me')
      .set('Cookie', cookies.cookieHeader).expect(200);
    assertPublicAccount(currentUser);
    assert.equal(currentUser.body.userId, login.body.userId);
    assert.equal(await sessions.countDocuments(), 1);
  });
});
