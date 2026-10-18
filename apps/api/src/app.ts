import 'express-async-errors';
import cookieParser from 'cookie-parser';
import express, { type ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import pino from 'pino';
import { config } from './config';
import { query } from './db';
import { authRouter } from './routes/auth';
import { centresRouter } from './routes/centres';
import { examsRouter } from './routes/exams';

export const logger = pino();

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

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    logger.error({ err }, 'unhandled error');
    res.status(500).json({ error: 'Internal server error' });
  };
  app.use(onError);
  return app;
}
