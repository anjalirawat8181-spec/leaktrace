import { Router } from 'express';
import { getAdapters } from '../adapters';
import { logger } from '../logger';
import { clientIp, requireAuth, requireRole } from '../auth';
import { audit, query } from '../db';
import { examWindow, now } from '../time';

export const centreRouter = Router();
centreRouter.use(requireAuth, requireRole('SUPERINTENDENT'));

const UUID = /^[0-9a-f-]{36}$/i;
const VISIBLE_STATUSES = ['SCHEDULED', 'RELEASED', 'CLOSED'];

centreRouter.get('/exams', async (req, res) => {
  const at = now();
  const exams = await query(
    'SELECT * FROM exams WHERE status = ANY($1) ORDER BY starts_at', [VISIBLE_STATUSES],
  );
  const rooms = await query('SELECT * FROM rooms WHERE centre_id=$1 ORDER BY name', [req.user!.centreId]);
  res.json({
    serverTime: at.toISOString(),
    exams: exams.map((e) => {
      const w = examWindow(e, at);
      return {
        id: e.id,
        title: e.title,
        subject: e.subject,
        startsAt: new Date(e.starts_at).toISOString(),
        status: e.status,
        windowState: w.state,
        opensAt: w.opensAt.toISOString(),
        closesAt: w.closesAt.toISOString(),
        rooms: rooms.map((r) => ({ id: r.id, name: r.name })),
      };
    }),
  });
});

type Reason = 'TOO_EARLY' | 'CLOSED' | 'WRONG_CENTRE' | 'OK';

centreRouter.post('/exams/:id/download', async (req, res) => {
  const user = req.user!;
  if (!UUID.test(req.params.id)) return res.status(404).json({ error: 'Exam not found' });
  const exam = (await query('SELECT * FROM exams WHERE id=$1', [req.params.id]))[0];
  if (!exam) return res.status(404).json({ error: 'Exam not found' });

  const at = now();
  const requestedCentre: string | undefined = req.body?.centreId;
  const w = examWindow(exam, at);
  let reason: Reason = 'OK';
  if (!user.centreId || (requestedCentre && requestedCentre !== user.centreId)) reason = 'WRONG_CENTRE';
  else if (exam.status === 'CLOSED' || w.state === 'CLOSED') reason = 'CLOSED';
  else if (w.state === 'BEFORE' || exam.status !== 'RELEASED') reason = 'TOO_EARLY';

  const ip = clientIp(req) ?? null;
  const ua = req.headers['user-agent'] ?? null;
  const adapters = getAdapters();

  if (reason !== 'OK') {
    await query(
      `INSERT INTO downloads (exam_id, centre_id, user_id, ip, user_agent, allowed, reason, at)
       VALUES ($1,$2,$3,$4,$5,false,$6,$7)`,
      [exam.id, user.centreId, user.id, ip, ua, reason, at],
    );
    logger.warn({
      event: 'OUTSIDE_WINDOW_DOWNLOAD', examId: exam.id, userId: user.id, centreId: user.centreId, reason, ip,
    });
    adapters.metrics.count('DownloadsOutsideWindow');
    await adapters.notifier.publish(
      'ops-alerts',
      `DENIED DOWNLOAD (${reason}): ${exam.title}`,
      `${user.name} <${user.email}> from IP ${ip ?? 'unknown'} tried to download "${exam.title}" at ${at.toISOString()}. Reason: ${reason}.`,
    );
    return res.status(403).json({ reason });
  }

  const bundles = await query(
    `SELECT r.id AS room_id, r.name, min(c.storage_key) AS storage_key
     FROM copies c JOIN rooms r ON r.id = c.room_id
     WHERE c.exam_id=$1 AND c.centre_id=$2 AND c.storage_key IS NOT NULL
     GROUP BY r.id, r.name ORDER BY r.name`,
    [exam.id, user.centreId],
  );
  if (!bundles.length) return res.status(404).json({ error: 'No papers were generated for this centre' });

  const ttlSec = 120;
  const expiresAt = new Date(at.getTime() + ttlSec * 1000).toISOString();
  const rooms = [];
  for (const b of bundles) {
    await query(
      `INSERT INTO downloads (exam_id, centre_id, room_id, user_id, ip, user_agent, allowed, reason, at)
       VALUES ($1,$2,$3,$4,$5,$6,true,'OK',$7)`,
      [exam.id, user.centreId, b.room_id, user.id, ip, ua, at],
    );
    rooms.push({ room: b.name, url: await adapters.storage.signedDownloadUrl(b.storage_key, ttlSec), expiresAt });
  }
  await audit(user.id, 'PAPER_DOWNLOADED', 'exam', exam.id, { examId: exam.id, rooms: bundles.length, ip });
  res.json({ rooms });
});
