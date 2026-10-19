# LeakTrace

Exam-paper fingerprinting and leak tracing. Each printed copy of an exam paper gets a unique, meaning-preserving
wording (a secret "fingerprint vector"); pasting leaked text into the Trace Lab names the copy, centre, room, seat
and invigilator. Deterministic code only, no AI/ML. Detailed reference: **docs/CONTEXT.md**. Spec: docs/prompt-app.md.

## Rules (do not break)
- Never put AWS keys, tokens or any secret in code, tests, docs or commits. `.env` is gitignored; only `.env.example` is committed.
- All external services (storage, queue, scheduler, notifier, metrics, config, worker fleet) go through `packages/adapters`.
  App code must not import AWS SDKs or Postgres-backed queue/scheduler code directly, and must not use `instanceof` on local adapters.
- `MAX_COPIES_PER_EXAM` is 20. The API returns 422 when rooms exceed it, and the fingerprint engine also refuses more than 20.
- `FINGERPRINT_KEY` must stay stable: vectors are recomputed from it (spot-the-difference) and trace depends on stored vectors.
- Do not weaken: RBAC on every route, zod validation on every body, parameterised SQL only, append-only `audit_events`.

## Commands
- Setup: `cp .env.example .env && npm install`
- Dev (Postgres, migrate, build packages, api + worker + web): `npm run dev`; seed once with `npm run seed`
- Tests: `npm run db:up && npm run db:test` once, then `npm test` (fingerprint, api, worker; DB tests skip if Postgres is down)
- Build packages: `npm run build:packages` (needed before seed/api/worker). Web: `npm run build --workspace @leaktrace/web`
- Typecheck: `npm run typecheck --workspace @leaktrace/<api|worker|web>`
- Fingerprint demo: `npm run fp:demo`
- Ports: web 5173, API 4000, Postgres 5434 (docker). Demo users `controller@demo`, `supt.c1@demo`, `supt.c2@demo`, `auditor@demo`.

## Architecture map
- `apps/web`: React 18 + Vite + Tailwind + TanStack Query. Calls relative `/api` only (Vite proxies in dev).
- `apps/api`: Express. Routes in `src/routes/`, auth in `src/auth.ts`, config in `src/config.ts`, release/close consumer in `src/events.ts`,
  scheduler poller started in `src/server.ts`. Adapters obtained through `src/adapters.ts` (`getAdapters()`).
- `apps/worker`: long-polls the `generation` queue, renders and merges a room's PDFs, stores them, writes heartbeats.
- `packages/fingerprint`: pure DSL parser, vector generator, renderer, detector. No I/O.
- `packages/pdf`: pdfkit render, pdf-lib merge, answer key, visible code (fonts in `packages/pdf/fonts`).
- `packages/shared`: zod schemas, roles, statuses. `packages/adapters`: interfaces + local impls + `createAdapters(mode)`.
- `db/migrations` (node-pg-migrate SQL), `db/seed/seed.ts`.
- Flow: generate -> queue -> worker -> storage; schedule -> `exam-events` queue -> API consumer sets RELEASED/CLOSED;
  superintendent download = window check + signed URL (120 s) + `downloads` row; trace = fuzzy detection over stored vectors.

## Conventions
- TypeScript everywhere; api/worker run through `tsx` with `--env-file=../../.env`; packages compile to `dist` (rebuild after editing them).
- Keep the surrounding style: single quotes, semicolons, 2-space indent, small route files, SQL inline with `$n` parameters.
- Every state-changing action writes `audit(...)`; denied downloads also write a `downloads` row, a metric and an ops alert.
- Time-window logic goes through `apps/api/src/time.ts` (`now()`, `examWindow()`); exam timezone is `Asia/Kolkata`.
- New external dependency on a service = add a method to an interface in `packages/adapters/src/interfaces.ts` plus a local implementation.
- Tests live in `apps/*/test` and `packages/fingerprint/test`; they use the separate `leaktrace_test` database.

## Known gaps (see docs/CONTEXT.md section 16)
No AWS adapter exists yet (`createAdapters('aws')` throws); `'local'` is hard-coded in `apps/api/src/adapters.ts` and `apps/worker/src/main.ts`.
