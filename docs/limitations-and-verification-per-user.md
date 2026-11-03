# MGC Pricing: limitations and verification, per user

**Last reviewed:** 2026-11-03. Checked against the code at commit `3ce6b5c` plus the uncommitted working changes, and against the database rule files in `db/private-*.sql`.
**Method:** read from the code and the SQL. Nothing was clicked through in a browser. Every item below is marked **code-read** until a test in section 7 has been run and confirmed.

**Keep this file current.** When a change alters what a role can see or click, update section 3 for that role. When a limitation is fixed, move it to the "Fixed" list at the bottom with the date. When a new one is found, add it with the next free number, because `calculations-per-page.md` refers to these numbers.

---

## 1. How access is enforced

Access has four layers. Each one can be wrong on its own.

1. **Menu.** `navFor` in [js/router.js:57](js/router.js:57) decides which items each role sees.
2. **Route.** `canAccess` in [js/router.js:27](js/router.js:27) decides whether a page loads. A page that is not allowed shows "Not available". Typing the address is enough to reach a page that is not in the menu.
3. **Control.** Each button checks an access level (`canView`, `canEdit`, `canApprove` in [js/access.js](js/access.js)), or does not check anything. Several do not (L4, L7, L8).
4. **Database** (database mode only). Row rules in `db/private-*.sql`. These are **temporarily admin-only for most writes** (L1).

**Levels:** None 0, View 1, Edit 2, Approve 3. Role defaults are in `ROLE_DEFAULTS` ([js/access.js:31](js/access.js:31)). Per-person overrides are set by an Admin in Configuration.

**Who you are in the local (demo) app.** The app has no sign-in and no user switcher (L2). It acts as the user stored in the browser (key `mgc_pricing_v1_user`), and defaults to Manager 1. To test another role, set that key in the browser console to a user id from section 2, then reload:

```js
localStorage.setItem('mgc_pricing_v1_user', 'u_sales_1'); location.reload();
```

---

## 2. Users in the seed file

| Id | Name in the seed | Role | Price lists | May draft | May approve | Notes |
|---|---|---|---|---|---|---|
| `u_sales_1` | Sales Assistant 1 | seller | Commercial, End user | no | no | |
| `u_sales_2` | Sales Assistant 2 | seller | Dealer, Retail outlet | no | no | |
| `u_mgr_1` | Manager 1 | manager | all | yes | no | The default user in the local app |
| `u_mgr_2` | Manager 2 | manager | all | no | **yes** | The only approver in the seed (L3) |
| `u_admin_1` | Admin | admin | all | no | no | |
| `u_msgr_1` | Messenger 1 | messenger | none | no | no | |
| `u_msgr_2` | Messenger 2 | messenger | none | no | no | |
| `u_view_acct` | Accounting viewer | viewer | MGSA only | no | no | Role is viewer, not accounting |

**Accounting** is a role with no user in the seed. The local app creates "Accounting 1" (all price lists) only if no accounting user exists ([js/store.js:112](js/store.js:112)). Its access is in section 3.

---

## 3. What each role sees and can click

### 3.1 Menu and landing page

| Menu item | Seller | Manager | Admin | Viewer | Messenger | Accounting |
|---|---|---|---|---|---|---|
| Tour | yes | yes | no | no | no | no |
| Quote desk | **URL only** | no | no | no | no | no |
| Price Room | yes: Channels board, Client Pricing, Price History | yes: same three | yes: all four tabs | yes: Channels board, Price History | no | yes: Channels, Client Pricing, Price History |
| MPL calculator panel | no | yes | yes | no | no | yes (view only) |
| Price Watch | yes | yes | yes | yes | **only item** | yes |
| Price Requests | under Price Watch | under Price Watch | own item | no | no | no |
| Price Lists | yes (landing) | yes | yes | yes, MGSA only | no | yes |
| Log | no | no | yes | no | no | no |
| Configuration | **URL only** | **URL only** | yes | no | no | no |
| Notifications bell | no | yes (requests panel) | yes | no | no | yes (empty panel) |
| Landing page | Price lists | Price Room | Price Room | Price Room | Price Watch | Price Room |

The seller and manager menus do not include Configuration or Log (or Quote desk for a seller). They are reachable from links on other pages and from the address bar (L32).

### 3.2 Seller (`u_sales_1`, `u_sales_2`)

**Clickable**

