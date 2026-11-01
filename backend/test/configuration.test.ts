import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateEnvironment } from '../src/config/validate-environment';

test('uses the default port with a MongoDB URI', () => {
  const config = validateEnvironment({ MONGODB_URI: 'mongodb://127.0.0.1/test' });
  assert.equal(config.PORT, 3000);
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
