# MGC Pricing: calculations per page

**Last reviewed:** 2026-11-03. Checked against the code at commit `3ce6b5c` plus the uncommitted working changes (including the deleted `db/schema*.sql` files).
**Method:** read from the code. Nothing here was run in a browser. The engine's own tests are in `engine.test.html`; run them before trusting a change to a formula.

**Keep this file current.** When a change alters a formula, a rounding rule, a default, or what a screen shows, update the section for that page. If it touches the engine or a shared rule, update section 1 as well. Add a line to the change log at the bottom.

---

## 1. Shared rules

These apply on several pages. Each one is computed in one place, and every screen reads from it.

**Money.** All amounts are whole centavos (integers). Display goes through `fmt` in [js/money.js](js/money.js). Rounding is half away from zero, to whole centavos. The engine rounds once per ladder step ([js/engine.js:39](js/engine.js:39), `resolvePrice`).

**Channel price** (the price on a price list, with no client terms):

- Ladder per kg: acquisition cost + hauling + channel margin + channel buffer.
- Each step is rounded on its own. Net per kg is the running sum.
- Per cylinder = round(net per kg × content kg).
- Gross per cylinder equals net per cylinder. No VAT is added (see section 4).
- Source: `priceFor` with no account ([js/pricing.js:127](js/pricing.js:127)), then `boardPrices` ([js/pricing.js:180](js/pricing.js:180)).

**Client price** (one client, one product):

- Ladder per kg: acquisition + hauling + product margin + premiums − discounts + buffer.
- Product margin: the client's own margin for that product if set, otherwise the channel margin. The client's **fixed margin is not in this chain** (reference only).
- Premiums: each premium row on the client. A fixed rate comes from the catalogue. Two codes are derived:
  - `ROI_INSTALL` = investment ÷ TRMV kg.
  - `ENTRUSTED_CYL` = cylinder count × cylinder cost ÷ TRMV kg.
  - A premium with no rate and no formula input is skipped, with a note.
- Discounts: each discount row that has a rate. Also added: the approved price-request discount (`APPROVED_EXCEPTION`), and the product's own premium and discount.
- Per cylinder = round(net per kg × content kg).

**Volume bands** (`VOLUME_BANDS`, [js/pricing.js:178](js/pricing.js:178)): 1–2, 3–5, 6–10 and 11 & up cylinders per drop. Band k price = max(0, version price − band step × k). The step is per product (`volStepCentavos`). Bands show in the Client Pricing hover and on the Products screen. They are **not printed** on the price list.

**Floor** (`defaultFloorPerKg`, [js/engine.js:19](js/engine.js:19)): acquisition + hauling + margin, with no premiums, discounts or buffer. A client's `floorOverridePerKg` replaces it when set. Below floor means net per kg is under the floor. This feeds the quote's "Needs approval" flag, the red exceptions, and the simulation's "newly below floor" count.

**Current price for a price request** (`currentFor`, [js/price-requests.js:16](js/price-requests.js:16)): the client's price ignoring approved sub-versions. See limitation L15.

**Simulation** (`simulate`, [js/pricing.js:346](js/pricing.js:346)): prices before and after the proposal, for every channel and product that has a margin before or after, and for every active client with a main product. Monthly impact = sum of round(change per kg × average monthly volume kg). Clients with no volume are excluded and counted.

**Staleness.** A competitor reading is stale after `settings.competitorStaleDays` (7) days ([js/pricing.js:201](js/pricing.js:201)). A price list is stale when the cost basis is newer than the list ([js/pricing.js:53](js/pricing.js:53)). A stale list blocks printing, saving and emailing on the Quote desk.

---

## 2. Pages

### Sign-in and shell (`index.html`)

- No calculations. With a database configured, the sign-in form is shown first. The header badge reads "Database" or "Local only".
- Every database write that fails shows "Not saved" and leaves the screen as it was.

### Tour (`js/views/tour.js`, `js/tours.js`)

- No calculations. Text and links only. Seller and manager only.

### Quote desk (`js/views/quote.js`), seller route

