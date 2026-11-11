import path from 'node:path';
import { LocalScheduler, bootstrapAwsAdapters, bootstrapCloudAdapters, type Adapters, type CloudRuntime } from '@leaktrace/adapters';
import { setActivityGate } from './activity';
import { getAdapters, setAdapters } from './adapters';
import { createApp, logger } from './app';
import { startExamEventConsumer } from './events';
import { checkRequiredConfig, config } from './config';
import { setPool } from './db';

async function startInProcessWorker(runtime: CloudRuntime) {
  const entry = path.resolve(__dirname, '../../worker/src/loop');
  const { startWorkerLoop } = await import(entry);
  startWorkerLoop({
    pool: runtime.pool,
    adapters: runtime.adapters,
    heartbeat: false,
    onState: (running: boolean) => runtime.fleet.setRunning(running),
    log: (o: object) => logger.info(o),
    logError: (o: object) => logger.error(o),
  });
}

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
  } else if (config.appMode === 'cloud') {
    const runtime = bootstrapCloudAdapters();
    for (const key of ['JWT_SECRET', 'FINGERPRINT_KEY']) process.env[key] = runtime.config.get(key);
    setPool(runtime.pool);
    setAdapters(runtime.adapters);
    setActivityGate(runtime.gate);
    runtime.startBackground((err) => logger.error({ err }, 'scheduler poll failed'));
    if (config.workerInProcess) await startInProcessWorker(runtime);
    adapters = runtime.adapters;
    port = config.awsPort;
    host = config.cloudHost;
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
