# LeakTrace: deploy notes

Region `ap-south-1`. Deploy bucket `leaktrace-deploy-ccl2026`. Data bucket `leaktrace-data-ccl2026`.

## 1. Which file goes where

All six files are in `release/` after `npm run package`. Upload them to the **deploy bucket**, at the top level (no folder):

| File in `release/` | S3 location | Used by |
|---|---|---|
| `api.tar.gz` | `s3://leaktrace-deploy-ccl2026/api.tar.gz` | the API server (redeploy script, or first boot) |
| `web.tar.gz` | `s3://leaktrace-deploy-ccl2026/web.tar.gz` | the website, served by nginx (new) |
| `worker.tar.gz` | `s3://leaktrace-deploy-ccl2026/worker.tar.gz` | every new worker the Auto Scaling group starts |
| `redeploy-api.sh` | `s3://leaktrace-deploy-ccl2026/redeploy-api.sh` | you run it once on the existing server (section 2) |
| `user-data-api.sh` | not needed on the existing server | paste into the launch settings only if you build a **new** API server |
| `user-data-worker.sh` | already in the worker launch template | unchanged in behaviour; re-paste only if you rebuild the template |

Console: S3 > `leaktrace-deploy-ccl2026` > Upload > add the files > Upload (same name replaces the old one).
CLI (when your Mac has working credentials): `aws s3 cp release/ s3://leaktrace-deploy-ccl2026/ --recursive --region ap-south-1`

## 2. The one command to run on the API server

Connect with Session Manager (EC2 > the API server > Connect > Session Manager), then paste:

```
aws s3 cp s3://leaktrace-deploy-ccl2026/redeploy-api.sh /tmp/redeploy-api.sh --region ap-south-1 && sudo bash /tmp/redeploy-api.sh
```

It downloads and checks `api.tar.gz` and `web.tar.gz`, keeps the old version in `/opt/leaktrace/backups/<time>/`, swaps the new files in, rewrites the service file and nginx settings, runs the database migration, restarts the API, reloads nginx and prints `curl localhost/api/health`. A good run ends with `{"status":"ok"}` and `Deploy finished`.

If anything fails it puts the old version back by itself and tells you why. To look at logs: `sudo journalctl -u leaktrace-api -n 50 --no-pager`.

**Workers.** A worker that is already running keeps the old code. New workers download `worker.tar.gz` when they boot, so to use the new worker set the Auto Scaling group desired capacity to 0 (or terminate the running worker); the next Generate click starts a fresh one.

## 3. Things that must change in AWS

**New Parameter Store parameters: none required.**
Optional: `GENERATION_DLQ_URL` (the URL of the generation dead-letter queue). Without it, "Failed rooms" is counted from the database, which already works. With it, the page also reads the real dead-letter queue.

**IAM, API server role (2 additions, both used only by Delete exam).** If you skip them, delete still works: the exam is removed from the database and screens, and the page says some files could not be removed.
```json
{ "Effect": "Allow", "Action": "s3:DeleteObject",
  "Resource": "arn:aws:s3:::leaktrace-data-ccl2026/*" },
{ "Effect": "Allow", "Action": "scheduler:DeleteSchedule",
  "Resource": "arn:aws:scheduler:ap-south-1:<ACCOUNT_ID>:schedule/leaktrace/*" }
```
Not needed any more: the API role no longer needs `autoscaling:DescribeAutoScalingGroups` (the old way of counting workers). The worker role needs nothing new.

**Optional, only if you use photo evidence in "Find a leak":** the browser uploads the photo straight to the data bucket, so the bucket needs a CORS rule: allowed method `PUT`, allowed header `Content-Type`, allowed origin `http://<your site address>`.

**Security groups: none.** Port 80 to the API server is all that is needed. The API now listens only on `127.0.0.1:3000` inside the server, so a rule for 3000 is not needed.

**Database migrations: one, and it runs by itself** (`1700000000001_deploy-fixes`, run by the redeploy script and again on every API start). It adds `release_at`, `close_at`, `last_error` and `failed_messages`, back-fills `release_at`/`close_at` for exams that were already scheduled, and changes three foreign keys so an exam can be deleted without deleting audit history. It is safe to run twice. The old `migrate.js` could only create the first schema, so this release also brings a proper migration list (`app_migrations` table).

**nginx:** the redeploy script replaces `/etc/nginx/nginx.conf` (the old file is saved in the backup folder). A separate `/etc/nginx/conf.d/leaktrace.conf` you made by hand is no longer read; you can delete it.

## 4. Ten-step live test

