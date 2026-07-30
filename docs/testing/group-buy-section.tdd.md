# TDD evidence — separate Group Buy page (client request #4)

**Branch:** `feat/group-buy-page`
**Worktree:** `/Users/ynadonaire/bbg-groupbuy-worktree-group-buy-page` (see "Working conditions" below)
**Date:** 2026-07-30
**Source plan:** produced inline via `/ecc:plan`, confirmed by the user with "proceed".

Final, measured: **103 files / 934 tests green**, `tsc --noEmit` exit 0,
`next build` compiled. This work adds 10 test files / 73 tests and modifies no
existing test file, so the baseline was 93 files / 861 tests.

---

## The request

> The Group Buy Campaign should have its own dedicated page.
> Navigation: Admin → Group Buy → Campaigns → Create Campaign.
> When creating or editing a campaign: display a Back button; preserve entered
> data when navigating back. Keep the workflow isolated from Hatian and Product
> Management.

Two readings of "preserve entered data" were possible. Confirmed with the user
before implementing: leaving the form and returning must not cost what was
typed. There is no multi-step wizard here, so nothing else it could mean.

## User journeys

1. As an admin, I reach campaigns through Admin → Group Buy → Campaigns.
2. As an admin, I create a campaign on its own page, not in a modal over the board.
3. As an admin, I edit a campaign at a URL I can bookmark, reload or share.
4. As an admin, Back returns me to the campaigns list from either screen.
5. As an admin, what I typed is still there when I come back to the form.
6. As an admin, I am told the form was restored, and can throw the draft away.
7. As an admin, the campaign workflow does not reach into Hatian or Product Management.
8. As an admin, my old `/admin/campaigns` bookmark still works.

---

## Task report

| Task | Execution | Validation run | Result |
|---|---|---|---|
| Draft shape, validation, payload | Extracted to `lib/campaign-form.ts`, mirroring `lib/moq-product-form.ts` so screen and tests build one body | `npx vitest run lib/campaign-form.test.ts` | 19 passed |
| Draft preservation | `lib/campaign-draft.ts` — sessionStorage, keyed per campaign, restored after mount only | `npx vitest run lib/campaign-draft.test.tsx` | 8 passed |
| Routed Create / Edit + Back | `CampaignForm.tsx` + `new/page.tsx` + `[id]/page.tsx` | `npx vitest run app/admin/group-buy` | 34 passed |
| Campaigns board | Moved to `app/admin/group-buy/campaigns/page.tsx`, modal form removed, lifecycle actions kept | same | included above |
| Isolation boundary | `isolation.test.ts` asserts the promise against the source | same | 5 passed |
| Nav + legacy redirect | `Group Buy` section entry; hatian board relabelled `Hatian`; `/admin/campaigns` forwards | `npx vitest run app/admin/layout.test.tsx app/admin/campaigns/redirect.test.tsx` | 7 passed |

### RED → GREEN evidence

**RED (all six new-feature files):**

```
$ npx vitest run lib/campaign-form.test.ts lib/campaign-draft.test.tsx app/admin/group-buy
 Test Files  6 failed (6)
```

Failing for the intended reason: `lib/campaign-form.ts`, `lib/campaign-draft.ts`
and every screen under `app/admin/group-buy` did not exist. Committed as
`1f4fe86`.

**GREEN (same command after implementation):**

```
 Test Files  6 passed (6)
      Tests  61 passed (61)
```

Committed as `3980d0f`.

**One real bug caught by RED, not by review.** The first implementation of
`useCampaignDraft` failed `discard() drops the stored draft`:

```
 ❯ lib/campaign-draft.test.tsx:73:38
     expect(readCampaignDraft('new')).toBeNull();
   → received the blank draft, not null
```

`discard()` cleared storage and reset the form, which changed `draft`, which
re-fired the persist effect and wrote the blank straight back. The rule was
wrong, not the test: storage now holds a draft **only while it differs from what
the form started with**, so an untouched form leaves nothing behind and a draft
edited back to the original drops its own entry.

