# LeakTrace: project showcase

A detailed, fact-checked brief of our project. We (Anjali Rawat and Pranav) keep it in our LinkedIn project folders and hand it to a writing assistant when we draft posts. Every number below comes from the code, the git history, a command we ran, or a read of our own deployment; the commands are shown. Anything we could not source from our own work is marked **verify before posting**.

## 1. The one-liner and the pitch

**One-liner.** LeakTrace prints every exam paper slightly differently, so when a paper leaks, a few pasted lines name the exact copy, centre, room, seat and invigilator.

**Pitch, in three sentences.** Every printed copy of an exam paper is made unique through small, meaning-preserving changes in wording, and each copy carries a secret fingerprint. When a paper leaks, the Trace Lab compares the leaked text with every copy, tolerating typos, and names the copy and the people responsible for that seat and that room. We built it as a full-stack system, ran it on AWS with auto-scaling workers, and then moved it to a free stack for a public demo in a day, because the app only ever talks to small interfaces for its outside services.

Tagline we used in the first share: *"Every copy is worded differently, so a few leaked lines name the exact copy, centre, room, seat and invigilator. No AI, just deterministic code."*

## 2. The problem and why it matters

Exam papers leak. The usual answer is prevention: sealed packets, tighter handling and, when that fails, cancelling and re-running the exam. Prevention has a weak last mile. After a paper is printed and opened at many centres, anyone with a phone can photograph it, and every copy is identical, so a leaked photo does not say where it came from. Cancelling an exam punishes every candidate for one person's leak.

Our angle is accountability after prevention fails: if each copy is different, a leak points back to a single copy and a single seat, which narrows an investigation from "anyone at any centre" to "this room, this invigilator, this download".

We do not quote leak statistics in this project. If a post wants one (how many exams were affected, how many candidates), find a published source and mark it **verify before posting**.

## 3. How it works, role by role

**Controller (the exam body)**
1. Signs in and creates an exam with a start time and length.
2. Writes the paper in a small template language. A phrase that can vary is written `{{this wording|that wording}}`. A live meter shows how many unique copies the template can support and warns if it cannot support 20.
3. Uses *spot the difference* to see two copies side by side.
4. Clicks *Generate copies*. One job per room goes on a queue, a worker renders and merges each room's PDFs and stores them. The page shows "Copies done" climbing to the total.
5. Schedules the release and close times in India time. The system sets two timers.
6. After a leak, opens *Find a leak*, pastes some lines (optionally attaches a photo as evidence) and reads the verdict: copy, centre, room, seat, invigilator, who downloaded that room's papers, and the chance the match is a coincidence.

**Superintendent (one per centre)**
1. Signs in and sees only their own centre's exams.
2. Sees "Locked until…" before the release time. The button unlocks by itself at the release time.
3. Downloads the room bundles through a signed link that works for 120 seconds. Every attempt, allowed or blocked, is recorded.

**Auditor**
1. Signs in read only and browses the append-only audit log: every sign-in, release, download, blocked download and trace.

## 4. The fingerprint, in plain words

Think of the paper as a form with blanks that each have two or three acceptable fillings. A copy is one way of filling every blank. The list of fillings chosen for a copy is its fingerprint vector. The demo paper has 67 such blanks, enough for 72.2 bits of variety, and 20 copies need 16.3 bits, so there is plenty of room, and the generator keeps every pair of copies at least 4 choices apart.

Real output for the first sentence of question 1:

| Copy | Choices at the first six blanks | The sentence |
|---|---|---|
| #1 | `[1,0,0,0,0,0]` | *Determine the total storage required for every virtual machine. Present your result clearly and include the units…* |
| #2 | `[0,0,1,1,0,0]` | *Calculate the total storage required for every virtual machine. Show your result clearly and state the units…* |
| #3 | `[1,1,0,1,0,1]` | *Determine the total storage required for each virtual machine. Present your result clearly and state the units…* |

To trace, we read the leaked text, find which filling appears at every blank we can read, and score each copy against that. A blank garbled by a typo is not counted, so typos cost evidence but do not mislead.

**Worked trace.** We took the first two questions of copy #2 and introduced a typo (`storage` → `storge`). The tracer read 16 blanks, copy #2 matched all 16 with no mismatch, the runner-up matched 11 and disagreed at 5, the verdict was *identified*, and the chance of a coincidence was 1 in 3,449. The tracer names a copy only when the excerpt has more than one line, enough blanks were read, the best copy disagrees at no more than one, and the runner-up disagrees at three or more points beyond that.

