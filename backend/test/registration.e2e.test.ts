import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import type { TestContext } from 'node:test';
import { Controller, Get, INestApplication, Module, Req, UseGuards } from '@nestjs/common';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Model, Types } from 'mongoose';
import request, { Response } from 'supertest';
import { AuthModule } from '../src/auth/auth.module';
import { AuthenticatedRequest, AuthGuard } from '../src/auth/auth.guard';
import { AuthService } from '../src/auth/auth.service';
import { PasswordService } from '../src/auth/password.service';
import { Roles } from '../src/auth/roles.decorator';
import { RolesGuard } from '../src/auth/roles.guard';
import { AuthSession } from '../src/auth/schemas/auth-session.schema';
import { AccountStatus } from '../src/common/enums/account-status.enum';
import { UserRole } from '../src/common/enums/user-role.enum';
import { configureApplication } from '../src/configure-application';
import { CurrenciesService } from '../src/currencies/currencies.service';
import { User, UserDocument } from '../src/users/schemas/user.schema';
import { UsersService } from '../src/users/users.service';
import { AdminSeedService } from '../src/users/admin-seed.service';

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

const PASSWORD_CHANGE_COOKIE = '__Host-passwordChangeToken';

function readNamedCookie(response: Response, name: string) {
  const headers = response.headers['set-cookie'];
  assert.ok(Array.isArray(headers), 'The expected cookie header must be present');
  const raw = (headers as string[]).find((cookie) => cookie.startsWith(`${name}=`));
  assert.ok(raw, `The ${name} cookie must be present`);
  const pair = raw.split(';', 1)[0];
  return { raw, pair, value: decodeURIComponent(pair.slice(name.length + 1)) };
}

function assertProtectedCookie(raw: string) {
  assert.ok(/;\s*HttpOnly(?:;|$)/i.test(raw));
  assert.ok(/;\s*Secure(?:;|$)/i.test(raw));
  assert.ok(/;\s*SameSite=Lax(?:;|$)/i.test(raw));
  assert.ok(/;\s*Path=\/(?:;|$)/i.test(raw));
  assert.ok(!/;\s*Domain=/i.test(raw));
}

function assertClearedCookie(response: Response, name: string) {
  const cookie = readNamedCookie(response, name);
  assert.ok(cookie.value === '', 'The cookie must be empty');
  assertProtectedCookie(cookie.raw);
  const maxAge = /;\s*Max-Age=([^;]+)/i.exec(cookie.raw);
  const expires = /;\s*Expires=([^;]+)/i.exec(cookie.raw);
  assert.ok((maxAge !== null && Number(maxAge[1]) <= 0) ||
    (expires !== null && Date.parse(expires[1]) < Date.now()));
}

function readPasswordChangeCookie(response: Response) {
  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(response.body), ['passwordChangeRequired']);
  assert.equal(response.body.passwordChangeRequired, true);
  assert.equal(response.headers['cache-control'], 'no-store');
  const raw = response.headers['set-cookie'] as unknown as string[];
  assert.ok(Array.isArray(raw) && raw.length === 3);
  assertClearedCookie(response, '__Host-accessToken');
  assertClearedCookie(response, '__Host-refreshToken');
  const limited = readNamedCookie(response, PASSWORD_CHANGE_COOKIE);
  assert.ok(limited.value.length > 0, 'Only the restricted cookie may be nonempty');
  assertProtectedCookie(limited.raw);
  assert.ok(/;\s*Max-Age=900(?:;|$)/i.test(limited.raw));
  return limited;
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