**RED (nav + redirect):**

```
$ npx vitest run app/admin/layout.test.tsx app/admin/campaigns/redirect.test.tsx
 Test Files  2 failed (2) | 7 tests failed
 → Unable to find an accessible element with the role "link" and name /^group buy$/i
```

GREEN after implementation: 7 passed. Committed as `36fbd47`.

---

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|--------------------|------|------|--------|
| 1 | A blank draft never inherits another campaign; batch defaults to the cap | `lib/campaign-form.test.ts` | unit | PASS |
| 2 | An edit prefills every field; a null description reads as empty, not `"null"` | `lib/campaign-form.test.ts` | unit | PASS |
| 3 | Included products are copied, not aliased into the cached campaign row | `lib/campaign-form.test.ts` | unit | PASS |
| 4 | A cleared price is rejected in the form rather than saved as a ₱0 kit | `lib/campaign-form.test.ts` | unit | PASS |
| 5 | An over-cap batch is refused, naming the cap | `lib/campaign-form.test.ts` | unit | PASS |
| 6 | The payload never carries `status` (lifecycle-owned by `/campaigns/:id/action`) | `lib/campaign-form.test.ts` | unit | PASS |
| 7 | A blank description and deadline are sent as `null`, not `""` | `lib/campaign-form.test.ts` | unit | PASS |
| 8 | **What was typed survives the form unmounting** | `lib/campaign-draft.test.tsx` | unit | PASS |
| 9 | Mounting does not overwrite a stored draft with the blank initial | `lib/campaign-draft.test.tsx` | unit | PASS |
| 10 | Drafts for different campaigns stay apart | `lib/campaign-draft.test.tsx` | unit | PASS |
| 11 | `discard()` and `clear()` leave no stored draft | `lib/campaign-draft.test.tsx` | unit | PASS |
| 12 | An unreadable stored draft is ignored, not thrown | `lib/campaign-draft.test.tsx` | unit | PASS |
| 13 | **Back returns to the campaigns list, not browser history** | `CampaignForm.test.tsx` | component | PASS |
| 14 | **Typing, leaving and returning still shows the entered values** | `CampaignForm.test.tsx` | component | PASS |
| 15 | The restore is announced, and can be discarded | `CampaignForm.test.tsx` | component | PASS |
| 16 | One campaign's draft never leaks into another's form | `CampaignForm.test.tsx` | component | PASS |
| 17 | A rejected save shows its reason and keeps the draft | `CampaignForm.test.tsx` | component | PASS |
| 18 | A successful save clears the draft and returns to the list | `CampaignForm.test.tsx` | component | PASS |
| 19 | Ticked products reach the payload | `CampaignForm.test.tsx` | component | PASS |
| 20 | The board routes to `/new` and `/:id` and opens no form over itself | `campaigns/page.test.tsx` | component | PASS |
| 21 | Approve / extend / cancel / delete still work, with warnings before the destructive two | `campaigns/page.test.tsx` | component | PASS |
| 22 | A completed batch still offers cancel, but not approve | `campaigns/page.test.tsx` | component | PASS |
| 23 | Edit waits for the campaign instead of flashing an empty form | `campaigns/[id]/page.test.tsx` | component | PASS |
| 24 | A missing campaign says so rather than rendering a form that would create a second one | `campaigns/[id]/page.test.tsx` | component | PASS |
| 25 | Create keys its draft under `new`, not a campaign id | `campaigns/new/page.test.tsx` | component | PASS |
| 26 | The breadcrumb shows Admin → Group Buy → Campaigns → Create Campaign | `new/page.test.tsx`, `group-buy/page.test.tsx` | component | PASS |
| 27 | **The section imports nothing from the hatian or product screens** | `isolation.test.ts` | architecture | PASS |
| 28 | **The section calls no hatian or product mutation** | `isolation.test.ts` | architecture | PASS |
| 29 | It takes only campaign hooks + the read-only catalog from the shared admin API | `isolation.test.ts` | architecture | PASS |
| 30 | The nav separates `Group Buy` from `Hatian`; the old entry is gone | `app/admin/layout.test.tsx` | component | PASS |
| 31 | `aria-current` marks the section anywhere inside it, and not its neighbour | `app/admin/layout.test.tsx` | component | PASS |
| 32 | `/admin/campaigns` forwards to the board's new home | `redirect.test.tsx` | component | PASS |