- Price Room tabs: Channels board, Client Pricing, Price History. The Channels board, Client Pricing and Price History show every channel, not only the seller's own (L9).
- Client Pricing: client name (opens the terms drawer), filters, price range, Flag.
- Client Pricing: the margin input (not greyed out) and **Save**, which can add a margin change to the open proposal (L8).
- Price Lists for the seller's channels: Print, Save, Email, **Approve channel** (L6), Flag.
- Price Requests: list, New request, form (Save as draft, Submit for review), open a request, Edit draft for own drafts.
- Price Watch: readings form (needs a database and a photo, L13), due list, recent list.
- Quote desk at `#/quote` (not in the menu): customer search, product ticks, Print, Save price list, Send email, Past quotes (empty, L18).

**Not clickable or hidden**

- Premium and discount inputs in Client Pricing: read-only.
- MPL calculator button: clickable, but the panel closes again because the seller has no calculator access. It appears to do nothing (code-read).
- Notifications bell: hidden.
- Log: not available.

**Limitations that apply here:** L6, L8, L9, L13, L18, L32.

### 3.3 Manager 1 (`u_mgr_1`)

**Clickable**

- All Price Room tabs. The Notices tab is not in the menu, but opens by address (`#/priceroom?tab=notices`).
- MPL calculator: add margin and buffer changes, Simulate, Share link, Open proposals sheet, Continue to review.
- Review stage: **Approve** is shown, but clicking it returns "Only the two approvers can approve this proposal" (not an approver).
- Publish: disabled, with the tip "Your access does not include publishing" (correct).
- Price Requests: list and open each request. Approve and Cancel are not shown; the page says "Waiting for a manager to decide" (correct by default, L5).
- Price lists: approve any channel (L6).
- Configuration by address: Channels, Products, Zones, Competitors and Clients all have save buttons, which work (L7). Users shows "Only an Admin manages users and access."
- Bell: appears with an empty panel, because this user cannot decide requests (L28).

**Not clickable or hidden:** Access matrix and Users editing (admin only), Log, publish.

**Limitations that apply here:** L4, L5, L6, L7, L8, L10 (the "May draft" box is ticked but does nothing), L11, L28.

### 3.4 Manager 2 (`u_mgr_2`, the seeded approver)

**Clickable**

- Everything Manager 1 can click, plus:
- Review stage: **Approve** works only if a second approver is ticked. With the seed, it shows "Two approvers must be ticked as 'May approve' in Configuration → Users" (L3).
- Publish: enabled after both approvals. Publish requires `mpl_publish` at Approve level, which the seed gives this user (`store.init` adds the override in the local app only, [js/store.js:117](js/store.js:117)).
- Price Requests: Approve at this price and Cancel request, on requests in Review. Cancel needs a reason.
- Bell: lists requests waiting, and the three newest sub-versions. Clicking a request opens it.

**Limitations that apply here:** L3, L4, L5 (the overrides depend on how the database was provisioned in database mode), L6, L7, L11, L15.

### 3.5 Admin (`u_admin_1`)

**Clickable**

- All Price Room tabs and the MPL calculator, including publish (Approve level by default).
- Configuration: every tab. Users (add, role, price lists, May draft, May approve, remove) and the access matrix, including per-person overrides.
- Log: all six views.
- Price Requests: decide, as an approver of requests.

**Not clickable or limited**

- Approve on a proposal: the admin is not ticked "May approve" in the seed, so the button says "Only the two approvers can approve this proposal" (L3, L4).
- Remove on the admin's own user row is disabled, to stop a lock-out.

**Limitations that apply here:** L1 (in database mode, the admin is the only role that can write most data), L3, L4, L11, L25.

### 3.6 Viewer (`u_view_acct`, MGSA)

**Clickable**

- Price Room: Channels board (all channels, L9) and Price History with its filters.
- Price Lists: MGSA page only. Print, Save, Email, **Approve MGSA price list** (L6).
- Flag on a client line: the button is clickable but leads to "Not available" (L33).
- Price Watch: the readings form (L13). This user can submit a reading in local mode.

**Not clickable or hidden:** MPL calculator, Client Pricing, PL Notices, Price Requests, Configuration, bell.

**Limitations that apply here:** L6, L9, L13, L33.

### 3.7 Messenger (`u_msgr_1`, `u_msgr_2`)

**Clickable**

- Price Watch only: readings form (photo and database required), due list, recent list.

**Not clickable or hidden:** every other menu item. The address of any other page shows "Not available".

