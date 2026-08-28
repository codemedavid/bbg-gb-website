# Orders moves into Account so MOQ fits beside On-hand

**Branch:** `feat/group-buy-page`
**Date:** 2026-08-28
**Source plan:** none — journeys derived during this TDD run from the reported
symptom: "the moq is still not next to the on-hand in the bottom nav bar, i
think because it's too crowded; we will change the layout, orders is going to
be in the account."

## The bug

The previous cycle seated the MOQ tab directly after On-hand in the DOM
(`8f7f244`), and that ordering was correct. It was still not what the customer
saw. Eight tabs each reserving `min-w-[54px]` claim 432px, and the bar is
`overflow-x-auto`: on a 320px phone the strip scrolls, the last ~112px sits off
screen, and MOQ — the sixth of eight — is clipped at the right edge rather than
reading as On-hand's pair.

The fix is a layout change, not another reorder. Orders gives up its slot and
moves onto the Account page, leaving six fixed tabs plus the conditional MOQ
tab, and each tab's reserved width drops to 44px so seven of them (308px) fit
inside 320px with nothing to scroll.

## User journeys

1. As a shopper on a 320px phone, I want every tab visible at once, so that MOQ
   sits next to On-hand where I can see it instead of past the fold.
2. As a shopper, I want My Orders reachable from Account, so that dropping the
   Orders tab does not strand my own order history.
3. As an admin, I want the MOQ tab to keep appearing only while the MOQ page is
   switched on, so that the bar never links to a route that 404s.

## Task report

### 1. Take Orders off the tab bar

`components/BottomNav.tsx` — `/orders` removed from `TABS`; the fixed list is
now Home, Search, Kahati, Group Buy, On-hand, Account. `MOQ_AFTER = '/shop'` is
unchanged, so MOQ still splices in directly after On-hand.

- RED: `npx vitest run components/BottomNav.test.tsx` → 8 failed / 8 passed.
  `expected 432 to be less than or equal to 320`, and Orders still present.
- GREEN: same command → 16 passed.

### 2. Fit seven tabs inside 320px

Per-tab reserved width `min-w-[54px]` → `min-w-[44px]` (7 × 44 = 308 ≤ 320), and
the tighter label size now triggers at more than six tabs rather than more than
seven, so the MOQ-on bar keeps `text-[9px]`.

- Guarantee: the summed reserved width of every rendered tab never exceeds 320,
  with MOQ on or off — JSDOM cannot measure layout, so the test parses the
  `min-w-[Npx]` class off each tab and sums it.

### 3. Stop the labels touching at 320px

A headless 320px render of the seven-tab bar showed everything fitting, but
"Group Buy" (~44px at 9px in a 45.7px column) ran flush into "On-hand" with no
gap — the crowding the report was actually about. The MOQ-on label size became
`text-[8.5px] tracking-tight`; six tabs keep `text-[9.5px]` untightened.

- RED: `npx vitest run components/BottomNav.test.tsx` → 1 failed / 15 passed
  (`expected '...text-[9px]...' to contain 'text-[8.5px]'`).
- GREEN: same command → 16 passed.

### 4. Give Account the Orders entrance

`app/(storefront)/account/page.tsx` — a full-width `My Orders` row leads the
page, above the profile forms, linking to `/orders`. The section subtitle now
reads "Orders · profile · shipping address · password".

- RED: `npx vitest run 'app/(storefront)/account/page.test.tsx'` → 3 failed / 2 passed
  (`Unable to find an accessible element with the role "link" and name /orders/i`).
- GREEN: same command → 5 passed.

One RED assertion was itself wrong and was corrected during GREEN: "puts the
orders link first" asserted `links[0]`, but `SectionHeader` renders a cart link
ahead of all page content. The guarantee was restated against document order —
the orders link precedes the Profile heading — which is what the journey
actually claims.

## Test specification

