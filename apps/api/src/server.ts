import { LocalScheduler } from '@leaktrace/adapters';
import { getAdapters } from './adapters';
import { createApp, logger } from './app';
import { startExamEventConsumer } from './events';
import { checkRequiredConfig, config } from './config';

checkRequiredConfig();
const adapters = getAdapters();
if (adapters.scheduler instanceof LocalScheduler) {
  adapters.scheduler.startPoller(10_000, (err) => logger.error({ err }, 'scheduler poll failed'));
}
startExamEventConsumer(adapters, (err) => logger.error({ err }, 'exam-events consumer failed'));
createApp().listen(config.port, () => {
  logger.info({ port: config.port }, 'LeakTrace API listening');
});