## 5. Two architectures

### AWS reference deployment (ap-south-1)

The deployment as it was built in `ap-south-1`; it can be redeployed from the Terraform, and the live demo does not depend on it.

- A `t3.micro` API server runs nginx and Express.
- **Auto-scaling workers from zero.** Clicking Generate puts one message per room on **SQS**. A **CloudWatch** alarm on queue depth sets an **Auto Scaling** group from 0 to 1 `t3.micro` worker, which renders the PDFs and uploads them to **S3**. Five minutes of an empty queue scales it back to 0. The group is capped at 1.
- **Release windows with EventBridge Scheduler.** Each exam gets two one-time schedules in India time that drop a message on an events queue; the API consumes it and marks the exam released or closed.
- **Short-lived signed S3 links** (120 seconds) for downloads; every download checks the window first.
- **SSM Parameter Store** holds all configuration (16 parameters, secrets as `SecureString`); **SNS** sends leak, ops and release alerts by email; **RDS PostgreSQL** holds the data. Roles are least privilege and there are no keys in code.
- It is described in `docs/aws/architecture-as-deployed.md` and rebuilt by the Terraform in `infra/terraform/aws`. A read-only plan against the live account gave 75 resources to import, 0 to add and 0 to destroy.

### The free stack, and why we moved

We moved to a free stack for **cost**. The AWS deployment costs about $0.75 a day (about ₹66) just to sit there, almost all of it the database and the server, and it was not worth paying for after the demo. We wanted a public link anyone could try without us paying for it.

The free stack is Vercel for the web app, Render's free web service for the API and worker, Neon for Postgres and Cloudflare R2 for files, with GitHub Actions for CI and the nightly reset.

**Why it took small changes: the adapter pattern.** The app never talks to S3, SQS or SSM directly. It talks to seven small interfaces (`Storage`, `Queue`, `Scheduler`, `Notifier`, `Metrics`, `Config`, `WorkerFleet`), and `APP_MODE` picks the implementations. Local mode already kept the queue and the release timers in Postgres, and R2 speaks the S3 API, so a third mode needed only: an optional endpoint on the S3 adapter, a bootstrap that wires the existing pieces, and the worker loop pulled into a function the API can run. That change touched 14 source and test files, about 410 lines added and 49 removed, a third of it tests.

| AWS | Free stack | Why |
|---|---|---|
| EC2 + nginx | Vercel + Render | free static hosting and one free web service |
| EC2 Auto Scaling worker | worker inside the API process | Render's free plan has no background workers |
| RDS PostgreSQL | Neon | free serverless Postgres |
| S3 | Cloudflare R2 | S3-compatible: same adapter, other endpoint |
| SQS | Postgres table | the local-mode queue already existed |
| EventBridge Scheduler | Postgres table and a poller | same |
| SNS | alerts outbox table | no email service in the free stack |
| SSM Parameter Store | environment variables | simplest for one service |
| CloudWatch alarms | not needed | nothing scales |

## 6. Tech stack, and why

| Choice | Why |
|---|---|
| TypeScript across web, API, worker and packages | one language and shared types between the template parser, the API and the web app |
| React 18, Vite, Tailwind, TanStack Query | fast iteration, accessible components, server state handled by the query library |
| Express with zod validation and parameterised SQL | small, explicit, easy to audit for the security rules |
| PostgreSQL | strong constraints, a trigger makes the audit log append-only, and it doubled as the queue and scheduler in the free stack |
| pdfkit and pdf-lib | pure-JavaScript PDF rendering and merging, so the same code runs on a worker and on a free web service |
| A pure `packages/fingerprint` | the core idea has no I/O, so it is easy to test and to explain |
| Vitest, supertest, a local end-to-end script | the end-to-end run walks every role against real processes |
| AWS, then Vercel, Render, Neon and R2 | the first to learn and show cloud-scale design; the second to make the demo free |
| Terraform | a reproducible record of the AWS stack, checked read-only against the live account |
| GitHub Actions | free for public repositories: CI, nightly reset, keep-warm |

## 7. Engineering challenges: symptom, cause, fix, lesson

