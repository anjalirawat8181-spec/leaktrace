# ROLE AND GOAL
You are GitHub Copilot in agent mode. Build "LeakTrace", a forensic exam-paper
distribution and leak-tracing web app, for a college mini project. In this phase the app
runs entirely on my laptop. A separate, later prompt will connect it to AWS, so:
- Do NOT add the AWS SDK or any AWS code now.
- Put every external service behind the adapter interfaces defined below, with LOCAL
  implementations only.
Work milestone by milestone (listed at the end). After each milestone, stop, summarise what
you built, and list the exact commands to run and what to check.

# STACK
- Frontend: React 18, Vite, TypeScript, Tailwind CSS, React Router, TanStack Query,
  CodeMirror 6.
- Backend: Node.js 20, Express, TypeScript (apps/api) plus a separate worker process
  (apps/worker).
- Database: PostgreSQL 16 in docker-compose; migrations with node-pg-migrate; the pg driver.
- PDFs: pdfkit with a bundled Noto Sans TTF font; pdf-lib to merge PDFs.
- Auth: bcryptjs (pure JavaScript) and jsonwebtoken in an httpOnly, SameSite=Strict cookie.
- Validation: zod. Logging: pino, JSON lines to stdout. Tests: Vitest and supertest.
- npm workspaces monorepo.
- No AI or ML of any kind. Every feature is deterministic code.

# SIZE LIMIT (keeps compute small)
MAX_COPIES_PER_EXAM = 20 (config value, default 20). The API rejects any exam whose rooms add
up to more than 20 seats with HTTP 422 and a clear message. The centres page and the editor
show "x / 20 copies".

# THE CORE IDEA
Every copy of an exam paper is made textually unique through small, meaning-preserving
"variation points" (synonyms, optional commas, number style, MCQ option order, question order
inside a block). Each copy gets a secret combination of choices, its "fingerprint vector".
When a paper leaks, an examiner pastes a few lines of the leaked text into the Trace Lab. The
app detects which alternative appears at each variation point it can see, and matches that
partial pattern against every issued copy to name the exact copy, centre, room, seat and
invigilator.

# ROLES
- CONTROLLER: creates exams, writes papers, manages centres and rooms, generates copies,
  schedules release, runs traces, reads audit logs.
- SUPERINTENDENT: belongs to one centre; downloads only that centre's papers, only inside
  the release window.
- AUDITOR: read-only access to traces and audit logs.

# FINGERPRINT ENGINE (packages/fingerprint: pure TypeScript, no I/O, 100% unit tested)
Template language written by the controller:
- Phrase point: {{Calculate|Compute|Determine}}
- Optional token: {{,|}}   (empty alternative allowed)
- Number style: {{10|ten}}
- MCQ option block, options permuted per copy, letters re-assigned in print order, a
  per-copy answer key stored:
    ::options
    (A) Amazon S3
    (B) Amazon EBS
    (C) Amazon EFS
    (D) Instance store
    ::end
- Question-order block: ::shuffle ... ::end (questions inside may be reordered per copy).
Points get ids P1..Pn in document order. Each point has k >= 2 alternatives (a 4-option
block has k = 24).

Capacity: capacity_bits = sum(log2(k_i)); required = log2(totalCopies) + 12 (about 16.3 bits
for 20 copies). The editor shows a live meter and blocks generation when capacity is too low.

Vectors: for copy serial s of exam e,
  choice_i = uint32(HMAC_SHA256(FINGERPRINT_KEY, `${e}:${s}:${attempt}:${i}`)) mod k_i
All vectors of an exam must be unique with minimum pairwise Hamming distance >= 4; re-roll a
violating vector by incrementing attempt. Store vectors as smallint[] on the copy row.

Rendering: resolve the template with the vector, render with pdfkit. Header: exam title,
date, centre code. Footer: seat number and a 6-hex-char visible code
(SHA-256(serial + key)), which acts as a decoy.

Detection (trace), input = leaked text typed or pasted by the examiner:
1. Normalise both sides: NFKC, lowercase, unify quotes and dashes, collapse whitespace.
2. Per phrase/optional/number point, one probe per alternative: leftContext + alternative +
   rightContext, contexts = fixed template text up to 25 chars, cut at the neighbouring
   point; if a context is shorter than 6 chars, merge the neighbour (probe per combination).
3. Fuzzy-search each probe (Levenshtein similarity >= 0.9 over a sliding window). Exactly one
   alternative matches = observed; none or several = unknown.
4. Option and shuffle blocks: fuzzy-locate each option or question stem and read the order.
5. Score every copy: m = agreeing points, x = disagreeing points, score = m - 3x. Rank.
6. Verdict: IDENTIFIED if top copy has x <= 1, m >= log2(N) + 4, and the runner-up has >= 3
   more mismatches; INSUFFICIENT if fewer than log2(N) + 2 points were observed; otherwise
   POSSIBLE with the top 5 candidates.
7. Coincidence odds: p = product of 1/k_i over observed points; expected false matches =
   (N - 1) * p; show as "1 in X".
