import { createHash, randomBytes } from 'node:crypto';
export function createEmailToken(): string { return randomBytes(32).toString('hex'); }
export function hashEmailToken(token: string): string { return createHash('sha256').update(token).digest('hex'); }
export function isDuplicateKey(error: unknown): boolean { return typeof error === 'object' && error !== null && 'code' in error && error.code === 11000; }
