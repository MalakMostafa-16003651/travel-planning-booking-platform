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
  return { ...environment, MONGODB_URI: uri, PORT: port };
}
