# Admin-issued reset link — TDD record

**Task:** shop report, 2026-09-05:

> **Ruth:** How about yung mga di po makapag log in ulit na wala na ibang email na pwede gamitin
> **Jonina:** di po sila maka receive ng auth po to change pass? Yes po need pa daw mag
> create ng new email para makapaglog in ulit kaya nagpapamanual nalang sila

**Source plan:** none. The journeys below were derived during this TDD run from the
reported symptom and from what production actually showed.

## What was actually wrong — two separate faults

### 1. `POSTHOG_KEY` is not set in production (environment, not code)

PostHog is the only sender of customer mail on this shop. It has no key in the
production environment, so `captureEvent` returns without sending and **every**
customer notification has been silently undelivered. Verified against prod on
2026-09-05:

```sql
select kind, status, count(*), (array_agg(distinct error))[1] as err
from email_log where sent_at >= '2026-09-02' group by 1,2 order by 3 desc;
```

| kind | status | count | error |
|---|---|---|---|
| `order_receipt` | skipped | 69 | `POSTHOG_KEY is not set, so nothing was sent.` |
| `order_receipt_updated` | skipped | 34 | ” |
| `settlement_placed` | skipped | 28 | ” |
| `status_payment_confirmed` | skipped | 20 | ” |
| `password_reset` | **failed** | **6** | ” |
| `status_cancelled` / `_batch_filling` / `_proof_review` / `_shipped` / `_delivered` | skipped | 10 | ” |

167 rows, all undelivered. The reset rows read `failed` rather than `skipped` only
because `/forgot-password` passes the capture outcome to `sendEmail` and the other
call sites do not — both mean the same thing.

`lib/env.ts:33` already falls back to `NEXT_PUBLIC_POSTHOG_KEY`, so this is **not**
a variable-name mismatch. The key is absent. **This is fixed in Vercel → Project
Settings → Environment Variables and nowhere else** — no code change in this cycle
substitutes for it, because PostHog is the only sender.

This is the second delivery failure in three weeks. The first (2026-08-17..08-31)
was the PostHog workflow's re-entry rule: 144 links minted for 54 customers, 0
completed resets. Different cause, identical symptom.

### 2. A locked-out customer had no recovery path at all (code — fixed here)

Both failures had the same consequence, and it is the one the shop is reporting:
account recovery has exactly one channel, that channel is a third party, and when
it breaks the customer is permanently locked out. Their only way back in was to
register a **new email address**, abandoning their order history — then order
manually. Prod, 2026-09-05:

```sql
select count(distinct t.user_id) from password_reset_tokens t
where t.created_at >= '2026-08-17'
  and not exists (select 1 from password_reset_tokens d
                  where d.user_id = t.user_id and d.used_at is not null);
```

**18 customers** have requested a reset since 2026-08-17 and never completed one.
7 of them have `last_login_at IS NULL` — they have never signed in at all.

## User journeys

1. As an admin, I want to issue a password reset link for a locked-out customer,
   so that I can hand it to them on WhatsApp when email delivery is down.
2. As a locked-out customer, I want the link the admin sends me to actually set a
   new password on my existing account, so that I do not have to register a new
   email address and lose my order history.
3. As the shop owner, I want an admin-issued link to carry exactly the same
   safeguards as an emailed one — single use, one hour, retiring any older
   outstanding link — so that convenience for staff is not a standing key to a
   customer's account.
4. As the shop owner, I want the action refused for admin accounts, so that one
   staff session cannot mint a credential for another administrator.

## Task report

### Shared issuance helper — `lib/password-reset-server.ts`

`issueResetLink({ userId, origin })` holds the safeguards once: retire every
outstanding token for the user, mint a fresh one, store only its hash, return the
raw link. Both doors into an account now call it, so they cannot drift apart on
the invariant that only one key is ever live.

- **RED:** `Error: Failed to load url ./password-reset-server … Does the file exist?`
- **GREEN:** `npx vitest run lib/password-reset-server.test.ts` → 6 passed

### Admin route — `app/api/admin/accounts/[id]/reset-link/route.ts`

`POST`, admin-only. The gate runs *before* the account id is read, so the endpoint
cannot be used to probe which ids exist. Refuses non-customer accounts. Still
fires `password_reset_requested` and still writes the `email_log` row, so a
customer whose delivery is working finishes without waiting for a human and the
issuance is recorded either way — but neither may fail the request, because a dead
mail channel is the situation the endpoint exists for.

- **RED:** `Error: Failed to load url ./route … Does the file exist?`
- **GREEN:** `npx vitest run "app/api/admin/accounts/[id]/reset-link/route.test.ts"` → 14 passed

### Admin → Accounts UI — `app/admin/accounts/page.tsx`

"Issue reset link" per customer row; the minted link is shown attached to that
row, with a copy button and its lifetime stated. One link on screen at a time.

- **RED:** 7 failed, 9 pre-existing passed —
  `TestingLibraryElementError: Unable to find an accessible element with the role "button" and name /reset link for Ana Cruz/i`
- **GREEN:** `npx vitest run app/admin/accounts/page.test.tsx` → 16 passed

### Refactor — `app/api/auth/forgot-password/route.ts`

Folded onto `issueResetLink`, replacing its own inline retire-mint-insert. No
behaviour change; the public form still answers every address identically.