Not in the seller's menu. Reached by URL `#/quote`.

- **Customer.** A client from the search, or a walk-in with a channel.
- **Lines.** Every product sold on the channel (`skusForChannel`), each priced with `priceFor`. The client's terms apply when a client is chosen. Net per kg and per cylinder are shown. The seller does not see the floor or the ladder.
- **Line status.**
  - "Request pending": a price request for this client and product is in Review.
  - "Needs approval": net per kg is below floor and there is no approved exception.
  - Held lines are left off the printed and emailed list.
- **Print, Save price list, Send email** are enabled only when the list is not stale and at least one line is selectable and not held.
- **Valid until** = issue date + `settings.quoteValidityDays` (7). A past quote shows "Expired" under Past quotes.
- **Email** writes two events: `PRICE_LIST_ISSUED` and `PL_EMAIL_SENT`. It saves the address on the client if it is new.
- The Past quotes list reads the `quotes` table. No code path creates a quote record (L18).

### Price lists (`js/views/board.js`)

**Index.** Lists the channels the user can see.

**Channel page:**

- **Product table.** The stored snapshot for the version shown: net per kg and gross per cylinder. Falls back to a live calculation only when no snapshot exists.
- **Client prices.** One row per client product. The current figure is the version's stored `clientPrices` snapshot, or a live calculation for the current version when no snapshot exists.
  - Compare with up to two earlier versions.
  - Change = current − compared version, per cylinder. An increase shows red.
- **Approve channel.** Writes `channelApprovals` on the version. Shown to anyone with access to the channel (L6).
- **Flag.** Opens the price request form for that client and product.
- **Email.** Opens a mail draft with the lines as text. The PDF is attached by hand.
- Superseded banner when an older version is open. Stale banner when the cost basis is newer than the list.

### Price Room: Channels board (`js/views/priceroom.js`, `channelsBoard`)

- Shows up to five channels picked by the user.
- Rows are products priced on those channels, or priced in the open proposal.
- Each cell shows the channel price per cylinder now, and the proposed price with its change when the open proposal alters it.
- Price range filter (₱ per cylinder, min and max) applies to every shown price, current or proposed.

### Price Room: Client Pricing (`js/views/clientgrid.js`)

One page per channel: Commercial, Bulk, Dealer and the other channels.

**Top row inputs** (`js/session.js`). Acq, Hauling cost, Total Acq, Margin and Buffer. Total Acq = Acq + Hauling. A blank hauling uses the current hauling. These values are kept in this browser only. They drive the future prices, and do not change any price until saved to a proposal.

**Commercial and Bulk** (one row per client product):

- **Current price** = client price for that product (`priceFor`), with the latest approved sub-version label beside it.
- **Future price** per cylinder (`futureValue`, [js/views/clientgrid.js:469](js/views/clientgrid.js:469)) = round((Total Acq + Margin + Buffer + Premiums − Discounts) × content kg).
  - **Margin:** the client's margin for this product (pending in a proposal first, then saved), else the channel margin in a pending proposal, else the top-row margin.
  - **Buffer:** the buffer in a pending proposal, else the top-row buffer.
  - **Premiums:** the total of the premium columns (for ROI, investment ÷ TRMV when the ₱/kg is blank), plus the client's other premiums, plus the product's premium (pending or saved).
  - **Discounts:** the same, for the discount columns.
  - Shows "—" when Acq, Margin or Buffer is blank.
- **Margin column.** A floating client margin chip (dashed when it is waiting in a proposal), the channel margin for reference, and the input.
- **Premiums and Discounts** totals per client, from the columns beside them.
- **Hover on future price.** Band prices from the future price, with the band that matches the client's volume per drop highlighted.
- **Bulk hover on current price.** Margin, acquisition, hauling and buffer behind the price.
- **Price history columns** (toggle) read dated snapshots from `state.clientPriceHistory`. That data only exists in database mode (L21). The demo shows "—".
- **Client name** opens the client terms drawer (view only). The Edit link goes to Configuration.
- **Filters.** Clients (multi-select and search), products (Commercial), and the price range on the main product price.
- **Save.** Creates proposal changes; it never writes a price directly:
  - Acq and Hauling, only when different from current, and only with cost-edit access.
  - Buffer, only when different and with buffer-edit access.
  - Premium and discount rows per client and code, when different.
  - Product margin, premium and discount, per client and product, when different.

