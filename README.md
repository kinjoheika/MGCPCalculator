# MGC Pricing — HTML prototype

> **Still open: the floor definition.** The prototype uses
> `floor_per_kg = acq + hauling + margin(channel, sku)` — net of premiums and buffer.
> Discounts may not push the final price below it without an approved request.
> Each account has `floorOverridePerKg` so a real floor can be set later without touching the engine.
> **Do not treat this as settled.**

A working calculator, logger and decision tool for LPG pricing. Static HTML and vanilla JS modules plus one seed JSON. No build, no npm, no server code.

## Run

```bash
cd mgc-pricing
python serve.py 8000
```

Open http://localhost:8000/. Engine tests: http://localhost:8000/engine.test.html.

`serve.py` is `http.server` with `Cache-Control: no-store`, so an edited file is never served from a stale browser cache. `python3 -m http.server 8000` also works, but after an update reload with Ctrl+Shift+R or you may run a mix of old and new files.

Serve it over HTTP. Browsers block ES modules and `fetch` on `file://`, and `crypto.subtle` (SHA-256 snapshot hashes) needs `localhost` or HTTPS.

## Screens

| Route | Role | What it is |
|---|---|---|
| `#/quote` | seller | Quote desk: customer → **All products** price list, or one product with quantity. No editable price field, no floor or ladder shown. Send quote, Request lower, Print, Save price list, Past quotes |
| `#/priceroom` | manager | Clients board, Products board, Channels board (compare up to 5 each), PL notices. The **MPL calculator** and **Exceptions** live in a sliding panel on the right; changes added in the calculator are previewed on every board until published |
| `#/market` | messenger | Competitor price watch: readings with a required photo. No MGC prices |
| `#/board/:channelId` | manager, seller (own), viewer (own) | Price list: Acknowledge, Print, Save |
| `#/log` | manager | Append-only event log, four views |
| `#/config` | manager | Users and roles; clients list with CSV import / export |

## Documents

Print, Save price list and Send quote all use one template (`js/pricedoc.js`): short bond (8.5 × 11 in) portrait, drawn on a canvas and saved as a one-page PDF with no library. Send quote downloads the quotation PDF; Past quotes can reprint it from the immutable snapshot. On the Quote desk, printing or saving a customer price list is gated like sending (current price list, no pending request, no unapproved below-floor price) and logged as `PRICE_LIST_ISSUED`; lines that need approval are left off.

## Client pricing grid

Price room → **Client pricing**, or the channel buttons inside the MPL calculator. One page per channel: clients down the side, line types across the top.

- **Current price offered** is view only, with MPL (acquisition + margin) and Margin (margin + buffer) underneath.
- **Two column groups.** *Premiums*: Total premium (view only, updating as you type), Installation cost for ROI, Credit risk / bad debts. *Discounts*: Supply only, Competition (dual supplier), Cash / zero-rated (short term).
- Every cell takes **several rows per client** — an investment amount (ROI only), a ₱/kg and a note. A blank ₱/kg on an ROI row divides the investment by the client's TRMV. Fields open with the last saved amounts.
- **The client name expands** its terms, **view only**: install date, LPG content billing, factor rate, tank ownership, tank counts by size (with 60% of 90% capacity computed), minimum kilograms per drop, fixed margin, total investment, required volume per month, start date and total generated volume. Edit them in **Configuration → Clients → Edit terms**, where they are saved and logged as `CLIENT_TERMS_SAVED`.
- **One Save button** adds every premium and discount edit to the open MPL proposal; they take effect on Publish.
- A **fixed margin** on a client replaces the channel margin, and moves that client's floor with it.

In the calculator itself, premiums and discounts are now one entry type: pick the client, then any component (premiums shown with +, discounts with −).

## Importing clients

Configuration → Clients. Choose a CSV (or paste rows from Google Sheets), check the preview, then import. Required columns: **Name, Channel, Status**. Optional: Account ID, Needs attention, Zone, Main product, Contract start / end, TRMV kg, Volume generated kg, Avg monthly volume kg, Credit term days, Floor override per kg, Premiums (`TANK_RENTAL; CREDIT_30`), Discounts (`DUAL_SUPPLIER=6.25`), Competitor brand, Installation investment, Entrusted cylinders, Cylinder cost. "Download template" gives a ready header row. Clients match by Account ID, then by name; a column left out keeps the client's current value. "Active but needs attention" imports as Inactive with the needs-attention flag. Rows with errors are skipped and listed. The import is logged.

**Role switcher.** "Acting as" in the header stands in for auth. Routes a role can't reach are never rendered — the view module isn't even loaded.

## Checks and balances it enforces

1. **No price typing.** Sellers cannot enter a price. Below floor, Send is disabled; the only route is Request lower, which requires a reason and a competitor reading.
2. **Freshness gate.** If the cost basis is newer than the published board, quotes cannot be sent.
3. **Simulate before approve.** Price changes go Draft → Simulate → Review → Approve → Publish, in order. Simulation writes nothing but its own log event.
4. **Four eyes.** Approval needs `instructedBy` and `verifiedBy`, and the verifier cannot be the drafter.
5. **Immutable quotes and versioned prices.** A sent quote stores the full engine input and output with a SHA-256 hash. Price rows are never updated; publish closes the old version (`effectiveTo`) and inserts a new one.
6. **The log is not optional.** Every mutation goes through `store.commit(event, mutationFn)`, the same call that changes the data. There is no "add log entry" button.

Also: competitor readings older than 7 days render greyed with their age; a reading more than 10% off the last one for that brand, zone and product must be confirmed.

## Files

```
js/engine.js     pure pricing function — no DOM, no imports, no clock. Ports verbatim.
js/money.js      integer centavos, half-up rounding, ₱ formatting
js/store.js      seed load, localStorage (key mgc_pricing_v1), commit(), export/import/reset
js/pricing.js    store-aware selectors: effective-dated lookups, account pricing, simulation, exceptions
js/router.js     hash router and role gate
js/ui.js         small DOM helpers
js/views/*       one module per screen (priceroom-wizard.js holds the five-step change flow)
data/seed.json   seed data
engine.test.html browser test page for the engine
```

## Seed data

The seed holds the cost basis (₱65.50 acquisition, ₱2.25 hauling), channel × product margins, the premium and discount catalogue, 10 sample clients and 3 competitor readings. User names are placeholders — edit them in Configuration → Users, or in `data/seed.json` and then Reset demo data.

It also holds `settings` (VAT 12%, quote validity 7 days), per-channel `buffers`, `primarySkuId` on each client (used for exceptions and monthly impact), `trackedBrands` (drives the weekly competitor checklist), and empty `publications`, `proposals`, `quotes`, `priceRequests`, `acknowledgments`, `events` collections.

## Pricing rules

- Order: `(acq + hauling) + margin + premiums − discounts + buffer`, then VAT on the per-cylinder net.
- All money is integer centavos. Each ladder step rounds half-up (away from zero) to a whole centavo; per-cylinder and VAT round once each.
- The 11 kg MGas dealer price reproduces ₱943.25 per cylinder, net of VAT.
- An approved price request adds an "Approved price exception" discount for that customer and product for 7 days and allows sending below floor.

## Demo tools

Header buttons: **Reset demo data** (wipes localStorage, reloads the seed), **Export JSON** and **Import JSON** (hand a session to someone else).

## Port path

`engine.js` moves to `packages/pricing-engine`. `store.commit()` becomes API calls; the event object is the `event_log` row. Seed keys become tables; `effectiveFrom/effectiveTo` become `tstzrange` with an exclusion constraint. Money stays `bigint` centavos end to end.
