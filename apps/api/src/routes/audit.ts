import { Router } from 'express';
import { requireAuth, requireRole } from '../auth';
import { query } from '../db';

export const auditRouter = Router();
auditRouter.use(requireAuth, requireRole('CONTROLLER', 'AUDITOR'));

const UUID = /^[0-9a-f-]{36}$/i;

/** Audit events and download attempts merged into one chronological feed. */
auditRouter.get('/', async (req, res) => {
  const examId = typeof req.query.examId === 'string' && UUID.test(req.query.examId) ? req.query.examId : null;
  const type = typeof req.query.type === 'string' && req.query.type ? req.query.type : null;

  const rows = await query(
    `SELECT * FROM (
       SELECT a.id::text, a.at, u.name AS actor, a.action, a.entity, a.entity_id, a.details,
              (a.action = 'LOGIN_FAILED') AS denied,
              CASE WHEN a.entity = 'exam' THEN a.entity_id ELSE a.details->>'examId' END AS exam_id
       FROM audit_events a LEFT JOIN users u ON u.id = a.actor_user_id
       UNION ALL
       SELECT d.id::text, d.at, u.name, CASE WHEN d.allowed THEN 'DOWNLOAD' ELSE 'DOWNLOAD_DENIED' END,
              'exam', d.exam_id::text,
              jsonb_build_object('reason', d.reason, 'ip', host(d.ip), 'userAgent', d.user_agent,
                                 'centreId', d.centre_id, 'roomId', d.room_id),
              NOT d.allowed, d.exam_id::text
       FROM downloads d LEFT JOIN users u ON u.id = d.user_id
     ) feed
     WHERE ($1::text IS NULL OR exam_id = $1) AND ($2::text IS NULL OR action = $2)
     ORDER BY at DESC LIMIT 500`,
    [examId, type],
  );
  res.json(rows.map((r) => ({
    id: r.id, at: new Date(r.at).toISOString(), actor: r.actor ?? 'system', action: r.action,
    entity: r.entity, entityId: r.entity_id, details: r.details, denied: r.denied, examId: r.exam_id,
  })));
});

export const notificationsRouter = Router();
notificationsRouter.get('/', requireAuth, requireRole('CONTROLLER', 'AUDITOR'), async (_req, res) => {
  const rows = await query('SELECT id, topic, subject, body, at FROM notifications ORDER BY at DESC LIMIT 200');
  res.json(rows.map((r) => ({ ...r, at: new Date(r.at).toISOString() })));
});