**Dealer** (`js/views/dealersheet.js`):

- Rows: SRP and Dealer Price, under each Price Watch product. Internal prices use the product's first active variant.
- **Future price** = round((Total Acq + top-row margin + top-row buffer) × content kg) (`computedFuturePrice`, [js/views/dealersheet.js:38](js/views/dealersheet.js:38)). **No premiums or discounts** are included, which differs from Commercial (L14).
- **Own columns:** Current (published Dealer price), CODO (CBK channel, live), Dealer pick-up (Dealer channel, live), Semi-dealer (Retail outlet, live).
- **Competitor columns:** newest reading for each partner, product, basis and service. Difference = reading − future price. Stale readings are marked.
- **Final price** is typed in and kept in memory only. It is not saved (L14).

### Price Room: Price History (`priceHistoryTab`)

- Columns are versions, newest first. Filter by product and from/to version.
- Rows: channel prices per product. Each cell is the stored price for that version. Red or green marks a change from the version before it.
- Sub-version rows: approved price requests, placed under the version they belong to.
- "Approved by": the first APPROVE event whose proposal published that version (L20).
- Sub-version table: before, after, approver and date for each approved request.

### Price Room: PL Notices (`noticesTab`)

- Matrix: staff (not messengers) by channel. "Approved" when the version has that channel's approval. "Not approved" when the person's channels include it. "·" otherwise.
- Count shows approved over total for the current version.
- Email log: rows for the current version.
- Seeded acknowledgments are not read here (L19).

### Price Room: MPL calculator (`js/views/priceroom-wizard.js`)

Stages: Draft, Review, Approved. Simulate sits between Draft and Review.

- **Draft.** The calculator offers two change types: channel margin (channel, product, ₱ per kg) and channel buffer (₱ per kg, negative allowed). Acquisition, hauling, client and product changes come from Client Pricing and Configuration.
- **Simulate.** Runs `simulate` on a copy. Shows channel changes, client changes, monthly impact, clients newly below floor, and competitor crossings.
- **Review.** Lists channel prices per cylinder before and after, and the number of client prices that change. Shows approval pills for the two approvers.
- **Publish.** Creates version = current + 1 via `applyChanges`. Rows are versioned: the current row gets an end date and a new row is added. Stores the channel snapshot and the client snapshot. Stores `snapshotHash`, a SHA-256 of version, time, changes and review. The fallback on `file://` is labelled FNV-1a.
- **Open proposals sheet.** Lists every unpublished proposal, its status, approvals (for example "1/2"), changes, drafter and time.
- **Preview.** The changes in every open proposal, plus the one being drafted, feed Client Pricing's future prices and margins (`pendingAll`).

### Price Watch (`js/views/market.js`)

- **Due this week.** For each tracked brand with a zone: due when there is no reading for that zone and brand, or the newest is older than 7 days.
- **Today.** Readings this user has submitted today.
- **Outlier check.** When the new price is more than 10% away from the newest reading for the same zone, product and brand, it asks for confirmation and shows the percentage.
- **Recent readings.** The latest 12. Stale ones are marked with their age.
- **Zone** defaults from the brand's zone.
- **Price** is stored in centavos. A photo is required. Submit requires a database connection (L13).

### Price Requests (`js/views/requests.js`, `js/price-requests.js`)