| # | What is guaranteed | Test file or command | Type | Result |
|---|--------------------|----------------------|------|--------|
| 1 | The bar renders six fixed tabs when MOQ is off, seven when on | `components/BottomNav.test.tsx` | unit | PASS |
| 2 | No tab is labelled Orders and no tab links to `/orders`, with MOQ on or off | `components/BottomNav.test.tsx:BottomNav Orders tab removal` | unit | PASS |
| 3 | MOQ renders directly after On-hand | `components/BottomNav.test.tsx:places the MOQ tab directly after On-hand` | unit | PASS |
| 4 | Reserved tab width totals ≤ 320px with MOQ on and off | `components/BottomNav.test.tsx:fits all seven tabs on a 320px screen` | unit | PASS |
| 5 | Every tab keeps a 44px tap target and never wraps its label | `components/BottomNav.test.tsx:keeps each tab from shrinking` | unit | PASS |
| 6 | One consistent label size across the bar; `text-[8.5px] tracking-tight` only when MOQ is present, `text-[9.5px]` untightened otherwise | `components/BottomNav.test.tsx:BottomNav compact typography` | unit | PASS |
| 7 | An unresolved MOQ setting is treated as off, so no tab flashes in | `components/BottomNav.test.tsx:treats an unresolved setting as off` | unit | PASS |
| 8 | Account links to `/orders`, labelled "My Orders" | `app/(storefront)/account/page.test.tsx` | unit | PASS |
| 9 | The orders link renders above the profile forms | `app/(storefront)/account/page.test.tsx:puts the orders link above` | unit | PASS |
| 10 | Profile, shipping address and password cards still render | `app/(storefront)/account/page.test.tsx:still renders the profile` | unit | PASS |
| 11 | A signed-out visitor is redirected to `/login` and sees no orders link | `app/(storefront)/account/page.test.tsx:sends a signed-out visitor` | unit | PASS |

## Validation

```
npx vitest run components/BottomNav.test.tsx 'app/(storefront)/account/page.test.tsx'
  RED   → Tests  11 failed | 10 passed (21)
  GREEN → Tests  21 passed (21)

npx vitest run
  Test Files  234 passed (234)
  Tests       2493 passed (2493)

npx tsc --noEmit --pretty false
  exit 0
```

A first full-suite run alongside a concurrent vitest run and `tsc` reported 15
failures across 10 unrelated files (kahati sweeps, settlements). Re-run alone,
the same files pass — those are load flakes from running two suites at once
against per-file in-memory PGlite, not regressions from this change.

## Browser check

JSDOM has no layout engine, so the widths were confirmed in headless Chrome
against the dev server's compiled Tailwind CSS, with the nav markup rendered
inside fixed-width frames (`--headless=new --screenshot`, scratchpad
`nav-final.html`):

| Case | Result |
|------|--------|
| 7 tabs @ 320px | All seven on screen, no sideways scroll; MOQ sits between On-hand and Account; labels visibly separated |
| 6 tabs @ 320px | Comfortable spacing |
| 7 tabs @ 430px (`max-w-app`, the framed desktop width) | Roomy; MOQ clearly paired with On-hand |

The same harness is what caught the touching labels: at `text-[9px]` the 320px
frame rendered "Group BuyOn-hand" as one run of text.

## Known gaps

- The 320px fit is pinned in unit tests only by the reserved-width classes; the
  rendered text width has no automated regression guard, so a future label
  rename needs the browser check above repeated.
- `/orders` itself is unchanged and still handles its own signed-out state,
  because settlement emails link straight to it.

## Checkpoints

| Stage | Commit |
|-------|--------|
| RED | `2a77e74` test: pin Orders out of the tab bar and into Account |
| GREEN | `c55e7b6` fix: move Orders into Account so MOQ fits beside On-hand |
| RED+GREEN (label size) | `a29e7ee` fix: stop the group-buy and on-hand labels touching at 320px |
