import { Router } from 'express';
import { centreSchema, roomSchema } from '@leaktrace/shared';
import { requireAuth, requireRole } from '../auth';
import { config } from '../config';
import { audit, query } from '../db';

export const centresRouter = Router();
centresRouter.use(requireAuth, requireRole('CONTROLLER'));

const roomJson = (r: any) => ({
  id: r.id, centreId: r.centre_id, name: r.name, seats: r.seats, invigilatorName: r.invigilator_name,
});

async function totalSeats(excludeRoomId?: string): Promise<number> {
  const rows = await query<{ total: string }>(
    'SELECT COALESCE(SUM(seats),0) AS total FROM rooms WHERE ($1::uuid IS NULL OR id <> $1)',
    [excludeRoomId ?? null],
  );
  return Number(rows[0].total);
}

function limitError(total: number) {
  return {
    error: `Rooms would add up to ${total} seats; the maximum is ${config.maxCopies} copies per exam`,
    totalSeats: total,
    maxCopies: config.maxCopies,
  };
}

centresRouter.get('/', async (_req, res) => {
  const centres = await query('SELECT * FROM centres ORDER BY code');
  const rooms = await query('SELECT * FROM rooms ORDER BY name');
  res.json({
    maxCopies: config.maxCopies,
    totalSeats: rooms.reduce((sum, r) => sum + r.seats, 0),
    centres: centres.map((c) => ({
      id: c.id, code: c.code, name: c.name, city: c.city,
      rooms: rooms.filter((r) => r.centre_id === c.id).map(roomJson),
    })),
  });
});

centresRouter.post('/', async (req, res) => {
  const parsed = centreSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid centre', issues: parsed.error.issues });
  const { code, name, city } = parsed.data;
  const dup = await query('SELECT 1 FROM centres WHERE code = $1', [code]);
  if (dup.length) return res.status(409).json({ error: 'Centre code already exists' });
  const [row] = await query(
    'INSERT INTO centres (code, name, city) VALUES ($1,$2,$3) RETURNING *', [code, name, city],
  );
  await audit(req.user!.id, 'CENTRE_CREATED', 'centre', row.id, { code });
  res.status(201).json({ ...row, rooms: [] });
});

centresRouter.put('/:id', async (req, res) => {
  const parsed = centreSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid centre', issues: parsed.error.issues });
  const { code, name, city } = parsed.data;
  const dup = await query('SELECT 1 FROM centres WHERE code = $1 AND id <> $2', [code, req.params.id]);
  if (dup.length) return res.status(409).json({ error: 'Centre code already exists' });
  const rows = await query(
    'UPDATE centres SET code=$1, name=$2, city=$3 WHERE id=$4 RETURNING *',
    [code, name, city, req.params.id],
  );
  if (!rows[0]) return res.status(404).json({ error: 'Centre not found' });
  await audit(req.user!.id, 'CENTRE_UPDATED', 'centre', rows[0].id, { code });
  res.json(rows[0]);
});

centresRouter.delete('/:id', async (req, res) => {
  const rows = await query('DELETE FROM centres WHERE id=$1 RETURNING id, code', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Centre not found' });
  await audit(req.user!.id, 'CENTRE_DELETED', 'centre', rows[0].id, { code: rows[0].code });
  res.status(204).end();
});

centresRouter.get('/:id/rooms', async (req, res) => {
  const rows = await query('SELECT * FROM rooms WHERE centre_id=$1 ORDER BY name', [req.params.id]);
  res.json(rows.map(roomJson));
});

centresRouter.post('/:id/rooms', async (req, res) => {
  const parsed = roomSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid room', issues: parsed.error.issues });
  const centre = await query('SELECT 1 FROM centres WHERE id=$1', [req.params.id]);
  if (!centre.length) return res.status(404).json({ error: 'Centre not found' });
  const total = (await totalSeats()) + parsed.data.seats;
  if (total > config.maxCopies) return res.status(422).json(limitError(total));
  const [row] = await query(
    'INSERT INTO rooms (centre_id, name, seats, invigilator_name) VALUES ($1,$2,$3,$4) RETURNING *',
    [req.params.id, parsed.data.name, parsed.data.seats, parsed.data.invigilatorName],
  );
  await audit(req.user!.id, 'ROOM_CREATED', 'room', row.id, { seats: row.seats });
  res.status(201).json(roomJson(row));
});

centresRouter.put('/:id/rooms/:roomId', async (req, res) => {
  const parsed = roomSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid room', issues: parsed.error.issues });
  const total = (await totalSeats(req.params.roomId)) + parsed.data.seats;
  if (total > config.maxCopies) return res.status(422).json(limitError(total));
  const rows = await query(
    `UPDATE rooms SET name=$1, seats=$2, invigilator_name=$3
     WHERE id=$4 AND centre_id=$5 RETURNING *`,
    [parsed.data.name, parsed.data.seats, parsed.data.invigilatorName, req.params.roomId, req.params.id],
  );
  if (!rows[0]) return res.status(404).json({ error: 'Room not found' });
  await audit(req.user!.id, 'ROOM_UPDATED', 'room', rows[0].id, { seats: rows[0].seats });
  res.json(roomJson(rows[0]));
});

centresRouter.delete('/:id/rooms/:roomId', async (req, res) => {
  const rows = await query(
    'DELETE FROM rooms WHERE id=$1 AND centre_id=$2 RETURNING id', [req.params.roomId, req.params.id],
  );
  if (!rows[0]) return res.status(404).json({ error: 'Room not found' });
  await audit(req.user!.id, 'ROOM_DELETED', 'room', rows[0].id);
  res.status(204).end();
});
