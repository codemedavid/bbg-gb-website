# WhatsApp and Viber beside the wordmark on the home header

**Branch:** `main`
**Date:** 2026-09-07
**Source plan:** none — journeys derived during this TDD run from the client's
request: "Pwede po palagay ang whatsapp at viber ko bandang taas? sa homepage.
Sa tabi ng bbg peptides?" with the number +63 991 446 2762 and a screenshot of
the storefront header.

## The gap

Every kahati question BBG answers — is this batch still open, did my proof
land, can I pasalo my slot — arrives in a WhatsApp or Viber thread. The number
itself was only ever handed out inside those threads and in the Messenger
group, so a visitor who reaches bbgph.org cold had no way to start one: the
header carried a cart, an Orders shortcut and an avatar, and nothing that
reaches a person.

The two links now sit immediately after the wordmark, which is the first thing
read on the page, and they render for signed-out visitors too — the people most
likely to want to ask something before they commit a vial.

## User journeys

1. As a visitor who lands on bbgph.org without knowing BBG, I want to open a
   WhatsApp chat from the top of the homepage, so that I can ask before I
   commit a vial.
2. As a Viber user, I want the same number as a Viber chat, so that I do not
   have to install a second app to reach BBG.
3. As a shopper on a 320px phone, I want the header to stay one line, so that
   the chat buttons do not push the wordmark or the cart out of shape.

## Task report

### 1. One number, two link formats

`lib/contact.ts` — `SUPPORT_PHONE = '+63 991 446 2762'`, with `whatsappUrl()`
and `viberUrl()` derived from it. The two apps disagree about the "+": wa.me
takes bare digits and shows "phone number shared via url is invalid" for an
escaped plus, while Viber matches on the E.164 form and without the country
code opens a chat with whoever holds that number locally. Deriving both from
one constant is what stops the pair drifting apart the next time the number
changes.

- RED: `npx vitest run lib/contact.test.ts` →
  `Error: Failed to load url ./contact … Does the file exist?`, no tests.
- GREEN: same command → 6 passed.

### 2. The two marks in the header

`components/ChatShortcuts.tsx`, rendered by `AppHeader` between the wordmark
and the cart group. Plain `<a>`, not `next/link`: wa.me leaves the app and
`viber://` is a protocol handoff to the phone, neither of which the router
should try to own. WhatsApp opens in its own tab with
`rel="noreferrer noopener"`; the Viber link has no target, since a protocol
handler would leave an empty tab behind. Brand colours rather than the BBG
palette — a WhatsApp button in BBG green reads as one more site control, and
the point is that it is recognised at a glance.

- RED: `npx vitest run components/headers.test.tsx` → 4 failed / 8 passed,
  `Unable to find an accessible element with the role "link" and name /whatsapp/i`.
- GREEN: same command → 12 passed.

### 3. Keep the 320px header on one line

The first headless render at 320px showed the cost: with two more controls in
the row, flexbox compressed the wordmark and broke it over two lines — "BBG"
above "Peptides" — doubling the height of the header. The marks step down to
28px below 400px, the wordmark is pinned `flex-none whitespace-nowrap` at 16px,
and the header's gap and horizontal padding tighten on the same breakpoint.

Measured in headless Chrome, signed out and with the signed-in controls
(Orders pill + avatar in place of Log in) injected into the row:

| Width | `documentElement.scrollWidth` vs `clientWidth` | Wordmark |
|-------|----------------------------------------------|----------|
| 320 signed out | 320 / 320 | one line, 99px uncompressed |
| 320 signed in (simulated) | 320 / 320 | one line, 99px uncompressed |
| 390 | 390 / 390 | one line |
| 768 | 768 / 768 | one line |
| 1440 | 1440 / 1440 | one line |

Before the breakpoint work the same simulated signed-in row measured 321
against a 320 viewport with the wordmark compressed to 74px.

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|--------------------|------|------|--------|
| 1 | The support number is published in the form a customer reads | `lib/contact.test.ts:is the number BBG answers on` | unit | PASS |
| 2 | wa.me is addressed with digits only, whatever punctuation the number is written with | `lib/contact.test.ts:addresses wa.me with digits only`, `:tolerates a number written with dashes and parentheses` | unit | PASS |
| 3 | Viber gets the country code as an escaped plus | `lib/contact.test.ts:keeps the country code as an escaped plus` | unit | PASS |
| 4 | Both links default to the BBG number rather than needing it passed in | `lib/contact.test.ts:defaults to the BBG support number` (×2) | unit | PASS |
| 5 | The home header offers a WhatsApp link and a Viber link to that number | `components/headers.test.tsx:offers WhatsApp and Viber links to the BBG number` | component | PASS |
| 6 | They sit after the wordmark and before the cart controls | `components/headers.test.tsx:sits after the wordmark and before the cart controls` | component | PASS |
| 7 | WhatsApp opens in its own tab without handing over the referrer | `components/headers.test.tsx:opens WhatsApp in its own tab without handing it the referrer` | component | PASS |
| 8 | Signing in does not take the chat links away | `components/headers.test.tsx:stays put once the customer is signed in` | component | PASS |

## Coverage and known gaps

- Whole suite: `npx vitest run` — see the run recorded in the commit for this
  change.
- The links are on the home header (`AppHeader`) only, which is what was asked
  for. The board headers (`SectionHeader` on Kahati, Group Buy, MOQ, Search,
  Account) and `BackHeader` are unchanged; adding them there is a one-line
  change to each if BBG wants the same reach from every tab.
- Deep links are not exercised end to end: a headless browser has neither
  WhatsApp nor Viber installed, so the tests assert the URLs, and the URLs
  themselves were checked against each app's documented format.
- The number lives in source, not in admin settings. It changes about as often
  as the domain does; a settings row can come later if that stops being true.

## Merge evidence

- RED `665ec97` — `test: require the home header to offer WhatsApp and Viber`
- GREEN `50b642b` — `feat: put BBG's WhatsApp and Viber beside the wordmark on the home header`