1. **"Workers online" always showed 0 on AWS.** *Cause:* we counted workers by asking Auto Scaling, which needed an extra permission. *Fix:* every worker writes a heartbeat row to the database every 15 seconds and the page counts rows from the last 60 seconds, with no AWS call. *Lesson:* derive status from data you already own.
2. **An exam said "Scheduled" with no schedule behind it.** *Cause:* a failed schedule call was swallowed. *Fix:* creating both timers is now all-or-nothing and the error text is shown. Failed generation jobs also keep their real error text in the database and show it on the page. *Lesson:* never show success for something that did not happen.
3. **Every visitor looked like the same address behind nginx.** *Cause:* the app saw nginx's address, so a limit of five sign-ins per minute would have applied to a whole class together. *Fix:* trust the proxy and read the real client address. *Lesson:* it came back on the free stack (item 9).
4. **PDF copies spilled onto hundreds of pages.** *Cause:* the header and footer drawer did not restore the text position and font after each page break. *Fix:* restore them, and a test checks the page count and one footer per page.
5. **Deleting an exam versus an append-only audit log.** *Cause:* foreign keys from downloads blocked deletes. *Fix:* a migration changes the foreign keys so an exam deletes with its template, copies and trace cases, while the download history is kept unlinked and the audit log gets an "Exam deleted" entry. *Lesson:* design the audit trail and the delete flow together.
6. **Render's free plan has no background workers.** *Fix:* the worker loop moved into a function and the API process runs it (`WORKER_IN_PROCESS=true`). Twenty copies take 28 seconds from the click, against about four minutes on AWS to even get a worker.
7. **A Postgres-backed queue keeps a serverless database awake.** *Cause:* polling every half second means Neon never suspends and burns its monthly compute allowance. *Fix:* an idle gate stops polling after ten minutes with no visitor, and the free-stack health check does not touch the database. *Trade-off:* a scheduled release that comes due while the site is idle fires on the next visit. We designed this from the limits; we did not measure Neon's hours.
8. **Rate limits that could be bypassed.** *Symptom:* the Render logs showed `ERR_ERL_PERMISSIVE_TRUST_PROXY` and "limiter created in a request handler". *Cause:* `TRUST_PROXY=true` lets anyone send their own `X-Forwarded-For`, and we had created the limiters inside the request. *Fix:* create limiters at start-up and trust a hop count. A test written for the fix failed because of a regex typo of ours (a missing backslash made `"2"` a string), which is exactly why we test it. We then measured the real hop count through the public site: 2 recorded a Cloudflare address, 4 recorded the visitor. A caller that skips Vercel and hits the Render address directly can still spoof, because nothing authenticates that hop, so each action also has a global cap. *Lesson:* measure the proxy chain you really have.
9. **R2 keys can read and write objects but cannot change bucket settings.** The evidence-photo upload needs a CORS rule. We wrote the check script, the key failed with Access Denied on the settings call, and Pranav added the rule in the Cloudflare dashboard; we then proved the browser upload works. *Lesson:* test the permission you need, not the one you assume.
10. **Reading the AWS account while writing the Terraform exposed things we had not seen.** The database has deletion protection on, the data bucket has no CORS rule (so browser photo uploads would not work on AWS), the API security group's description says "CloudFront only" but allows `0.0.0.0/0`, and queues use a 1 MiB message size that the Terraform provider does not yet accept as a value. We matched the live setup, noted the gaps, and wrote the teardown order around the protection.
11. **Our own estimate of the cold start was wrong.** The deploy notes said 1 to 4 minutes. In two recorded runs, the worker was online about 245 seconds after the click: the SQS metric reaches CloudWatch, the one-minute alarm evaluates, and only then does the group launch an instance. Once the alarm fired, the PDFs were in S3 about 75 seconds later. The Auto Scaling activity log says the launch finished five minutes after it began, which is its own bookkeeping, not the worker's work time. We changed the messages to "3 to 5 minutes".
12. **Our video captions described features, not what was on screen.** On AWS the audit log had no red blocked rows, and the alerts page is empty because AWS alerts go by email through SNS. We re-cut the video with captions that match.
13. **A flaky test.** The leak-detection test runs 500 trials and takes 5 to 6 seconds, at the default 5-second limit, so it failed at random. A 30-second limit fixed it. Separately, vitest sometimes crashed at start-up in Git Bash on Windows (a tooling quirk we did not fix): setting `pool: forks` did not help, running from PowerShell did.

## 8. Measured numbers

Counted on `master` on 2026-11-11. Lines are tracked source and config files, blank lines and comments included.

