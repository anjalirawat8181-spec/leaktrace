import 'express-async-errors';
import cookieParser from 'cookie-parser';
import express, { type ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import { config } from './config';
import { logger } from './logger';
import { touchActivity } from './activity';
import { query } from './db';
import { auditRouter, notificationsRouter } from './routes/audit';
import { adminRouter } from './demo';
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

  app.use((req, _res, next) => {
    if (!req.path.startsWith('/api/health')) touchActivity();
    next();
  });

  app.get('/api/health', async (req, res) => {
    if (config.appMode !== 'cloud' || req.query.deep === '1') await query('SELECT 1');
    res.json({ status: 'ok' });
  });
  app.use('/api/auth', authRouter);
  app.use('/api/admin', adminRouter);
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
