# MGC Pricing: problems, roles and checks

**Date:** 2026-11-04
**Purpose:** List what each user can do, the problems we found, and the decisions we need from you. Please read it, then sign off at the end.
**Status:** These findings come from reading the code. No one has tested them in the app yet.
**Keep it current:** When a problem is fixed, move it to "Fixed". When a new problem is found, give it the next number.

---

## 1. Who can see and do what

**Words:**
- **Menu:** the items in the top bar.
- **Address only:** the page is not in the menu, but it opens if you type its address.

| | Seller | Manager | Admin | Viewer | Messenger |
|---|---|---|---|---|---|
| Tour | Yes | Yes | No | No | No |
| Quote desk | Address only | No | No | No | No |
| Price Room | Yes, 3 tabs | Yes, 3 tabs | Yes, 4 tabs | Yes, 2 tabs | No |
| Proposal (calculator) | No | Yes | Yes | No | No |
| Price Watch | Yes | Yes | Yes | Yes | Yes (only item) |
| Price Requests | Yes | Yes | Yes | No | No |
| Price lists | Yes | Yes | Yes | Yes, MGSA only | No |
| Log | No | No | Yes | No | No |
| Configuration | Address only | Address only | Yes | No | No |

**What each role can click, in short:**

- **Seller:** prices, price requests, the price-list email, Flag, Price Watch, and the Quote desk (by address). Can also approve a channel's price list, which should not be allowed (L6).
- **Manager:** everything a seller can do, plus proposals and request decisions. Cannot approve or publish by default (L5).
- **Admin:** everything, including users, access settings and the log.
- **Viewer:** prices and price history for its own channel. Can also approve that channel's list (L6).
- **Messenger:** Price Watch readings only.

---

## 2. Problems found

**Priority:**
- **High:** blocks work, or gives wrong results users will see.
- **Medium:** wrong or confusing in a case that will come up.
- **Low:** small, or only in unusual cases.

| No. | Priority | Problem | What happens | Suggested fix |
|---|---|---|---|---|
| L1 | High | In database mode, only the admin can save most data. | Managers, sellers and messengers get "Not saved." | Write role rules for each user type. |
| L2 | High | The app has no sign-in and no user switch. | Anyone with the file acts as the stored user. | Use the sign-in in database mode. Add a switch for testing only. |
| L3 | High | Only one person is set to approve. | The app needs two. Nothing can be approved. | Set a second approver. |
| L4 | High | Approval uses the "May approve" tick box, not the access setting. | Changing "Review and approve" does nothing. | Use the access setting. |
| L5 | High | Managers cannot decide requests or publish by default. | Requests and publishing wait for an admin. | Decide the manager settings (see Q1). |
| L6 | High | Anyone with access to a channel can approve its price list. | Sellers and viewers can approve. | Limit approval to managers. |
| L7 | High | Configuration saves are not checked against access. | Anyone who opens it by address can change products, clients and channels. | Limit it to admins. |
| L8 | Medium | Client margin can be typed by anyone who can see Client Pricing. | A seller can add a margin change to a proposal. | Make the margin read-only for those roles. |
| L9 | Medium | Sellers and viewers see every channel. | Client Pricing and Price History show other channels. | Show only the user's own channels. |
| L10 | Low | The "May draft" tick box does nothing. | Drafting depends on the access setting. | Remove the tick box, or use it. |
| L11 | High | The bell does not show exception warnings. | Below-floor, contract and stale-reading warnings are never seen. | Show them in the bell. |
| L12 | Medium | Fixed margin does not change any price. | It can be changed, and nothing happens to the price. | Remove it from the price, or remove the field. |
| L13 | High | Price Watch cannot save in the local app. Messengers are blocked in database mode. | Readings are lost or blocked. | Connect the database, and allow readings for messengers. |
| L14 | Medium | Dealer future price leaves out premiums and discounts. The typed final price is lost on reload. | The Dealer sheet and Client Pricing show different future prices. | Use the same formula, and save the final price. |
| L15 | Medium | A new request is measured against the version price, not the approved price. | A second request can give a double discount. | Measure against the approved price (see Q4). |
| L16 | Medium | Band step and content changes do not save straight away. | The screen shows the old number, which looks like a save failure. | Decide where these changes go (see Q2). |
| L17 | Medium | Saving Client Pricing can add cost changes to a margin proposal. | Cost changes can enter the wrong proposal. | Keep cost changes separate (see Q3). |
| L18 | Medium | Quotes are never saved. | "Past quotes" is always empty. | Save each quote as a record. |
| L19 | Medium | PL Notices ignores the seeded acknowledgments. | The demo shows zero approved. | Read the seeded data, or remove it. |
| L20 | Low | "Approved by" shows only the first approver. | Second approver is missing. | Show both names. |
| L21 | Medium | Client price history works only in database mode. | The demo shows dashes. | Load history into the demo too. |
| L22 | Low | Volume bands are not printed on the price list. | Customers do not see the discount steps. | Print them, if wanted. |
| L23 | Medium | VAT is stored but not used. | Prices carry no VAT. | Decide VAT (see Q5). |
| L24 | Medium | The floor definition is still open. | The floor may be wrong for some clients. | Decide the floor (see Q1 on the calculations file). |
| L25 | Medium | In the local app, the log can be edited in the browser. | The log is not a true audit record. | Use the database, where the log only accepts new entries. |
| L26 | Low | Monthly change uses average volume only. | Contract volume is ignored. | Add contract volume if needed. |
| L27 | Low | The log's Issues tab shows the last 7 days only. | Older changes are in the other tabs. | Keep as is, or change the period. |
| L28 | Low | Some managers see an empty bell panel. | Confusing, but harmless. | Hide the bell for them. |
| L29 | Low | Every role that opens Price Requests sees every request. | A seller sees other sellers' requests. | Limit to own requests (see Q6). |
| L30 | Medium | The README and database setup are out of date. | Setup steps fail. | Update the README. |
| L31 | Low | Some old code can never run. | No effect on users. | Remove it. |
| L32 | Low | The Tour sends sellers to Configuration, which is not in their menu. | Confusing. | Fix the Tour text. |
| L33 | Low | Viewers see a Flag button that leads to "Not available." | Confusing. | Hide the button for viewers. |

