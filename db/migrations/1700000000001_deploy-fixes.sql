-- Up Migration
ALTER TABLE exams ADD COLUMN IF NOT EXISTS release_at timestamptz;
ALTER TABLE exams ADD COLUMN IF NOT EXISTS close_at timestamptz;
UPDATE exams
   SET release_at = starts_at - make_interval(mins => release_lead_min),
       close_at = starts_at + make_interval(mins => close_after_min)
 WHERE release_at IS NULL AND status IN ('SCHEDULED','RELEASED','CLOSED');

ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS last_error text;
ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS failed_messages int NOT NULL DEFAULT 0;

ALTER TABLE downloads ALTER COLUMN exam_id DROP NOT NULL;
ALTER TABLE downloads DROP CONSTRAINT IF EXISTS downloads_exam_id_fkey;
ALTER TABLE downloads ADD CONSTRAINT downloads_exam_id_fkey
  FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE SET NULL;

ALTER TABLE trace_cases DROP CONSTRAINT IF EXISTS trace_cases_exam_id_fkey;
ALTER TABLE trace_cases ADD CONSTRAINT trace_cases_exam_id_fkey
  FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE;

ALTER TABLE trace_results DROP CONSTRAINT IF EXISTS trace_results_copy_id_fkey;
ALTER TABLE trace_results ADD CONSTRAINT trace_results_copy_id_fkey
  FOREIGN KEY (copy_id) REFERENCES copies(id) ON DELETE CASCADE;

-- Down Migration
ALTER TABLE trace_results DROP CONSTRAINT IF EXISTS trace_results_copy_id_fkey;
ALTER TABLE trace_results ADD CONSTRAINT trace_results_copy_id_fkey FOREIGN KEY (copy_id) REFERENCES copies(id);
ALTER TABLE trace_cases DROP CONSTRAINT IF EXISTS trace_cases_exam_id_fkey;
ALTER TABLE trace_cases ADD CONSTRAINT trace_cases_exam_id_fkey FOREIGN KEY (exam_id) REFERENCES exams(id);
ALTER TABLE downloads DROP CONSTRAINT IF EXISTS downloads_exam_id_fkey;
DELETE FROM downloads WHERE exam_id IS NULL;
ALTER TABLE downloads ALTER COLUMN exam_id SET NOT NULL;
ALTER TABLE downloads ADD CONSTRAINT downloads_exam_id_fkey FOREIGN KEY (exam_id) REFERENCES exams(id);
ALTER TABLE generation_jobs DROP COLUMN IF EXISTS failed_messages;
ALTER TABLE generation_jobs DROP COLUMN IF EXISTS last_error;
ALTER TABLE exams DROP COLUMN IF EXISTS close_at;
ALTER TABLE exams DROP COLUMN IF EXISTS release_at;
