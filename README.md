# LeakTrace

LeakTrace is forensic exam-paper distribution and leak tracing. Every printed copy of an exam paper is made
textually unique through small, meaning-preserving variations (synonyms, optional commas, number style, MCQ option
order, question order inside a block). Each copy carries a secret combination of choices, its *fingerprint vector*.
When a paper leaks, an examiner pastes a few lines of the leaked text into the **Trace Lab**, and LeakTrace names the
exact copy, centre, room, seat and invigilator. There is no AI or ML anywhere: every feature is deterministic code.

![LeakTrace AWS architecture](docs/architecture/leaktrace-aws-architecture.png)

Full write-up: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Interactive explorer:
[docs/architecture/index.html](docs/architecture/index.html) (open it in a browser, or use the GitHub Pages link if enabled).

## Features by role

**Controller**
- Writes the paper in a small template language and previews the variants.
- Generates one unique PDF copy per seat; rooms are rendered in the background by a worker.
- Schedules release and close times (India time) and follows a 5-step progress bar per exam.
- Uses **Find a leak**: pastes leaked lines (optionally with photo evidence) and gets the copy, centre, room, seat and invigilator.
- Manages centres and deletes an exam (audit history is kept).

**Superintendent** (one per centre)
- Sees only their own centre's exams with one big status: *Locked until...*, *Download now* or *Closed*.
- Downloads the papers only inside the release window, through a short-lived signed link.

**Auditor** (read only)
- Browses the append-only audit log, downloads (including blocked attempts), alerts and the notification outbox.

## Repo layout

```
apps/web         React 18 + Vite + Tailwind front end
apps/api         Express API (auth, RBAC, schedule consumer)
apps/worker      Background worker: renders and stores each room's PDFs
packages/fingerprint   Template parser, vector generator, renderer, leak detector (pure code)
packages/pdf           pdfkit rendering, pdf-lib merge, answer key
packages/shared        zod schemas, roles, statuses
packages/adapters      Storage, queue, scheduler, notifier, metrics, config, fleet: local and AWS implementations
db/                    SQL migrations and seed data
infra/                 EC2 user-data and redeploy scripts
scripts/               Packaging, local end-to-end run, screenshots
docs/                  Architecture diagram, write-up and interactive explorer
```

## Run locally

Prerequisites: Node 20+, Docker Desktop (for PostgreSQL).

```bash
git clone https://github.com/<you>/leaktrace.git && cd leaktrace
cp .env.example .env     # change JWT_SECRET, FINGERPRINT_KEY and DEMO_PASSWORD; .env is never committed
npm install
npm run db:up            # PostgreSQL in Docker (port 5434)
npm run migrate
npm run build:packages
npm run seed             # demo centres, users and a sample exam
npm run dev              # API :4000, worker, web http://localhost:5173
```

Demo users (password is `DEMO_PASSWORD` from your `.env`): `controller@demo`, `supt.c1@demo`, `supt.c2@demo`, `auditor@demo`.

Other commands: `npm test` (run `npm run db:test` once first; DB tests skip if Postgres is down),
`npm run e2e` (full walkthrough as every role, needs Docker), `npm run fp:demo` (fingerprint demo).
Keep `FINGERPRINT_KEY` stable once you have generated copies: vectors are recomputed from it.

## Deploy to AWS

`APP_MODE=aws` swaps the local adapters for S3, SQS, SNS, EventBridge Scheduler and SSM Parameter Store
(`/leaktrace/prod`). The API listens on `127.0.0.1:3000` and nginx on port 80 serves the web build and proxies `/api/`.

1. `npm run package` builds `release/api.tar.gz`, `release/worker.tar.gz`, `release/web.tar.gz` and copies the `infra/` scripts.
2. Upload those files to your deploy bucket.
3. New server: paste `infra/user-data-api.sh` as user data. Existing server: run `infra/redeploy-api.sh` (it backs up and rolls back on failure). Workers boot from `infra/user-data-worker.sh`.

Step-by-step instructions, the IAM additions and a live test checklist are in [DEPLOY-NOTES.md](DEPLOY-NOTES.md).
Never put AWS keys in code; the servers use IAM roles and Parameter Store.

## Tech stack

TypeScript, React 18, Vite, Tailwind CSS, TanStack Query, Express, PostgreSQL, pdfkit, pdf-lib, zod, vitest;
AWS S3, SQS, SNS, EventBridge Scheduler, SSM Parameter Store, EC2 Auto Scaling, nginx.

## Limitations

- A single API instance (the schedule consumer and nginx run on it).
- CloudFront is pending account verification, so the site is served directly from EC2.
- HTTP only for now; put it behind HTTPS before real use.
- Not run against real exams: treat it as a college project and a reference design.

## License

[MIT](LICENSE)
