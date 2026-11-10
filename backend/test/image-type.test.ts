import assert from 'node:assert/strict';
import test from 'node:test';
import { detectImageExtension } from '../src/common/files/image-type';

test('recognises PNG and JPG by content and rejects everything else', () => {
  assert.equal(detectImageExtension(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])), 'png');
  assert.equal(detectImageExtension(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), 'jpg');
  assert.equal(detectImageExtension(Buffer.from('<svg></svg>')), null);
  assert.equal(detectImageExtension(Buffer.from('%PDF-1.7')), null);
  assert.equal(detectImageExtension(Buffer.alloc(0)), null);
});
