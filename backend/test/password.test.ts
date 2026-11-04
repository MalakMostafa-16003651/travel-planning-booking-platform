import assert from 'node:assert/strict';
import { scrypt } from 'node:crypto';
import { before, describe, it } from 'node:test';
import { PasswordService } from '../src/auth/password.service';

describe('password hashing and verification', () => {
  const service = new PasswordService();
  const password = '  TrAvEl2026  ';
  let encodedHash: string;

  before(async () => {
    encodedHash = await service.hash(password);
  });

  it('verifies the existing encoded format produced independently of the service', async () => {
    const salt = Buffer.alloc(16, 0x42);
    const key = await new Promise<Buffer>((resolve, reject) => {
      scrypt(password, salt, 64, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }, (error, derived) => {
        if (error) reject(error);
        else resolve(derived);
      });
    });
    const existingHash = `scrypt$32768$8$3$${salt.toString('hex')}$${key.toString('hex')}`;

    assert.equal(await service.verify(password, existingHash), true);
    assert.equal(await service.verify('different input', existingHash), false);
  });

  it('keeps the registration format and uses a fresh salt for each hash', async () => {
    const secondHash = await service.hash(password);

    assert.equal(/^scrypt\$32768\$8\$3\$[0-9a-f]{32}\$[0-9a-f]{128}$/.test(encodedHash), true);
    assert.equal(/^scrypt\$32768\$8\$3\$[0-9a-f]{32}\$[0-9a-f]{128}$/.test(secondHash), true);
    assert.equal(encodedHash !== secondHash, true);
    assert.equal(encodedHash.split('$')[4] !== secondHash.split('$')[4], true);
    assert.equal(await service.verify(password, encodedHash), true);
    assert.equal(await service.verify(password, secondHash), true);
  });

  it('preserves password whitespace and case exactly', async () => {
    assert.equal(await service.verify(password, encodedHash), true);
    assert.equal(await service.verify(password.trim(), encodedHash), false);
    assert.equal(await service.verify(password.toLowerCase(), encodedHash), false);
    assert.equal(await service.verify(password.toUpperCase(), encodedHash), false);
  });

  it('rejects changed salt or key bytes without exposing their values', async () => {
    const parts = encodedHash.split('$');
    const salt = parts[4];
    const key = parts[5];
    const changedSalt = `${salt[0] === '0' ? '1' : '0'}${salt.slice(1)}`;
    const changedKey = `${key.slice(0, -1)}${key.endsWith('0') ? '1' : '0'}`;

    assert.equal(await service.verify(password, [...parts.slice(0, 4), changedSalt, key].join('$')), false);
    assert.equal(await service.verify(password, [...parts.slice(0, 5), changedKey].join('$')), false);
  });

  it('returns false for malformed, noncanonical, or oversized encoded values', async () => {
    const [, , , , salt, key] = encodedHash.split('$');
    const malformed: Array<[string, unknown]> = [
      ['missing value', undefined],
      ['null value', null],
      ['non-string value', 123],
      ['empty value', ''],
      ['different algorithm', `argon2$32768$8$3$${salt}$${key}`],
      ['leading whitespace', ` ${encodedHash}`],
      ['trailing newline', `${encodedHash}\n`],
      ['missing segment', `scrypt$32768$8$3$${salt}`],
      ['extra segment', `${encodedHash}$extra`],
      ['odd salt length', `scrypt$32768$8$3$${salt.slice(1)}$${key}`],
      ['odd key length', `scrypt$32768$8$3$${salt}$${key.slice(1)}`],
      ['invalid salt encoding', `scrypt$32768$8$3$g${salt.slice(1)}$${key}`],
      ['invalid key encoding', `scrypt$32768$8$3$${salt}$g${key.slice(1)}`],
      ['noncanonical salt encoding', `scrypt$32768$8$3$A${salt.slice(1)}$${key}`],
      ['oversized input', 'x'.repeat(1_000_000)],
    ];

    for (const [label, value] of malformed) {
      assert.equal(await service.verify(password, value as string), false, label);
    }
  });

  it('rejects unsupported scrypt parameters instead of using caller-selected work factors', async () => {
    const [, , , , salt, key] = encodedHash.split('$');
    const parameterSets = [
      '16384$8$3',
      '32769$8$3',
      '032768$8$3',
      '2147483648$8$3',
      '32768$9$3',
      '32768$8$1',
      '32768$8$9',
      '32768$8$999999999',
    ];

    for (const parameters of parameterSets) {
      assert.equal(await service.verify(password, `scrypt$${parameters}$${salt}$${key}`), false);
    }
  });
});
