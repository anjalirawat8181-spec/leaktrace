import bcrypt from 'bcryptjs';
import { Pool } from 'pg';
import { parseTemplate, capacityBits } from '@leaktrace/fingerprint';
import { seedPaper } from '@leaktrace/fingerprint/dist/seed-paper';

async function main() {
  const password = process.env.DEMO_PASSWORD;
  if (!process.env.DATABASE_URL || !password) throw new Error('DATABASE_URL and DEMO_PASSWORD are required');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const hash = await bcrypt.hash(password, 12);

  const centreIds: string[] = [];
  const centres: Array<[string, string, string, [string, string]]> = [
    ['C1', 'North Campus Centre', 'Pune', ['A. Sharma', 'B. Iyer']],
    ['C2', 'South Campus Centre', 'Mumbai', ['C. Nair', 'D. Gupta']],
  ];
  for (const [code, name, city, invigilators] of centres) {
    const { rows } = await pool.query(
      `INSERT INTO centres (code, name, city) VALUES ($1,$2,$3)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      [code, name, city],
    );
    centreIds.push(rows[0].id);
    const existing = await pool.query('SELECT 1 FROM rooms WHERE centre_id=$1', [rows[0].id]);
    if (!existing.rowCount) {
      for (const [i, invigilator] of invigilators.entries()) {
        await pool.query(
          'INSERT INTO rooms (centre_id, name, seats, invigilator_name) VALUES ($1,$2,5,$3)',
          [rows[0].id, `${code}-Room ${i + 1}`, invigilator],
        );
      }
    }
  }

  const users: Array<[string, string, string, string | null]> = [
    ['controller@demo', 'Controller Demo', 'CONTROLLER', null],
    ['supt.c1@demo', 'Superintendent C1', 'SUPERINTENDENT', centreIds[0]],
    ['supt.c2@demo', 'Superintendent C2', 'SUPERINTENDENT', centreIds[1]],
    ['auditor@demo', 'Auditor Demo', 'AUDITOR', null],
  ];
  const ids: Record<string, string> = {};
  for (const [email, name, role, centreId] of users) {
    const { rows } = await pool.query(
      `INSERT INTO users (email, password_hash, name, role, centre_id) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash RETURNING id`,
      [email, hash, name, role, centreId],
    );
    ids[email] = rows[0].id;
  }

  const title = 'Cloud Computing Unit Test 1';
  const exists = await pool.query('SELECT id FROM exams WHERE title=$1', [title]);
  if (!exists.rowCount) {
    const startsAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    const exam = await pool.query(
      `INSERT INTO exams (title, subject, starts_at, duration_min, created_by)
       VALUES ($1,'Cloud Computing',$2,90,$3) RETURNING id`,
      [title, startsAt, ids['controller@demo']],
    );
    const parsed = parseTemplate(seedPaper);
    const tpl = await pool.query(
      `INSERT INTO paper_templates (exam_id, source, parsed, capacity_bits, version)
       VALUES ($1,$2,$3,$4,1) RETURNING id`,
      [exam.rows[0].id, seedPaper, JSON.stringify(parsed), capacityBits(parsed.points)],
    );
    for (const p of parsed.points) {
      await pool.query(
        `INSERT INTO variation_points (template_id, idx, kind, alternatives, left_ctx, right_ctx)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [tpl.rows[0].id, p.idx, p.kind, JSON.stringify(p.alternatives), p.leftCtx, p.rightCtx],
      );
    }
  }
  await pool.end();
  console.log('Seeded users, 2 centres x 2 rooms x 5 seats, and the demo exam.');
}

main().catch((err) => { console.error(err); process.exit(1); });
