import 'express-async-errors';
import cookieParser from 'cookie-parser';
import express, { type ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import { config } from './config';
import { logger } from './logger';
import { query } from './db';
import { auditRouter, notificationsRouter } from './routes/audit';
import { authRouter } from './routes/auth';
import { centreRouter } from './routes/centre';
import { centresRouter } from './routes/centres';
import { examsRouter } from './routes/exams';
import { generationRouter } from './routes/generation';
import { localFilesRouter } from './routes/localFiles';
import { traceRouter } from './routes/trace';
import { scheduleRouter } from './routes/schedule';

export { logger };

export function createApp() {
  const app = express();
  app.set('trust proxy', config.trustProxy);
  app.use(helmet());
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.get('/api/health', async (_req, res) => {
    await query('SELECT 1');
    res.json({ ok: true });
  });
  app.use('/api/auth', authRouter);
  app.use('/api/centres', centresRouter);
  app.use('/api/exams', examsRouter);
  app.use('/api/exams', generationRouter);
  app.use('/api/exams', scheduleRouter);
  app.use('/api/centre', centreRouter);
  app.use('/api/trace', traceRouter);
  app.use('/api/audit', auditRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/local-files', localFilesRouter);

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    logger.error({ err }, 'unhandled error');
    res.status(500).json({ error: 'Internal server error' });
  };
  app.use(onError);
  return app;
}