---

## 3. Decisions we need from you

Please circle one option for each, or write your own answer.

- **Q1. Manager settings (L5, L6).** Who can publish, decide requests and approve price lists?
  - A. Managers only.
  - B. Admins only.
  - C. Two named managers.
  - Answer: ________________________

- **Q2. Band step and content (L16).** Where should these changes go?
  - A. Into a proposal, which needs approval.
  - B. Straight to Products.
  - Answer: ________________________

- **Q3. Cost changes from Client Pricing (L17).** Should Client Pricing ever change acquisition or hauling?
  - A. No. Only the cost step does that.
  - B. Yes, through a proposal.
  - Answer: ________________________

- **Q4. Price requests (L15).** Measure new requests against the approved price, or the version price?
  - A. Approved price.
  - B. Version price.
  - Answer: ________________________

- **Q5. VAT (L23).** Should prices show VAT?
  - A. No, prices stay net.
  - B. Yes, VAT included.
  - C. Yes, VAT added on top.
  - Answer: ________________________

- **Q6. Requests list (L29).** Should sellers see only their own requests?
  - A. Yes.
  - B. No, everyone sees all.
  - Answer: ________________________

---

## 4. How we will test

Each person should try these steps in the app.

**Seller**
1. Open the Quote desk. Check the prices match the price list.
2. Open Client Pricing. Check you cannot see other channels (L9).
3. Make a price request. Check it reaches the manager.

**Manager**
1. Make a proposal. Simulate it. Check the monthly change.
2. Try to approve. Check it follows the rule in Q1.
3. Decide a price request. Check the sub-version number appears.

**Admin**
1. Change one access setting. Check the change is logged.
2. Open the log. Check the changes are there.

**Viewer**
1. Open Price History for your channel. Check the colours.
2. Check you cannot see other channels (L9).

**Messenger**
1. Submit a price reading with a photo. Check it saves (L13).

---

## 5. Sign-off

Please mark each part.

| Part | Approve | Change needed | Comment |
|---|---|---|---|
| 1. Who can see and do what | ☐ | ☐ | |
| 2. Problems, L1 to L33 | ☐ | ☐ | |
| 3. Decisions Q1 to Q6 | ☐ | ☐ | |
| 4. Test steps | ☐ | ☐ | |

Name: ____________________________ Date: ______________ Signature: ____________________

---

## Fixed

None yet.

---

## Change log

- **2026-11-04.** Rewritten in plain language. Sign-off section added.
- **2026-11-03.** First version.