- `npx vitest run app/api/auth/forgot-password/route.test.ts app/api/auth/reset-password/route.test.ts lib/password-reset.test.ts lib/password-reset-server.test.ts "app/api/admin/accounts/[id]/reset-link/route.test.ts"` → **62 passed**

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | An anonymous caller cannot mint a link | `reset-link/route.test.ts:rejects an anonymous caller with 401` | integration | PASS |
| 2 | A signed-in customer cannot mint a link, for anyone | `…:rejects a signed-in customer with 403` | integration | PASS |
| 3 | A rejected caller leaves no token behind | `…:writes no token when the caller is not an admin` | integration | PASS |
| 4 | An unknown account id is a 404, not a 500 | `…:returns 404 for an account that does not exist` | integration | PASS |
| 5 | An admin gets a usable link, address and lifetime | `…:hands the admin a reset link for the customer` | integration | PASS |
| 6 | Only the token's hash is stored, never the token | `…:stores only the hash of the token it just handed out` | integration | PASS |
| 7 | **The link actually resets the customer's password** | `…:issues a link that actually resets the customer password` | integration | PASS |
| 8 | Minting does not change the password by itself | `…:leaves the old password working until the link is used` | integration | PASS |
| 9 | The link works exactly once | `…:refuses the same link a second time` | integration | PASS |
| 10 | Issuing again retires the previous link | `…:retires an earlier outstanding link, so only one key is ever live` | integration | PASS |
| 11 | No link may be minted for an admin account | `…:refuses to issue a link for an admin account` | integration | PASS |
| 12 | The password hash never appears in the response | `…:never returns the password hash` | integration | PASS |
| 13 | The customer is still mailed, and the row records its fate | `…:still tries to mail the customer, and records what became of it` | integration | PASS |
| 14 | A dead mail channel still returns the link | `…:still returns the link when the mail could not be delivered` | integration | PASS |
| 15 | The link is built on the origin it was given | `password-reset-server.test.ts:mints a link on the origin it was given` | unit | PASS |
| 16 | Stored hash matches `hashResetToken` of the emitted token | `…:stores only the hash of the token, never the token itself` | unit | PASS |
| 17 | Every link expires, and starts unused | `…:gives the link an expiry, so an unused one cannot sit in a chat forever` | unit | PASS |
| 18 | A second issuance leaves one live token | `…:retires an earlier outstanding link when a second is issued` | unit | PASS |
| 19 | Tokens are never reused between issuances | `…:issues a different token every time` | unit | PASS |
| 20 | Issuing is an offer, not the change | `…:leaves the current password working until the link is actually used` | unit | PASS |
| 21 | Customer rows offer the action | `page.test.tsx:offers a reset link on a customer row` | component | PASS |
| 22 | Admin rows do not offer it (matches the server) | `…:does not offer one on an admin row` | component | PASS |
| 23 | The action asks for that row's account | `…:asks the server for a link for that account` | component | PASS |
| 24 | The link is shown so it can be handed over | `…:shows the link so the admin can hand it over` | component | PASS |
| 25 | Its lifetime and single use are stated | `…:says how long the link lasts and that it works once` | component | PASS |
| 26 | Only the issued row shows a link | `…:shows the link only on the row it was issued for` | component | PASS |
| 27 | One click gets it to the clipboard | `…:copies the link to the clipboard` | component | PASS |
| 28 | A failure to mint is reported, not silent | `…:says so when the link could not be issued` | component | PASS |

## Coverage and known gaps

Full suite, after the refactor:

```
env POSTHOG_KEY= NEXT_PUBLIC_POSTHOG_KEY= npx vitest run --no-file-parallelism
Test Files  262 passed (262)
     Tests  2779 passed (2779)

npx tsc --noEmit --pretty false   → clean
```

Coverage of the modules this cycle touched (`--coverage`, scoped to the four
relevant test files):

| file | stmts | branch | funcs | lines |
|---|---|---|---|---|
| `lib/password-reset-server.ts` | 100 | 100 | 100 | 100 |
| `app/api/admin/accounts/[id]/reset-link/route.ts` | 100 | 100 | 100 | 100 |
| `app/api/auth/forgot-password/route.ts` | 100 | 100 | 100 | 100 |
| `app/admin/accounts/page.tsx` | 98.18 | 80.85 | 100 | 98.18 |

The one branch still uncovered on `page.tsx` is the pre-existing "could not load
the accounts" alert, which predates this cycle. `lib/admin-api.ts` reads 0% in
that scoped run because the page test mocks it wholesale; it is a thin
query/mutation declaration layer, covered in the full suite by
`lib/admin-api.errors.test.tsx`.

Deliberately **not** covered here:

- **`POSTHOG_KEY` itself.** The missing production variable is the immediate cause
  of the report and no test can fix it. Nothing in this cycle makes the shop's
  email work again — that is one dashboard change, and until it is made every
  customer notification is still going nowhere.
- **Which admin issued a link.** `email_log` records that a reset was issued for an
  account and when, but not who asked for it. Recording the actor needs a column
  and a migration, and given the prod schema-drift history that was not worth
  bundling into this fix. The admin surface is a handful of trusted staff.
- **Rate limiting** on the admin endpoint. No admin route in this app has any, and
  adding it for this one alone would be inconsistent without being much safer.
- **No E2E.** The end-to-end guarantee that matters — an issued link really
  changing the password — is covered at integration level (#7) by feeding the
  minted link to the real `/api/auth/reset-password` handler, which is stronger
  evidence than a browser click-through of the same path.
- **The 18 already-locked-out customers** are not migrated or notified by this
  change. Each still needs an admin to issue them a link.

## Merge evidence

- RED: `bbf1c41` — reproducers added; 2 modules missing (compile-time RED), 7 page
  tests failing on the absent button, 9 pre-existing page tests still passing.
- GREEN: `dc293a2` — helper, route, hook and UI; 36 passed (6 + 14 + 16), full
  suite 2779 passed, `tsc` clean.
- Refactor: `/forgot-password` folded onto the shared helper; 62 passed across the
  five reset-related files, full suite re-run green.
