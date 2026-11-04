# MGC Pricing: how the numbers are worked out

**Date:** 2026-11-04
**Purpose:** Explain each number in the app, page by page. Please read it, then sign off at the end.
**Keep it current:** When a number changes, update its section and add a line to the change log.

---

## 1. Words used

- **Channel price:** the price on a price list. It has no client-specific terms.
- **Client price:** the price for one client and one product. It includes that client's terms.
- **Margin:** our profit per kg. Each channel has one margin per product.
- **Buffer:** an extra amount per kg on a channel. It can be negative.
- **Premium:** an extra charge per kg for a client. Examples: tank rental, credit risk.
- **Discount:** a reduction per kg for a client. Examples: supply only, competition.
- **Band:** a volume step. Bigger orders get a lower price.
- **Floor:** the lowest price we accept without approval.
- **Version:** one published price list. Each new version is numbered one higher.

---

## 2. How a channel price is worked out

1. Start with the acquisition cost per kg.
2. Add hauling per kg.
3. Add the channel margin per kg.
4. Add the channel buffer per kg.
5. Multiply the total per kg by the content of the cylinder in kg. This is the price per cylinder.

**Example (made-up numbers):** acquisition 60.00 + hauling 2.00 + margin 18.00 + buffer 0.00 = 80.00 per kg. For an 11 kg cylinder: 80.00 × 11 = **880.00 per cylinder.**

No VAT is added. Every price is a net price.

---

## 3. How a client price is worked out

1. Start with acquisition plus hauling.
2. Add the client's margin for this product. If the client has no margin of its own, use the channel margin.
3. Add the client's premiums.
4. Subtract the client's discounts.
5. Add the channel buffer.
6. Multiply by the cylinder content in kg.

Two premiums are worked out from the client's own figures:

- **Installation cost:** total investment ÷ the client's TRMV (kg).
- **Entrusted cylinders:** number of cylinders × cylinder cost ÷ TRMV (kg).

A premium with no rate and no figures is left out. The app shows a note when this happens.

The client's **fixed margin** is shown on screen, but it does **not** change any price. See item L12.

---

## 4. Volume bands

Each product has four bands, based on cylinders per drop:

| Band | Cylinders per drop | Price |
|---|---|---|
| 1 | 1 to 2 | Full price |
| 2 | 3 to 5 | Full price minus one band step |
| 3 | 6 to 10 | Full price minus two band steps |
| 4 | 11 and up | Full price minus three band steps |

The band step is set per product, in pesos per cylinder. A price never goes below zero.

Bands show on the Client Pricing hover and on the Products screen. They are **not** printed on the price list (see L22).

---

## 5. The floor

- **Floor per kg** = acquisition + hauling + margin.
- Premiums, discounts and buffer are not in the floor.
- A client can have its own floor. If it does, that one is used.
- A price below the floor is marked for approval.

The floor definition is still open. See question Q4 below.

---

## 6. Each page

### 6.1 Quote desk (seller)

- **Shows:** each product's price per kg and per cylinder, for one client or for a walk-in customer.
- **Worked out:** the client price (section 3), or the channel price for a walk-in.
- **"Request pending":** a price request for this client and product is waiting for review.
- **"Needs approval":** the price is below the floor and nobody has approved it.
- **Valid until:** issue date + 7 days.
- **Print, save, send email:** available only when the price list is current and at least one line is ticked and not on hold.

### 6.2 Price lists

- **Product table:** the prices saved when that version was published.
- **Client prices:** one row per client product. You can compare with up to two earlier versions.
- **Change column:** this version's price minus the earlier version's price. Increases show in red.
- **Approve button:** records that the channel's list was approved.
- **Flag button:** opens a price request for that client and product.
- **Email button:** opens a new email with the prices typed in. The PDF is attached by hand.

### 6.3 Price Room: Channels board

- **Shows:** up to five channels side by side, one row per product.
- **Each cell:** the channel price per cylinder today. If a proposal changes it, the new price and the difference show too.
- **Price range filter:** shows only prices between the minimum and maximum you enter.

### 6.4 Price Room: Client Pricing

This is the main working screen for each channel.

**Top row (Acq, Hauling, Margin, Buffer):**
- These numbers are used only for the future prices on this screen.
- Total Acq = Acq + Hauling. A blank hauling uses the current hauling.
- These numbers do **not** change any price until you press Save.

**Commercial and Bulk, per client product:**

- **Current price:** the client price today.
- **Future price:** (Total Acq + Margin + Buffer + Premiums − Discounts) × cylinder content.
  - **Margin:** the client's own margin if it has one. Otherwise the margin waiting in a proposal. Otherwise the top-row margin.
  - **Buffer:** the buffer waiting in a proposal, or the top-row buffer.
  - **Premiums and discounts:** the client's amounts, including anything waiting in a proposal.
  - If Acq, Margin or Buffer is blank, the future price shows "—".
- **Margin column:** the client's own margin, in a small badge over the cell. A dashed badge means it is waiting in a proposal.
- **Hover on the future price:** shows the band prices. The band that matches the client's drop is highlighted.
- **Price history columns:** show past prices for the client. They are empty in the demo (see L21).
- **Save:** does not change prices directly. It adds the changes to the open proposal.

**Dealer channel:** see 6.5.

### 6.5 Price Room: Dealer sheet

- **Rows:** SRP and Dealer Price, for each product that Price Watch tracks.
- **Future price:** (Total Acq + top-row Margin + top-row Buffer) × cylinder content. Premiums and discounts are **not** included (see L14).
- **Our prices:** the current Dealer price, CODO, Dealer pick-up and Semi-dealer.
- **Competitor prices:** the newest reading for each competitor. The difference is the reading minus the future price. Old readings are marked "stale".
- **Final price column:** you can type a number, but it is not saved (see L14).

