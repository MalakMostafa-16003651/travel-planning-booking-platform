import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Connection, createConnection } from 'mongoose';
import { PasswordService } from '../src/auth/password.service';

const EXPECTED_CODES = ['AED', 'EGP', 'EUR', 'GBP', 'JPY', 'SAR', 'USD'];
const BACKEND_DIRECTORY = resolve(__dirname, '../..');
// npm test compiles this same CLI source with the suite; no stale production
// output or separate build prerequisite can hide a changed implementation.
const SEED_SCRIPT = resolve(__dirname, '../src/scripts/seed-currencies.js');
const ADMIN_SCRIPT = resolve(__dirname, '../src/scripts/seed-admin.js');
const SUCCESS_MESSAGE = 'Currency reference seed completed: 7 required codes available.\n';
const FAILURE_MESSAGE = 'Currency seed did not finish cleanly. Check MongoDB configuration/connectivity, then retry.\n';

function mongoBinaryOptions() {
  const fallback = { downloadDir: join(BACKEND_DIRECTORY, 'node_modules', '.cache', 'mongodb-binaries') };
  const candidates: string[] = [];
  if (process.env.MONGOMS_SYSTEM_BINARY) candidates.push(process.env.MONGOMS_SYSTEM_BINARY);
  if (process.platform === 'win32') {
    const directory = join(process.env.ProgramFiles ?? 'C:\\Program Files', 'MongoDB', 'Server');
    try {
      candidates.push(...readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && /^\d+(?:\.\d+){1,2}$/.test(entry.name))
        .sort((left, right) => right.name.localeCompare(left.name, undefined, { numeric: true }))
        .map((entry) => join(directory, entry.name, 'bin', 'mongod.exe')));
    } catch {
      // A local installation is optional; use the isolated downloaded fallback.
    }
  }
  for (const systemBinary of candidates) {
    try {
      const output = execFileSync(systemBinary, ['--version'], {
        encoding: 'utf8', timeout: 5_000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      });
      const version = output.match(/\bdb version v(\d+\.\d+\.\d+)\b/)?.[1];
      if (version && Number(version.split('.')[0]) >= 7) return { ...fallback, systemBinary, version };
    } catch {
      // Ignore missing/incompatible candidates without printing their output.
    }
  }
  return fallback;
}

interface SeedResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

function runSeed(uri: string, adminInput?: unknown): Promise<SeedResult> {
  // Override the URI before spawning and explicitly disable all local .env reads.
  const environment: NodeJS.ProcessEnv = { ...process.env, MONGODB_URI: uri };
  delete environment.JWT_SECRET;
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, adminInput === undefined
      ? [SEED_SCRIPT, '--no-env-file'] : [ADMIN_SCRIPT, '--no-env-file', '--stdin-json'], {
      cwd: BACKEND_DIRECTORY,
      env: environment,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30_000,
      killSignal: 'SIGKILL',
    });
    child.stdin!.on('error', () => { /* Exit status determines failure; never print supplied input. */ });
    child.stdin!.end(adminInput === undefined ? undefined : JSON.stringify(adminInput));
    let stdout = '';
    let stderr = '';
    child.stdout!.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
    child.stderr!.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
    child.once('error', () => reject(new Error('The isolated currency seed process could not start')));
    child.once('close', (exitCode, signal) => resolveResult({ exitCode, signal, stdout, stderr }));
  });
}

function assertSuccessfulSeed(result: SeedResult): void {
  // Boolean assertions prevent captured process diagnostics from entering output.
  assert.ok(result.exitCode === 0, 'Currency seed must exit successfully');
  assert.ok(result.signal === null, 'Currency seed must finish without being killed');
  assert.ok(result.stdout === SUCCESS_MESSAGE, 'Currency seed must report seven confirmed required codes');
  assert.ok(result.stderr === '', 'Successful currency seed must not report an error');
}

