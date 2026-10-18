import { Router } from 'express';
import { z } from 'zod';
import { getAdapters } from '../adapters';
import { requireAuth, requireRole } from '../auth';
import { audit, query } from '../db';
import {
  EXAM_TIMEZONE, closeScheduleName, examWindow, releaseScheduleName, wallClockIso,
} from '../time';

export const scheduleRouter = Router();
scheduleRouter.use(requireAuth, requireRole('CONTROLLER'));

const bodySchema = z.object({
  releaseLeadMin: z.number().int().min(0).max(240).optional(),
  closeAfterMin: z.number().int().min(0).max(240).optional(),
});

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
  res.json({ status: exam.status, ...scheduleInfo(exam) });
});

scheduleRouter.post('/:id/schedule', async (req, res) => {
  const body = bodySchema.safeParse(req.body ?? {});
  if (!body.success) return res.status(400).json({ error: 'Invalid schedule', issues: body.error.issues });
  const exam = (await query('SELECT * FROM exams WHERE id=$1', [req.params.id]))[0];
  if (!exam) return res.status(404).json({ error: 'Exam not found' });
  if (!['READY', 'SCHEDULED'].includes(exam.status)) {
    return res.status(409).json({ error: `Exam is ${exam.status}; only READY or SCHEDULED exams can be scheduled` });
  }

  const lead = body.data.releaseLeadMin ?? exam.release_lead_min;
  const closeAfter = body.data.closeAfterMin ?? exam.close_after_min;
  const [updated] = await query(
    "UPDATE exams SET release_lead_min=$2, close_after_min=$3, status='SCHEDULED' WHERE id=$1 RETURNING *",
    [exam.id, lead, closeAfter],
  );
  const info = scheduleInfo(updated);
  const { scheduler } = getAdapters();
  await scheduler.scheduleOnce(info.release.name, info.release.local, EXAM_TIMEZONE, { type: 'RELEASE', examId: exam.id });
  await scheduler.scheduleOnce(info.close.name, info.close.local, EXAM_TIMEZONE, { type: 'CLOSE', examId: exam.id });
  await audit(req.user!.id, 'EXAM_SCHEDULED', 'exam', exam.id, {
    examId: exam.id, release: info.release.at, close: info.close.at,
  });
  res.json({ status: 'SCHEDULED', ...info });
});
