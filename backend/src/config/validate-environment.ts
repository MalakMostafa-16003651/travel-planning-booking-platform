export function validateJwtSecret(value: unknown): string {
  if (
    typeof value !== 'string' ||
    Buffer.byteLength(value, 'utf8') < 32 ||
    /[<>]/.test(value) ||
    /^(?:change|replace|example|your[-_ ]?jwt)/i.test(value) ||
    new Set(value).size < 8
  ) {
    throw new Error('JWT_SECRET must be a non-placeholder secret of at least 32 bytes');
  }
  return value;
}

export function validateEnvironment(environment: Record<string, unknown>): Record<string, unknown> {
  const uri = environment.MONGODB_URI;
  if (typeof uri !== 'string' || !/^mongodb(?:\+srv)?:\/\//.test(uri)) {
    throw new Error('MONGODB_URI must be a MongoDB connection string');
  }
  const rawPort = environment.PORT ?? '3000';
  const port = Number(rawPort);
  if (!/^\d+$/.test(String(rawPort)) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }
  return { ...environment, MONGODB_URI: uri, PORT: port, JWT_SECRET: validateJwtSecret(environment.JWT_SECRET) };
}