describe('currency seed CLI', { concurrency: false }, () => {
  let mongo: MongoMemoryServer | undefined;
  let connection: Connection | undefined;
  let isolatedUri: string;

  before(async () => {
    assert.ok(existsSync(SEED_SCRIPT), 'Test compilation must emit the currency seed CLI');
    mongo = await MongoMemoryServer.create({
      binary: mongoBinaryOptions(),
      instance: { launchTimeout: 60_000 },
    });
    isolatedUri = mongo.getUri('currency-seed-cli-test');
    connection = await createConnection(isolatedUri, { serverSelectionTimeoutMS: 10_000 }).asPromise();
  }, { timeout: 30 * 60_000 });

  beforeEach(async () => {
    // This URI is created exclusively by the fresh local MongoMemoryServer above.
    await connection!.dropDatabase();
  });

  after(async () => {
    try {
      await connection?.close();
    } finally {
      await mongo?.stop();
    }
  });

  async function assertCatalogOnly(): Promise<void> {
    const collections = await connection!.db!.listCollections({}, { nameOnly: true }).toArray();
    assert.deepEqual(collections.map((collection) => collection.name).sort(), ['currencies']);
  }

  async function snapshotCatalog() {
    const rows = await connection!.collection('currencies').find().sort({ code: 1 }).toArray();
    return rows.map((row) => ({
      id: row._id.toHexString(),
      code: row.code as string,
      name: row.name as string,
      createdAt: (row.createdAt as Date).getTime(),
      updatedAt: (row.updatedAt as Date).getTime(),
    }));
  }

  it('currency seed creates the seven reference codes with an enforced unique index and no auth collections', { timeout: 40_000 }, async () => {
    assertSuccessfulSeed(await runSeed(isolatedUri));
    const collection = connection!.collection('currencies');
    const rows = await collection.find().sort({ code: 1 }).toArray();
    assert.deepEqual(rows.map((row) => row.code), EXPECTED_CODES);
    for (const row of rows) {
      assert.deepEqual(Object.keys(row).sort(), ['_id', 'code', 'name', 'createdAt', 'updatedAt'].sort());
      assert.ok(typeof row.name === 'string' && row.name.trim().length > 0);
      assert.ok(row.createdAt instanceof Date && row.updatedAt instanceof Date);
    }
    const indexes = await collection.indexes();
    assert.ok(indexes.some((index) => index.unique === true && index.key.code === 1 && Object.keys(index.key).length === 1));
    let rejectedDuplicate = false;
    try {
      await collection.insertOne({ code: 'EGP', name: 'Duplicate fixture currency' });
    } catch (error: unknown) {
      rejectedDuplicate = typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;
    }
    assert.ok(rejectedDuplicate, 'The database must reject a duplicate currency code');
    assert.equal(await collection.countDocuments(), 7);
    await assertCatalogOnly();
  });

  it('currency seed is repeatable and preserves existing IDs, names, timestamps and additional rows', { timeout: 70_000 }, async () => {
    assertSuccessfulSeed(await runSeed(isolatedUri));
    const collection = connection!.collection('currencies');
    const marker = new Date('2001-02-03T04:05:06.000Z');
    await collection.updateOne({ code: 'EGP' }, { $set: { name: 'Existing agreed label', updatedAt: marker } });
    await collection.insertOne({ code: 'CAD', name: 'Canadian dollar', createdAt: marker, updatedAt: marker });
    const beforeRepeat = await snapshotCatalog();

    assertSuccessfulSeed(await runSeed(isolatedUri));

    assert.deepEqual(await snapshotCatalog(), beforeRepeat);
    assert.equal(await collection.countDocuments(), 8);
    await assertCatalogOnly();
  });

  it('currency seed rejects an invalid URI without exposing synthetic credentials or starting application collections', { timeout: 40_000 }, async () => {
    const syntheticUser = 'synthetic-seed-user';
    const syntheticPassword = 'synthetic-seed-password';
    const invalidUri = `not-mongodb://${syntheticUser}:${syntheticPassword}@example.invalid/test`;
    const result = await runSeed(invalidUri);

    assert.ok(result.exitCode === 1, 'Invalid configuration must fail the currency seed command');
    assert.ok(result.signal === null, 'Invalid configuration must terminate cleanly');
    assert.ok(result.stdout === '', 'Failed seeding must not report success');
    assert.ok(result.stderr === FAILURE_MESSAGE, 'Only the sanitized seed failure message may be returned');
    const output = result.stdout + result.stderr;
    for (const forbidden of [invalidUri, syntheticUser, syntheticPassword]) {
      assert.ok(!output.includes(forbidden), 'Seed diagnostics must not expose supplied configuration values');
    }
    assert.deepEqual(await connection!.db!.listCollections({}, { nameOnly: true }).toArray(), []);
  });

  function adminInput(overrides: Record<string, unknown> = {}) {
    return { name: ' Setup Admin ', email: ' ADMIN@example.com ', password: 'SeedAdmin123', termsAccepted: true, ...overrides };
  }

  function assertAdminSuccess(result: SeedResult) {
    assert.ok(result.exitCode === 0 && result.signal === null, 'Admin setup must succeed');
    assert.ok(result.stdout === 'Administrator seed completed; existing administrator data is preserved.\n');
    assert.ok(result.stderr === '');
    assert.ok(!result.stdout.includes('SeedAdmin123'));
  }

  it('admin seed creates a normalized ADMIN with a verifiable salted hash and no sessions', { timeout: 40_000 }, async () => {
    assertAdminSuccess(await runSeed(isolatedUri, adminInput()));
    const user = await connection!.collection('users').findOne({ email: 'admin@example.com' });
    assert.ok(user);
    assert.equal(user.name, 'Setup Admin');
    assert.equal(user.role, 'ADMIN');
    assert.equal(user.status, 'ACTIVE');
    assert.equal(user.mustChangePassword, false);
    assert.equal(user.credentialVersion, 0);
    assert.ok(user.termsAcceptedAt instanceof Date);
    assert.ok(await new PasswordService().verify('SeedAdmin123', user.passwordHash));
    const collections = await connection!.db!.listCollections({}, { nameOnly: true }).toArray();
    assert.deepEqual(collections.map(row => row.name), ['users']);
  });

  it('admin seed reruns preserve passwords, suspension and every existing field', { timeout: 70_000 }, async () => {
    assertAdminSuccess(await runSeed(isolatedUri, adminInput()));
    const users = connection!.collection('users');
    await users.updateOne({ email: 'admin@example.com' }, { $set: { status: 'SUSPENDED', failedLoginAttempts: 4 } });
    const before = await users.findOne({ email: 'admin@example.com' });
    assertAdminSuccess(await runSeed(isolatedUri, adminInput({ name: 'Different name', password: 'Different456' })));
    const after = await users.findOne({ email: 'admin@example.com' });
    assert.ok(JSON.stringify(after) === JSON.stringify(before), 'Rerun must not overwrite an administrator');
    assert.equal(await users.countDocuments(), 1);
  });

  it('admin seed never promotes an existing normal user on email collision', { timeout: 40_000 }, async () => {
    const users = connection!.collection('users');
    await users.insertOne({ email: 'admin@example.com', name: 'Existing user', role: 'USER', status: 'ACTIVE' });
    const before = await users.findOne({ email: 'admin@example.com' });
    const result = await runSeed(isolatedUri, adminInput());
    assert.ok(result.exitCode === 1 && result.signal === null);
    assert.ok(!result.stderr.includes('SeedAdmin123') && !result.stderr.includes('admin@example.com'));
    assert.ok(JSON.stringify(await users.findOne({ email: 'admin@example.com' })) === JSON.stringify(before));
  });

  it('admin seed rejects invalid credentials, missing consent and privilege injection without records', { timeout: 120_000 }, async () => {
    for (const override of [{ password: 'short1' }, { email: 'invalid' }, { termsAccepted: false }, { role: 'ADMIN' }, { name: '' }]) {
      const result = await runSeed(isolatedUri, adminInput(override));
      assert.ok(result.exitCode === 1 && result.signal === null);
      assert.ok(!result.stderr.includes('SeedAdmin123'));
      assert.equal(await connection!.collection('users').countDocuments(), 0);
    }
  });
});
