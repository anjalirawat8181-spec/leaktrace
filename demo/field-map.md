# Demo field map

What `record-demo.cjs` clicks and types, page by page, taken from the web app source and checked against the running site. Accounts are the seeded demo users; the password comes from the `DEMO_PASSWORD` environment variable and is never written to this repository.

## How to run

```
npm i --prefix <tools folder> playwright pdfjs-dist
npx --prefix <tools folder> playwright install chromium
npm run build:packages
DEMO_TOOLS=<tools folder> BASE=http://<server address> DEMO_PASSWORD=... OUT=<scratch folder> node demo/record-demo.cjs
OUT=<scratch folder> node demo/assemble-demo.cjs
```

`record-demo.cjs` records one clip per scene (1280×720, headless, one browser context per person) and writes `clips.json` with the speed-up marks and chapter times. `assemble-demo.cjs` joins the clips, speeds up the waiting parts, and writes the videos, `chapters.txt` and `demo-preview.gif` into `demo/`. The `.mp4` and `.webm` files are gitignored.

Set `TAIL_ONLY=1` to re-record only the last scenes (Find a leak, auditor, end card) against an exam created by an earlier run.

## Helpers

| Helper | What it does |
|---|---|
| `injectCursor` (init script) | draws a white arrow that follows the mouse, so clicks are visible |
| `injectSubtitleBar` (init script) | adds a fixed bar at the bottom of every page, plus masks IPv4 addresses in page text |
| `showSubtitle(page, text)` | sets the bar text; lines starting with `Step N –` also become chapters |
| `moveAndClick(page, locator)` | scrolls to the element, glides the cursor to it, then clicks |
| `typeSlowly(page, locator, text)` | clicks the field and types with a per-key delay |
| `ensureVisible(page, locator)` | waits for the element and scrolls it into view |
| `panElements(page, selector)` | moves the cursor across a few elements to draw attention |

## Scenes and selectors

| Scene | Page | Action | Locator |
|---|---|---|---|
| Title card | none | 3 s card with the tagline | `setContent` |
| Step 1 | `/` sign-in | type email and password, sign in | `input[autocomplete="username"]`, `input[type="password"]`, button "Sign in" |
| Step 2 | Exams | show the cards with the 5-step bar | `main h2, main h3` |
| Step 3 | Exams | create a fresh exam | button "New exam"; fields "Exam title", "Subject", "Exam starts (India time)"; button "Create exam" |
| Step 4 | `/exams/:id` | paste the paper, show capacity meter and copies indicator, save | `.cm-content`, button "Save paper" |
| Step 5 | `/exams/:id` | spot the difference between two copies | button "Spot the difference", button "Close" |
| Step 6 | `/exams/:id/generation` | generate, wait for the worker, watch "Copies done" reach 20 / 20 | button "Generate copies", text "A worker is online", link "Schedule release" |
| Step 7 | `/exams/:id/schedule` | release in 3 minutes, close in 40, India time | two `input[type="datetime-local"]`, button "Schedule release", then "Save new times" appears |
| Step 8 | `/` superintendent (own context) | "Locked until…", reload until the button enables | text "Locked until", button "Download papers" inside the exam card |
| Step 9 | `/` superintendent | request links, open the PDF | link "open PDF (link works for 2 minutes)"; the PDF is shown in a local viewer so the signed link never appears |
| Step 10 | `/trace` | paste six lines from the PDF with one typo | `select`, field "Case title", field "Leaked text (paste a few lines)", button "Find the copy"; verdict text "LEAK TRACED" |
| Step 11 | Alerts | the leak alert | link "Alerts" |
| Step 12 | Audit log (auditor context) | scroll the log, blocked attempts in red | link "Audit log" |
| End card | none | 4 s card with credit, stack, "Ran on AWS (ap-south-1)", repository | `setContent` |

## Timing

| Wait | Real time on AWS | Edit |
|---|---|---|
| Worker cold start (Auto Scaling 0 → 1) | 1 to 4 minutes | sped up 10× with the caption "worker auto-scaled from 0 → 1" |
| Scheduled release | about 3 minutes | sped up 8× with the caption "waiting for the scheduled release time" |

## Why six lines

Three lines of this paper expose only 11 of its 67 variation points, which narrows the leak to a few copies ("POSSIBLE"). Six lines expose about 22 points and name one copy.