- **Clients:** bulk and commercial only. **Products:** the client's own list, or every product on its channel if none is set.
- **Current price:** `currentFor` (ignores approved sub-versions, L15).
- **Difference shown** = current − requested, when above zero.
- **Submit for review:** requested price must be below current, and a reason is required.
- **Save as draft:** only requires a price above zero.
- **Margin implication** (managers only): new margin = current margin − round((current − requested) ÷ content kg).
- **Number:** `PR-YYYY-NNNN`, one above the highest in the year.
- **Approve** (`decide`): final price defaults to the requested price and must be above zero and below the current price stored at submission. Sub-version = `v{version}.{n}`, where n counts approved requests under that version, across all clients. The approved discount per kg = round((current − final) ÷ content kg). It applies to the client's pricing until the next version.
- **Cancel:** a reason is required.

### Notifications bell (`js/notify.js`)

- **Count:** requests in Review. Shown only to users who can see approvals.
- **Panel for managers:** requests waiting, and the three newest sub-versions of the current version.
- **Exceptions** (`exceptions`, [js/pricing.js:406](js/pricing.js:406)) are calculated but not drawn (L11). The rules are:
  - Below floor (red).
  - Contract expired (red), or ending within 30 days (amber).
  - Behind TRMV pace: volume ÷ TRMV is less than the share of contract time elapsed (amber).
  - No competitor reading in 7 days for a zone (amber).
  - A competitor is lower than the client's price for the same zone and product (amber).

### Log (`js/views/log.js`, admin only)

- **Issues:** events from the last 7 days, grouped by proposal, with the cause shown.
- **Channels, Clients, Competitors, Users, Products:** the same events grouped by that item. Products also shows a price table by version.
- Each event's text is built from its own `after` fields. No new calculations.

### Configuration (`js/views/config.js`)

- **Users.** Saves only if at least two managers or admins remain, and at least one price list for sellers and viewers. Logs what changed.
- **Access matrix.** Admin only. Roles by part, plus per-person overrides. "Same as role" removes an override.
- **Channels.** Order, add, rename. Remove only when no clients and no priced products.
- **Products sold per channel.** Ticking a product needs a starting margin, which goes to the proposal. Unticking goes to the proposal as a channel product removal.
- **Products.** Name, content kg, band step (₱ per cylinder), Price Watch, sold, variants. Content and band step changes go to the proposal and the field is reset to its old value (L16). Remove only when unused.
- **Zones and competitor brands.** Renaming carries readings and clients across. Remove only when unused.
- **Clients (CSV import).**
  - Channel matched by ID, label or audience (prefix allowed).
  - Clients matched by Account ID, then by name.
  - Merge or replace. Rows with errors are skipped and listed.
  - Main product falls back to 11 kg MGas when none is given and it is priced.
  - Premium codes take an optional ₱ per kg. Discounts need a rate.
- **Client editor.** Basic record, then terms. Fixed margin and total investment are price levers and go to the proposal. Other terms save directly.
- **Usable kg** (`usableKg`, [js/clientterms.js:41](js/clientterms.js:41)) = Σ tanks × capacity × 0.9 × 0.6.

---

## 3. Calculated values that are stored but not used

- `settings.vatRate` (0.12) and `vatInclusive` are in the seed. No code reads them (L23).
- `fixedMarginPerKg` is shown, editable and sent to proposals, but no price uses it (L12).
- `user.canDraft` is stored and shown, but drafting is decided by the Draft access level (L10).
- `acknowledgments` in the seed are not displayed (L19).
- `quotes` have no code that writes them (L18).
- The inline client editor in Configuration (`saveInline`) has no inputs rendered, so it cannot run (L31).
- `store.exportJson`, `store.importJson` and `store.reset` have no button in the app.

---

## 4. Open questions that change formulas

These are decided by you, not by code. Each one changes a number on the pages above.

- **Floor.** The README still lists the floor definition as open. Today it is acquisition + hauling + margin, with no premiums or discounts.
- **VAT.** Prices carry no VAT. Is quotation or the price list to show VAT, and how (inclusive or on top)?
- **Future price, Dealer sheet.** Should it include premiums and discounts, as Client Pricing does?
- **Approved sub-versions in price requests.** Should a new request be measured against the sub-version price, not the version price?

---

## Change log

- **2026-11-03.** First version, from the code at `3ce6b5c` plus working changes.
