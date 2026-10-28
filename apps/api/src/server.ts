import { LocalScheduler, bootstrapAwsAdapters, type Adapters } from '@leaktrace/adapters';
import { getAdapters, setAdapters } from './adapters';
import { createApp, logger } from './app';
import { startExamEventConsumer } from './events';
import { checkRequiredConfig, config } from './config';
import { setPool } from './db';

async function main() {
  let adapters: Adapters;
  let port: number;
  let host: string | undefined;

  if (config.appMode === 'aws') {
    const runtime = await bootstrapAwsAdapters('api');
    for (const key of ['JWT_SECRET', 'FINGERPRINT_KEY']) {
      const value = runtime.config.get(key);
      if (!value) throw new Error(`Missing SSM parameter ${key}`);
      process.env[key] = value;
    }
    setPool(runtime.pool);
    setAdapters(runtime.adapters);
    adapters = runtime.adapters;
    port = config.awsPort;
    host = config.awsHost;
  } else {
    checkRequiredConfig();
    adapters = getAdapters();
    if (adapters.scheduler instanceof LocalScheduler) {
      adapters.scheduler.startPoller(10_000, (err) => logger.error({ err }, 'scheduler poll failed'));
    }
    port = config.port;
  }

  startExamEventConsumer(adapters, (err) => logger.error({ err }, 'exam-events consumer failed'));
  const onListening = () => logger.info({ port, host: host ?? 'all interfaces', mode: config.appMode }, 'LeakTrace API listening');
  if (host) createApp().listen(port, host, onListening);
  else createApp().listen(port, onListening);
}

main().catch((err) => {
  logger.error({ err }, 'startup failed');
  process.exit(1);
});
