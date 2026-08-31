# Orders: a header shortcut beside the cart

## Source plan

No `*.plan.md`. Derived during this TDD run from the request:

> *"the orders in the accounts add a shortcut beside the cart"*

## The gap

My Orders gave up its bottom-nav slot when the tab bar ran out of room at
320px (see the comment in `components/BottomNav.tsx`). Its replacement was a
single card on the Account page, which made it the **only** entrance to
`/orders`: two taps, and only for a customer who guesses that "Account" is
where a delivery is tracked.

The cart already had the opposite treatment — `CartShortcut` rides
`SectionHeader`, so it is one tap from every board tab. Orders is at least as
common a reason to open the app, and it had nothing in the header at all.

## User journeys

1. As a signed-in customer browsing the Kahati board, I want to reach My
   Orders from the header, so that I can check a delivery without first
   finding the Account tab.
2. As a signed-in customer landing on Home, I want the same shortcut beside
   the cart, so that the entrance does not disappear on the one screen I
   always start from.
3. As a signed-out visitor, I want not to be offered the shortcut, so that I
   am not sent to a login wall by a control that looks like a feature.

## Decisions

**Both headers, one component.** `OrdersShortcut` goes into `SectionHeader`
(Kahati, Group Buy, MOQ, Search, Settle, Calc, Orders, Account) and
`AppHeader` (Home). Leaving Home out would have put a gap in the one screen a
returning customer always sees first.

**Placed after the cart, before the avatar.** "Beside the cart" is the ask;
sitting between the cart and the account avatar also groups the two
*my-own-records* controls together and leaves the cart where muscle memory
expects it.

**Hidden when signed out, and while auth resolves.** `/orders` redirects
anonymous visitors to `/login`. Auth resolves after first paint, so rendering
the link eagerly would flash it in and then yank it away.

**The word drops below 400px.** The pill carries 📦 + "Orders", but the word is
`hidden xs:inline`. At 320px the cart pill (~96px), this control and the 36px
avatar together leave a board title like "🤝 Kahati Board" no room. The
`aria-label="My orders"` carries the meaning at every width, so nothing is lost
to a screen reader. This mirrors the greeting in `AppHeader`, which already
hides below `xs`.

**The Account card stays.** The header pill cannot say "Track status · download
COA · settle hatian". The card is the described route; the pill is the fast one.

## Task report

### 1. Add the shortcut component

Wrote `components/OrdersShortcut.test.tsx` first, covering the link target, the
accessible name, the visible word, and both suppressed states.

RED — the module did not exist:

```
❯ components/OrdersShortcut.test.tsx (0 test)
```

GREEN after `components/OrdersShortcut.tsx`:

```
✓ components/OrdersShortcut.test.tsx (5 tests) 78ms
```

### 2. Place it beside the cart in both headers

Added a `describe('Orders shortcut in the headers')` block to
`components/headers.test.tsx`, asserting DOM adjacency to the cart control in
each header and absence for a signed-out visitor. The existing static
`useAuth` mock became a mutable `auth` binding so the signed-in case is
reachable.

RED:

```
× Orders shortcut in the headers > sits beside the cart on a board header when signed in
  → Unable to find an accessible element with the role "link" and name "My orders"
```

GREEN after wiring `<OrdersShortcut />` into `AppHeader` and `SectionHeader`:

```
✓ components/headers.test.tsx (8 tests) 145ms
```

### 3. Keep the Account card guarded

`app/(storefront)/account/page.test.tsx` selected its card with
`getByRole('link', { name: /orders/i })`, which the new header pill also
matches — the whole file failed on "Found multiple elements". The guarantee
was unchanged, only the selector was ambiguous, so it now matches the card's
own description (`/track status/i`). The card itself was not touched.

```
✓ app/(storefront)/account/page.test.tsx (5 tests) 199ms
```

## Test specification

| # | What is guaranteed | Test file or command | Test type | Result | Evidence |
|---|--------------------|----------------------|-----------|--------|----------|
| 1 | The shortcut points at `/orders` | `components/OrdersShortcut.test.tsx:links to My Orders` | unit | PASS | `npx vitest run components/OrdersShortcut.test.tsx` |
| 2 | It has the accessible name "My orders", not a bare emoji | `components/OrdersShortcut.test.tsx:names itself for screen readers…` | unit | PASS | same |
| 3 | It carries the visible word, not just the icon | `components/OrdersShortcut.test.tsx:carries the word, not just the icon` | unit | PASS | same |
| 4 | A signed-out visitor is offered nothing | `components/OrdersShortcut.test.tsx:renders nothing for a signed-out visitor` | unit | PASS | same |
| 5 | Nothing renders while auth is still resolving | `components/OrdersShortcut.test.tsx:renders nothing while auth is still resolving` | unit | PASS | same |
| 6 | On a board header it sits directly after the cart | `components/headers.test.tsx:sits beside the cart on a board header when signed in` | unit | PASS | `npx vitest run components/headers.test.tsx` |
| 7 | On the home header it sits directly after the cart | `components/headers.test.tsx:sits beside the cart on the home header when signed in` | unit | PASS | same |
| 8 | Neither header shows it to a signed-out visitor, and the cart still shows | `components/headers.test.tsx:is absent from a board header…` / `…from the home header…` | unit | PASS | same |
| 9 | The Account page still leads with its own My Orders card, above the forms | `app/(storefront)/account/page.test.tsx` (5 tests) | unit | PASS | `npx vitest run "app/(storefront)/account/page.test.tsx"` |

## Coverage

```
npx vitest run components/headers.test.tsx components/OrdersShortcut.test.tsx \
  "app/(storefront)/account/page.test.tsx" --coverage \
  --coverage.include='components/OrdersShortcut.tsx' \
  --coverage.include='components/headers.tsx' --coverage.reporter=text

File               | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
 ...rsShortcut.tsx |     100 |      100 |     100 |     100 |
 headers.tsx       |     100 |    84.61 |   83.33 |     100 | 18,39
```

`components/OrdersShortcut.tsx` is fully covered. The two uncovered branches in
`headers.tsx` are pre-existing and untouched by this change: the `AuthControl`
loading skeleton (line 18) and the optional `greeting` in `AppHeader` (line 39).

Whole-suite regression check: `npx vitest run` — **242 files, 2601 tests passed**.
Types: `npx tsc --noEmit` — clean.

## Known gaps

- **Not verified in a real browser.** The `hidden xs:inline` width behaviour and
  the 320px header fit are reasoned from measurements, not screenshotted. jsdom
  applies no Tailwind CSS, so test 3 proves the word is in the markup, not that
  it is visible at a given width. A visual pass at 320/375/400px would close this.
- **The home header's cart button has no accessible name.** `CartButton` renders
  a bare 🛒 with no `aria-label`, so the AppHeader placement test matches it by
  `href` instead of by role name. Pre-existing, out of scope here, worth fixing.
- **No E2E.** The journeys above are covered at component level only.

## Merge evidence

If these commits are squashed, the RED/GREEN record is:

- `e909cb4` `test: add reproducer for the missing Orders header shortcut` — RED:
  `components/OrdersShortcut.test.tsx (0 test)` plus "Unable to find an
  accessible element with the role 'link' and name 'My orders'" in both headers.
- `e4f261c` `feat: put an Orders shortcut beside the cart in the storefront headers`
  — GREEN: 18 tests across the three files; full suite 2601 passed; tsc clean.
- refactor: stale `SectionHeader` comment updated to describe both shortcuts;
  tests re-run green.