function assertLogoutResponse(response: Response) {
  assert.equal(response.status, 204);
  assert.equal(response.text, '');
  assert.equal(response.headers['cache-control'], 'no-store');
  const cleared = readAuthCookies(response);
  assert.equal(cleared.raw.length, 3);
  assert.ok(cleared.accessToken === '', 'The access cookie must be cleared');
  assert.ok(cleared.refreshToken === '', 'The refresh cookie must be cleared');
  assertClearedCookie(response, PASSWORD_CHANGE_COOKIE);
  for (const cookie of cleared.raw) {
    assert.ok(/;\s*HttpOnly(?:;|$)/i.test(cookie), 'Cleared cookies must remain HttpOnly');
    assert.ok(/;\s*Secure(?:;|$)/i.test(cookie), 'Cleared cookies must remain Secure');
    assert.ok(/;\s*SameSite=Lax(?:;|$)/i.test(cookie), 'Cleared cookies must retain SameSite=Lax');
    assert.ok(/;\s*Path=\/(?:;|$)/i.test(cookie), 'Cleared cookies must retain Path=/');
    assert.ok(!/;\s*Domain=/i.test(cookie), 'Host cookies must not specify Domain');
    const maxAge = /;\s*Max-Age=([^;]+)/i.exec(cookie);
    const expires = /;\s*Expires=([^;]+)/i.exec(cookie);
    if (maxAge) assert.ok(Number(maxAge[1]) <= 0, 'Clearing must not extend cookie lifetime');
    const immediatelyExpired = maxAge !== null && Number(maxAge[1]) <= 0;
    const expiredDate = expires !== null && Date.parse(expires[1]) < Date.now();
    assert.ok(immediatelyExpired || expiredDate, 'The browser must discard the cleared cookie');
  }
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

  @Get('admin-only')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  adminOnly(@Req() authenticatedRequest: AuthenticatedRequest) {
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

describe('ACC-01 registration and ACC-04/05/06 authentication', { concurrency: false }, () => {
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

  async function createRoleAccount(email: string, role = UserRole.USER, status = AccountStatus.ACTIVE, password = 'Travel123') {
    const registered = await request(app.getHttpServer()).post('/api/auth/register')
      .send(registration({ email, password })).expect(201);
    await users.updateOne({ _id: registered.body.userId }, { $set: { role, status } }).exec();
    return registered.body.userId as string;
  }

  async function adminFixture(email = 'password-admin@example.com') {
    const userId = await createRoleAccount(email, UserRole.ADMIN);
    const login = await request(app.getHttpServer()).post('/api/auth/login')
      .send({ email, password: 'Travel123' }).expect(200);
    return { userId, cookies: readAuthCookies(login) };
  }

  async function restrictedFixture(email = 'restricted@example.com') {
    const userId = await createRoleAccount(email);
    await users.updateOne({ _id: userId }, { $set: { mustChangePassword: true } }).exec();
    const response = await request(app.getHttpServer()).post('/api/auth/login')
      .send({ email, password: 'Travel123' }).expect(200);
    const cookie = readPasswordChangeCookie(response);
    const claims = app.get(JwtService).decode<AccessClaims>(cookie.value);
    assert.ok(claims && typeof claims === 'object');
    return { userId, response, cookie, claims };
  }

  async function credentialState(userId: string) {
    return users.findById(userId)
      .select('+passwordHash +credentialVersion +mustChangePassword +failedLoginAttempts +lockedUntil')
      .orFail().lean().exec();
  }

  function changePassword(cookie: string, currentPassword = 'Travel123', newPassword = 'Changed456') {
    return request(app.getHttpServer()).patch('/api/auth/change-password')
      .set('Sec-Fetch-Site', 'same-origin').set('Cookie', cookie)
      .send({ currentPassword, newPassword });
  }

  function resetPassword(cookie: string, userId: string, temporaryPassword = 'Temporary456') {
    return request(app.getHttpServer()).post(`/api/admin/users/${userId}/reset-password`)
      .set('Sec-Fetch-Site', 'same-origin').set('Cookie', cookie)
      .send({ temporaryPassword });
  }

  function patchProfile(cookie: string, changes: Record<string, unknown>) {
    return request(app.getHttpServer()).patch('/api/users/me')
      .set('Sec-Fetch-Site', 'same-origin').set('Cookie', cookie).send(changes);
  }

  function signedPasswordChangeToken(token: string, changes: Record<string, unknown> = {}, options: JwtSignOptions = {}) {
    const claims = app.get(JwtService).decode<Record<string, unknown>>(token);
    assert.ok(claims && typeof claims === 'object');
    const { iat, exp, iss, aud, ...payload } = claims;
    return app.get(JwtService).sign({ ...payload, ...changes }, {
      algorithm: 'HS256', issuer: 'travel-planning-booking-platform', audience: 'travel-platform-api',
      expiresIn: 900, ...options,
    });
  }

  function pauseVerifiedPassword(context: TestContext, expectedPassword: string, arrivals = 1) {
    const service = app.get(PasswordService);
    const original = service.verify.bind(service);
    const entered = deferredSignal();
    const release = deferredSignal();
    let count = 0;
    const verification = context.mock.method(service, 'verify', async (password: string, hash: string) => {
      const valid = await original(password, hash);
      if (password === expectedPassword && valid) {
        count += 1;
        if (count >= arrivals) entered.resolve();
        await release.promise;
      }
      return valid;
    });
    return { entered: entered.promise, release: release.resolve, restore: () => verification.mock.restore() };
  }

  function pauseProfileUpdate(context: TestContext, targetId: string) {
    const service = app.get(UsersService);
    const original = service.updateOwnProfile.bind(service);
    const entered = deferredSignal();
    const release = deferredSignal();
    const update = context.mock.method(service, 'updateOwnProfile', async (...args: Parameters<UsersService['updateOwnProfile']>) => {
      if (args[0] === targetId) {
        assert.equal(args[1], 0);
        entered.resolve();
        await release.promise;
      }
      return original(...args);
    });
    return { entered: entered.promise, release: release.resolve, restore: () => update.mock.restore() };
  }

  async function waitForBarrier(entered: Promise<void>, pending: Array<Promise<Response>>) {
    await Promise.race([
      entered,
      ...pending.map((operation) => operation.then(() => {
        throw new Error('The request completed before its deterministic barrier');
      })),
    ]);
  }

  before(async () => {
    memoryMongo = await MongoMemoryServer.create({
      // MMS always starts its own process with a fresh temporary database and port.
      binary: mongoBinaryOptions(),
      instance: { launchTimeout: 60_000 },
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
    await app.get(CurrenciesService).seedSupported();
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
      for (const field of ['passwordHash', 'mustChangePassword', 'failedLoginAttempts', 'lockedUntil', 'credentialVersion']) {
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

  it('identifies verified temporary credentials without granting an unrestricted session', async () => {
    await request(app.getHttpServer()).post('/api/auth/register').send(registration()).expect(201);
    await users.updateOne({ email: 'traveler@example.com' }, { $set: { mustChangePassword: true } }).exec();
    const verified = await app.get(AuthService).verifyCredentials({ email: 'traveler@example.com', password: 'Travel123' });
    assert.equal(verified.mustChangePassword, true);
    assert.equal(await sessions.countDocuments(), 0);
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

  it('reuses the role guard across modules and enforces the current database role', async () => {
    const { response, cookies } = await registerAndLogin();
    assertInvalidSession(await request(app.getHttpServer()).get('/api/test-feature/admin-only'));
    for (const role of Object.values(UserRole)) {
      await users.updateOne({ _id: response.body.userId }, { $set: { role } }).exec();
      const result = await request(app.getHttpServer()).get('/api/test-feature/admin-only')
        .set('Cookie', cookies.cookieHeader).query({ role: UserRole.ADMIN });
      assert.equal(result.status, role === UserRole.ADMIN ? 200 : 403);
      if (role === UserRole.ADMIN) {
        assert.deepEqual(result.body, { userId: response.body.userId, role });
      } else {
        assert.equal(result.body.message, 'Insufficient permissions');
      }
    }
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

  it('blocks suspended and deactivated accounts through the login API', async () => {
    const cases = [
      { email: 'suspended@example.com', fields: { status: AccountStatus.SUSPENDED }, status: 403, message: 'Account is suspended' },
      { email: 'deactivated@example.com', fields: { status: AccountStatus.DEACTIVATED }, status: 401, message: 'Invalid email or password' },
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
    assert.equal(cookies.raw.length, 3);
    assertClearedCookie(response, PASSWORD_CHANGE_COOKIE);
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

  it('documents login, current-user access, and logout while keeping refresh deferred', async () => {
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
    const logout = specification.body.paths?.['/api/auth/logout']?.post;
    assert.ok(logout);
    assert.ok(logout.responses?.['204']);
    assert.ok(logout.responses?.['403']);
    assert.ok(logout.responses?.['500']);
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

  it('logs out every role, rejects cookie replay, and allows a separate new login', async () => {
    for (const role of Object.values(UserRole)) {
      const email = `logout-${role.toLowerCase()}@example.com`;
      await request(app.getHttpServer()).post('/api/auth/register')
        .send(registration({ email })).expect(201);
      await users.updateOne({ email }, { $set: { role } }).exec();
      const login = await request(app.getHttpServer()).post('/api/auth/login')
        .send({ email, password: 'Travel123' }).expect(200);
      const cookies = readAuthCookies(login);
      const claims = app.get(JwtService).decode<AccessClaims>(cookies.accessToken);
      await request(app.getHttpServer()).get('/api/auth/me')
        .set('Cookie', cookies.cookieHeader).expect(200);
      const beforeLogout = await sessions.findById(claims.sid).orFail().lean().exec();

      const response = await request(app.getHttpServer()).post('/api/auth/logout')
        .set('Sec-Fetch-Site', 'same-origin')
        .set('Cookie', cookies.cookieHeader);
      assertLogoutResponse(response);
      const revoked = await sessions.findById(claims.sid).orFail().lean().exec();
      assert.ok(revoked.revokedAt instanceof Date);
      assert.equal(revoked.lastActivityAt.getTime(), beforeLogout.lastActivityAt.getTime());
      assert.equal(revoked.expiresAt.getTime(), beforeLogout.expiresAt.getTime());
      assertInvalidSession(await request(app.getHttpServer()).get('/api/auth/me')
        .set('Cookie', cookies.cookieHeader));

      const newLogin = await request(app.getHttpServer()).post('/api/auth/login')
        .send({ email, password: 'Travel123' }).expect(200);
      assertPublicAccount(newLogin);
      assert.equal(newLogin.body.role, role);
      const currentUser = await request(app.getHttpServer()).get('/api/auth/me')
        .set('Cookie', readAuthCookies(newLogin).cookieHeader).expect(200);
      assert.equal(currentUser.body.userId, login.body.userId);
      assert.equal(currentUser.body.role, role);
    }
    assert.equal(await sessions.countDocuments({ revokedAt: { $ne: null } }), Object.values(UserRole).length);
  });

  it('revokes through either valid cookie even when its companion is missing or malformed', async () => {
    const variants = ['access-only', 'refresh-only', 'bad-refresh', 'bad-access'] as const;
    for (const variant of variants) {
      const { claims, cookies } = await registerAndLogin(`${variant}@example.com`);
      const cookieHeader = variant === 'access-only' ? cookies.accessPair
        : variant === 'refresh-only' ? cookies.refreshPair
          : variant === 'bad-refresh' ? `${cookies.accessPair}; __Host-refreshToken=malformed`
            : `__Host-accessToken=not-a-jwt; ${cookies.refreshPair}`;
      const response = await request(app.getHttpServer()).post('/api/auth/logout')
        .set('Cookie', cookieHeader);
      assertLogoutResponse(response);
      const session = await sessions.findById(claims.sid).orFail().lean().exec();
      assert.ok(session.revokedAt instanceof Date);
      assertInvalidSession(await request(app.getHttpServer()).get('/api/auth/me')
        .set('Cookie', cookies.cookieHeader));
    }
  });

  it('revokes the refresh session when the access token has already expired', async () => {
    const { claims, cookies } = await registerAndLogin();
    const expiredAccess = signedAccessToken(claims, {}, { expiresIn: -1 });
    const response = await request(app.getHttpServer()).post('/api/auth/logout')
      .set('Cookie', `__Host-accessToken=${expiredAccess}; ${cookies.refreshPair}`);
    assertLogoutResponse(response);
    const session = await sessions.findById(claims.sid).orFail().lean().exec();
    assert.ok(session.revokedAt instanceof Date);
    assertInvalidSession(await request(app.getHttpServer()).get('/api/auth/me')
      .set('Cookie', cookies.cookieHeader));
  });

  it('allows logout after suspension, deactivation, a password-change restriction, or account deletion', async () => {
    const variants = ['suspended', 'deactivated', 'password-change', 'deleted'] as const;
    for (const variant of variants) {
      const { claims, cookies } = await registerAndLogin(`${variant}-logout@example.com`);
      if (variant === 'deleted') {
        await users.deleteOne({ _id: claims.sub }).exec();
      } else {
        const changes = variant === 'suspended' ? { status: AccountStatus.SUSPENDED }
          : variant === 'deactivated' ? { status: AccountStatus.DEACTIVATED }
            : { mustChangePassword: true };
        await users.updateOne({ _id: claims.sub }, { $set: changes }).exec();
      }
      const response = await request(app.getHttpServer()).post('/api/auth/logout')
        .set('Cookie', cookies.cookieHeader);
      assertLogoutResponse(response);
      const session = await sessions.findById(claims.sid).orFail().lean().exec();
      assert.ok(session.revokedAt instanceof Date);
    }
  });

  it('does not revive or touch idle-expired or absolutely expired sessions during logout', async () => {
    for (const variant of ['idle', 'absolute'] as const) {
      const { claims, cookies } = await registerAndLogin(`${variant}-logout@example.com`);
      const changes = variant === 'idle'
        ? { lastActivityAt: new Date('2000-01-01T00:00:00.000Z') }
        : { expiresAt: new Date('2000-01-01T00:00:00.000Z') };
      await sessions.updateOne({ _id: claims.sid }, { $set: changes }).exec();
      const beforeLogout = await sessions.findById(claims.sid).lean().exec();
      assertInvalidSession(await request(app.getHttpServer()).get('/api/auth/me')
        .set('Cookie', cookies.cookieHeader));
      const response = await request(app.getHttpServer()).post('/api/auth/logout')
        .set('Cookie', cookies.cookieHeader);
      assertLogoutResponse(response);
      const afterLogout = await sessions.findById(claims.sid).lean().exec();
      if (afterLogout) {
        assert.ok(beforeLogout);
        assert.ok(afterLogout.revokedAt instanceof Date);
        assert.equal(afterLogout.lastActivityAt.getTime(), beforeLogout.lastActivityAt.getTime());
        assert.equal(afterLogout.expiresAt.getTime(), beforeLogout.expiresAt.getTime());
      } else {
        // TTL deletion of an absolutely expired record also leaves it unusable.
        assert.equal(variant, 'absolute');
      }
    }
  });

  it('clears missing or invalid cookies idempotently without revoking an unrelated session', async () => {
    const { claims, cookies } = await registerAndLogin();
    const beforeLogout = await sessions.findById(claims.sid).orFail().lean().exec();
    const invalidHeaders: Array<string | undefined> = [
      undefined,
      'unrelated=value',
      '__Host-accessToken=not-a-jwt; __Host-refreshToken=malformed',
      '__Host-accessToken=%E0%A4%A; __Host-refreshToken=bad',
      `__Host-refreshToken=${'x'.repeat(1_024)}`,
      `__Host-refreshToken=${'A'.repeat(43)}`,
      `__Host-accessToken=${signedAccessToken(claims, { tokenUse: 'refresh' })}`,
      `__Host-accessToken=${signedAccessToken(claims, {}, { expiresIn: -1 })}`,
    ];
    for (const cookieHeader of invalidHeaders) {
      const pending = request(app.getHttpServer()).post('/api/auth/logout');
      if (cookieHeader !== undefined) pending.set('Cookie', cookieHeader);
      assertLogoutResponse(await pending);
      const unchanged = await sessions.findById(claims.sid).orFail().lean().exec();
      assert.equal(unchanged.revokedAt, null);
      assert.equal(unchanged.lastActivityAt.getTime(), beforeLogout.lastActivityAt.getTime());
      assert.equal(unchanged.expiresAt.getTime(), beforeLogout.expiresAt.getTime());
    }
    await request(app.getHttpServer()).get('/api/auth/me')
      .set('Cookie', cookies.cookieHeader).expect(200);
    assert.equal(await sessions.countDocuments(), 1);
  });

  it('revokes both independently proven mixed sessions while preserving other browser logins', async () => {
    const first = await registerAndLogin('first-browser@example.com');
    const second = await registerAndLogin('second-browser@example.com');
    const unaffectedLogin = await request(app.getHttpServer()).post('/api/auth/login')
      .send({ email: 'first-browser@example.com', password: 'Travel123' }).expect(200);
    const unaffectedCookies = readAuthCookies(unaffectedLogin);
    const response = await request(app.getHttpServer()).post('/api/auth/logout')
      .set('Cookie', `${first.cookies.accessPair}; ${second.cookies.refreshPair}`);
    assertLogoutResponse(response);

    for (const fixture of [first, second]) {
      const revoked = await sessions.findById(fixture.claims.sid).orFail().lean().exec();
      assert.ok(revoked.revokedAt instanceof Date);
      assertInvalidSession(await request(app.getHttpServer()).get('/api/auth/me')
        .set('Cookie', fixture.cookies.cookieHeader));
    }
    const currentUser = await request(app.getHttpServer()).get('/api/auth/me')
      .set('Cookie', unaffectedCookies.cookieHeader).expect(200);
    assert.equal(currentUser.body.userId, first.response.body.userId);
    assert.equal(await sessions.countDocuments(), 3);
    assert.equal(await sessions.countDocuments({ revokedAt: null }), 1);
  });

  it('keeps already-revoked timestamps and activity stable on repeated logout', async () => {
    const { claims, cookies } = await registerAndLogin();
    const firstLogout = await request(app.getHttpServer()).post('/api/auth/logout')
      .set('Cookie', cookies.cookieHeader);
    assertLogoutResponse(firstLogout);
    const revoked = await sessions.findById(claims.sid).orFail().lean().exec();
    assert.ok(revoked.revokedAt instanceof Date);
    const previousMarker = new Date('2000-01-01T00:00:00.000Z');
    // A fixed existing marker detects rewriting without relying on a timed delay.
    await sessions.collection.updateOne({ _id: revoked._id }, {
      $set: { revokedAt: previousMarker, updatedAt: previousMarker },
    });
    for (let repeat = 0; repeat < 2; repeat++) {
      const response = await request(app.getHttpServer()).post('/api/auth/logout')
        .set('Cookie', cookies.cookieHeader);
      assertLogoutResponse(response);
      const unchanged = await sessions.findById(claims.sid).orFail().lean().exec();
      assert.equal(unchanged.revokedAt?.getTime(), previousMarker.getTime());
      assert.equal(unchanged.updatedAt.getTime(), previousMarker.getTime());
      assert.equal(unchanged.lastActivityAt.getTime(), revoked.lastActivityAt.getTime());
      assert.equal(unchanged.expiresAt.getTime(), revoked.expiresAt.getTime());
    }
  });

  it('does not let body or query identifiers select another account or session for logout', async () => {
    const own = await registerAndLogin('own-logout@example.com');
    const other = await registerAndLogin('other-logout@example.com');
    const path = `/api/auth/logout?userId=${other.claims.sub}&sessionId=${other.claims.sid}`;
    const body = { userId: other.claims.sub, sessionId: other.claims.sid };
    const withoutCredentials = await request(app.getHttpServer()).post(path).send(body);
    assertLogoutResponse(withoutCredentials);
    assert.equal(await sessions.countDocuments({ revokedAt: { $ne: null } }), 0);

    const ownLogout = await request(app.getHttpServer()).post(path)
      .set('Cookie', own.cookies.cookieHeader).send(body);
    assertLogoutResponse(ownLogout);
    const ownSession = await sessions.findById(own.claims.sid).orFail().lean().exec();
    const otherSession = await sessions.findById(other.claims.sid).orFail().lean().exec();
    assert.ok(ownSession.revokedAt instanceof Date);
    assert.equal(otherSession.revokedAt, null);
    const currentOtherUser = await request(app.getHttpServer()).get('/api/auth/me')
      .set('Cookie', other.cookies.cookieHeader).expect(200);
    assert.equal(currentOtherUser.body.userId, other.response.body.userId);
  });

  it('handles concurrent logout requests without creating sessions or changing activity and expiry', async () => {
    const { claims, cookies } = await registerAndLogin();
    const beforeLogout = await sessions.findById(claims.sid).orFail().lean().exec();
    const responses = await Promise.all(Array.from({ length: 4 }, () =>
      request(app.getHttpServer()).post('/api/auth/logout')
        .set('Cookie', cookies.cookieHeader),
    ));
    for (const response of responses) assertLogoutResponse(response);
    const afterLogout = await sessions.findById(claims.sid).orFail().lean().exec();
    assert.ok(afterLogout.revokedAt instanceof Date);
    assert.equal(afterLogout.lastActivityAt.getTime(), beforeLogout.lastActivityAt.getTime());
    assert.equal(afterLogout.expiresAt.getTime(), beforeLogout.expiresAt.getTime());
    assert.equal(await sessions.countDocuments(), 1);
    assertInvalidSession(await request(app.getHttpServer()).get('/api/auth/me')
      .set('Cookie', cookies.cookieHeader));
  });

  it('does not let an in-flight authenticated request revive or touch a logged-out session', async (context) => {
    const { claims, cookies } = await registerAndLogin();
    const beforeLogout = await sessions.findById(claims.sid).orFail().lean().exec();
    const usersService = app.get(UsersService);
    const originalLookup = usersService.findByIdForAuthentication.bind(usersService);
    const entered = deferredSignal();
    const release = deferredSignal();
    const lookup = context.mock.method(usersService, 'findByIdForAuthentication', async (userId: string) => {
      const user = await originalLookup(userId);
      if (userId === claims.sub) {
        entered.resolve();
        await release.promise;
      }
      return user;
    });
    const pendingRead = request(app.getHttpServer()).get('/api/auth/me')
      .set('Cookie', cookies.cookieHeader)
      .timeout({ deadline: 15_000 }).then((response) => response);

    try {
      await Promise.race([
        entered.promise,
        pendingRead.then(() => { throw new Error('The authenticated read completed before the barrier'); }),
      ]);
      const response = await request(app.getHttpServer()).post('/api/auth/logout')
        .set('Cookie', cookies.cookieHeader).timeout({ deadline: 15_000 });
      assertLogoutResponse(response);
      release.resolve();
      assertInvalidSession(await pendingRead);
      const revoked = await sessions.findById(claims.sid).orFail().lean().exec();
      assert.ok(revoked.revokedAt instanceof Date);
      assert.equal(revoked.lastActivityAt.getTime(), beforeLogout.lastActivityAt.getTime());
      assert.equal(revoked.expiresAt.getTime(), beforeLogout.expiresAt.getTime());
    } finally {
      release.resolve();
      await pendingRead.catch(() => undefined);
      lookup.mock.restore();
    }
  });

  it('reports database revocation failure without clearing cookies and allows a successful retry', async (context) => {
    const { claims, cookies } = await registerAndLogin();
    const beforeLogout = await sessions.findById(claims.sid).orFail().lean().exec();
    const failedQuery = {
      exec: async () => { throw new Error('Injected isolated revocation failure'); },
    } as unknown as ReturnType<typeof sessions.updateMany>;
    const update = context.mock.method(sessions, 'updateMany', () => failedQuery, { times: 1 });
    try {
      const response = await request(app.getHttpServer()).post('/api/auth/logout')
        .set('Cookie', cookies.cookieHeader);
      assert.equal(response.status, 500);
      assert.equal(response.body.error, 'Internal Server Error');
      assert.ok(response.body.message === 'An unexpected error occurred');
      assertNoAuthCookies(response);
      const unchanged = await sessions.findById(claims.sid).orFail().lean().exec();
      assert.equal(unchanged.revokedAt, null);
      assert.equal(unchanged.lastActivityAt.getTime(), beforeLogout.lastActivityAt.getTime());
      assert.equal(unchanged.expiresAt.getTime(), beforeLogout.expiresAt.getTime());
    } finally {
      update.mock.restore();
    }

    await request(app.getHttpServer()).get('/api/auth/me')
      .set('Cookie', cookies.cookieHeader).expect(200);
    const retry = await request(app.getHttpServer()).post('/api/auth/logout')
      .set('Cookie', cookies.cookieHeader);
    assertLogoutResponse(retry);
    assertInvalidSession(await request(app.getHttpServer()).get('/api/auth/me')
      .set('Cookie', cookies.cookieHeader));
  });

  it('rejects cross-origin logout before either clearing cookies or revoking the session', async () => {
    const { claims, cookies } = await registerAndLogin();
    const beforeLogout = await sessions.findById(claims.sid).orFail().lean().exec();
    const crossSite = await request(app.getHttpServer()).post('/api/auth/logout')
      .set('Cookie', cookies.cookieHeader).set('Sec-Fetch-Site', 'cross-site');
    assert.equal(crossSite.status, 403);
    assertNoAuthCookies(crossSite);
    const foreignOrigin = await request(app.getHttpServer()).post('/api/auth/logout')
      .set('Cookie', cookies.cookieHeader).set('Origin', 'https://attacker.invalid');
    assert.equal(foreignOrigin.status, 403);
    assertNoAuthCookies(foreignOrigin);
    const unchanged = await sessions.findById(claims.sid).orFail().lean().exec();
    assert.equal(unchanged.revokedAt, null);
    assert.equal(unchanged.lastActivityAt.getTime(), beforeLogout.lastActivityAt.getTime());
    assert.equal(unchanged.expiresAt.getTime(), beforeLogout.expiresAt.getTime());
    await request(app.getHttpServer()).get('/api/auth/me')
      .set('Cookie', cookies.cookieHeader).expect(200);
  });

  it('changes the password for every role and invalidates all older sessions by credential epoch', async () => {
    for (const role of Object.values(UserRole)) {
      const email = `change-${role.toLowerCase()}@example.com`;
      const userId = await createRoleAccount(email, role);
      const login = await request(app.getHttpServer()).post('/api/auth/login')
        .send({ email, password: 'Travel123' }).expect(200);
      const first = readAuthCookies(login);
      const claims = app.get(JwtService).decode<AccessClaims>(first.accessToken);
      const secondLogin = await request(app.getHttpServer()).post('/api/auth/login')
        .send({ email, password: 'Travel123' }).expect(200);
      const second = readAuthCookies(secondLogin);
      await users.updateOne({ _id: userId }, { $set: { failedLoginAttempts: 4 } }).exec();

      assertLogoutResponse(await changePassword(first.cookieHeader));
      const changed = await credentialState(userId);
      assert.equal(changed.credentialVersion, 1);
      assert.equal(changed.mustChangePassword, false);
      assert.equal(changed.failedLoginAttempts, 0);
      assert.equal(changed.lockedUntil, null);
      assert.equal(changed.role, role);
      assert.equal(changed.status, AccountStatus.ACTIVE);
      assert.ok(await app.get(PasswordService).verify('Changed456', changed.passwordHash));
      const oldSession = await sessions.findById(claims.sid).select('+credentialVersion').orFail().lean().exec();
      assert.equal(oldSession.credentialVersion, 0);
      assert.equal(oldSession.revokedAt, null);
      for (const oldCookies of [first, second]) {
        assertInvalidSession(await request(app.getHttpServer()).get('/api/auth/me')
          .set('Cookie', oldCookies.cookieHeader));
      }
      assertCredentialFailure(await request(app.getHttpServer()).post('/api/auth/login')
        .send({ email, password: 'Travel123' }));
      const newLogin = await request(app.getHttpServer()).post('/api/auth/login')
        .send({ email, password: 'Changed456' }).expect(200);
      assertPublicAccount(newLogin);
      assertClearedCookie(newLogin, PASSWORD_CHANGE_COOKIE);
      await request(app.getHttpServer()).get('/api/auth/me')
        .set('Cookie', readAuthCookies(newLogin).cookieHeader).expect(200);
    }
  });

  it('requires current credentials and rejects unchanged or invalid replacement passwords without mutation', async () => {
    const { registered, cookies } = await registerAndLogin();
    const userId = registered.body.userId as string;
    const before = await credentialState(userId);
    const wrong = await changePassword(cookies.cookieHeader, 'Incorrect123', 'Changed456');
    assert.equal(wrong.status, 401);
    assert.ok(wrong.body.message === 'Invalid current password');
    assertNoAuthCookies(wrong);

    const unchanged = await changePassword(cookies.cookieHeader, 'Travel123', 'Travel123');
    assert.equal(unchanged.status, 400);
    assert.ok(Array.isArray(unchanged.body.errors?.newPassword));
    assert.ok(unchanged.body.errors.newPassword.length > 0);
    assertNoAuthCookies(unchanged);

    const invalid: Array<{ field: string; value: unknown }> = [
      { field: 'currentPassword', value: undefined }, { field: 'currentPassword', value: null },
      { field: 'currentPassword', value: '' }, { field: 'currentPassword', value: 12345678 },
      { field: 'newPassword', value: undefined }, { field: 'newPassword', value: null },
      { field: 'newPassword', value: 12345678 }, { field: 'newPassword', value: 'short1' },
      { field: 'newPassword', value: 'abcdefgh' }, { field: 'newPassword', value: '12345678' },
    ];
    for (const { field, value } of invalid) {
      const response = await request(app.getHttpServer()).patch('/api/auth/change-password')
        .set('Cookie', cookies.cookieHeader)
        .send({ currentPassword: 'Travel123', newPassword: 'Changed456', [field]: value });
      assertValidationError(response, field);
      assertNoAuthCookies(response);
      assert.ok(!JSON.stringify(response.body).includes('Travel123'));
      assert.ok(!JSON.stringify(response.body).includes('Changed456'));
    }
    assertInvalidSession(await changePassword('', 'Travel123', 'Changed456'));
    assertInvalidSession(await changePassword(cookies.refreshPair, 'Travel123', 'Changed456'));
    const after = await credentialState(userId);
    assert.equal(after.credentialVersion, before.credentialVersion);
    assert.ok(after.passwordHash === before.passwordHash);
    assert.equal(after.failedLoginAttempts, before.failedLoginAttempts);
    await request(app.getHttpServer()).get('/api/auth/me').set('Cookie', cookies.cookieHeader).expect(200);
  });

  it('preserves current and replacement password whitespace and Unicode policy characters', async () => {
    const email = 'exact-password-change@example.com';
    await createRoleAccount(email, UserRole.USER, AccountStatus.ACTIVE, ' Travel123 ');
    const login = await request(app.getHttpServer()).post('/api/auth/login')
      .send({ email, password: ' Travel123 ' }).expect(200);
    const cookies = readAuthCookies(login);
    const trimmed = await changePassword(cookies.cookieHeader, 'Travel123', ' abcd١٢٣٤ ');
    assert.equal(trimmed.status, 401);
    assert.ok(trimmed.body.message === 'Invalid current password');
    assertLogoutResponse(await changePassword(cookies.cookieHeader, ' Travel123 ', ' abcd١٢٣٤ '));
    assertCredentialFailure(await request(app.getHttpServer()).post('/api/auth/login')
      .send({ email, password: 'abcd١٢٣٤' }));
    const renewed = await request(app.getHttpServer()).post('/api/auth/login')
      .send({ email, password: ' abcd١٢٣٤ ' }).expect(200);
    assertPublicAccount(renewed);
  });

  it('uses the authenticated owner for changes and rejects client-controlled identity or credential fields', async () => {
    const own = await registerAndLogin('change-owner@example.com');
    const otherId = await createRoleAccount('unchanged-owner@example.com');
    const beforeOther = await credentialState(otherId);
    for (const [field, value] of Object.entries({ userId: otherId, role: UserRole.ADMIN, status: AccountStatus.ACTIVE, credentialVersion: 99 })) {
      const rejected = await request(app.getHttpServer()).patch('/api/auth/change-password')
        .set('Cookie', own.cookies.cookieHeader)
        .send({ currentPassword: 'Travel123', newPassword: 'Changed456', [field]: value });
      assertValidationError(rejected, field);
      assertNoAuthCookies(rejected);
    }
    const response = await request(app.getHttpServer()).patch('/api/auth/change-password')
      .query({ userId: otherId }).set('Cookie', own.cookies.cookieHeader)
      .send({ currentPassword: 'Travel123', newPassword: 'Changed456' });
    assertLogoutResponse(response);
    const afterOther = await credentialState(otherId);
    assert.equal(afterOther.credentialVersion, beforeOther.credentialVersion);
    assert.ok(afterOther.passwordHash === beforeOther.passwordHash);
    assert.equal((await credentialState(own.registered.body.userId)).credentialVersion, 1);
  });

  it('allows an ACTIVE existing session to change its password while new logins are locked', async () => {
    const fixture = await registerAndLogin();
    await users.updateOne({ _id: fixture.registered.body.userId }, {
      $set: { failedLoginAttempts: 5, lockedUntil: new Date(Date.now() + 15 * 60_000) },
    }).exec();
    assertLogoutResponse(await changePassword(fixture.cookies.cookieHeader));
    const changed = await credentialState(fixture.registered.body.userId);
    assert.equal(changed.failedLoginAttempts, 0);
    assert.equal(changed.lockedUntil, null);
    assert.equal(changed.credentialVersion, 1);
    assert.equal(changed.status, AccountStatus.ACTIVE);
  });

  it('permits only an administrator to reset another account and preserves the actor session', async () => {
    const targetId = await createRoleAccount('reset-target@example.com');
    const before = await credentialState(targetId);
    const anonymous = await request(app.getHttpServer()).post(`/api/admin/users/${targetId}/reset-password`)
      .send({ temporaryPassword: 'Temporary456' });
    assertInvalidSession(anonymous);
    for (const role of [UserRole.USER, UserRole.AIRLINE_MODERATOR, UserRole.HOTEL_MODERATOR]) {
      const email = `reset-denied-${role.toLowerCase()}@example.com`;
      await createRoleAccount(email, role);
      const login = await request(app.getHttpServer()).post('/api/auth/login')
        .send({ email, password: 'Travel123' }).expect(200);
      const denied = await resetPassword(readAuthCookies(login).cookieHeader, targetId);
      assert.equal(denied.status, 403);
      assertNoAuthCookies(denied);
    }
    const unchanged = await credentialState(targetId);
    assert.equal(unchanged.credentialVersion, before.credentialVersion);
    assert.ok(unchanged.passwordHash === before.passwordHash);
    const admin = await adminFixture();
    const accepted = await resetPassword(admin.cookies.cookieHeader, targetId);
    assert.equal(accepted.status, 204);
    assert.equal(accepted.text, '');
    assertNoAuthCookies(accepted);
    await request(app.getHttpServer()).get('/api/auth/me')
      .set('Cookie', admin.cookies.cookieHeader).expect(200);
  });

  it('resets users and both moderator types in every status without reactivating or reassigning them', async () => {
    const admin = await adminFixture();
    for (const role of [UserRole.USER, UserRole.AIRLINE_MODERATOR, UserRole.HOTEL_MODERATOR]) {
      for (const status of Object.values(AccountStatus)) {
        const targetId = await createRoleAccount(`reset-${role.toLowerCase()}-${status.toLowerCase()}@example.com`, role, status);
        await users.updateOne({ _id: targetId }, { $set: { failedLoginAttempts: 5, lockedUntil: new Date(Date.now() + 15 * 60_000) } }).exec();
        const response = await resetPassword(admin.cookies.cookieHeader, targetId);
        assert.equal(response.status, 204);
        assertNoAuthCookies(response);
        const target = await credentialState(targetId);
        assert.equal(target.role, role);
        assert.equal(target.status, status);
        assert.equal(target.mustChangePassword, true);
        assert.equal(target.failedLoginAttempts, 0);
        assert.equal(target.lockedUntil, null);
        assert.equal(target.credentialVersion, 1);
        assert.ok(await app.get(PasswordService).verify('Temporary456', target.passwordHash));
        assert.ok(target.passwordHash !== 'Temporary456');
      }
    }
  });

  it('rejects administrator targets, missing users, malformed IDs and invalid reset payloads without changes', async () => {
    const admin = await adminFixture();
    const targetId = await createRoleAccount('validated-reset@example.com');
    const before = await credentialState(targetId);
    for (const userId of [admin.userId, new Types.ObjectId().toHexString()]) {
      const rejected = await resetPassword(admin.cookies.cookieHeader, userId);
      assert.equal(rejected.status, 404);
      assertNoAuthCookies(rejected);
    }
    assertValidationError(await resetPassword(admin.cookies.cookieHeader, 'not-an-id'), 'userId');
    for (const value of [undefined, null, '', 12345678, 'short1', 'abcdefgh', '12345678']) {
      const rejected = await request(app.getHttpServer()).post(`/api/admin/users/${targetId}/reset-password`)
        .set('Cookie', admin.cookies.cookieHeader).send({ temporaryPassword: value });
      assertValidationError(rejected, 'temporaryPassword');
      assertNoAuthCookies(rejected);
    }
    for (const [field, value] of Object.entries({ userId: admin.userId, role: UserRole.ADMIN, status: AccountStatus.ACTIVE, credentialVersion: 99 })) {
      const rejected = await request(app.getHttpServer()).post(`/api/admin/users/${targetId}/reset-password`)
        .set('Cookie', admin.cookies.cookieHeader).send({ temporaryPassword: 'Temporary456', [field]: value });
      assertValidationError(rejected, field);
      assertNoAuthCookies(rejected);
    }
    const after = await credentialState(targetId);
    assert.equal(after.credentialVersion, before.credentialVersion);
    assert.ok(after.passwordHash === before.passwordHash);
  });

  it('issues a restricted-only 15-minute login for every role requiring a password change', async () => {
    for (const role of Object.values(UserRole)) {
      const email = `required-${role.toLowerCase()}@example.com`;
      const userId = await createRoleAccount(email, role);
      await users.updateOne({ _id: userId }, { $set: { mustChangePassword: true, failedLoginAttempts: 4 } }).exec();
      const before = Date.now();
      const login = await request(app.getHttpServer()).post('/api/auth/login')
        .send({ email, password: 'Travel123' }).expect(200);
      const limited = readPasswordChangeCookie(login);
      const claims = app.get(JwtService).decode<AccessClaims>(limited.value);
      assert.equal(claims.tokenUse, 'password-change');
      assert.equal(claims.sub, userId);
      assert.equal(claims.exp - claims.iat, 900);
      const session = await sessions.findById(claims.sid).orFail().lean().exec();
      assert.ok(session.expiresAt.getTime() >= before + 900_000 - 1000);
      assert.ok(session.expiresAt.getTime() <= Date.now() + 900_000);
      assert.equal((await credentialState(userId)).failedLoginAttempts, 0);
      assertInvalidSession(await request(app.getHttpServer()).get('/api/auth/me').set('Cookie', limited.pair));
      assertInvalidSession(await request(app.getHttpServer()).get('/api/test-feature/guarded')
        .set('Cookie', `__Host-accessToken=${limited.value}`));
      assertInvalidSession(await request(app.getHttpServer()).get('/api/test-feature/admin-only').set('Cookie', limited.pair));
      await request(app.getHttpServer()).post('/api/auth/refresh').set('Cookie', limited.pair).expect(404);
    }
  });

  it('completes the administrator-assisted reset through restricted change and requires a fresh normal login', async () => {
    const admin = await adminFixture();
    const target = await registerAndLogin('reset-flow@example.com');
    const targetId = target.registered.body.userId as string;
    const secondLogin = await request(app.getHttpServer()).post('/api/auth/login')
      .send({ email: 'reset-flow@example.com', password: 'Travel123' }).expect(200);
    const reset = await resetPassword(admin.cookies.cookieHeader, targetId);
    assert.equal(reset.status, 204);
    assertNoAuthCookies(reset);
    for (const cookie of [target.cookies.cookieHeader, readAuthCookies(secondLogin).cookieHeader]) {
      assertInvalidSession(await request(app.getHttpServer()).get('/api/auth/me').set('Cookie', cookie));
    }
    assertCredentialFailure(await request(app.getHttpServer()).post('/api/auth/login')
      .send({ email: 'reset-flow@example.com', password: 'Travel123' }));
    const login = await request(app.getHttpServer()).post('/api/auth/login')
      .send({ email: 'reset-flow@example.com', password: 'Temporary456' }).expect(200);
    const limited = readPasswordChangeCookie(login);
    const wrongCurrent = await changePassword(limited.pair, 'Incorrect123', 'FinalPass789');
    assert.equal(wrongCurrent.status, 401);
    assert.ok(wrongCurrent.body.message === 'Invalid current password');
    assertNoAuthCookies(wrongCurrent);
    assertLogoutResponse(await changePassword(limited.pair, 'Temporary456', 'FinalPass789'));
    const changed = await credentialState(targetId);
    assert.equal(changed.credentialVersion, 2);
    assert.equal(changed.mustChangePassword, false);
    assert.equal(changed.failedLoginAttempts, 0);
    assert.ok(await app.get(PasswordService).verify('FinalPass789', changed.passwordHash));
    assertInvalidSession(await changePassword(limited.pair, 'Temporary456', 'AnotherPass123'));
    assertCredentialFailure(await request(app.getHttpServer()).post('/api/auth/login')
      .send({ email: 'reset-flow@example.com', password: 'Temporary456' }));
    const normal = await request(app.getHttpServer()).post('/api/auth/login')
      .set('Cookie', limited.pair)
      .send({ email: 'reset-flow@example.com', password: 'FinalPass789' }).expect(200);
    assertPublicAccount(normal);
    assertClearedCookie(normal, PASSWORD_CHANGE_COOKIE);
    await request(app.getHttpServer()).get('/api/auth/me')
      .set('Cookie', readAuthCookies(normal).cookieHeader).expect(200);
  });

  it('rejects swapped cookie purposes, expired restricted credentials and empty restricted fallback', async () => {
    const limited = await restrictedFixture();
    const normal = await registerAndLogin('normal-proof@example.com');
    const invalidTokens = [
      signedPasswordChangeToken(limited.cookie.value, { tokenUse: 'access' }),
      signedPasswordChangeToken(limited.cookie.value, { tokenUse: 'refresh' }),
      signedPasswordChangeToken(limited.cookie.value, { sub: 'invalid' }),
      signedPasswordChangeToken(limited.cookie.value, { sid: 'invalid' }),
      signedPasswordChangeToken(limited.cookie.value, {}, { expiresIn: -1 }),
      signedPasswordChangeToken(limited.cookie.value, {}, { issuer: 'untrusted-issuer' }),
      normal.cookies.accessToken,
    ];
    for (const token of invalidTokens) {
      assertInvalidSession(await changePassword(`${PASSWORD_CHANGE_COOKIE}=${token}`));
    }
    assertInvalidSession(await changePassword(`${normal.cookies.cookieHeader}; ${PASSWORD_CHANGE_COOKIE}=`));
    assertInvalidSession(await changePassword(`${normal.cookies.cookieHeader}; ${PASSWORD_CHANGE_COOKIE}=malformed`));
    assertInvalidSession(await changePassword(`__Host-accessToken=${limited.cookie.value}`));
    assertInvalidSession(await changePassword(normal.cookies.refreshPair));
    assert.equal((await credentialState(limited.userId)).credentialVersion, 0);
    assert.equal((await credentialState(normal.registered.body.userId)).credentialVersion, 0);
  });

  it('revokes a restricted session on logout and rejects replay without altering its password', async () => {
    const fixture = await restrictedFixture();
    const before = await credentialState(fixture.userId);
    assertLogoutResponse(await request(app.getHttpServer()).post('/api/auth/logout').set('Cookie', fixture.cookie.pair));
    const session = await sessions.findById(fixture.claims.sid).orFail().lean().exec();
    assert.ok(session.revokedAt instanceof Date);
    assertInvalidSession(await changePassword(fixture.cookie.pair));
    assertLogoutResponse(await request(app.getHttpServer()).post('/api/auth/logout').set('Cookie', fixture.cookie.pair));
    const after = await credentialState(fixture.userId);
    assert.ok(after.passwordHash === before.passwordHash);
    assert.equal(after.credentialVersion, before.credentialVersion);
  });

  it('invalidates an older restricted proof when an administrator resets the password again', async () => {
    const admin = await adminFixture();
    const fixture = await restrictedFixture();
    await resetPassword(admin.cookies.cookieHeader, fixture.userId, 'SecondTemp789').expect(204);
    assertInvalidSession(await changePassword(fixture.cookie.pair, 'Travel123', 'Changed456'));
    assert.equal((await credentialState(fixture.userId)).credentialVersion, 1);
    const renewed = await request(app.getHttpServer()).post('/api/auth/login')
      .send({ email: 'restricted@example.com', password: 'SecondTemp789' }).expect(200);
    readPasswordChangeCookie(renewed);
  });

  it('treats absent legacy user/session epochs as zero and invalidates them after the first change', async () => {
    const fixture = await registerAndLogin();
    await users.updateOne({ _id: fixture.registered.body.userId }, { $unset: { credentialVersion: 1 } }).exec();
    await sessions.updateOne({ _id: fixture.claims.sid }, { $unset: { credentialVersion: 1 } }).exec();
    await request(app.getHttpServer()).get('/api/auth/me').set('Cookie', fixture.cookies.cookieHeader).expect(200);
    assertLogoutResponse(await changePassword(fixture.cookies.cookieHeader));
    const changed = await credentialState(fixture.registered.body.userId);
    assert.equal(changed.credentialVersion, 1);
    assertInvalidSession(await request(app.getHttpServer()).get('/api/auth/me').set('Cookie', fixture.cookies.cookieHeader));
    const ordinary = await users.findById(fixture.registered.body.userId).orFail().lean().exec();
    assert.equal(Object.hasOwn(ordinary, 'credentialVersion'), false);
    const ordinarySession = await sessions.findById(fixture.claims.sid).orFail().lean().exec();
    assert.equal(Object.hasOwn(ordinarySession, 'credentialVersion'), false);
  });

  it('preserves cookies and credentials when the password compare-and-swap fails or its database write throws', async (context) => {
    const fixture = await registerAndLogin();
    const before = await credentialState(fixture.registered.body.userId);
    const service = app.get(UsersService);
    const failedCas = context.mock.method(service, 'replacePassword', async () => false, { times: 1 });
    try {
      assertInvalidSession(await changePassword(fixture.cookies.cookieHeader));
    } finally {
      failedCas.mock.restore();
    }
    const failedWrite = context.mock.method(service, 'replacePassword', async () => {
      throw new Error('Injected isolated password write failure');
    }, { times: 1 });
    try {
      const response = await changePassword(fixture.cookies.cookieHeader);
      assert.equal(response.status, 500);
      assert.ok(response.body.message === 'An unexpected error occurred');
      assertNoAuthCookies(response);
    } finally {
      failedWrite.mock.restore();
    }
    const after = await credentialState(fixture.registered.body.userId);
    assert.equal(after.credentialVersion, before.credentialVersion);
    assert.ok(after.passwordHash === before.passwordHash);
    assertLogoutResponse(await changePassword(fixture.cookies.cookieHeader));
  });

  it('rejects cross-origin password changes/resets and publishes both flows and cookie alternatives in Swagger', async () => {
    const admin = await adminFixture();
    const normal = await registerAndLogin();
    const limited = await restrictedFixture();
    for (const cookie of [normal.cookies.cookieHeader, limited.cookie.pair]) {
      const response = await request(app.getHttpServer()).patch('/api/auth/change-password')
        .set('Cookie', cookie).set('Sec-Fetch-Site', 'cross-site')
        .send({ currentPassword: 'Travel123', newPassword: 'Changed456' });
      assert.equal(response.status, 403);
      assertNoAuthCookies(response);
    }
    const reset = await request(app.getHttpServer()).post(`/api/admin/users/${normal.registered.body.userId}/reset-password`)
      .set('Cookie', admin.cookies.cookieHeader).set('Origin', 'https://attacker.invalid')
      .send({ temporaryPassword: 'Temporary456' });
    assert.equal(reset.status, 403);
    assertNoAuthCookies(reset);
    assert.equal((await credentialState(normal.registered.body.userId)).credentialVersion, 0);
    assert.equal((await credentialState(limited.userId)).credentialVersion, 0);

    const specification = await request(app.getHttpServer()).get('/api/docs-json').expect(200);
    const change = specification.body.paths['/api/auth/change-password']?.patch;
    const adminReset = specification.body.paths['/api/admin/users/{userId}/reset-password']?.post;
    assert.ok(change?.responses?.['204']);
    assert.ok(adminReset?.responses?.['204']);
    assert.ok(change.security.some((entry: Record<string, unknown>) => Object.hasOwn(entry, 'accessToken')));
    assert.ok(change.security.some((entry: Record<string, unknown>) => Object.hasOwn(entry, 'passwordChangeToken')));
    assert.ok(change.security.every((entry: Record<string, unknown>) => Object.keys(entry).length === 1));
    assert.equal(specification.body.components.securitySchemes.passwordChangeToken.name, PASSWORD_CHANGE_COOKIE);
    assert.equal(specification.body.paths['/api/auth/login'].post.responses['200'].content['application/json'].schema.oneOf.length, 2);
    assert.equal(specification.body.paths['/api/auth/refresh'], undefined);
  });

  it('allows only one of two concurrently verified password replacements to commit', async (context) => {
    const fixture = await registerAndLogin();
    const barrier = pauseVerifiedPassword(context, 'Travel123', 2);
    const replacements = ['FirstNew123', 'SecondNew456'];
    const pending = replacements.map((replacement) => changePassword(fixture.cookies.cookieHeader, 'Travel123', replacement)
      .timeout({ deadline: 20_000 }).then((response) => response));
    try {
      await waitForBarrier(barrier.entered, pending);
      barrier.release();
      const results = await Promise.all(pending);
      assert.deepEqual(results.map((response) => response.status).sort(), [204, 401]);
      const winner = results.findIndex((response) => response.status === 204);
      assertLogoutResponse(results[winner]);
      assertInvalidSession(results[1 - winner]);
      const stored = await credentialState(fixture.registered.body.userId);
      assert.equal(stored.credentialVersion, 1);
      assert.ok(await app.get(PasswordService).verify(replacements[winner], stored.passwordHash));
      assert.ok(!await app.get(PasswordService).verify(replacements[1 - winner], stored.passwordHash));
    } finally {
      barrier.release();
      await Promise.allSettled(pending);
      barrier.restore();
    }
  });

  it('cannot overwrite an administrator reset using an earlier verified current password', async (context) => {
    const admin = await adminFixture();
    const fixture = await registerAndLogin();
    const barrier = pauseVerifiedPassword(context, 'Travel123');
    const pending = changePassword(fixture.cookies.cookieHeader).timeout({ deadline: 20_000 }).then((response) => response);
    try {
      await waitForBarrier(barrier.entered, [pending]);
      await resetPassword(admin.cookies.cookieHeader, fixture.registered.body.userId).expect(204);
      barrier.release();
      assertInvalidSession(await pending);
      const stored = await credentialState(fixture.registered.body.userId);
      assert.equal(stored.credentialVersion, 1);
      assert.equal(stored.mustChangePassword, true);
      assert.ok(await app.get(PasswordService).verify('Temporary456', stored.passwordHash));
      assert.ok(!await app.get(PasswordService).verify('Changed456', stored.passwordHash));
    } finally {
      barrier.release();
      await pending.catch(() => undefined);
      barrier.restore();
    }
  });

  it('does not log in using an old password verification that finishes after an administrator reset', async (context) => {
    const admin = await adminFixture();
    const targetId = await createRoleAccount('stale-login@example.com');
    const barrier = pauseVerifiedPassword(context, 'Travel123');
    const pending = request(app.getHttpServer()).post('/api/auth/login')
      .send({ email: 'stale-login@example.com', password: 'Travel123' })
      .timeout({ deadline: 20_000 }).then((response) => response);
    try {
      await waitForBarrier(barrier.entered, [pending]);
      await resetPassword(admin.cookies.cookieHeader, targetId).expect(204);
      barrier.release();
      assertCredentialFailure(await pending);
      assert.equal(await sessions.countDocuments({ userId: targetId }), 0);
      assert.equal((await credentialState(targetId)).credentialVersion, 1);
    } finally {
      barrier.release();
      await pending.catch(() => undefined);
      barrier.restore();
    }
  });

  it('cannot issue a usable session when reset occurs between credential acceptance and session issuance', async (context) => {
    const admin = await adminFixture();
    const targetId = await createRoleAccount('reset-during-issuance@example.com');
    const service = app.get(UsersService);
    const original = service.findByIdForAuthentication.bind(service);
    const entered = deferredSignal();
    const release = deferredSignal();
    let paused = false;
    const lookup = context.mock.method(service, 'findByIdForAuthentication', async (userId: string) => {
      const user = await original(userId);
      if (userId === targetId && !paused) {
        paused = true;
        entered.resolve();
        await release.promise;
      }
      return user;
    });
    const pending = request(app.getHttpServer()).post('/api/auth/login')
      .send({ email: 'reset-during-issuance@example.com', password: 'Travel123' })
      .timeout({ deadline: 20_000 }).then((response) => response);
    try {
      await waitForBarrier(entered.promise, [pending]);
      await resetPassword(admin.cookies.cookieHeader, targetId).expect(204);
      release.resolve();
      assertInvalidSession(await pending);
      const oldSessions = await sessions.find({ userId: targetId }).select('+credentialVersion').lean().exec();
      assert.ok(oldSessions.every((session) => (session.credentialVersion ?? 0) === 0));
      assert.equal((await credentialState(targetId)).credentialVersion, 1);
    } finally {
      release.resolve();
      await pending.catch(() => undefined);
      lookup.mock.restore();
    }
  });

  it('rechecks the account epoch after touching a session when a reset races authenticated access', async (context) => {
    const admin = await adminFixture();
    const fixture = await registerAndLogin();
    const targetId = fixture.registered.body.userId as string;
    const service = app.get(UsersService);
    const original = service.findByIdForAuthentication.bind(service);
    const entered = deferredSignal();
    const release = deferredSignal();
    let lookups = 0;
    const lookup = context.mock.method(service, 'findByIdForAuthentication', async (userId: string) => {
      if (userId === targetId && ++lookups === 2) {
        entered.resolve();
        await release.promise;
      }
      return original(userId);
    });
    const pending = request(app.getHttpServer()).get('/api/auth/me').set('Cookie', fixture.cookies.cookieHeader)
      .timeout({ deadline: 20_000 }).then((response) => response);
    try {
      await waitForBarrier(entered.promise, [pending]);
      await resetPassword(admin.cookies.cookieHeader, targetId).expect(204);
      release.resolve();
      assertInvalidSession(await pending);
      assert.equal((await credentialState(targetId)).credentialVersion, 1);
    } finally {
      release.resolve();
      await pending.catch(() => undefined);
      lookup.mock.restore();
    }
  });

  it('rechecks target eligibility if an account becomes ADMIN while its temporary password is hashed', async (context) => {
    const admin = await adminFixture();
    const targetId = await createRoleAccount('promoted-during-reset@example.com');
    const before = await credentialState(targetId);
    const passwords = app.get(PasswordService);
    const original = passwords.hash.bind(passwords);
    const entered = deferredSignal();
    const release = deferredSignal();
    const hash = context.mock.method(passwords, 'hash', async (password: string) => {
      const derived = await original(password);
      if (password === 'Temporary456') {
        entered.resolve();
        await release.promise;
      }
      return derived;
    });
    const pending = resetPassword(admin.cookies.cookieHeader, targetId)
      .timeout({ deadline: 20_000 }).then((response) => response);
    try {
      await waitForBarrier(entered.promise, [pending]);
      await users.updateOne({ _id: targetId }, { $set: { role: UserRole.ADMIN } }).exec();
      release.resolve();
      const rejected = await pending;
      assert.equal(rejected.status, 404);
      assertNoAuthCookies(rejected);
      const after = await credentialState(targetId);
      assert.equal(after.role, UserRole.ADMIN);
      assert.equal(after.credentialVersion, before.credentialVersion);
      assert.ok(after.passwordHash === before.passwordHash);
    } finally {
      release.resolve();
      await pending.catch(() => undefined);
      hash.mock.restore();
    }
  });

  it('preserves the administrator cookies and target credentials on an injected reset write failure', async (context) => {
    const admin = await adminFixture();
    const targetId = await createRoleAccount('failed-reset@example.com');
    const before = await credentialState(targetId);
    const service = app.get(UsersService);
    const write = context.mock.method(service, 'setTemporaryPassword', async () => {
      throw new Error('Injected isolated reset write failure');
    }, { times: 1 });
    try {
      const failed = await resetPassword(admin.cookies.cookieHeader, targetId);
      assert.equal(failed.status, 500);
      assert.ok(failed.body.message === 'An unexpected error occurred');
      assertNoAuthCookies(failed);
      const after = await credentialState(targetId);
      assert.equal(after.credentialVersion, before.credentialVersion);
      assert.ok(after.passwordHash === before.passwordHash);
    } finally {
      write.mock.restore();
    }
    await request(app.getHttpServer()).get('/api/auth/me').set('Cookie', admin.cookies.cookieHeader).expect(200);
    await resetPassword(admin.cookies.cookieHeader, targetId).expect(204);
  });

  it('allows an ACC-18 seeded administrator to log in and use the reusable ADMIN guard', async () => {
    const setup = new AdminSeedService(app.get(getModelToken(User.name)), app.get(PasswordService));
    await setup.seed({ name: 'Seeded Admin', email: ' SEEDED@example.com ', password: 'SeededAdmin123', termsAccepted: true });
    const login = await request(app.getHttpServer()).post('/api/auth/login')
      .send({ email: 'seeded@example.com', password: 'SeededAdmin123' }).expect(200);
    assertPublicAccount(login);
    assert.equal(login.body.role, UserRole.ADMIN);
    await request(app.getHttpServer()).get('/api/test-feature/admin-only')
      .set('Cookie', readAuthCookies(login).cookieHeader).expect(200);
  });

  it('returns only the current profile fields for every agreed role without credential or session internals', async () => {
    for (const role of Object.values(UserRole)) {
      const email = `profile-${role.toLowerCase()}@example.com`;
      const userId = await createRoleAccount(email, role);
      await users.updateOne({ _id: userId }, {
        $set: { phoneNumber: '+201000000001', preferredCurrency: 'EGP' },
      }).exec();
      const login = await request(app.getHttpServer()).post('/api/auth/login')
        .send({ email, password: 'Travel123' }).expect(200);
      const cookies = readAuthCookies(login);
      const profile = await request(app.getHttpServer()).get('/api/users/me')
        .set('Cookie', cookies.cookieHeader).expect(200);
      assert.equal(profile.headers['cache-control'], 'no-store');
      assert.deepEqual(Object.keys(profile.body).sort(), [
        'createdAt', 'email', 'name', 'phoneNumber', 'preferredCurrency', 'role', 'status', 'updatedAt', 'userId',
      ].sort());
      assert.equal(profile.body.userId, userId);
      assert.equal(profile.body.role, role);
      assert.equal(profile.body.status, AccountStatus.ACTIVE);
      assert.ok(profile.body.phoneNumber === '+201000000001');
      assert.equal(profile.body.preferredCurrency, 'EGP');
      const stored = await credentialState(userId);
      const serialized = JSON.stringify(profile.body);
      assert.ok(!serialized.includes(stored.passwordHash));
      assert.ok(!serialized.includes(cookies.accessToken));
      assert.ok(!serialized.includes(cookies.refreshToken));
      for (const field of ['password', 'passwordHash', 'credentialVersion', 'mustChangePassword', 'failedLoginAttempts', 'lockedUntil', 'termsAcceptedAt', 'refreshTokenHash', 'authenticatedCredentialVersion']) {
        assert.equal(Object.hasOwn(profile.body, field), false);
      }
      assertNoAuthCookies(profile);
    }
  });

  it('omits absent profile preferences, accepts legacy epochs, and preserves login/current-identity JSON', async () => {
    const fixture = await registerAndLogin();
    const userId = fixture.registered.body.userId as string;
    await users.updateOne({ _id: userId }, { $unset: { credentialVersion: 1 } }).exec();
    await sessions.updateOne({ _id: fixture.claims.sid }, { $unset: { credentialVersion: 1 } }).exec();
    const absent = await request(app.getHttpServer()).get('/api/users/me')
      .set('Cookie', fixture.cookies.cookieHeader).expect(200);
    assertPublicAccount(absent);
    assert.equal(Object.hasOwn(absent.body, 'phoneNumber'), false);
    assert.equal(Object.hasOwn(absent.body, 'preferredCurrency'), false);

    await users.updateOne({ _id: userId }, {
      $set: { phoneNumber: '+201000000002', preferredCurrency: 'USD' },
    }).exec();
    const present = await request(app.getHttpServer()).get('/api/users/me')
      .set('Cookie', fixture.cookies.cookieHeader).expect(200);
    assert.ok(present.body.phoneNumber === '+201000000002');
    assert.equal(present.body.preferredCurrency, 'USD');
    const me = await request(app.getHttpServer()).get('/api/auth/me')
      .set('Cookie', fixture.cookies.cookieHeader).expect(200);
    assertPublicAccount(me);
    const login = await request(app.getHttpServer()).post('/api/auth/login')
      .send({ email: 'traveler@example.com', password: 'Travel123' }).expect(200);
    assertPublicAccount(login);
    for (const response of [me, login]) {
      assert.equal(Object.hasOwn(response.body, 'phoneNumber'), false);
      assert.equal(Object.hasOwn(response.body, 'preferredCurrency'), false);
    }
  });

  it('pins profile ownership to the session despite query identifiers and documents profile operations', async () => {
    const own = await registerAndLogin('profile-owner@example.com');
    const otherId = await createRoleAccount('other-profile@example.com');
    await users.updateOne({ _id: otherId }, {
      $set: { phoneNumber: '+201000000003', preferredCurrency: 'EUR' },
    }).exec();
    const response = await request(app.getHttpServer()).get('/api/users/me')
      .query({ userId: otherId, role: UserRole.ADMIN, credentialVersion: 999 })
      .set('Cookie', own.cookies.cookieHeader).expect(200);
    assert.equal(response.body.userId, own.registered.body.userId);
    assert.equal(response.body.role, UserRole.USER);
    const serialized = JSON.stringify(response.body);
    assert.ok(!serialized.includes(otherId));
    assert.ok(!serialized.includes('other-profile@example.com'));
    assert.ok(!serialized.includes('+201000000003'));
    assert.equal(Object.hasOwn(response.body, 'preferredCurrency'), false);

    const specification = await request(app.getHttpServer()).get('/api/docs-json').expect(200);
    const operations = specification.body.paths['/api/users/me'];
    assert.ok(operations?.get?.responses?.['200']);
    assert.ok(operations?.get?.responses?.['401']);
    assert.ok(operations.get.security.some((entry: Record<string, unknown>) => Object.hasOwn(entry, 'accessToken')));
    assert.ok(operations.patch?.responses?.['200']);
    assert.ok(operations.patch?.responses?.['400']);
    assert.ok(operations.patch?.responses?.['401']);
    const schema = specification.body.components.schemas.UserProfileDto;
    assert.equal(schema.properties.phoneNumber.type, 'string');
    assert.equal(schema.properties.preferredCurrency.type, 'string');
    assert.ok(!schema.required?.includes('phoneNumber'));
    assert.ok(!schema.required?.includes('preferredCurrency'));
    assert.equal(Object.hasOwn(schema.properties, 'credentialVersion'), false);
    assert.equal(Object.hasOwn(schema.properties, 'passwordHash'), false);
  });

  it('guards profile reads against missing, restricted, suspended and deactivated credentials', async () => {
    assertInvalidSession(await request(app.getHttpServer()).get('/api/users/me'));
    assertInvalidSession(await request(app.getHttpServer()).get('/api/users/me')
      .set('Cookie', '__Host-accessToken=malformed'));
    const restricted = await restrictedFixture('restricted-profile@example.com');
    assertInvalidSession(await request(app.getHttpServer()).get('/api/users/me').set('Cookie', restricted.cookie.pair));
    assertInvalidSession(await request(app.getHttpServer()).get('/api/users/me')
      .set('Cookie', `__Host-accessToken=${restricted.cookie.value}`));
    for (const status of [AccountStatus.SUSPENDED, AccountStatus.DEACTIVATED]) {
      const fixture = await registerAndLogin(`inactive-profile-${status.toLowerCase()}@example.com`);
      await users.updateOne({ _id: fixture.registered.body.userId }, { $set: { status } }).exec();
      assertInvalidSession(await request(app.getHttpServer()).get('/api/users/me')
        .set('Cookie', fixture.cookies.cookieHeader));
    }
  });

  it('rejects a profile read when reset and password completion change the epoch after its guard', async (context) => {
    const admin = await adminFixture();
    const fixture = await registerAndLogin('racing-profile@example.com');
    const userId = fixture.registered.body.userId as string;
    const service = app.get(UsersService);
    const original = service.findOwnProfile.bind(service);
    const entered = deferredSignal();
    const release = deferredSignal();
    const lookup = context.mock.method(service, 'findOwnProfile', async (id: string, version: number) => {
      if (id === userId) {
        assert.equal(version, 0);
        entered.resolve();
        await release.promise;
      }
      return original(id, version);
    });
    const pending = request(app.getHttpServer()).get('/api/users/me')
      .set('Cookie', fixture.cookies.cookieHeader).timeout({ deadline: 20_000 }).then((response) => response);
    try {
      await waitForBarrier(entered.promise, [pending]);
      await resetPassword(admin.cookies.cookieHeader, userId).expect(204);
      const temporaryLogin = await request(app.getHttpServer()).post('/api/auth/login')
        .send({ email: 'racing-profile@example.com', password: 'Temporary456' }).expect(200);
      const limited = readPasswordChangeCookie(temporaryLogin);
      assertLogoutResponse(await changePassword(limited.pair, 'Temporary456', 'Completed789'));
      const changed = await credentialState(userId);
      assert.equal(changed.credentialVersion, 2);
      assert.equal(changed.mustChangePassword, false);
      assert.equal(changed.status, AccountStatus.ACTIVE);
      release.resolve();
      assertInvalidSession(await pending);
    } finally {
      release.resolve();
      await pending.catch(() => undefined);
      lookup.mock.restore();
    }
  });

  it('updates the profile for every role with normalized fields and unchanged credentials, status and sessions', async () => {
    for (const role of Object.values(UserRole)) {
      const email = `updated-profile-${role.toLowerCase()}@example.com`;
      const userId = await createRoleAccount(email, role);
      const login = await request(app.getHttpServer()).post('/api/auth/login')
        .send({ email, password: 'Travel123' }).expect(200);
      const cookies = readAuthCookies(login);
      const before = await credentialState(userId);
      const response = await patchProfile(cookies.cookieHeader, {
        name: '  Updated Profile  ', phoneNumber: '  +201000000011  ', preferredCurrency: ' egp ',
      }).expect(200);
      assert.equal(response.headers['cache-control'], 'no-store');
      assertNoAuthCookies(response);
      assert.deepEqual(Object.keys(response.body).sort(), [
        'createdAt', 'email', 'name', 'phoneNumber', 'preferredCurrency', 'role', 'status', 'updatedAt', 'userId',
      ].sort());
      assert.equal(response.body.name, 'Updated Profile');
      assert.ok(response.body.phoneNumber === '+201000000011');
      assert.equal(response.body.preferredCurrency, 'EGP');
      assert.equal(response.body.userId, userId);
      assert.equal(response.body.role, role);
      const after = await credentialState(userId);
      assert.equal(after.role, before.role);
      assert.equal(after.status, before.status);
      assert.equal(after.email, before.email);
      assert.equal(after.credentialVersion, before.credentialVersion);
      assert.equal(after.mustChangePassword, before.mustChangePassword);
      assert.equal(after.failedLoginAttempts, before.failedLoginAttempts);
      assert.equal(after.lockedUntil, before.lockedUntil);
      assert.ok(after.passwordHash === before.passwordHash);
      assert.equal(after.createdAt.getTime(), before.createdAt.getTime());
      assert.ok(after.updatedAt.getTime() >= before.updatedAt.getTime());
      assert.ok(!JSON.stringify(response.body).includes(before.passwordHash));
      const me = await request(app.getHttpServer()).get('/api/auth/me')
        .set('Cookie', cookies.cookieHeader).expect(200);
      assertPublicAccount(me);
      assert.equal(me.body.name, 'Updated Profile');
    }
  });

  it('changes only supplied profile fields and retains existing optional preferences on later patches', async () => {
    const fixture = await registerAndLogin();
    const named = await patchProfile(fixture.cookies.cookieHeader, { name: '  Profile Name  ' }).expect(200);
    assert.equal(named.body.name, 'Profile Name');
    assert.equal(Object.hasOwn(named.body, 'phoneNumber'), false);
    assert.equal(Object.hasOwn(named.body, 'preferredCurrency'), false);
    const phone = await patchProfile(fixture.cookies.cookieHeader, { phoneNumber: '+201000000012' }).expect(200);
    assert.equal(phone.body.name, 'Profile Name');
    assert.ok(phone.body.phoneNumber === '+201000000012');
    const currency = await patchProfile(fixture.cookies.cookieHeader, { preferredCurrency: ' eur ' }).expect(200);
    assert.equal(currency.body.name, 'Profile Name');
    assert.ok(currency.body.phoneNumber === '+201000000012');
    assert.equal(currency.body.preferredCurrency, 'EUR');
    for (const response of [named, phone, currency]) assertNoAuthCookies(response);
  });

  it('accepts profile phone boundaries and rejects malformed international numbers without partial writes', async () => {
    const fixture = await registerAndLogin();
    for (const phoneNumber of ['+12345678', '+123456789012345']) {
      const valid = await patchProfile(fixture.cookies.cookieHeader, { phoneNumber }).expect(200);
      assert.ok(valid.body.phoneNumber === phoneNumber);
    }
    const before = await credentialState(fixture.registered.body.userId);
    for (const phoneNumber of ['12345678', '+1234567', '+1234567890123456', '+0123456789', '+12 345678', '+12-345678', '+abcdefgh', '+١٢٣٤٥٦٧٨']) {
      const rejected = await patchProfile(fixture.cookies.cookieHeader, { name: 'Must not persist', phoneNumber });
      assertValidationError(rejected, 'phoneNumber');
      assertNoAuthCookies(rejected);
      const after = await credentialState(fixture.registered.body.userId);
      assert.equal(after.name, before.name);
      assert.ok(after.phoneNumber === before.phoneNumber);
    }
  });

  it('rejects null, empty and wrong-type profile fields atomically instead of clearing existing data', async () => {
    const fixture = await registerAndLogin();
    await patchProfile(fixture.cookies.cookieHeader, {
      name: 'Original Profile', phoneNumber: '+201000000013', preferredCurrency: 'EGP',
    }).expect(200);
    const before = await credentialState(fixture.registered.body.userId);
    const invalid: Array<[string, unknown]> = [
      ['name', null], ['name', ''], ['name', '   '], ['name', 123], ['name', {}],
      ['phoneNumber', null], ['phoneNumber', ''], ['phoneNumber', '   '], ['phoneNumber', 123], ['phoneNumber', []],
      ['preferredCurrency', null], ['preferredCurrency', ''], ['preferredCurrency', '   '], ['preferredCurrency', 123], ['preferredCurrency', {}],
    ];
    for (const [field, value] of invalid) {
      const response = await patchProfile(fixture.cookies.cookieHeader, {
        name: 'Must not persist', phoneNumber: '+201000000099', preferredCurrency: 'USD', [field]: value,
      });
      assertValidationError(response, field);
      assertNoAuthCookies(response);
      const after = await credentialState(fixture.registered.body.userId);
      assert.equal(after.name, before.name);
      assert.ok(after.phoneNumber === before.phoneNumber);
      assert.equal(after.preferredCurrency, before.preferredCurrency);
      assert.equal(after.credentialVersion, before.credentialVersion);
    }
  });

  it('normalizes every seeded profile currency and rejects malformed or unsupported codes before writes', async () => {
    const fixture = await registerAndLogin();
    for (const code of ['AED', 'EGP', 'EUR', 'GBP', 'JPY', 'SAR', 'USD']) {
      const response = await patchProfile(fixture.cookies.cookieHeader, { preferredCurrency: ` ${code.toLowerCase()} ` }).expect(200);
      assert.equal(response.body.preferredCurrency, code);
    }
    const before = await credentialState(fixture.registered.body.userId);
    for (const code of ['US', 'USDD', '123', 'U$D', '€UR', 'ZZZ']) {
      const response = await patchProfile(fixture.cookies.cookieHeader, { name: 'Must not persist', preferredCurrency: code });
      assert.equal(response.status, 400);
      assert.ok(Array.isArray(response.body.errors?.preferredCurrency) && response.body.errors.preferredCurrency.length > 0);
      assertNoAuthCookies(response);
      const after = await credentialState(fixture.registered.body.userId);
      assert.equal(after.name, before.name);
      assert.equal(after.preferredCurrency, before.preferredCurrency);
    }
  });

  it('rejects profile identity, privilege and credential fields without applying otherwise valid edits', async () => {
    const fixture = await registerAndLogin();
    const before = await credentialState(fixture.registered.body.userId);
    const fields = {
      userId: new Types.ObjectId().toHexString(), _id: new Types.ObjectId().toHexString(),
      email: 'different@example.com', role: UserRole.ADMIN, status: AccountStatus.SUSPENDED,
      password: 'Unaccepted123', passwordHash: 'client-controlled-hash', credentialVersion: 99,
      mustChangePassword: true, failedLoginAttempts: 0, lockedUntil: null, createdAt: new Date().toISOString(),
    };
    for (const [field, value] of Object.entries(fields)) {
      const response = await patchProfile(fixture.cookies.cookieHeader, { name: 'Must not persist', [field]: value });
      assertValidationError(response, field);
      assertNoAuthCookies(response);
    }
    const after = await credentialState(fixture.registered.body.userId);
    assert.equal(after.name, before.name);
    assert.equal(after.email, before.email);
    assert.equal(after.role, before.role);
    assert.equal(after.status, before.status);
    assert.equal(after.credentialVersion, before.credentialVersion);
    assert.equal(after.mustChangePassword, before.mustChangePassword);
    assert.ok(after.passwordHash === before.passwordHash);
  });

  it('rejects an empty profile patch and ignores query IDs when applying an authorized own-profile update', async () => {
    const own = await registerAndLogin('patch-profile-owner@example.com');
    const otherId = await createRoleAccount('other-patch-profile@example.com');
    const beforeOther = await credentialState(otherId);
    const empty = await patchProfile(own.cookies.cookieHeader, {});
    assert.equal(empty.status, 400);
    assert.ok(Array.isArray(empty.body.errors?.profile) && empty.body.errors.profile.length > 0);
    assertNoAuthCookies(empty);
    const response = await request(app.getHttpServer()).patch('/api/users/me')
      .query({ userId: otherId }).set('Cookie', own.cookies.cookieHeader).send({ name: 'Own Profile Updated' }).expect(200);
    assert.equal(response.body.userId, own.registered.body.userId);
    assert.equal(response.body.name, 'Own Profile Updated');
    const afterOther = await credentialState(otherId);
    assert.equal(afterOther.name, beforeOther.name);
    assert.equal(afterOther.credentialVersion, beforeOther.credentialVersion);
    assert.ok(afterOther.passwordHash === beforeOther.passwordHash);
  });

  it('guards profile patches against anonymous, restricted, inactive and cross-origin requests', async () => {
    assertInvalidSession(await patchProfile('', { name: 'Rejected Profile' }));
    const restricted = await restrictedFixture('restricted-patch-profile@example.com');
    assertInvalidSession(await patchProfile(restricted.cookie.pair, { name: 'Rejected Profile' }));
    for (const status of [AccountStatus.SUSPENDED, AccountStatus.DEACTIVATED]) {
      const fixture = await registerAndLogin(`blocked-profile-${status.toLowerCase()}@example.com`);
      await users.updateOne({ _id: fixture.registered.body.userId }, { $set: { status } }).exec();
      assertInvalidSession(await patchProfile(fixture.cookies.cookieHeader, { name: 'Rejected Profile' }));
      assert.equal((await credentialState(fixture.registered.body.userId)).name, 'Example Traveler');
    }
    const fixture = await registerAndLogin('csrf-patch-profile@example.com');
    const crossSite = await patchProfile(fixture.cookies.cookieHeader, { name: 'Rejected Profile' }).set('Sec-Fetch-Site', 'cross-site');
    assert.equal(crossSite.status, 403);
    assertNoAuthCookies(crossSite);
    const foreign = await request(app.getHttpServer()).patch('/api/users/me')
      .set('Cookie', fixture.cookies.cookieHeader).set('Origin', 'https://attacker.invalid').send({ name: 'Rejected Profile' });
    assert.equal(foreign.status, 403);
    assertNoAuthCookies(foreign);
    assert.equal((await credentialState(fixture.registered.body.userId)).name, 'Example Traveler');
  });

  it('preserves concurrent disjoint profile edits instead of replacing unrelated preferences', async () => {
    const fixture = await registerAndLogin();
    const before = await credentialState(fixture.registered.body.userId);
    const responses = await Promise.all([
      patchProfile(fixture.cookies.cookieHeader, { name: 'Concurrent Profile' }),
      patchProfile(fixture.cookies.cookieHeader, { phoneNumber: '+201000000014' }),
      patchProfile(fixture.cookies.cookieHeader, { preferredCurrency: 'JPY' }),
    ]);
    for (const response of responses) {
      assert.equal(response.status, 200);
      assertNoAuthCookies(response);
    }
    const after = await credentialState(fixture.registered.body.userId);
    assert.equal(after.name, 'Concurrent Profile');
    assert.ok(after.phoneNumber === '+201000000014');
    assert.equal(after.preferredCurrency, 'JPY');
    assert.equal(after.credentialVersion, before.credentialVersion);
    assert.ok(after.passwordHash === before.passwordHash);
  });

  it('rejects an old profile patch after reset and password completion change its captured epoch', async (context) => {
    const admin = await adminFixture();
    const fixture = await registerAndLogin('reset-patch-profile@example.com');
    const userId = fixture.registered.body.userId as string;
    const before = await credentialState(userId);
    const barrier = pauseProfileUpdate(context, userId);
    const pending = patchProfile(fixture.cookies.cookieHeader, { name: 'Must not persist' })
      .timeout({ deadline: 20_000 }).then((response) => response);
    try {
      await waitForBarrier(barrier.entered, [pending]);
      await resetPassword(admin.cookies.cookieHeader, userId).expect(204);
      const login = await request(app.getHttpServer()).post('/api/auth/login')
        .send({ email: 'reset-patch-profile@example.com', password: 'Temporary456' }).expect(200);
      const limited = readPasswordChangeCookie(login);
      assertLogoutResponse(await changePassword(limited.pair, 'Temporary456', 'FinalProfile789'));
      barrier.release();
      assertInvalidSession(await pending);
      const after = await credentialState(userId);
      assert.equal(after.name, before.name);
      assert.equal(after.credentialVersion, 2);
      assert.equal(after.mustChangePassword, false);
      assert.equal(after.status, AccountStatus.ACTIVE);
    } finally {
      barrier.release();
      await pending.catch(() => undefined);
      barrier.restore();
    }
  });

  it('rejects a profile patch if status or mandatory-change eligibility changes after its guard', async (context) => {
    for (const [index, state] of [
      { status: AccountStatus.SUSPENDED }, { status: AccountStatus.DEACTIVATED }, { mustChangePassword: true },
    ].entries()) {
      const fixture = await registerAndLogin(`state-patch-profile-${index}@example.com`);
      const userId = fixture.registered.body.userId as string;
      const barrier = pauseProfileUpdate(context, userId);
      const pending = patchProfile(fixture.cookies.cookieHeader, { name: 'Must not persist' })
        .timeout({ deadline: 20_000 }).then((response) => response);
      try {
        await waitForBarrier(barrier.entered, [pending]);
        await users.updateOne({ _id: userId }, { $set: state }).exec();
        barrier.release();
        assertInvalidSession(await pending);
        const after = await credentialState(userId);
        assert.equal(after.name, 'Example Traveler');
        assert.equal(after.credentialVersion, 0);
      } finally {
        barrier.release();
        await pending.catch(() => undefined);
        barrier.restore();
      }
    }
  });

  it('uses the public profile currency catalog as database membership and seeds it idempotently without deleting extra rows', async () => {
    const expectedCodes = ['AED', 'EGP', 'EUR', 'GBP', 'JPY', 'SAR', 'USD'];
    const service = app.get(CurrenciesService);
    const currencies = app.get<Model<{ code: string; name: string; createdAt: Date; updatedAt: Date }>>(getModelToken('Currency'));
    const response = await request(app.getHttpServer()).get('/api/currencies').expect(200);
    assert.equal(response.headers['cache-control'], 'no-store');
    assertNoAuthCookies(response);
    assert.ok(Array.isArray(response.body));
    assert.deepEqual(response.body.map((entry: { code: string }) => entry.code), expectedCodes);
    for (const entry of response.body) {
      assert.deepEqual(Object.keys(entry).sort(), ['code', 'name']);
      assert.ok(typeof entry.name === 'string' && entry.name.trim().length > 0);
    }
    const before = await currencies.findOne({ code: 'EGP' }).orFail().lean().exec();
    await currencies.create({ code: 'CHF', name: 'Swiss franc' });
    try {
      assert.equal(await service.seedSupported(), 7);
      assert.equal(await service.seedSupported(), 7);
      assert.equal(await currencies.countDocuments(), 8);
      const after = await currencies.findOne({ code: 'EGP' }).orFail().lean().exec();
      assert.equal(after._id.toString(), before._id.toString());
      assert.equal(after.createdAt.getTime(), before.createdAt.getTime());
      assert.equal(after.updatedAt.getTime(), before.updatedAt.getTime());
      assert.equal((await currencies.findOne({ code: 'CHF' }).orFail().lean().exec()).name, 'Swiss franc');
      const expanded = await request(app.getHttpServer()).get('/api/currencies').expect(200);
      assert.deepEqual(expanded.body.map((entry: { code: string }) => entry.code), ['AED', 'CHF', 'EGP', 'EUR', 'GBP', 'JPY', 'SAR', 'USD']);
      const fixture = await registerAndLogin();
      const accepted = await patchProfile(fixture.cookies.cookieHeader, { preferredCurrency: ' chf ' }).expect(200);
      assert.equal(accepted.body.preferredCurrency, 'CHF');
      await currencies.deleteOne({ code: 'GBP' }).exec();
      const missing = await patchProfile(fixture.cookies.cookieHeader, { name: 'Must not persist', preferredCurrency: 'GBP' });
      assert.equal(missing.status, 400);
      assert.ok(Array.isArray(missing.body.errors?.preferredCurrency));
      const stored = await credentialState(fixture.registered.body.userId);
      assert.equal(stored.name, 'Example Traveler');
      assert.equal(stored.preferredCurrency, 'CHF');
    } finally {
      await currencies.deleteOne({ code: 'CHF' }).exec();
      await service.seedSupported();
    }
  });
});