8. Return evidence: each detected point, its position in the leak, the alternative seen,
   and whether it agrees with the top copy.

# ADAPTER INTERFACES (packages/adapters) - LOCAL implementations only for now
Define these TypeScript interfaces and a factory createAdapters(mode). mode "local" returns
the local implementations; mode "aws" throws "AWS adapters not implemented yet".
- Storage: put(key, body, contentType), exists(key), signedDownloadUrl(key, ttlSec),
  signedUploadUrl(key, contentType, ttlSec).
  Local: files under ./data. Signed URLs point to /api/local-files/:token, where token is an
  HMAC-signed {key, method, exp}; expired or tampered tokens get 403.
- Queue: send(queue, body), receive(queue, {max, waitSec}) -> [{id, body, receiptHandle,
  receiveCount}], delete(queue, receiptHandle), depth(queue). Queues: "generation",
  "exam-events".
  Local: a Postgres table local_queue with a visibility timeout, using SELECT ... FOR UPDATE
  SKIP LOCKED; after 3 receives a message moves to "generation-dlq".
- Scheduler: scheduleOnce(name, atLocalISO, timezone, payload) delivers payload to the
  "exam-events" queue at that time; cancel(name).
  Local: table local_schedules plus a 10-second poller in the API.
- Notifier: publish(topic "leak-alerts" | "ops-alerts" | "release-notices", subject, body).
  Local: insert into a notifications table and log it; an Outbox page shows them.
- Metrics: count(name, value = 1). Names: DownloadsOutsideWindow, CopiesGenerated,
  TraceRuns, LeaksIdentified. Local: log line + in-memory counters.
- Config: get(key), with a required-keys list checked at startup. Local: .env via dotenv.
- WorkerFleet: status() -> {desired, inService}. Local: the worker writes a heartbeat row
  every 10 s; inService = heartbeats in the last 30 s.

# DATABASE (PostgreSQL, node-pg-migrate)
users(id uuid pk, email unique, password_hash, name, role CONTROLLER|SUPERINTENDENT|AUDITOR,
      centre_id fk null, created_at)
centres(id, code unique, name, city)
rooms(id, centre_id fk, name, seats int, invigilator_name)
exams(id, title, subject, starts_at timestamptz, duration_min, release_lead_min default 15,
      close_after_min default 30,
      status DRAFT|GENERATING|READY|SCHEDULED|RELEASED|CLOSED, created_by)
paper_templates(id, exam_id fk, source text, parsed jsonb, capacity_bits numeric, version)
variation_points(id, template_id fk, idx, kind PHRASE|OPTIONAL|NUMBER|OPTION_ORDER|
      QUESTION_ORDER, alternatives jsonb, left_ctx, right_ctx)
copies(id, exam_id fk, centre_id fk, room_id fk, seat_no, serial, visible_code,
      choice_vector smallint[], answer_key jsonb, storage_key, generated_at,
      unique(exam_id, serial))
generation_jobs(id, exam_id, total, done, failed, status, started_at, finished_at)
downloads(id, exam_id, centre_id, room_id, user_id, ip inet, user_agent, allowed boolean,
      reason TOO_EARLY|CLOSED|WRONG_CENTRE|OK, at timestamptz)
audit_events(id, actor_user_id, action, entity, entity_id, details jsonb, at)  -- append-only
trace_cases(id, exam_id, title, leak_text, evidence_key, evidence_sha256,
      status OPEN|IDENTIFIED|INCONCLUSIVE, created_by, created_at)
trace_results(id, case_id, copy_id, matches, mismatches, score, false_match_odds, rank)
Local-adapter tables: local_queue, local_schedules, notifications, worker_heartbeats.
Indexes: copies(exam_id), downloads(exam_id, at), audit_events(at).

# API (Express, prefix /api, zod on every body)
Auth:    POST /auth/login, POST /auth/logout, GET /auth/me
Centres: CRUD /centres and /centres/:id/rooms                       (CONTROLLER)
Exams:   POST /exams, GET /exams, GET /exams/:id
         PUT  /exams/:id/template        parse DSL, return points + capacity
         GET  /exams/:id/spot-the-difference   two random copies' text + diff ranges
         POST /exams/:id/generate        create up to 20 copy rows, enqueue one job per room
         POST /exams/:id/rerender        re-enqueue the same room jobs; identical PDFs
                                         (vectors are stored), used to demo the worker
         GET  /exams/:id/generation      done/total, queue depth, workers online
         POST /exams/:id/schedule        create the release and close schedules
         GET  /exams/:id/demo-set        zip of 5 random copies for printing
Centre:  GET  /centre/exams              my exams, window state, server time
         POST /centre/exams/:id/download 200 {rooms:[{room, url, expiresAt}]} or 403 {reason}
Trace:   POST /trace/cases, POST /trace/cases/:id/evidence-url, POST /trace/cases/:id/run,
         GET /trace/cases/:id