### 6.6 Price Room: Price History

- **Columns:** one per version, newest first.
- **Cells:** the saved price for that version.
- **Colour:** red means the price went up from the version before. Green means it went down.
- **Sub-version rows:** approved price requests, shown under the version they belong to.
- **Approved by:** shows only the first approver (see L20).

### 6.7 Price Room: PL Notices

- **Table:** each staff member against each channel. Shows whether they approved the channel's current list.
- **Count:** approved out of total, for the current version.
- **Email log:** the emails sent for the current version.

### 6.8 Price Room: MPL calculator (proposals)

A proposal goes through four steps: **Draft → Simulate → Review → Publish.**

1. **Draft:** add a channel margin or a channel buffer.
2. **Simulate:** calculates the new prices, and the monthly change in money. Nothing is saved.
   - Monthly change = change per kg × average monthly volume.
   - Clients with no volume figure are left out, and the number left out is shown.
   - It also lists clients who would fall below floor.
3. **Review:** two approvers must each press Approve.
4. **Publish:** creates the next version. The old version keeps its prices.

Each published version gets a fingerprint (a hash) of its date, changes and review. This shows the version was not changed later.

**Open proposals list:** every proposal not yet published, with its status and approvals.

**Preview:** all open proposals feed the future prices in Client Pricing.

### 6.9 Price Watch (competitor readings)

- **Due this week:** each tracked competitor in a zone with no reading in the last 7 days.
- **Outlier check:** if a new price is more than 10% away from the last reading for the same zone, product and competitor, the app asks you to confirm.
- **Recent readings:** the last 12 readings. Old ones are marked.
- **Photo:** required for every reading.

### 6.10 Price requests

- **Who can ask:** bulk and commercial clients only.
- **Current price:** the client's price today, without approved sub-versions (see L15).
- **Difference:** current price minus requested price.
- **Submit:** requested price must be lower than current, and a reason is required.
- **Save as draft:** no check on the price.
- **Margin effect (managers only):** shows what the margin becomes if the request is approved.
- **Number:** PR-year-number, counting up each year.
- **Approve:** the final price must be above zero and below the current price. Approved requests get a sub-version number, such as v5.1. The discount applies until the next version is published.
- **Cancel:** a reason is required.

### 6.11 Notifications bell

- **Number on the bell:** requests waiting for a decision. Managers only.
- **Panel:** requests waiting, and the three newest sub-versions.
- **Exception warnings:** the app works these out, but does not show them (see L11). They are:
  - Below floor (red).
  - Contract expired (red), or ending within 30 days (amber).
  - Behind contract pace (amber). Pace = volume ÷ TRMV, compared with time used so far.
  - No competitor reading for 7 days in a zone (amber).
  - A competitor cheaper than our client price in the same zone (amber).

### 6.12 Log (admin only)

- Shows every change, in order.
- **Issues:** the last 7 days, grouped by proposal.
- Other tabs group the same changes by channel, client, competitor, user or product.

### 6.13 Configuration

- **Users:** at least two managers or admins must remain. Each change is logged.
- **Access:** admin only. Sets what each role can see and do.
- **Channels:** a channel can be removed only when no clients or products use it.
- **Products sold per channel:** adding a product needs a starting margin. The change goes into a proposal.
- **Products:** changes to content or band step go into a proposal. The screen then shows the old value again (see L16).
- **Zones and competitors:** renaming keeps the old readings and clients. Removing needs them unused.
- **Clients (CSV import):** the app previews the file first. Rows with errors are skipped and listed.
- **Client edit:** basic details save straight away. Fixed margin and total investment go into a proposal.
- **Usable kg:** sum of tank sizes × tank count × 90% × 60%.

---

## 7. Values saved but not used

- **VAT rate (12%) and "VAT inclusive":** stored, not used (see L23).
- **Fixed margin:** shown and saved, but it does not change any price (see L12).
- **"May draft" tick box:** stored, not used (see L10).
- **Seeded acknowledgments:** stored, not shown (see L19).
- **Quote records:** the app never creates them (see L18).

---

## 8. Questions to answer

- **Q1. Floor:** should the floor include premiums and discounts? Today it does not.
- **Q2. VAT:** should prices show VAT? If yes, inclusive or added on top?
- **Q3. Dealer future price:** should it include premiums and discounts, like Client Pricing does?
- **Q4. Price requests:** should a new request be measured against the approved sub-version price, not the version price?

---

## 9. Sign-off

Please mark each section.

| Section | Approve | Change needed | Comment |
|---|---|---|---|
| 2. Channel price | ☐ | ☐ | |
| 3. Client price | ☐ | ☐ | |
| 4. Volume bands | ☐ | ☐ | |
| 5. Floor | ☐ | ☐ | |
| 6.1 Quote desk | ☐ | ☐ | |
| 6.2 Price lists | ☐ | ☐ | |
| 6.3 Channels board | ☐ | ☐ | |
| 6.4 Client Pricing | ☐ | ☐ | |
| 6.5 Dealer sheet | ☐ | ☐ | |
| 6.6 Price History | ☐ | ☐ | |
| 6.7 PL Notices | ☐ | ☐ | |
| 6.8 Proposals | ☐ | ☐ | |
| 6.9 Price Watch | ☐ | ☐ | |
| 6.10 Price requests | ☐ | ☐ | |
| 6.11 Notifications | ☐ | ☐ | |
| 6.12 Log | ☐ | ☐ | |
| 6.13 Configuration | ☐ | ☐ | |

Answers to Q1 to Q4: ____________________________________________

Name: ____________________________ Date: ______________ Signature: ____________________

---

## Change log

- **2026-11-04.** Rewritten in plain language. Sign-off section added.
- **2026-11-03.** First version.
