import { createApp, logger } from './app';
import { checkRequiredConfig, config } from './config';

checkRequiredConfig();
createApp().listen(config.port, () => {
  logger.info({ port: config.port }, 'LeakTrace API listening');
});
