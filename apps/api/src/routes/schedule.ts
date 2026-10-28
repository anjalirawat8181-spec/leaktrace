import { Router } from 'express';
import { z } from 'zod';
import { localIsoToUtc } from '@leaktrace/adapters';
import { getAdapters } from '../adapters';
import { requireAuth, requireRole } from '../auth';
import { audit, query } from '../db';
import { logger } from '../logger';
import {
  EXAM_TIMEZONE, closeScheduleName, examWindow, now, releaseScheduleName, wallClockIso,
} from '../time';

export const scheduleRouter = Router();
scheduleRouter.use(requireAuth, requireRole('CONTROLLER'));

const WALL_CLOCK = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;
const bodySchema = z.object({
  releaseAt: z.string().regex(WALL_CLOCK, 'Pick a release date and time'),
  closeAt: z.string().regex(WALL_CLOCK, 'Pick a close date and time'),
});

const MIN_LEAD_MS = 60_000;

export function scheduleInfo(exam: any) {
  const w = examWindow(exam);
  return {
    timezone: EXAM_TIMEZONE,
    release: { name: releaseScheduleName(exam.id), at: w.opensAt.toISOString(), local: wallClockIso(w.opensAt) },
    close: { name: closeScheduleName(exam.id), at: w.closesAt.toISOString(), local: wallClockIso(w.closesAt) },
  };
}

scheduleRouter.get('/:id/schedule', async (req, res) => {
  const exam = (await query('SELECT * FROM exams WHERE id=$1', [req.params.id]))[0];
  if (!exam) return res.status(404).json({ error: 'Exam not found' });
  const start = new Date(exam.starts_at).getTime();
  res.json({
    status: exam.status,
    startsAt: new Date(exam.starts_at).toISOString(),
    suggested: {
      releaseAt: wallClockIso(new Date(start - 15 * 60_000)).slice(0, 16),
      closeAt: wallClockIso(new Date(start + 30 * 60_000)).slice(0, 16),
    },
    ...scheduleInfo(exam),
  });
});

scheduleRouter.post('/:id/schedule', async (req, res) => {
  const body = bodySchema.safeParse(req.body ?? {});
  if (!body.success) {
    return res.status(400).json({ error: body.error.issues[0]?.message ?? 'Pick a release time and a close time' });
  }
  const exam = (await query('SELECT * FROM exams WHERE id=$1', [req.params.id]))[0];
  if (!exam) return res.status(404).json({ error: 'Exam not found' });
  if (!['READY', 'SCHEDULED'].includes(exam.status)) {
    return res.status(409).json({ error: `This exam is ${exam.status}; it can only be scheduled after its copies are generated and before it is released` });
  }

  const releaseAt = localIsoToUtc(body.data.releaseAt, EXAM_TIMEZONE);
  const closeAt = localIsoToUtc(body.data.closeAt, EXAM_TIMEZONE);
  if (releaseAt.getTime() < now().getTime() + MIN_LEAD_MS) {
    return res.status(422).json({ error: 'Release time must be at least 1 minute from now (India time)' });
  }
  if (closeAt.getTime() < releaseAt.getTime() + MIN_LEAD_MS) {
    return res.status(422).json({ error: 'Close time must be after the release time' });
  }

  const preview = scheduleInfo({ ...exam, release_at: releaseAt, close_at: closeAt });
  const { scheduler } = getAdapters();
  try {
    await scheduler.scheduleOnce(preview.release.name, preview.release.local, EXAM_TIMEZONE, { type: 'RELEASE', examId: exam.id });
    await scheduler.scheduleOnce(preview.close.name, preview.close.local, EXAM_TIMEZONE, { type: 'CLOSE', examId: exam.id });
  } catch (err) {
    logger.error({ err, examId: exam.id }, 'could not create the schedule');
    if (exam.status === 'READY') {
      await scheduler.cancel(preview.release.name).catch(() => undefined);
      await scheduler.cancel(preview.close.name).catch(() => undefined);
    }
    return res.status(502).json({
      error: `Could not create the schedule, so nothing was saved: ${(err as Error).message}`,
    });
  }
  const [updated] = await query(
    "UPDATE exams SET release_at=$2, close_at=$3, status='SCHEDULED' WHERE id=$1 RETURNING *",
    [exam.id, releaseAt.toISOString(), closeAt.toISOString()],
  );
  const info = scheduleInfo(updated);
  await audit(req.user!.id, 'EXAM_SCHEDULED', 'exam', exam.id, {
    examId: exam.id, release: info.release.at, close: info.close.at,
  });
  res.json({ status: 'SCHEDULED', ...info });
});
