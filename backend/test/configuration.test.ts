import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { validateEnvironment, validateJwtSecret } from '../src/config/validate-environment';

const testSecret = randomBytes(48).toString('hex');

test('uses the default port with a MongoDB URI', () => {
  const config = validateEnvironment({ MONGODB_URI: 'mongodb://127.0.0.1/test', JWT_SECRET: testSecret });
  assert.equal(config.PORT, 3000);
  assert.ok(config.JWT_SECRET === testSecret);
});

test('requires a non-placeholder JWT signing secret without exposing its value', () => {
  for (const secret of [undefined, '', 'short', 'a'.repeat(64), '<generate-a-random-secret-of-at-least-32-bytes>', 'replace-with-a-random-secret-before-use']) {
    assert.throws(() => validateJwtSecret(secret), {
      message: 'JWT_SECRET must be a non-placeholder secret of at least 32 bytes',
    });
  }
  assert.throws(() => validateEnvironment({ MONGODB_URI: 'mongodb://127.0.0.1/test' }), {
    message: 'JWT_SECRET must be a non-placeholder secret of at least 32 bytes',
  });
  assert.ok(validateJwtSecret(testSecret) === testSecret);
});

test('fails fast on invalid connection settings without including their values', () => {
  for (const uri of [undefined, '', 'not-a-connection-string']) {
    assert.throws(() => validateEnvironment({ MONGODB_URI: uri }), {
      message: 'MONGODB_URI must be a MongoDB connection string',
    });
  }
  for (const port of ['', 'abc', '1.5', '0', '65536']) {
    assert.throws(() => validateEnvironment({ MONGODB_URI: 'mongodb://127.0.0.1/test', PORT: port }), {
      message: 'PORT must be an integer between 1 and 65535',
    });
  }
});
