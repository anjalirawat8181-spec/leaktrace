import express, { Router } from 'express';
import { LocalStorage } from '@leaktrace/adapters';
import { getAdapters } from '../adapters';

export const localFilesRouter = Router();

function storage(): LocalStorage {
  const s = getAdapters().storage;
  if (!(s instanceof LocalStorage)) throw new Error('Local files are only served in local mode');
  return s;
}

localFilesRouter.get('/:token', async (req, res) => {
  const s = storage();
  const token = s.verifyToken(req.params.token);
  if (!token || token.method !== 'GET') return res.status(403).json({ error: 'Invalid or expired link' });
  if (!(await s.exists(token.key))) return res.status(404).json({ error: 'File not found' });
  res.type('application/pdf').setHeader('Content-Disposition', `inline; filename="${token.key.split('/').pop()}"`);
  res.send(await s.read(token.key));
});

localFilesRouter.put(
  '/:token',
  express.raw({ type: () => true, limit: '20mb' }),
  async (req, res) => {
    const s = storage();
    const token = s.verifyToken(req.params.token);
    if (!token || token.method !== 'PUT') return res.status(403).json({ error: 'Invalid or expired link' });
    await s.put(token.key, req.body as Buffer, token.contentType ?? 'application/octet-stream');
    res.status(204).end();
  },
);