**Limitations that apply here:** L13 (in database mode, the messenger's readings are blocked by the admin-only rule on competitor readings).

### 3.8 Accounting (role, no seeded user)

**Clickable**

- Price Room: Channels board, Client Pricing, Price History. MPL panel in view mode.
- Client Pricing: premium and cash-discount inputs are editable (their Edit level allows it), and **Save** adds them to the open proposal. This role cannot draft (L8).
- Price Lists: all channels.

**Limitations that apply here:** L8, L9, L28.

---

## 4. Limitations

Severity: **High** = wrong or blocked results a user will meet. **Medium** = wrong or misleading in a case that will come up. **Low** = cosmetic, or only in an unusual case.

### High

- **L1. Database writes are admin-only for most tables.** `db/private-5a-admin-write.sql` and `db/private-5b-admin-write.sql` give write access only to the admin role on proposals, price requests, quotes, competitor readings, events (insert), client records, margins, cost basis, buffers, publications and settings. The files say they are temporary and to be replaced "once the access questions are answered." In database mode, a manager's draft, a seller's price request, a messenger's reading and an approval all fail with "Not saved." Verify in section 7, test D2. (code-read from SQL.)
- **L2. The local app has no sign-in and no user switcher.** Anyone with the file acts as the stored user. Testing a role means setting the browser key (section 1). The demo file has a picker, but the real app does not. (code-read.)
- **L3. The seed has one approver.** Only `u_mgr_2` has "May approve" ticked. The app needs exactly two ([js/views/priceroom-wizard.js:468](js/views/priceroom-wizard.js:468)). As shipped, no proposal can be approved, and the admin is the only one who can tick a second approver. (code-read from `data/seed.json`.)
- **L4. The "May approve" box decides approval, not the access level.** Approval reads `canApprove` on the user ([js/views/priceroom-wizard.js:26](js/views/priceroom-wizard.js:26)). The "Review and approve a proposal" level (`mpl_approve`) is never read. Changing it in the access matrix does nothing. Publish does read `mpl_publish`, so the two settings can disagree. (code-read.)
- **L5. Manager defaults cannot decide requests or publish.** Managers default to View on "Review and approve" and "Publish" (`ROLE_DEFAULTS`, [js/access.js:34](js/access.js:34)), and Edit on "Price requests", where Approve is needed. So Manager 1 cannot decide requests or publish. Manager 2 has overrides only because of the local load code ([js/store.js:117](js/store.js:117)). In database mode, the overrides depend on what `tools/provision.mjs` wrote. (code-read.)
- **L6. Any user with access to a channel can approve its price list.** `approveChannel` checks only channel membership ([js/views/board.js:144](js/views/board.js:144)). So a seller, viewer or manager can approve, and no level is needed. (code-read.)
- **L7. Configuration saves are not checked against access.** Channels, products, zones, competitor brands and clients save for anyone who reaches `#/config`. Sellers and managers reach it by address, and their menus do not show it. Users and the access matrix are admin only. (code-read; in database mode the admin-only table rules block most of these saves for non-admins, L1.)
- **L11. The bell does not show exceptions.** The bell computes the exception list ([js/notify.js:44](js/notify.js:44)) but never draws it. The "Show all" control it refers to (`#nf-all`) is never rendered, so anything beyond 20 rows would be unreachable anyway. Below-floor, contract, TRMV-pace and stale-reading warnings reach no screen. (code-read.)
- **L13. Price Watch cannot save in local mode, and messengers are blocked in database mode.** Submit needs `db.enabled` and a photo ([js/views/market.js:141](js/views/market.js:141)). Local mode shows "Photos are saved to the database. Connect it first." In database mode, the admin-only rule on competitor readings blocks messengers (L1). (code-read.)

### Medium

- **L8. Client Pricing margin is not checked against access.** The margin input has no read-only setting, and its save path has no level check ([js/views/clientgrid.js:719-733](js/views/clientgrid.js:719)). A seller or accounting user can type a client's margin and save it into the open proposal. Premiums and discounts do check access. (code-read.)
- **L9. Channel scope is not applied.** The Channels board, Client Pricing and Price History list every channel. A seller or viewer sees other channels' prices and clients, though the Price lists page is limited to their own channels. (code-read.)
- **L12. The fixed margin lever has no price effect.** Fixed margin is shown in client terms, and its change goes into the proposal as a lever ([js/views/config.js:811](js/views/config.js:811)). No price reads it. Changing it alters a proposal and not a price. (code-read.)
- **L14. Two future prices disagree, and the Dealer final price is lost.** The Dealer sheet's future price leaves out premiums and discounts, and uses the top-row margin and buffer. Client Pricing's future price includes them. The Dealer sheet's "Final price" input is held in memory and lost on reload. (code-read.)
- **L15. Price requests compare against the version price.** `currentFor` ignores approved sub-versions, so a second request for the same client is measured against the price before the first approval. Approval also checks "below current" against the price stored at submission, not at decision time. (code-read.)
- **L16. Band step and content edits do not save directly.** Products routes these edits to the proposal and resets the field to its old value ([js/views/config.js:437-446](js/views/config.js:437)). The saved number therefore looks unchanged, which is the "cannot save" report. Decision needed (section 6). (code-read.)
- **L17. Top-row acquisition and hauling can enter a margin proposal.** Save in Client Pricing adds Acq and Hauling changes when they differ from current, even when the work was meant to be a margin change ([js/views/clientgrid.js:560-563](js/views/clientgrid.js:560)). Decision needed (section 6). (code-read.)
- **L18. Quotes are never recorded.** No code writes the `quotes` table, so Past quotes is always empty, and `QUOTE_SENT` never fires. Only the price-list email is logged. (code-read.)
- **L19. PL Notices ignores seeded acknowledgments.** It reads `channelApprovals` on the version. The seed's version 5 has none, so the notices show zero of N approved, even though the seed holds acknowledgments ([js/views/priceroom.js:264](js/views/priceroom.js:264)). (code-read.)
- **L21. Client price history exists only in database mode.** The Client Pricing history columns read `clientPriceHistory`, which is loaded only from the database. The demo shows "—" in every history column. (code-read.)
- **L23. VAT is not used.** `vatRate` (12%) and `vatInclusive` are in the seed. No code reads them, and prices carry no VAT. (code-read; a business question first, section 6.)
- **L24. The floor definition is open.** The README says so. Today it is acquisition + hauling + margin, with no premiums or discounts. (code-read.)
- **L25. In local mode, the event log is editable.** Local data and the log are plain browser storage. The "append-only" rule holds only by convention in the app. In database mode, the insert-only event rule applies. (code-read.)
- **L30. The README and database setup are out of date.** The README's screen table and steps refer to `db/schema.sql`, which is deleted in the working tree (`git status` shows `D db/schema.sql`), and to screens that have changed. (code-read.)

### Low

- **L10. "May draft" does nothing.** The box is stored and shown, but drafting is decided by the Draft access level ([js/views/priceroom-wizard.js:216](js/views/priceroom-wizard.js:216)). (code-read.)
- **L20. "Approved by" shows one name.** It shows the first approval event for the version, not both approvers. The Publish stage shows both. (code-read.)
- **L22. Volume bands are not printed.** They appear only in hover tips and on the Products screen. (code-read.)
- **L26. Monthly impact uses average volume only.** It ignores contract volume and TRMV. (code-read.)
- **L27. The Log's Issues view shows the last 7 days only.** Older events are in the other views. (code-read.)
- **L28. Empty bell panel.** Users who can see approvals but not decide requests see an empty panel. (code-read.)
- **L29. Price requests are visible to every role that can open the page.** This is by design (the list says so), but a seller sees other sellers' requests. (code-read.)
- **L31. Dead code.** The inline client editor in Configuration (`saveInline`, `data-ci`) has no inputs rendered, so it cannot run. (code-read.)
- **L32. The Tour sends a seller to Configuration.** Step 5 says "Opens Configuration", but a seller's menu has no Configuration item (`navFor`). (code-read.)
- **L33. Flag leads to "Not available" for viewers.** The button shows on the Price lists page for anyone with channel access, but the request form is for sellers and managers. (code-read.)

---

## 5. Fixed

None yet.

---

## 6. Decisions needed before some items can be fixed

These come from your own requests and need an answer from you. None of them is decided by the code.

1. **Band step and content (L16).** Keep them in the proposal (needs approval), or save them straight to Products?
2. **Top-row acquisition and hauling (L17).** Should a Client Pricing save create cost changes at all, or should cost changes go only through the calculator's own cost step?
3. **Manager access (L4, L5).** Raise "Review and approve" and "Publish" for managers, or only for named managers? And should approval follow the access level or the "May approve" box?
4. **Who approves a channel's price list (L6).** Managers only? Or no one, with approval moved into the proposal?
5. **Configuration (L7).** Limit it to admins, or to managers for the lists they run?
6. **Database write rules (L1).** When will the temporary admin-only rules be replaced by role rules? The Supabase plan in `C:\Users\Alex Co\.claude\plans\graceful-painting-cocoa.md` describes role-based policies, and would close L1 and L13.
7. **VAT (L23)** and **floor (L24)**, as listed in `calculations-per-page.md` section 4.

---

## 7. Verification

### 7.1 Automatic

- **Engine tests.** Open `engine.test.html` in the local app (served over HTTP). It holds a set of checks on the price engine, including rounding and premium and discount rows. Run this before and after any change to `js/engine.js` or `js/pricing.js`. (Not run for this review.)

### 7.2 Manual, per user

Run these in order. "Expect" is what should happen. If the result differs, record the step number against the limitation it relates to.

**A. Seller (`u_sales_1`)**

1. Set the user (section 1). Expect the menu: Tour, Price Room, Price Watch, Price Lists. No Quote desk and no Configuration.
2. Open Price Room, then Client Pricing. Change the channel to Dealer. **Expect (L9):** it lists the Dealer channel, which this seller does not hold.
3. Type a number in a client's margin input and press Save. **Expect (L8):** a change appears in the open proposal list.
4. Open Price Lists, then the Commercial page. Press Approve. **Expect (L6):** the list is approved, although a seller should not be able to.
5. Open `#/config` by address. **Expect (L7):** save buttons present and working.

**B. Manager without approval (`u_mgr_1`)**

1. Set the user. Expect the menu: Tour, Price Room, Price Watch, Price Lists. No Configuration.
2. Open the MPL calculator. Add a margin change, then Simulate, then Continue to review. Expect the Review stage.
3. Press Approve. **Expect:** "Only the two approvers can approve this proposal."
4. Open Price Requests. Open a request in Review. **Expect:** no Approve or Cancel; "Waiting for a manager to decide." (L5)
5. Check the bell. **Expect (L28):** it appears, and its panel is empty.

**C. Approving manager (`u_mgr_2`)**

1. Set the user. Open the calculator. Press Approve on a proposal in Review. **Expect (L3):** "Two approvers must be ticked…"
2. Set the user to Admin (section 1), go to Configuration → Users, tick "May approve" on a second manager, and save. Then set the user back to Manager 2 and repeat step 1. **Expect:** approval records; the second approval is needed.
3. Approve as both approvers, then publish as Manager 2. **Expect:** Publish enabled and a new version created.
4. Open a request in Review and approve it at a lower price. **Expect:** a sub-version label such as `v5.1` appears.

**D. Admin (`u_admin_1`)**

1. Set the user. Expect the menu: Price Room, Price Watch, Price Requests, Price Lists, Log, Configuration.
2. Open Configuration → Access. Change one role's level. **Expect:** saved and logged. Then change "Review and approve" for Manager and check whether approval changes. **Expect (L4):** it does not.
3. Open Log, all six views. **Expect:** events shown; Issues covers the last 7 days only (L27).
4. D2. In database mode only: have a manager draft a proposal. **Expect (L1):** "Not saved."

**E. Viewer (`u_view_acct`)**

1. Set the user. Expect the menu: Price room, Price Watch, Price lists (MGSA only).
2. Open Price Room → Channels board. **Expect (L9):** all channels listed.
3. Open Price Lists → MGSA. Press Approve. **Expect (L6):** the list is approved.
4. Press Flag on a client line. **Expect (L33):** "Not available."

**F. Messenger (`u_msgr_1`)**

1. Set the user. Expect the menu: Price Watch only. Open `#/board` by address. **Expect:** "Not available."
2. Submit a reading with a photo. **Expect (L13):** local mode: "Connect it first." Database mode: fails with "Not saved" (L1).

**G. Accounting (role, not seeded)**

1. Open Client Pricing. Type a premium and press Save. **Expect (L8):** a change in the open proposal.

### 7.3 After each change

- Re-run the engine tests if the formula changed.
- Re-run the steps above for each role the change affects.
- Check that the change does not remove a role's access to something it still needs (the menu, the route and the control each have to agree).

---

## 8. Status of this review

- Every item is **code-read** as of 2026-11-03. None has been clicked through in a browser yet.
- The demo file (`MGC-Pricing-app-demo.html`) was built from the same code, but its screens were not checked in a browser either.
- The database rule files were read but not run against a live project.

---

## Change log

- **2026-11-03.** First version, from the code at `3ce6b5c` plus working changes, and the database rule files.
