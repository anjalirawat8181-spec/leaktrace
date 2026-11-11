function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required config value ${name}`);
  return value;
}

export const config = {
  get appMode(): 'aws' | 'cloud' | 'local' {
    return process.env.APP_MODE === 'aws' ? 'aws' : process.env.APP_MODE === 'cloud' ? 'cloud' : 'local';
  },
  get workerInProcess() { return process.env.WORKER_IN_PROCESS === 'true'; },
  get databaseUrl() { return required('DATABASE_URL'); },
  get jwtSecret() { return required('JWT_SECRET'); },
  get fingerprintKey() { return required('FINGERPRINT_KEY'); },
  get maxCopies() { return Number(process.env.MAX_COPIES_PER_EXAM ?? 20); },
  get trustProxy(): boolean | string {
    const v = process.env.TRUST_PROXY;
    if (!v || v === 'false') return false;
    return v === 'true' ? true : v;
  },
  get awsPort() { return Number(process.env.PORT ?? 3000); },
  get awsHost() { return process.env.HOST ?? '127.0.0.1'; },
  get cloudHost() { return process.env.HOST ?? '0.0.0.0'; },
  get port() { return Number(process.env.API_PORT ?? 4000); },
  get webOrigin() { return process.env.WEB_ORIGIN ?? 'http://localhost:5173'; },
};

export function checkRequiredConfig(): void {
  config.databaseUrl;
  config.jwtSecret;
  config.fingerprintKey;
}
