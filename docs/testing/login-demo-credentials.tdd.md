# TDD evidence — remove demo credentials from the login page

**Source plan:** none. Journeys derived during this TDD run from a screenshot of the
production login screen showing the seed-account hint.

## User journeys

- As a visitor, I want the login page to show only the form and the register link,
  so that no working account name or password is advertised to strangers.
- As the site owner, I want the seeded admin address kept off public pages, so that
  an attacker cannot learn which account to target.

## Task report

**Removed the seed-credential hint block from `app/login/page.tsx`.**

The login screen rendered `Demo: ana@example.com / password123 · Admin: admin@bbgpeptides.ph`
in a bordered card below the register link. The block was deleted; nothing else on the page
changed. `app/register/page.tsx` was checked and never carried a credential hint, so it needed
no change.

RED — `npx vitest run app/login/page.test.tsx`:

```
 FAIL  app/login/page.test.tsx > Login page > does not expose demo or admin credentials
AssertionError: expected 'BBG PeptidesKahati tayo — research pe…' not to match /ana@example\.com|password123|admin@b…/i
+ Received:
"…Wala pang account? Mag-registerDemo: ana@example.com / password123 · Admin: admin@bbgpeptides.ph"
 Test Files  1 failed (1)
      Tests  1 failed | 1 passed (2)
```

GREEN — same command after the fix:

```
 ✓ app/login/page.test.tsx (2 tests) 67ms
 Test Files  1 passed (1)
      Tests  2 passed (2)
```

Full suite — `npx vitest run`:

```
 Test Files  144 passed (144)
      Tests  1405 passed (1405)
```

## Test specification

| # | What is guaranteed | Test file or command | Test type | Result | Evidence |
|---|--------------------|----------------------|-----------|--------|----------|
| 1 | The login page still renders the email field, password field, and the `/register` link | `app/login/page.test.tsx:renders the login form and the register link` | unit | PASS | `npx vitest run app/login/page.test.tsx` |
| 2 | No rendered text on the login page contains `ana@example.com`, `password123`, `admin@bbgpeptides.ph`, or a `Demo:` label | `app/login/page.test.tsx:does not expose demo or admin credentials` | unit | PASS | `npx vitest run app/login/page.test.tsx` |

## Coverage and known gaps

`npx vitest run app/login/page.test.tsx --coverage.enabled --coverage.include='app/login/**'`
reports 82.75% statements / 82.75% lines on `app/login/page.tsx`. The uncovered lines 17-21 are
the `submit` handler's success and failure branches, which are exercised through the auth flow
rather than this page test; they are unrelated to the credential-hint removal.

The seed credentials still live in `scripts/seed.ts`, `scripts/gen-supabase-sql.ts`, and the test
harness. That is intentional — they are development fixtures, not shipped UI. If the seeded
`admin@bbgpeptides.ph` account exists in production with `password123`, rotating that password is
a separate follow-up this change does not cover.

## Merge evidence

Checkpoints on `feat/group-buy-page`:

- `298b348 test: reproducer for demo credentials leaking on the login page` — RED validated
- `fix: stop printing seed credentials on the login page` — GREEN validated
