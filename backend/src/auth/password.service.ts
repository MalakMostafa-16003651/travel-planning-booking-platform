import { Injectable } from '@nestjs/common';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const HASH_PREFIX = 'scrypt$32768$8$3$';
const SALT_BYTES = 16;
const KEY_BYTES = 64;
const ENCODED_HASH_LENGTH = HASH_PREFIX.length + SALT_BYTES * 2 + 1 + KEY_BYTES * 2;
const HASH_FORMAT = /^scrypt\$32768\$8\$3\$([0-9a-f]{32})\$([0-9a-f]{128})$/;

@Injectable()
export class PasswordService {
  async hash(password: string): Promise<string> {
    const salt = randomBytes(SALT_BYTES);
    const key = await this.derive(password, salt);
    // Store parameters with the salt for subsequent password verification.
    return `${HASH_PREFIX}${salt.toString('hex')}$${key.toString('hex')}`;
  }

  async verify(password: string, encodedHash: string): Promise<boolean> {
    // Bound parsing and accept only the existing format before doing costly work.
    if (
      typeof password !== 'string' ||
      typeof encodedHash !== 'string' ||
      encodedHash.length !== ENCODED_HASH_LENGTH
    ) return false;

    const match = HASH_FORMAT.exec(encodedHash);
    if (!match) return false;

    const salt = Buffer.from(match[1], 'hex');
    const expectedKey = Buffer.from(match[2], 'hex');
    const actualKey = await this.derive(password, salt);
    return timingSafeEqual(actualKey, expectedKey);
  }

  private derive(password: string, salt: Buffer): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      // OWASP scrypt configuration: N=2^15, r=8, p=3 (32 MiB memory).
      scrypt(password, salt, KEY_BYTES, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }, (error, derived) => {
        if (error) reject(error);
        else resolve(derived);
      });
    });
  }
}
