import os from 'node:os';
import path from 'node:path';

export default {
  test: {
    include: ['test/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 60000,
    env: {
      JWT_SECRET: 'test-secret',
      LOGIN_RATE_LIMIT: '1000',
      FINGERPRINT_KEY: 'test-fingerprint-key',
      DATA_DIR: path.join(os.tmpdir(), 'leaktrace-test-data'),
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        'postgres://leaktrace:leaktrace@localhost:5434/leaktrace_test',
    },
  },
};
