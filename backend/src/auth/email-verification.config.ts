import { ConfigService } from '@nestjs/config';
export function readEmailVerificationRequired(config: ConfigService): boolean {
  const value = config.get<unknown>('EMAIL_VERIFICATION_REQUIRED');
  if (value === undefined || value === '' || value === false || value === 'false') return false;
  if (value === true || value === 'true') return true;
  throw new Error('EMAIL_VERIFICATION_REQUIRED must be true or false');
}
