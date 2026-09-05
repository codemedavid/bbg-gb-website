# On-hand: the 10+ vial discounted rate

## Source plan

No `*.plan.md`. Derived during this TDD run from a screenshot of the live
`bbgph.org` admin product form and the report:

> *"in the onhand this is what the user is seeing but the price is wrong since
> the admin set the discounted price when the client bought 10 or more vials it
> should apply the discounted price"*

followed by the shape the client wants:

> *"how can we implement a clear discounted price in the admin page … so that the
> admin will enter a discounted per vial price? so that in the website when the
> user entered 10 vial it will automatically show congrats you got the 10 vial
> discounted price and they will see the crossed original price on the side …
> and when its not 10 it should add a note that checkout 10 or more vials to get
> more discount"*

## The defect

`products.on_hand_ten_vial_php` was **write-only**. `drizzle/0026` added the
column and the admin form saved into it, but nothing read it back:

- `GET /api/products` and `GET /api/products/[id]` did not select it, so the
  storefront was never even sent the figure;
- `onHandUnitPrice()` knew only `piece` and `kit`;
- `POST /api/orders` re-priced every on-hand line at the piece price.

The product in the screenshot states ₱700 a vial and ₱6,500 for ten. A customer
stepping the quantity to ten was charged **₱7,000** — the discount the admin had
entered existed in the database and nowhere else.

## Decisions

**The rate is per-vial and applies to every vial at 10+.** Ten vials is ₱6,500,
twelve is ₱7,800, twenty-three is ₱14,950. Chosen over a blocks-plus-remainder
bundle because it is what the client described ("when the client bought 10 or
more vials it should apply the discounted price"), and because it keeps ONE
per-unit price on a line — which is what the cart, the order item row and the
checkout payload are all shaped to carry.

**The admin types a per-vial rate; the column keeps storing a ten-vial total.**
The admin thinks in "₱650 a vial if you take ten", so that is the input. The
column already holds ten-vial totals in production, so the form converts in both
directions (`bulkVialFromTen` / `tenFromBulkVial`) rather than a migration
rewriting live pricing data. No schema change — see `prod-db-schema-drift`.

**Piece lines only.** A kit is already ten vials at a kit price of its own;
applying a ten-vial discount to it would be the same discount twice.

**A rate that is not cheaper is not a discount.** `onHandBulkVialPrice()` returns
null when the figure is at or above the piece price, so a typo that RAISES the
price can never be presented to a customer as a saving, and the admin form says
so as it is typed.

## User journeys

1. As an admin, I want to type the discounted per-vial price for 10+ vials and
   see immediately what ten vials comes to and what it saves.
2. As an admin, I want to be told when the rate I typed is not actually cheaper
   than the piece price.
3. As a customer under ten vials, I want to be told how many more vials unlock
   the cheaper rate and what that rate is.
4. As a customer at ten vials or more, I want to be congratulated, see the old
   per-vial price struck through beside the new one, and see what I saved.
5. As a customer, I want the cart to gain and lose the discount as I step the
   quantity across ten — not freeze whatever price applied when I hit Add.
6. As a customer, I want checkout to charge the rate I was just shown.

## Task report

### 1. The rule (`lib/pricing.ts`)

`ON_HAND_BULK_MIN_VIALS = 10`. `onHandBulkVialPrice()` divides the stored
ten-vial figure back to a per-vial rate, rejecting absent, zero, negative and
not-actually-cheaper values, and any product not sold per piece.

`onHandQuote(product, unit, qty)` returns the whole answer together — charged
unit price, list unit price, whether the bulk rate applied, how many vials are
still needed, the line total and the saving. Every surface reads this one
function, which is what keeps the price shown and the price charged identical.

`onHandSpecSnapshot()` writes `On-hand · per piece · 10+ vial price` onto the
order line, so a ₱650 vial on a ₱700 shelf is still explainable months later.

12 tests in `lib/pricing.test.ts`.

### 2. The money path

`POST /api/orders` and `lib/order-edit-server.ts` (the admin order editor) both
price through `onHandQuote`. 7 tests in `app/api/orders/on-hand-bulk.test.ts`
cover below/at/above the threshold, the snapshot, a product with no rate, a rate
dearer than the piece price, and a kit line.

### 3. The cart

`CartItem` gains `bulkUnitPricePhp`. `lineUnitPrice` / `lineTotalPhp` /
`isBulkPriced` / `vialsToBulk` derive the price from the line's CURRENT quantity,
and `subtotal()` and `groupCartByMode()` run through them — so stepping 9 → 10
re-prices the cart, and 10 → 9 puts the list price back. 6 tests in
`lib/store/cart.test.ts`.

The product page and the shelf's quick-add both put the LIST price plus the rate
on the line, never the discounted figure alone, so a line stepped back below ten
cannot keep a discount it no longer qualifies for.

### 4. The storefront

`components/OnHandBulkPrice.tsx` renders the nudge below the threshold and the
congratulation at it, with the struck-through list price carrying an
`aria-label` (a screen reader is told the relationship rather than reading two
prices with nothing to connect them). 7 tests.

The product page headline shows the struck price beside the discounted one, and
a live `qty × rate = total` line under the stepper. The cart and the checkout
items card both mark a bulk-priced line.

### 5. The admin form

Field relabelled to `Discounted price / vial at 10+ ₱`, converting to and from
the stored ten-vial figure. Live hints below it: `10 vials = ₱6,500 · saves ₱500`,
and a warning when the rate is not cheaper than the piece price. 5 tests in
`app/admin/products/page.test.tsx`.

## Not done

`lib/order-calc.ts` (the `/order-calc` quote page) still prices every vial at the
piece price. `CalcProduct` does not carry the bulk rate and the page is
documented as an estimate, so it is left as-is — but a customer quoting ten vials
there sees ₱7,000 against a checkout that charges ₱6,500. Worth closing next.

## Verification

`npx tsc --noEmit` clean. Full suite: 241 files, 2592 tests, green.
