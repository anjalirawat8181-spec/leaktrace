# Free-stack deployment

The public demo runs on free tiers only. It uses the same code as the AWS reference deployment; only the adapters behind `packages/adapters` change (`APP_MODE=cloud`).

```
Browser -> Vercel (static web + /api rewrite) -> Render (API + in-process worker) -> Neon (Postgres)
                                                                                  -> Cloudflare R2 (generated PDFs, evidence photos)
GitHub Actions: CI on every pull request, nightly demo reset, daytime keep-warm ping
```

## Services

| Service | What runs there | Why this one |
|---|---|---|
| Vercel (Hobby) | `apps/web` static build; rewrites `/api/*` to Render so the site and API share one origin and the session cookie works | free static hosting with a global CDN |
| Render (Free web service, Singapore) | `apps/api` with `APP_MODE=cloud`; the worker loop runs inside the same process (`WORKER_IN_PROCESS=true`) | the free plan has no background workers, so one process does both |
| Neon (Free) | Postgres: data, the `local_queue` job queue, `local_schedules` release timers, alerts outbox | the existing Postgres-backed queue and scheduler need nothing else |
| Cloudflare R2 (Free tier) | generated PDFs and evidence photos, served by short-lived presigned URLs | S3-compatible API, so the AWS S3 adapter is reused with a different endpoint |
| GitHub Actions | CI, nightly reset, keep-warm | free for public repositories |

## Environment variables

Names only. Values live in `.env.deploy` (gitignored) and in the Render dashboard.

| Variable | Used by | Purpose |
|---|---|---|
| `APP_MODE` | api, worker | `cloud` on Render |
| `WORKER_IN_PROCESS` | api | `true`: the API process also runs the generation worker |
| `DEMO_MODE` | api | `true`: one-click demo logins, rate limits, caps, reset endpoint |
| `DATABASE_URL` | api | Neon pooled connection string (runtime) |
| `DATABASE_DIRECT_URL` | start command | Neon direct connection string (migrations) |
| `JWT_SECRET` | api | signs session cookies |
| `FINGERPRINT_KEY` | api | secret key for fingerprint vectors. Never change it: stored copies are recomputed from it |
| `DEMO_RESET_TOKEN` | api, GitHub | bearer token for `POST /api/admin/reset-demo` |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | api | R2 storage |
| `WEB_ORIGIN` | api | public web address |
| `TRUST_PROXY` | api | `true`, because the API sits behind Vercel and Render proxies |
| `MAX_COPIES_PER_EXAM` | api | 20 |
| `IDLE_AFTER_SEC` | api | seconds without a visitor before the queue and scheduler stop polling the database (default 600) |
| `DB_POOL_MAX` | api | connection pool size (default 5) |
| `DEMO_MAX_EXAMS`, `DEMO_MAX_PAPER_CHARS`, `DEMO_MAX_UPLOAD_BYTES` | api | public demo caps (defaults 12, 8000, 5 MB) |

GitHub repository settings: variable `API_URL`; secrets `DEMO_RESET_TOKEN`, `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`.

## Limits to know about

- **Render sleeps.** A free web service stops after 15 minutes without traffic and takes about a minute to wake. The `keep-warm` workflow pings `/api/health` every 10 minutes between 02:00 and 18:59 UTC (07:30 to 00:29 India time), roughly 17 hours a day. That is about 520 of Render's 750 free instance hours a month. Outside that window the first visitor wakes it.
- **Health does not touch the database** in cloud mode (`/api/health?deep=1` does), so the keep-warm ping does not keep Neon awake.
- **Neon autosuspends** after a few minutes without queries and has a monthly compute-hour allowance. To stay inside it, the in-process queue and scheduler stop polling the database after `IDLE_AFTER_SEC` without a visitor. A scheduled release that comes due while nobody is on the site fires on the next visit.
- **Compute is small.** Render Free is a fraction of a CPU with 512 MB of memory. Generating 20 copies takes longer than on the AWS reference deployment, which is why the demo caps exam count and paper length.
- **Storage is small.** Neon and R2 free tiers are measured in gigabytes. The nightly reset empties the demo data and removes the files from R2.
- **Audit log is append-only.** The reset does not delete audit rows; the audit page shows events since the last reset marker.
- Free-tier allowances change. Check each vendor's pricing page before relying on a number here.

## Redeploy from scratch

Prerequisites: Node 22, a filled-in `.env.deploy` (Neon, R2, Render and Vercel credentials).

```
scripts/deploy-free.sh                 # everything below
scripts/deploy-free.sh database        # migrate and seed Neon
scripts/deploy-free.sh storage         # check R2: access, put, get, presigned URL, privacy
scripts/deploy-free.sh render          # create or update the Render service and wait for /api/health
scripts/deploy-free.sh vercel          # write apps/web/vercel.json, deploy, point Render at the new web origin
scripts/deploy-free.sh reset           # call reset-demo once to seed the demo dataset
```

The script generates `JWT_SECRET`, `FINGERPRINT_KEY`, `DEMO_RESET_TOKEN` and `DEMO_PASSWORD` the first time and appends them to `.env.deploy`. It never prints secret values. It creates the Render service on the Free plan only and stops if Render asks for payment details.

The Render service can also be created from `render.yaml` (New > Blueprint in the Render dashboard); fill in the variables marked `sync: false`.

## Tokens after deployment

The live site does not need the Render API key or the Vercel token to keep running. They are only used by `deploy-free.sh` and by the `deploy-web` workflow (Vercel token). See `docs/aws/TEARDOWN.md` for the list of which values must stay.
