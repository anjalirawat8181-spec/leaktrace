# LeakTrace design system

Produced with the ui-ux-pro-max design-system generator, query: "forensic security dashboard exam integrity government audit tool dark trustworthy data-dense". The generator output is the starting point; the adaptations below keep the product's identity (dark forensics lab, amber = warning, red = leak, green = verified or allowed).

## Direction
| | Generator result | Decision |
|---|---|---|
| Pattern | Real-Time / Operations | Operations console: metrics first, live status with update cues, static state under reduced motion |
| Style | Dark Mode (OLED): deep black, high contrast, minimal glow | Adopted. Dark only; light mode is "not recommended" for this product |
| Typography | Fira Code (data, headings accents) + Fira Sans (body) | Adopted, self-hosted with @fontsource (no CDN) |
| Key effects | Minimal glow, visible focus, no slow dashboards | Subtle glow only on the verified/leak hero states |
| Avoid | Decorative charts, hidden error states | Every data view gets loading, empty and error states |

Why: an audit tool has to read as sober and trustworthy. OLED-dark gives the highest contrast for dense tables; a monospace face for identifiers, times and counts makes figures line up (tabular numbers) and reinforces the "lab" feel.

## Colour tokens
Defined as RGB channels in CSS variables (`apps/web/src/index.css`) and exposed in `tailwind.config.js` so opacity utilities work. Components use semantic names only.

| Token | Value | Use |
|---|---|---|
| `bg` | #020617 | page background |
| `surface` | #0B1120 | cards, panels |
| `raised` | #111A2E | table headers, inputs, hovered rows |
| `line` | #1E293B | decorative dividers |
| `line-strong` | #64748B | control borders (>= 3:1 non-text contrast) |
| `fg` | #F8FAFC | primary text |
| `fg-muted` | #94A3B8 | secondary text |
| `ok` | #22C55E (text/fill), tint #0A2417 | verified, allowed, released |
| `warn` | #FBBF24, tint #2A1F07 | warnings, locked, queued, possible |
| `danger` | #F87171, tint #2A0F14, solid #DC2626 | leaks, denied, errors |
| `info` | #38BDF8 | focus ring, links, generating |
| `on-accent` | #04140A | text on green fills |

Measured contrast (WCAG): fg/bg 19.3, muted/surface 7.3, ok/surface 8.3, warn/surface 11.3, danger/surface 6.8, info/surface 8.8, on-accent/ok 8.3, danger text on danger tint 9.4. Control borders use `line-strong` (about 4:1).

## Typography
- Sans: Fira Sans 400/500/600/700. Mono: Fira Code 400/500/600.
- Scale (Tailwind tokens only): xs 12, sm 14, base 16, lg 18, xl 20, 2xl 24, 3xl 30, 4xl 36. Body 16px, line-height 1.5. Numbers in tables, timers and counters use `tabular-nums`.
- Headings: h1 once per page (PageHeader), h2 for sections, sequential.

## Spacing, radius, elevation, motion
- Spacing: 4px base (Tailwind scale), card padding 16/24, page gutter 16 mobile, 24 desktop, max content width 1280.
- Radius: sm 4, md 8, lg 12, full for pills.
- Elevation: `shadow-card` (0 1px 0 + soft), `shadow-pop` (menus, toasts), `shadow-glow-ok|danger` (hero verdicts only).
- Motion: fast 150ms (hover, focus), base 200ms (state changes, bar fill), slow 300ms (page elements). Only transform/opacity/colour animate; width of progress fill is the one exception, done with `transform: scaleX` where possible. `prefers-reduced-motion` disables all transitions and the trace animation (points appear at once).

## Layout
Mobile first, breakpoints 375 / 768 / 1024 / 1440. App shell: left sidebar from `lg`, slide-in drawer below it; top bar with signed-in user, role badge and sign-out. Skip link to `#main`. Tables scroll inside an `overflow-x-auto` wrapper, never the page.

## Components (`apps/web/src/components/ui`)
Button (primary, secondary, ghost, danger; loading state), Card, Badge (tones, plus exam-status and verdict presets), Input, Textarea, Select, Field (label, hint, error), Table, PageHeader, EmptyState, ErrorState, Skeleton, Toast, Stat, ProgressBar, Icon (inline SVG, no icon font, no emoji).

## Status mapping
| Status | Tone | Icon cue |
|---|---|---|
| DRAFT | neutral | pencil |
| GENERATING | info | spinner/cog |
| READY | ok (outline) | check |
| SCHEDULED | warn | clock |
| RELEASED | ok | unlock |
| CLOSED | neutral (muted) | lock |
| IDENTIFIED | danger | target |
| POSSIBLE | warn | question |
| INSUFFICIENT | neutral | minus |

Colour is never the only signal: every badge carries an icon and the status word.

## Accessibility rules applied
Visible 2px focus ring (`info`, 2px offset) on every interactive element; targets at least 40px high (44 on touch widths); labels bound to inputs; icon-only buttons carry `aria-label`; live regions only for countdown completion and toasts; tables use `scope` headers; `lang="en"`; zoom never disabled.
