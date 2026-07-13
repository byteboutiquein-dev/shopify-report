# Phase 0 Scope Lock — Shopify Orders Reporting Web App

## 1. Phase Status

Status: Implemented as planning artifact

Phase 0 is complete enough to start Phase 1 database design. A few business-specific values still need confirmation before connecting the real Shopify store.

---

## 2. Confirmed MVP Decisions

- App type: Local web app
- Primary database: Supabase PostgreSQL
- Frontend/backend direction: Next.js with TypeScript
- Shopify integration: Shopify GraphQL Admin API
- Shopify app type: Custom app for owned Shopify store
- Sync approach for MVP: Manual sync from the app
- Automation approach: Webhooks after the manual workflow is stable
- Primary workflow: Replace current spreadsheet order tracking
- Export requirement: CSV required, Excel preferred if old sheet formatting must be preserved
- Data model rule: Shopify order data and manual operations data must stay separate
- Security rule: Shopify client secret and generated API tokens must stay server-side and must not appear in browser code

---

## 3. MVP Feature Scope

### In Scope

- Store Shopify shop configuration
- Manually sync Shopify orders
- Prevent duplicate Shopify orders
- Update Shopify-owned order fields during re-sync
- Preserve manual courier, delivery, communication, and review fields during re-sync
- Show sheet-like orders report
- Search and filter report rows
- Manually update courier details
- Manually update tracking details
- Manually update delivery details
- Manually update message statuses
- Add review comments and internal notes
- Export report rows to CSV
- Add Excel export if required for matching the current sheet workflow
- Track sync history
- Track manual edit history if more than one staff member uses the app

### Out of Scope for MVP

- Shopify webhooks
- Scheduled background sync
- Courier API integration
- WhatsApp, SMS, or email automation
- Google Sheets auto-sync
- Cloud deployment
- Advanced business intelligence reports
- Profit calculation

These items belong in later phases after the manual workflow is proven.

---

## 4. Locked Report Columns

The MVP report should preserve this column order:

| Order | Sheet Column | App Field | Source | Editable |
|---:|---|---|---|---|
| 1 | DATE | `orders.order_date` | Shopify | No |
| 2 | ORDER ID | `orders.order_name` | Shopify | No |
| 3 | PRICE | `orders.total_price` | Shopify | No |
| 4 | NAME | `orders.customer_name` | Shopify | No |
| 5 | CONFIRM TXT | `order_communication.confirm_txt_status` | App | Yes |
| 6 | COURIER DATE | `order_tracking.courier_date` | App/manual | Yes |
| 7 | COURIER NAME | `order_tracking.courier_name` | App/manual or Shopify fulfillment | Yes |
| 8 | COURIER CHARGE | `order_tracking.courier_charge` | App/manual | Yes |
| 9 | TRACKING ID | `order_tracking.tracking_id` | App/manual or Shopify fulfillment | Yes |
| 10 | TRACKING TXT | `order_communication.tracking_txt_status` | App | Yes |
| 11 | DELIVERY DATE | `order_tracking.delivery_date` | App/manual or courier API later | Yes |
| 12 | REVIEW TXT | `order_communication.review_txt_status` | App | Yes |
| 13 | REVIEW COMMENTS | Latest review comment | App | Yes |

---

## 5. Locked Status Values

Use these values for MVP dropdowns.

### Confirm TXT

- Pending
- Sent
- Failed
- Not Needed

### Tracking TXT

- Pending
- Sent
- Failed
- Not Needed

### Review TXT

- Pending
- Sent
- Received
- Failed
- Not Needed

### Tracking Status

- Pending
- Sent
- In Transit
- Delivered
- Failed

### Delivery Status

- Pending
- In Transit
- Delivered
- Returned
- Issue

### Sync Status

- Success
- Partial
- Failed

---

## 6. Shopify Data Required

The manual sync must pull these Shopify fields:

- Shopify order ID
- Order name
- Created date
- Total price
- Currency
- Financial status
- Fulfillment status
- Shopify updated timestamp
- Fulfillment tracking number, when available
- Fulfillment tracking company, when available
- Tracking URL, when available

Optional customer fields:

- Customer name
- Customer email
- Customer phone

Only store customer name, email, or phone if the business confirms they are needed for operations and the app has the required Shopify customer access scope.

---

## 7. User Roles for MVP

Default MVP assumption:

- One admin user is enough for the first local version.

Role plan for later multi-user usage:

| Role | Permissions |
|---|---|
| Admin | Full access, settings, sync, export, users |
| Operations Staff | Update courier, tracking, delivery, comments |
| Viewer | View reports and export only |

If more than one person will use the app during MVP, add Supabase Auth and Row Level Security before daily use.

---

## 8. Open Business Confirmations

These values are required before connecting the real Shopify store:

| Item | Current Decision | Needed From Business |
|---|---|---|
| Shopify store domain | Not provided yet | Confirm exact `*.myshopify.com` domain |
| Store count | Assume one store | Confirm one store only |
| Order history range | Not provided yet | Confirm import start date or number of months |
| Orders older than default recent access window | Unknown | Confirm whether older orders are needed |
| Users | Assume one admin user | Confirm who will use MVP |
| Export format | CSV required, Excel preferred | Confirm whether Excel formatting is required |
| Customer email/phone | Optional | Confirm whether these fields are required |
| Default courier names | Not provided yet | Provide courier dropdown values |
| Default courier charges | Optional | Provide values if standard charges exist |

---

## 9. Phase 1 Ready Checklist

- [x] MVP feature scope defined
- [x] Out-of-scope automation listed
- [x] Report column order locked
- [x] Status values locked
- [x] Shopify data fields defined
- [x] User role assumption defined
- [ ] Shopify store domain confirmed
- [ ] Order history range confirmed
- [ ] MVP user list confirmed
- [ ] Export format confirmed
- [ ] Courier dropdown values confirmed

Phase 1 can begin using placeholders for the unchecked items, but real Shopify sync should wait until the store domain, order history range, and API access scope are confirmed.