## Coverage

```
$ npx vitest run --coverage app/admin/group-buy app/admin/layout.test.tsx \
    app/admin/campaigns/redirect.test.tsx lib/campaign-form.test.ts lib/campaign-draft.test.tsx

app/admin/campaigns   (redirect)     100 % stmts
app/admin/group-buy   (section)      100 % stmts
  Breadcrumb.tsx                     100 %
app/admin/group-buy/campaigns      95.33 % stmts / 79.41 % branch
lib/campaign-form.ts                 100 % stmts
lib/campaign-draft.ts              98.24 % stmts
```

All new code is above the 80 % target.

Full suite and build:

```
$ npx vitest run          → 103 files, 934 passed
$ npx tsc --noEmit        → exit 0
$ npx next build          → Compiled successfully
  ○ /admin/campaigns              241 B     (redirect only)
  ○ /admin/group-buy              925 B
  ○ /admin/group-buy/campaigns   3.89 kB
  ƒ /admin/group-buy/campaigns/[id] 693 B
  ○ /admin/group-buy/campaigns/new  395 B
```

Build was run with `DATABASE_URL='' PGLITE_PATH='memory://'` so it could not
reach the production Supabase that `.env` points at.

## Decisions worth recording

- **`sessionStorage`, not `localStorage`.** The cart deliberately outlives a
  visit; an abandoned campaign draft should not follow the admin into next week.
- **Back is an explicit destination, not `router.back()`.** Same reasoning
  already written down at `app/cart/page.tsx:19` — the screen is reachable from
  the list and from a deep link, and history would send those two different
  places, one of them out of the workflow entirely.
- **Reading the product catalog is not a Product Management dependency.** The
  form ticks which products a campaign includes; it cannot create, edit or
  archive one. `isolation.test.ts` allows exactly `useAdminProducts` and the
  campaign hooks, and fails on anything else.
- **The hatian board was relabelled `Hatian`.** Confirmed with the user. It sat
  one row from "Group Buy Campaigns" under the near-identical name "Group Buys",
  which is the confusion the request was about.

## Known gaps / follow-ups

- **Two screens were written before their tests.** `app/admin/group-buy/page.tsx`
  and `campaigns/new/page.tsx` are thin routing wrappers; coverage flagged them
  at 0 % and tests were added afterwards. They are GREEN, but they did not go
  through RED first, unlike everything else here.
- **No E2E.** The repo has no Playwright harness; the routed flow is covered at
  the component level only. Clicking through Admin → Group Buy → Campaigns →
  Create in a browser is still worth doing once before release.
- **`perCustomerMin` is still not editable.** It was not editable in the modal
  either — the move preserved the field set rather than growing it.
- **The old board's file is now a redirect.** If anything still deep-links to a
  modal state on `/admin/campaigns` it will land on the list instead. Nothing in
  the repo does.

## Working conditions — concurrent session collision

Partway through, a second Claude Code session was found committing into the same
working tree, on an incompatible design for the same form ("per-product group
buy terms", adding a Quick Edit modal *into* `app/admin/campaigns/page.tsx` —
the file this work replaces with a redirect). Its commit `b4966e0` used broad
staging and swept this task's six untracked test files into itself.

Reported to the user, who chose isolation. This work was moved to a separate git
worktree on `feat/group-buy-page`, branched from `main` (`6c34c5b`) with the
test files restored from `b4966e0`, so it carries none of that session's work.

**This branch and `feat/group-buy-section` both rewrite the campaign form in
incompatible directions. They cannot both be merged as-is.** Whoever merges must
decide whether the per-product terms modal moves onto the routed Create/Edit
pages, or this move is abandoned in favour of the modal.