1. Open `http://<server address>/` (hard refresh). The sign-in page loads. `http://<server address>/api/health` shows `{"status":"ok"}`.
2. Sign in as `controller@demo`. Exams shows cards with "Step 2 of 5: Generate" and a Delete button. Open the demo exam: a 5-step bar and one green button, "Generate copies".
3. Click Generate copies (this opens the Generate page), then click Generate copies there. The page says "Waiting for a worker to start" and, after you clicked, "No worker running yet. One starts automatically within about 3 to 5 minutes after you click Generate."
4. Wait about 3 to 5 minutes (measured on a cold group: about 4). "Workers online" becomes 1 / 1, "Copies done" climbs to 20 / 20 and the exam becomes Ready. If a red "Last error from the worker" box appears, read it: it is the real error.
5. On the worker (Session Manager): `sudo journalctl -u leaktrace-worker -n 60 --no-pager` shows `MESSAGE_RECEIVED`, `ROOM_RENDERED`, `S3_UPLOAD_DONE`, `ROOM_SAVED`. In S3, `leaktrace-data-ccl2026/papers/<exam id>/` holds 4 PDFs.
6. Schedule release: pick "Release at" about 3 minutes from now and "Close at" 30 minutes later (India time). Wrong times (past, or close before release) give a plain message. After saving, EventBridge Scheduler > group `leaktrace` shows 2 schedules.
7. Sign in as `supt.c1@demo` in another browser window. The big status says "Locked until …". After the release time (within about a minute) it changes to "Download now"; click Download papers and open a PDF.
8. As controller, open "Find a leak", paste three lines from that PDF with one typo, click Find the copy. It names the copy, centre, room, seat and invigilator. "Alerts" shows the leak alert.
9. Sign in as `auditor@demo`. Audit log shows what happened (blocked attempts in red); the auditor has no delete or generate buttons.
10. As controller, delete the exam (type its title). Within about 5 seconds it disappears from the superintendent's screen; the PDFs are gone from S3, the schedules are gone from EventBridge, and the Audit log shows "Exam deleted" with the earlier history still there.

## 5. What changed, in plain English (for the viva)

**Generation on AWS.**
- The worker used to be counted by asking the Auto Scaling service, which needs extra permission and showed 0. Now every worker writes a heartbeat row to the database every 15 seconds and the page counts the rows from the last 60 seconds. No AWS permission needed.
- Errors are no longer hidden. The worker saves the real error text in the database and the Generation page shows it. If putting the job on the queue fails, or creating the schedule fails, you see that message and nothing is left half-done (before, an exam could say "Scheduled" with no real schedule).
- The worker now only needs the settings it uses, and writes a clear log line for every step (message received, room rendered, file uploaded, error with its full message).
- The laptop hint ("npm run dev…") now shows only on a laptop. On AWS it says a worker starts by itself in about 3 to 5 minutes, and only after you clicked Generate.

**Deployment.** The port comes from `PORT` (3000) and nginx owns port 80, so nothing has to be edited by hand on the server. `redeploy-api.sh` does the whole update safely, with a backup and automatic rollback. One more fix: behind nginx every visitor would have looked like the same address, so "5 sign-ins per minute" would have applied to the whole class together; the API now reads the real visitor address from nginx.

**Simpler to use.** One 5-step bar (Template, Generate, Schedule, Released, Closed) with one obvious button on every exam page; plain words and a one-line description on every page; the schedule uses two India-time pickers ("Release at" and "Close at") instead of minute counts; the superintendent sees only their own centre's exams, with one big status ("Locked until…", "Download now" or "Closed"), and closed exams disappear after 24 hours.

**Delete exam.** Controller only, after typing the exam title. It removes the exam, template, copies, trace cases, PDF files and schedules and updates every screen. The audit log is never edited: it gets an "Exam deleted" entry, and the download history stays (unlinked from the deleted exam).

**How it was tested.** 64 automated tests (the AWS adapters and the whole AWS path with the AWS services faked, delete, the worker, the step logic); a full run with a real API, worker and database as every role including a real scheduled release; a browser run through the real screens; the redeploy script in a sandbox including every failure and rollback; the nginx settings in a real nginx; and the packaged files themselves, including upgrading a database created by the old version.

**Later fixes (same release files).** PDF copies no longer spill onto hundreds of pages: the header/footer drawer now restores the text position and font after each page break (a test checks the page count and one footer per page). The superintendent's "Download papers" button turns grey with a not-allowed cursor while locked or closed. nginx sends `Cache-Control: no-cache` for `index.html` (browsers pick up a new deploy at once) and caches the hashed `/assets/` files for a year.

**Not done / honest limits.** Nothing was run against real AWS (credentials were expired), so step 4–7 of the live test are the first real AWS check. "Archive" (hide an exam but keep it) was optional and is not built.
