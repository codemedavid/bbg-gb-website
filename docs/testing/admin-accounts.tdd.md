# TDD Evidence: Admin → Accounts

**Source plan**: inline `/ecc:plan` output for "add a feature in the admin page to view all the accounts signed in" (not persisted as a `.plan.md`).
**Branch**: `feat/group-buy-page`
**Date**: 2026-08-17

## Requirements note

The request said "accounts signed in". Auth in this repo is a **stateless JWT**
(`lib/auth.ts`, 7-day HS256 token in the `bbg_token` httpOnly cookie) with no
session table, so "sessions active right now" was not answerable without new
infrastructure. Confirmed interpretation: **list all registered accounts, plus a
`users.last_login_at` stamp** written at sign-in so "signed in" is answerable as
"last signed in". Live/revocable session tracking remains out of scope.

## User journeys

1. As an admin, I want to see every account registered on the shop, so I know who my customers are — including those who signed up and never ordered.
2. As an admin, I want to see when each account last signed in, so I can tell a live account from a dormant one.
3. As an admin, I want to search by name or email, so I can find one customer among many.
4. As an admin, I want to filter by role, so I can see who holds admin access.
5. As a non-admin, I must never be able to read the accounts list.
6. As any user, my password hash must never leave the server.

## Task report

| Task | Summary | RED evidence | GREEN evidence |
|---|---|---|---|
| Schema + migration | Added nullable `users.last_login_at`; hand-written `drizzle/0024_users_last_login.sql` + `_journal.json` entry | `TypeError: Cannot convert undefined or null to object` in drizzle `orderSelectedFields` — the column did not exist | full suite green |
| Login stamps | Both `/api/auth/login` and `/api/admin/login` stamp `lastLoginAt` after the password check (and, for admin, after the role check) | 5 failing stamp tests | 10/10 login tests pass |
| `lib/accounts.ts` | `listAccounts({ search, role, limit })` — left join to `orders` for counts, `desc nulls last` ordering, explicit column select | `Failed to load url ./accounts` | 10/10 pass, 100% coverage |
| `GET /api/admin/accounts` | `requireAdmin()` + zod-parsed query | `Failed to load url ./route` | 7/7 pass, 100% coverage |
| `useAdminAccounts` + page | Debounced search, role pills, Never/relative last-login rendering | `Failed to load url ./page` | 8/8 pass |
| Sidebar nav | `Accounts` entry added to `NAV` in `app/admin/layout.tsx` | — | `app/admin/layout.test.tsx` 6/6 still pass |

**Migration note**: `npm run db:generate` fails on this branch with a
*pre-existing* snapshot collision (`0010_snapshot.json` / `0011_snapshot.json`),
unrelated to this change. Migrations 0013+ in this repo are hand-written SQL with
a manual `_journal.json` entry (snapshots stop at 0012); `0024` follows that
convention.

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | Every registered account is listed, not only those that have ordered | `lib/accounts.test.ts:returns every registered account…` | integration | PASS |
| 2 | Order counts are per account; a zero-order account still appears | `lib/accounts.test.ts:counts how many orders…` | integration | PASS |
| 3 | An account that never signed in reports `null`, never a date | `lib/accounts.test.ts:reports an account that has never signed in as null…` | integration | PASS |
| 4 | A signed-in account reports its actual last sign-in | `lib/accounts.test.ts:reports the last sign-in…` | integration | PASS |
| 5 | Most recently active first; never-signed-in sorts last | `lib/accounts.test.ts:puts the most recently signed-in accounts first…` | integration | PASS |
| 6 | Search matches email case-insensitively | `lib/accounts.test.ts:narrows to accounts whose name or email matches…` | integration | PASS |
| 7 | Search matches the account name too | `lib/accounts.test.ts:matches on the account name too…` | integration | PASS |
| 8 | Role filter narrows to one role | `lib/accounts.test.ts:narrows to a single role…` | integration | PASS |
| 9 | The query never returns the password hash | `lib/accounts.test.ts:never hands back the password hash` | integration | PASS |
| 10 | Row count is capped so the table cannot grow unbounded | `lib/accounts.test.ts:caps how many rows…` | integration | PASS |
| 11 | Anonymous callers get 401 | `app/api/admin/accounts/route.test.ts:rejects an anonymous caller…` | integration | PASS |
| 12 | Signed-in customers get 403 — the gate is server-side | `…route.test.ts:rejects a signed-in customer with 403` | integration | PASS |
| 13 | Admins get the list | `…route.test.ts:lists the accounts for an admin` | integration | PASS |
| 14 | No `passwordHash` / bcrypt string anywhere in the payload | `…route.test.ts:never includes the password hash…` | integration | PASS |
| 15 | `search` and `role` reach the query | `…route.test.ts:passes the search term…` / `…the role filter…` | integration | PASS |
| 16 | An unrecognised role is a 400, not a silent empty result | `…route.test.ts:rejects a role that is not a real role…` | integration | PASS |
| 17 | Customer sign-in stamps `lastLoginAt`; a wrong password does not | `app/api/auth/login/route.test.ts` | integration | PASS |
| 18 | Admin sign-in stamps it; wrong password and 403'd non-admins do not | `app/api/admin/login/route.test.ts` — last sign-in stamp | integration | PASS |
| 19 | The table renders name, email, order count, role badge and dates | `app/admin/accounts/page.test.tsx` (5 cases) | unit (RTL) | PASS |
| 20 | A never-signed-in account renders "Never", not a blank cell | `…page.test.tsx:says Never for an account that has not signed in` | unit (RTL) | PASS |
| 21 | Typing queries the API with the search term (debounced) | `…page.test.tsx:asks the API for the typed search term` | unit (RTL) | PASS |
| 22 | Choosing a role pill queries the API with that role | `…page.test.tsx:asks the API for a single role…` | unit (RTL) | PASS |
| 23 | Empty result says so rather than showing a blank table | `…page.test.tsx:says so when there are no accounts…` | unit (RTL) | PASS |

## Commands run

```
npx vitest run lib/accounts.test.ts app/api/admin/accounts/route.test.ts \
  app/api/auth/login/route.test.ts app/api/admin/login/route.test.ts \
  app/admin/accounts/page.test.tsx
  → RED:   5 failed files, 5 failed tests (missing column + 3 missing modules)
  → GREEN: 5 passed files, 35 passed tests

npx vitest run          → 200 files passed, 2077 tests passed
npx tsc --noEmit        → clean
npm run build           → Compiled successfully; /admin/accounts + /api/admin/accounts present
```

## Coverage

```
lib/accounts.ts                  100%  stmts / 100%   branch
app/api/admin/accounts/route.ts  100%  stmts / 100%   branch
app/admin/accounts/page.tsx     95.83% stmts / 78.57% branch
```

All above the 80% statement target. The uncovered page branches are the
`isLoading` cell and the `error` alert, both driven by react-query states the
mocked hook does not emit.

## Known gaps

- **The migration has not been applied to any live database.** `drizzle/0024_users_last_login.sql` runs against the in-memory PGlite in tests only. Production is Supabase via `DATABASE_URL`; until the column exists there, `/admin/accounts` will 500. Verify with `npm run db:check`.
- Every existing account starts with `last_login_at = NULL` and reads as "Never" until its owner next signs in. That is intentional — those sign-ins predate the stamp — but the screen will look mostly empty in that column at first.
- No pagination: capped at `ACCOUNTS_LIMIT = 200` with no "showing first 200" notice in the UI yet.
- Read-only. No editing, suspending, or role-changing from this screen.
- No E2E (Playwright) coverage for this screen.
