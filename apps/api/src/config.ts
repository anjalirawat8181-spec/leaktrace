function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required config value ${name}`);
  return value;
}

export const config = {
  get databaseUrl() { return required('DATABASE_URL'); },
  get jwtSecret() { return required('JWT_SECRET'); },
  get fingerprintKey() { return required('FINGERPRINT_KEY'); },
  get maxCopies() { return Number(process.env.MAX_COPIES_PER_EXAM ?? 20); },
  get trustProxy() { return process.env.TRUST_PROXY === 'true'; },
  get port() { return Number(process.env.API_PORT ?? 4000); },
  get webOrigin() { return process.env.WEB_ORIGIN ?? 'http://localhost:5173'; },
};

export function checkRequiredConfig(): void {
  config.databaseUrl;
  config.jwtSecret;
  config.fingerprintKey;
}