| Part | Lines | of which tests |
|---|---|---|
| `packages/fingerprint` | 1,181 | 219 |
| `packages/pdf` | 146 | 38 |
| `packages/shared` | 47 | 0 |
| `packages/adapters` | 1,207 | 322 |
| `apps/api` | 2,389 | 372 |
| `apps/worker` | 1,248 | 981 |
| `apps/web` | 2,626 | 30 |
| `db` (migrations, seed) | 310 | 0 |
| `scripts`, `infra` (incl. Terraform), `demo`, `tools`, `.github` | 3,533 | 0 |

```
for d in packages/fingerprint packages/pdf ...; do git ls-files $d | grep -E '\.(ts|tsx|mjs|cjs|js|sql|sh|py|tf|yml|css|html)$' | xargs cat | wc -l; done
```

- **Tests:** 87 automated tests (fingerprint 9, pdf 3, adapters 23, web 3, API 20, worker 29), plus a local end-to-end walkthrough of every role that CI runs. `npm test` and `npm run e2e`.
- **Commits and time:** 39 commits on `master` by the two of us, from 2026-10-18 to 2026-11-11 (`git log`).
- **Copies generated:** on AWS, 9 exams with generated papers, 36 room bundles (`aws s3api list-objects-v2 --prefix papers/`), five seats per room, so about 180 copies. On the free stack, 20 copies per exam, and each demo reset or walkthrough creates a new set.
- **Worker cold start.** AWS: about 245 seconds from the click to a worker being online, about 75 seconds from the scale-out alarm to the last PDF in S3 (`describe-scaling-activities`, S3 object timestamps). Free stack: 28 seconds from the click to 20 ready copies, no cold start (a Playwright walkthrough).
- **Trace accuracy on the demo paper.** 20 copies, 67 variation points, a leak made of the first *n* questions of one copy with one typo in each, three typo variants per copy, 60 trials per row, 480 in total:

| Questions pasted | Points read (average) | Right copy named | Wrong copy named |
|---|---|---|---|
| 1 | 8 | 0 / 60 (a single line is never enough) | 0 |
| 2 | 16 | 60 / 60 | 0 |
| 3 to 8 | 24 to 65 | 60 / 60 per row | 0 |

  This is clean text, not photos or OCR. The live site gave the same result on a PDF downloaded as a superintendent: six questions with one typo named copy #1, C1, C1-Room 1, seat 1, A. Sharma, with a chance of coincidence of 1 in 220,753.
- **Cost.** AWS: about $0.75 a day while it runs (Cost Explorer usage by type for 8 to 10 November, `ap-south-1`: server $0.19, database $0.37 plus $0.06 storage, public IPv4 $0.09, volume $0.03). Gross usage from 20 October to 11 November in `ap-south-1` was $21.80, all covered by credits, an upper bound for LeakTrace because the resources carry no cost tag. Free stack: ₹0, all free tiers.

```
aws ce get-cost-and-usage --time-period Start=2026-11-08,End=2026-11-11 --granularity MONTHLY \
  --metrics UnblendedCost --filter '{"And":[{"Dimensions":{"Key":"RECORD_TYPE","Values":["Usage"]}},{"Dimensions":{"Key":"REGION","Values":["ap-south-1"]}}]}' \
  --group-by Type=DIMENSION,Key=USAGE_TYPE
```

## 9. Skills this shows

Designing a forensic feature end to end (template language, vector generation with a minimum distance, fuzzy detection with explicit identification rules), full-stack TypeScript, role-based access control, an append-only audit log, a queue and scheduler design that survives two very different hosts, cloud architecture on AWS (auto-scaling from zero, signed links, least-privilege IAM, infrastructure as code), cost-driven migration, working inside free-tier limits, testing at several levels, measuring instead of guessing, and writing the ops documentation (teardown, evidence, field map) that lets someone else operate it.

## 10. Limitations and roadmap, honestly

**Limitations.** It has not been used on real exams. The fingerprint is in the wording, so retyping, paraphrasing or comparing several copies can remove it. Accuracy was measured on clean text, not photos or OCR. At most 20 copies per exam. The free stack sleeps when idle and has monthly allowances. The AWS deployment served plain HTTP from one server and had no CloudFront. We did not measure Neon's compute hours.

**Roadmap.** HTTPS and a CDN in front of AWS; trace from a photo by reading the text first and measuring accuracy on real photos; harder-to-normalise variations; more than 20 copies; several institutions in one installation.

