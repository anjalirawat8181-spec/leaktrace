import os from 'node:os';
import path from 'node:path';

export default {
  test: {
    include: ['test/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 20000,
    env: {
      DATA_DIR: path.join(os.tmpdir(), 'leaktrace-test-data'),
      JWT_SECRET: 'test-secret',
      LOGIN_RATE_LIMIT: '1000',
      FINGERPRINT_KEY: 'test-fingerprint-key',
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        'postgres://leaktrace:leaktrace@localhost:5434/leaktrace_test',
    },
  },
};
