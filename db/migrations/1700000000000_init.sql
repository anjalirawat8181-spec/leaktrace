-- Up Migration
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE centres (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  city text NOT NULL
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  name text NOT NULL,
  role text NOT NULL CHECK (role IN ('CONTROLLER','SUPERINTENDENT','AUDITOR')),
  centre_id uuid REFERENCES centres(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  centre_id uuid NOT NULL REFERENCES centres(id) ON DELETE CASCADE,
  name text NOT NULL,
  seats int NOT NULL CHECK (seats > 0),
  invigilator_name text NOT NULL
);

CREATE TABLE exams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  subject text NOT NULL,
  starts_at timestamptz NOT NULL,
  duration_min int NOT NULL,
  release_lead_min int NOT NULL DEFAULT 15,
  close_after_min int NOT NULL DEFAULT 30,
  status text NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','GENERATING','READY','SCHEDULED','RELEASED','CLOSED')),
  created_by uuid NOT NULL REFERENCES users(id)
);

CREATE TABLE paper_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id uuid NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  source text NOT NULL,
  parsed jsonb NOT NULL,
  capacity_bits numeric NOT NULL,
  version int NOT NULL
);

CREATE TABLE variation_points (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES paper_templates(id) ON DELETE CASCADE,
  idx int NOT NULL,
  kind text NOT NULL CHECK (kind IN ('PHRASE','OPTIONAL','NUMBER','OPTION_ORDER','QUESTION_ORDER')),
  alternatives jsonb NOT NULL,
  left_ctx text NOT NULL DEFAULT '',
  right_ctx text NOT NULL DEFAULT ''
);

CREATE TABLE copies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id uuid NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  centre_id uuid NOT NULL REFERENCES centres(id),
  room_id uuid NOT NULL REFERENCES rooms(id),
  seat_no int NOT NULL,
  serial int NOT NULL,
  visible_code text NOT NULL,
  choice_vector smallint[] NOT NULL,
  answer_key jsonb,
  storage_key text,
  generated_at timestamptz,
  UNIQUE (exam_id, serial)
);
CREATE INDEX copies_exam_idx ON copies (exam_id);

CREATE TABLE generation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id uuid NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  total int NOT NULL,
  done int NOT NULL DEFAULT 0,
  failed int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'RUNNING',
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE TABLE downloads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id uuid NOT NULL REFERENCES exams(id),
  centre_id uuid REFERENCES centres(id),
  room_id uuid REFERENCES rooms(id),
  user_id uuid REFERENCES users(id),
  ip inet,
  user_agent text,
  allowed boolean NOT NULL,
  reason text NOT NULL CHECK (reason IN ('TOO_EARLY','CLOSED','WRONG_CENTRE','OK')),
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX downloads_exam_at_idx ON downloads (exam_id, at);

CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES users(id),
  action text NOT NULL,
  entity text NOT NULL,
  entity_id text,
  details jsonb NOT NULL DEFAULT '{}',
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_events_at_idx ON audit_events (at);

CREATE FUNCTION audit_events_append_only() RETURNS trigger AS $fn$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only';
END;
$fn$ LANGUAGE plpgsql;
CREATE TRIGGER audit_events_no_change BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_append_only();

CREATE TABLE trace_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id uuid NOT NULL REFERENCES exams(id),
  title text NOT NULL,
  leak_text text NOT NULL,
  evidence_key text,
  evidence_sha256 text,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','IDENTIFIED','INCONCLUSIVE')),
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE trace_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES trace_cases(id) ON DELETE CASCADE,
  copy_id uuid NOT NULL REFERENCES copies(id),
  matches int NOT NULL,
  mismatches int NOT NULL,
  score int NOT NULL,
  false_match_odds numeric,
  rank int NOT NULL
);

CREATE TABLE local_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  queue text NOT NULL,
  body jsonb NOT NULL,
  receive_count int NOT NULL DEFAULT 0,
  visible_at timestamptz NOT NULL DEFAULT now(),
  receipt_handle text
);
CREATE INDEX local_queue_q_idx ON local_queue (queue, visible_at);

CREATE TABLE local_schedules (
  name text PRIMARY KEY,
  fire_at timestamptz NOT NULL,
  payload jsonb NOT NULL,
  fired boolean NOT NULL DEFAULT false
);

CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE worker_heartbeats (
  worker_id text PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now()
);

-- Down Migration
DROP TABLE worker_heartbeats, notifications, local_schedules, local_queue, trace_results,
  trace_cases, audit_events, downloads, generation_jobs, copies, variation_points,
  paper_templates, exams, rooms, users, centres CASCADE;
DROP FUNCTION audit_events_append_only();