## 11. Links

- **Live demo:** https://leaktrace-five.vercel.app (one click per role; may take about a minute to wake; data resets nightly)
- **Repository:** https://github.com/anjalirawat8181-spec/leaktrace
- **Anjali:** https://github.com/anjalirawat8181-spec · **Pranav:** https://github.com/08pranav
- **Preview GIF (committed):** `demo/demo-preview.gif`
- **Videos (kept on Anjali's laptop in `demo/`, not committed):** `leaktrace-demo.mp4` (3:10, the AWS run), `leaktrace-demo-square.mp4` (1080×1080), `leaktrace-demo-short.mp4` (34 s), `leaktrace-live-free.mp4` (40 s, the free-stack site)
- **Chapters of the full video:** `demo/chapters.txt`

Screenshots, with suggested captions (all in `docs/screenshots/live/` unless noted):

| File | Caption |
|---|---|
| `01-login.png` | One click signs you in as a controller, a superintendent or an auditor. |
| `03-paper-editor.png` | The paper is a template: every `{{a|b}}` is a place where copies differ. |
| `04-spot-the-difference.png` | Two copies of the same question, side by side. |
| `06-generation-done.png` | Twenty unique PDFs in 28 seconds on a free server. |
| `09b-superintendent-unlocked.png` | The button unlocks at the release time, by itself. |
| `12-trace-verdict.png` | A few leaked lines, one typo, and the verdict names the copy, centre, room, seat and invigilator. |
| `14-audit-log.png` | Every sign-in, release and download is recorded, and the log cannot be edited. |
| `../aws/08-trace-verdict.png` | The same verdict on the AWS deployment. |

## 12. LinkedIn material

### Five hooks

1. Every copy of our exam paper is different. When one leaks, a few pasted lines name the seat.
2. We ran a project on AWS, then moved it to a free stack in a day. The reason it was easy fits in one sentence.
3. The most useful bug we found this month was in our own estimate: the worker took four minutes, not one.
4. A leaked paper photo says nothing about where it came from. Unless every copy is worded differently.
5. Keeping our AWS deployment up cost about ₹66 a day for a demo nobody was using. So we rebuilt the hosting for ₹0.

### Post 1: technical deep dive

We built LeakTrace, a system that prints every exam paper slightly differently, so a leak points back to one copy.

The paper is a template. A phrase that can vary is written {{Calculate the total|Determine the total}}. Each copy picks one wording at every one of 67 places, and that list of choices is its secret fingerprint. The generator keeps every pair of copies at least four choices apart.

When text leaks, we read which wording appears at each place we can see and score every copy against it. A place garbled by a typo is skipped, so typos cost evidence but never mislead. A copy is named only if the best match disagrees at most once and the runner-up disagrees at three or more places beyond that.

We measured it: 20 copies, one typo per pasted question, 480 trials. One question never names a copy. Two questions named the right one in 60 of 60 trials, and no trial in any row named a wrong copy. That is clean text, not photos, and we say so in the README.

It is deterministic TypeScript with no models, so every verdict can be explained to an investigator.

Try it, one click per role: leaktrace-five.vercel.app (may take a minute to wake)

#TypeScript #ExamIntegrity #SoftwareEngineering #Postgres

### Post 2: the journey, including the move from AWS to free

We built LeakTrace together over about three and a half weeks: a system that makes every printed exam paper unique so a leak can be traced to a seat.

First we ran it on AWS in Mumbai: an API server, Postgres on RDS, files on S3, and workers that scale from zero when a queue fills up. Clicking Generate really did start a server. We recorded the demo on it, wrote Terraform for it, and checked that Terraform against the live account without applying anything.

Then we looked at the running cost. About ₹66 a day, just to sit there. So we moved the public demo to Vercel, Render, Neon and Cloudflare R2, all free.

It took a day, because the app never talks to S3 or SQS directly. It talks to seven small interfaces. Our local mode already kept the queue and release timers in Postgres, and R2 speaks the S3 API. The new mode touched 14 files, about 410 lines, a third of them tests.

The lesson we are keeping: the interface boundary is what you are really building. The cloud is a detail.

What it ran on AWS is documented in the repo, and what it runs on now is a link away.

#AWS #CloudArchitecture #StudentProjects #Terraform #BuildInPublic

### Post 3: short, with a call to action

Exam papers leak. We built the part that comes after.

LeakTrace makes every printed copy of an exam paper worded slightly differently. Paste a few leaked lines, even with a typo, and it names the copy, centre, room, seat and invigilator. On our demo paper, two pasted questions were enough to name the right copy in every one of 480 test trials.

It is a college project, not used on real exams, and it only works on text. We say so up front. Under the hood it is deterministic TypeScript with no models, so an investigator can check every verdict by hand.

Open the live demo and try it in one click as a controller, a superintendent or an auditor. It is free to use and it resets every night:

leaktrace-five.vercel.app

The first visit can take about a minute to wake up. Code, architecture diagrams and the numbers behind this post are in the repo, built by Anjali Rawat and Pranav.

#ExamIntegrity #FullStack #OpenSource

### Carousel (8 slides)

1. **Title:** "Every exam copy is unique, so every leak can be traced." Screenshot `01-login.png`.
2. **The gap:** identical copies mean a leaked photo says nothing about its source.
3. **The idea:** the paper is a template of `{{a|b}}` blanks; each copy is a different filling. Show the three-row table from section 4.
4. **Tracing:** read the wording at each blank, score every copy, tolerate typos. Screenshot `12-trace-verdict.png`.
5. **Measured:** the accuracy table, with "clean text only".
6. **Two deployments:** the two architecture diagrams side by side, with "AWS, then free".
7. **Why the move was small:** seven interfaces, three modes, 14 files.
8. **Try it:** the live URL, "one click per role", and the credit line.

### Video post caption

A 3-minute walk through LeakTrace on AWS: create a paper, generate 20 unique copies (the worker starts from zero, sped up in the edit), schedule the release, download as a superintendent, paste a few leaked lines with a typo, and read the verdict that names the copy, centre, room, seat and invigilator. Built by Anjali Rawat and Pranav. The same app now runs free at leaktrace-five.vercel.app. Code and notes are in the repo.

### Tagging each other

Anjali tags Pranav and Pranav tags Anjali in the first line of the post ("Built with @Pranav" / "Built with @Anjali Rawat") and again in the closing line, and each of us links both GitHub profiles in the first comment. Neither post says who did which part: we built it together and credit it equally.

### Instructions for the assistant writing our post

- Write in a grounded student voice: first person plural ("we"), plain words, short paragraphs, no hype words.
- Do not overclaim. It is a college project, it has not been used on real exams, and the accuracy was measured on clean text. Say what it ran on honestly: **it ran on AWS and now runs free**.
- Credit both of us equally. Do not say who did what, and always write "Anjali Rawat and Pranav".
- Include one specific technical lesson, for example: the interface boundary made the move small; or we measured the real proxy chain instead of guessing; or our own cold-start estimate was wrong.
- Use only the numbers in this document. Do not invent statistics about exam leaks; if a statistic is wanted, mark it **verify before posting**.
- Use three to five hashtags, no emoji walls, and one link to the live demo with a note that it may take about a minute to wake.

## 13. FAQ for recruiters and engineers

**Is this used on real exams?** No. It is a college project and a reference design. We state that in the README.

**Why not just watermark the PDF?** A watermark or a visible code is lost the moment someone retypes the text or photographs it in a way that hides it. Wording survives retyping. (We also print a visible code on each copy for convenience.)

**Can a leaker defeat it?** Yes: paraphrase the whole paper, or compare several copies and keep only what is the same in all of them. The more variation points a paper has, the more a leaker has to change. We list this under limitations.

**Why no machine learning?** Tracing has to be explainable: "these 16 places all agree with copy 2 and none disagree" is something an investigator can check by hand.

**Why two deployments?** AWS is the reference design that shows auto-scaling workers, scheduled releases and least-privilege IAM; the free stack is what makes a public demo possible without a bill.

**What was the hardest part?** Getting the identification rule right (when to name a copy and when to say "possible"), and measuring the real proxy chain on the free stack.

**How did the move from AWS to the free stack go?** About a day, because the app uses interfaces for storage, queue, scheduler, notifier, metrics, config and worker fleet. The new mode is 14 files.

**What would you do next?** Trace from a photo (read the text first), measure accuracy on real photos, and raise the 20-copy limit.

**Where is the code for the AWS side?** `infra/terraform/aws`, plus `docs/aws/` for the inventory, the evidence from the demo run and the teardown checklist.

**How is quality checked?** 87 automated tests, a full end-to-end run as every role in CI, a read-only Terraform plan against the live AWS account, and a Playwright walkthrough of the public site.
