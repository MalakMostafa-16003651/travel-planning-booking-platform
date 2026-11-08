import { ConfigService } from '@nestjs/config';
import { isEmail } from 'class-validator';

export interface MailConfiguration { host: string; port: number; user: string; pass: string; from: string }
export function readMailConfiguration(config: ConfigService): MailConfiguration | undefined {
  const keys = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'] as const;
  const values = keys.map((key) => config.get<unknown>(key));
  if (values.every((value) => value === undefined || value === '')) return undefined;
  if (values.some((value) => typeof value !== 'string' || value.length === 0 || /[\r\n]/.test(value))) {
    throw new Error('SMTP settings must all be configured without line breaks');
  }
  const [host, rawPort, user, pass, from] = values as string[];
  const port = Number(rawPort);
  if (!/^[a-zA-Z0-9.-]+$/.test(host) || !/^\d+$/.test(rawPort) || !Number.isInteger(port) || port < 1 || port > 65535 || !isEmail(from)) {
    throw new Error('SMTP host, port or sender configuration is invalid');
  }
  return { host, port, user, pass, from };
}

export function readPasswordResetUrl(config: ConfigService): string | undefined {
  const value = config.get<unknown>('PASSWORD_RESET_URL');
  if (value === undefined || value === '') return undefined;
  try {
    if (typeof value !== 'string' || /[\r\n]/.test(value)) throw new Error();
    const url = new URL(value);
    const localHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((!localHttp && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash) throw new Error();
    return url.toString();
  } catch { throw new Error('PASSWORD_RESET_URL must be a trusted HTTPS URL without credentials, query or fragment (HTTP allowed only on loopback)'); }
}