Audit:   GET /audit?examId=&type=
Outbox:  GET /notifications
Health:  GET /health (DB ping)
Local:   GET and PUT /local-files/:token (registered only in local mode)

# BEHAVIOUR
Worker (apps/worker): loop on Queue.receive("generation", {max: 10, waitSec: 20}). Message
{examId, roomId, copyIds}. Render each copy, merge the room's copies in seat order with
pdf-lib, Storage.put("papers/<examId>/<centreCode>/<roomName>.pdf"), update rows, increment
generation_jobs.done atomically, then delete the message. Idempotent unless the job is a
rerender. On error, don't delete (the queue retries, then dead-letters). On SIGTERM, stop
polling, finish the current message, exit.

Release and close: POST /exams/:id/schedule calls Scheduler.scheduleOnce twice:
"leaktrace-release-<examId>" at starts_at - release_lead_min and "leaktrace-close-<examId>"
at starts_at + close_after_min, timezone Asia/Kolkata, payload {type, examId}. The API runs a
consumer loop on the "exam-events" queue: RELEASE sets status RELEASED and publishes to
release-notices; CLOSE sets CLOSED.

Download rule: allowed only if role is SUPERINTENDENT, the centre matches, the exam is
RELEASED, and now is inside [starts_at - lead, starts_at + close_after] (checked again
against the DB and clock). Then return Storage.signedDownloadUrl per room, ttl 120 s, and
log a downloads row (allowed = true). Otherwise 403, a downloads row with allowed = false and
the reason, a log line {"event":"OUTSIDE_WINDOW_DOWNLOAD", ...},
Metrics.count("DownloadsOutsideWindow"), and Notifier.publish("ops-alerts", ...).

Leak alert: when a trace is IDENTIFIED, Notifier.publish("leak-alerts") with subject
"LEAK TRACED: <exam title>" and body: copy serial, centre, room, seat, invigilator, who
downloaded that room's bundle and when, and the coincidence odds.

# SECURITY
helmet; express-rate-limit on login (5 per minute per IP); bcryptjs cost 12; RBAC
middleware; parameterised SQL only; evidence uploads hashed with SHA-256 in the browser and
re-checked on the server; Express trust proxy setting configurable; the client IP is the
first X-Forwarded-For address when trust proxy is on.

# FRONTEND
A dark "forensics lab" look: near-black background, monospace accents, amber for warnings,
red for leaks. Pages:
1. Login.
2. Controller dashboard: exam cards with a status track and a countdown to release.
3. Paper editor: CodeMirror DSL editor with {{ }} points highlighted, live preview,
   capacity meter, "x / 20 copies", and a "Spot the difference" button showing two copies
   side by side with the changed words highlighted.
4. Centres and rooms, with seat counts adding up to the copy total (max 20).
5. Generation monitor: progress bar, queue depth, "Workers online" (from WorkerFleet),
   polling every 2 s; Generate and Re-render buttons.
6. Schedule: release lead and close time; shows both schedule names and times.
7. Centre portal: big countdown "Paper unlocks in 00:14:32", download button disabled until
   the window opens, banner "Every download is recorded".
8. Trace Lab: paste leaked text, optional photo upload; "Run trace" animates each variation
   point lighting up, then a verdict card (copy, centre, room, seat, invigilator, downloaded
   by and at, "chance of coincidence: 1 in X") above the leak text with every detected point
   highlighted.
9. Audit log: filterable table; denied attempts as red rows.
10. Outbox: every notification the app has published.

# REPO STRUCTURE
leaktrace/
  apps/web, apps/api, apps/worker
  packages/fingerprint, packages/shared (types, zod schemas), packages/adapters
  db/migrations, db/seed
  docs/PROMPT-APP.md
  docker-compose.yml (Postgres only), .env.example (never commit .env)

# SEED (npm run seed)
Exam "Cloud Computing Unit Test 1": 8 questions, 2 MCQ option blocks, 1 shuffle block, at
least 12 phrase points. 2 centres x 2 rooms x 5 seats = 20 copies. Users: controller@demo,
supt.c1@demo, supt.c2@demo, auditor@demo (password from .env).

# SCRIPTS
npm run dev (starts Postgres, runs migrations, then api + worker + web together),
npm run seed, npm test, npm run fp:demo (prints two variants and traces a pasted excerpt).

# TESTS
- Parser round-trips the seed paper.
- 20-copy exam: all vectors unique, minimum pairwise distance >= 4.
- Detection names the right copy from a random 3-question excerpt with 2 injected typos in
  >= 99% of 500 trials; a 1-line excerpt returns INSUFFICIENT.
- Creating rooms that total 21 seats returns 422.
- Download before the window: 403, a downloads row with allowed = false, metric counted.
- Expired local signed URL returns 403.

# MILESTONES
M1 packages/fingerprint + tests + fp:demo CLI.
M2 Database, auth, centres and exams CRUD, paper editor.
M3 Adapters (local) and PDF generation through the queue and worker.
M4 Centre portal, schedules, time window, audit log, Outbox.
M5 Trace Lab.
M6 Polish, seed data, README with screenshots.