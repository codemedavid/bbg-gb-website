# Storefront schedule quick controls — TDD evidence

**Source plan:** none. The journeys were derived during this TDD run, from a
support question ("how to open a kahati and groupbuy — it's not visible now in
the storefront") that turned out to be a configuration state rather than a
defect: the production `settings` table held no `group_buy_schedule_opens_at` /
`group_buy_schedule_closes_at` rows, so `isScheduleOpen` failed closed and both
boards 404'd for customers while admins read through `requireBoardsOpenOrAdmin`.

No fix was needed for that. The work below is the follow-up request — make the
window something an admin can open and close freely, rather than only by typing
two absolute instants into a picker.

## Scope

Chosen from four options: **quick controls on the one existing window**. Not a
recurring weekly pattern and not a queue of upcoming windows; the schedule stays
a single `(opensAt, closesAt)` pair and the storefront gate is untouched.

## User journeys

1. As an admin, I want to see at a glance whether both boards are open right now
   and how long is left, instead of computing it from two ISO timestamps.
2. As an admin, I want to open both boards immediately for a set run of days with
   one tap, without doing date math in a picker.
3. As an admin, I want to start a scheduled window early, keeping its planned
   close.
4. As an admin, I want to close both boards immediately without hand-clearing two
   fields and risking a half-set window.

## Task report

### 1. Pure control logic — `lib/schedule-controls.ts`

Four pure functions of `(window, now)` — `scheduleStatus`, `windowOpeningNow`,
`windowStartedNow`, `windowClosedNow` — plus `formatTimeLeft`. Each returns a
**whole** window, because a half-set one reads as CLOSED everywhere downstream: a
control that wrote one end would take both boards dark as a side effect of an
edit that looked like it succeeded.

- RED: `npx vitest run lib/schedule-controls.test.ts`
  ```
  Error: Failed to load url ./schedule-controls (resolved id: ./schedule-controls)
  in lib/schedule-controls.test.ts. Does the file exist?
  Test Files  1 failed (1) | Tests  no tests
  ```
  Compile-time RED: the reproducer newly references the module under test, and
  its absence is the intended signal.
- GREEN: same command — `Test Files 1 passed (1) | Tests 23 passed (23)`.

### 2. Card wiring — `app/admin/settings/SchedulePanel.tsx`

Live status line, `Open now` / `Close now`, and 3/7/14-day presets. Controls act
on the window **as stored** at the instant pressed, never on unsaved entries, and
share the form's single save path so none can skip its error handling.

- RED: `npx vitest run app/admin/settings/SchedulePanel.test.tsx`
  ```
  Test Files  1 failed (1)
  Tests  7 failed | 11 passed (18)
  → Unable to find an accessible element with the role "button" and name /7 days/i
  ```
  Runtime RED: the 7 new tests fail on buttons the card does not render; the 11
  pre-existing tests stay green, so the reproducer adds a gap rather than
  breaking the card.
- GREEN: same command — `Tests 18 passed (18)`.

### 3. Regression and type check

- `npm test` → `Test Files 143 passed (143) | Tests 1403 passed (1403)`
- `npx tsc --noEmit --pretty false` → clean, exit 0

### 4. Refactor

The four-state banner moved out of the form's JSX into
`app/admin/settings/ScheduleStatusLine.tsx`. Behaviour unchanged; 73 passed
across the settings and schedule suites afterwards, `tsc` clean.

## Two assertions tightened during GREEN

Recorded because both changed a *query*, not a guarantee:

1. Two status assertions used `findByText(/\bopen\b/i)`, which also matches the
   card's own prose ("Group Buy and Hatian open and close together"). Re-queried
   by `role="status"`; the same content is asserted on the live line.
2. Three control assertions pinned the posted instant to an exact millisecond.
   The fake clock advances while `userEvent` dispatches the click, so this tested
   the harness. Now asserted as "within 5s of the press", with the parts that
   *are* exact — a 7-day run is exactly 7 days, an early start keeps the stored
   close byte-for-byte — still pinned exactly.

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | An in-force window reports open, with the ms until it closes | `lib/schedule-controls.test.ts:scheduleStatus` | unit | PASS |
| 2 | A future window reports scheduled, with the ms until it opens | `lib/schedule-controls.test.ts:scheduleStatus` | unit | PASS |
| 3 | An elapsed window reports closed | `lib/schedule-controls.test.ts:scheduleStatus` | unit | PASS |
| 4 | An unset or half-set window reports unset, not merely closed | `lib/schedule-controls.test.ts:scheduleStatus` | unit | PASS |
| 5 | A backwards window reports closed, agreeing with `isScheduleOpen` | `lib/schedule-controls.test.ts:scheduleStatus` | unit | PASS |
| 6 | Open is inclusive, close is exclusive — same boundary as the gate | `lib/schedule-controls.test.ts:scheduleStatus` | unit | PASS |
| 7 | A preset opens at the press and runs exactly N days | `lib/schedule-controls.test.ts:windowOpeningNow` | unit | PASS |
| 8 | A preset window is open immediately | `lib/schedule-controls.test.ts:windowOpeningNow` | unit | PASS |
| 9 | A non-positive run is refused | `lib/schedule-controls.test.ts:windowOpeningNow` | unit | PASS |
| 10 | Starting early keeps the planned close | `lib/schedule-controls.test.ts:windowStartedNow` | unit | PASS |
| 11 | Starting a window whose close has passed is refused | `lib/schedule-controls.test.ts:windowStartedNow` | unit | PASS |
| 12 | Starting an unconfigured window is refused | `lib/schedule-controls.test.ts:windowStartedNow` | unit | PASS |
| 13 | Closing an open window truncates it, keeping when it opened | `lib/schedule-controls.test.ts:windowClosedNow` | unit | PASS |
| 14 | Closing a not-yet-started window clears it, never storing a backwards window | `lib/schedule-controls.test.ts:windowClosedNow` | unit | PASS |
| 15 | Closing at the exact opening instant clears rather than storing zero length | `lib/schedule-controls.test.ts:windowClosedNow` | unit | PASS |
| 16 | Closing leaves the boards shut in every state | `lib/schedule-controls.test.ts:windowClosedNow` | unit | PASS |
| 17 | Countdowns read as `2d 14h` / `14h 3m` / `3m` / `under a minute` | `lib/schedule-controls.test.ts:formatTimeLeft` | unit | PASS |
| 18 | The card says both boards are open and how long is left | `SchedulePanel.test.tsx:quick controls` | component | PASS |
| 19 | The card distinguishes a configured-but-not-trading window | `SchedulePanel.test.tsx:quick controls` | component | PASS |
| 20 | A preset posts a window starting now for the chosen run | `SchedulePanel.test.tsx:quick controls` | component | PASS |
| 21 | Close now posts the truncated window, keeping its opening | `SchedulePanel.test.tsx:quick controls` | component | PASS |
| 22 | Open now starts a scheduled window without moving its close | `SchedulePanel.test.tsx:quick controls` | component | PASS |
| 23 | No Close now is offered while nothing is configured | `SchedulePanel.test.tsx:quick controls` | component | PASS |
| 24 | The fields show what the control actually wrote | `SchedulePanel.test.tsx:quick controls` | component | PASS |
| 25 | A rejected control surfaces the error, not success | `SchedulePanel.test.tsx:quick controls` | component | PASS |

Command for 1–17: `npx vitest run lib/schedule-controls.test.ts`
Command for 18–25: `npx vitest run app/admin/settings/SchedulePanel.test.tsx`

## Coverage

`npx vitest run --coverage lib/schedule-controls.test.ts app/admin/settings/SchedulePanel.test.tsx`

| File | Stmts | Branch | Funcs | Lines |
|---|---|---|---|---|
| `lib/schedule-controls.ts` | 100% | 97.05% | 100% | 100% |
| `app/admin/settings/SchedulePanel.tsx` | 96.35% | 84.90% | 100% | 96.35% |
| `app/admin/settings/ScheduleStatusLine.tsx` | 96.42% | 87.50% | 100% | 96.42% |

All above the 80% floor.

## Known gaps

- **No E2E.** The controls are covered at unit and component level against a
  mocked `apiSend`; nothing exercises the real `PATCH /api/admin/settings` round
  trip and the storefront going live as a result. The API's own schedule
  validation is already covered by `lib/schedule-routes.test.ts`.
- **The 30s status tick is not tested.** The interval that re-reads the clock is
  asserted only indirectly — the countdown is rendered from `now`, but no test
  advances the clock and re-checks the line.
- **Not visually verified in a browser.** No screenshot pass was run against the
  admin settings page.
- **Production schedule still unset.** Nothing here writes a window; the boards
  stay closed to customers until an admin sets one.

## Merge evidence

RED: controls module absent (compile-time) + 7 failing card tests on missing
buttons, 11 pre-existing green.
GREEN: 23 unit + 18 component passed; full suite 1403 passed / 143 files; `tsc
--noEmit` clean.
REFACTOR: status line extracted to its own component, 73 passed after, `tsc`
clean.

Checkpoints on `feat/group-buy-page`: `6cf41a5` (test/RED) → `afcc19a`
(feat/GREEN) → `d5d31dc` (refactor).
