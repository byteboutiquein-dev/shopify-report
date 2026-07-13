# Shopify Orders Reporting Web App — Development Specification

**Project type:** Local web app + Supabase database  
**Primary goal:** Pull Shopify orders, store them in Supabase, and maintain a report in the same business format as the current sheet.  
**Recommended stack:** TypeScript, Next.js or React, Node.js backend routes, Supabase PostgreSQL, Shopify GraphQL Admin API.  
**Coding note:** This document is a development guide and requirement spec. It intentionally avoids implementation code.

---

## 1. Business Objective

The business currently maintains a manual order tracking sheet with fields such as order date, order ID, price, customer name, confirmation message status, courier details, tracking details, delivery date, review message status, and review comments.

The new web app should replace or reduce manual spreadsheet work by:

- Pulling order data from Shopify.
- Saving order data in Supabase PostgreSQL.
- Allowing the team to manually update courier, tracking, delivery, and review details.
- Showing a sheet-like report view.
- Allowing filtering, searching, and exporting.
- Preventing duplicate orders.
- Keeping Shopify data separate from internal manual tracking fields.

---

## 2. Recommended Architecture

### 2.1 Simple MVP Architecture

Shopify Admin API  
→ Local Node.js sync process  
→ Supabase PostgreSQL  
→ Local web dashboard  
→ Excel / CSV export

### 2.2 Future Automated Architecture

Shopify Webhooks  
→ Supabase Edge Function or hosted webhook receiver  
→ Supabase PostgreSQL  
→ Local or hosted dashboard

### 2.3 Why This Architecture

Start with manual sync because it is easier, safer, and faster to build. Webhooks need a public HTTPS endpoint, so they are better added after the basic local app works correctly.

---

## 3. Technology Stack

| Area | Recommended Tool | Reason |
|---|---|---|
| Programming language | TypeScript | Safer than plain JavaScript for business apps |
| Frontend | Next.js or React | Good for dashboard and table UI |
| Backend | Node.js backend routes | Keeps Shopify token safe outside browser |
| Database | Supabase PostgreSQL | Managed Postgres, easy dashboard, auth, storage, APIs |
| ORM / DB layer | Prisma or Supabase client | Prisma is good for structured backend apps; Supabase client is simpler |
| Shopify API | GraphQL Admin API | Current recommended direction for Shopify Admin apps |
| Export | Excel / CSV export library | Needed to match current sheet workflow |
| Hosting later | Vercel, Render, Railway, Fly.io, Supabase Edge Functions | Optional after local MVP |

---

## 4. Important API Decision

Use **Shopify GraphQL Admin API** as the main API.

Do not build the new system mainly on Shopify REST Admin API because Shopify marks REST Admin API as legacy. Shopify states that the REST Admin API became legacy on October 1, 2024, and new public apps from April 1, 2025 must use GraphQL Admin API.

For order reporting, use Shopify's GraphQL `orders` query. It is designed to return store orders with fields such as order status, customer, and line item details.

---

## 5. Shopify Access Requirements

### 5.1 Store Type

For your own Shopify store, use a **Shopify custom app** from Shopify Admin.

A custom app is enough when:

- The app is only for your own store.
- You do not need Shopify App Store distribution.
- You control the Shopify admin or Dev Dashboard and can create app API credentials.

### 5.2 Required Shopify Permissions

| Scope | Needed For |
|---|---|
| `read_orders` | Read recent orders |
| `read_all_orders` | Read orders older than Shopify's default recent order access window, if required |
| Fulfillment read scope | Read fulfillment and tracking information if needed |
| Protected customer data approval | Required if accessing protected customer data such as full customer details |

### 5.3 Data to Pull from Shopify

Minimum order fields:

| Field | Purpose |
|---|---|
| Shopify order ID | Unique internal ID |
| Order name | Display order ID like `#14001` |
| Created date | Report date |
| Total price | Report price |
| Financial status | Paid, pending, refunded, etc. |
| Fulfillment status | Fulfilled, unfulfilled, partial, etc. |
| Fulfillment tracking number | Tracking ID if already available in Shopify |
| Fulfillment tracking company | Courier name if already available in Shopify |
| Tracking URL | Customer tracking link if available |

---

Optional customer fields:

- Customer name
- Customer email
- Customer phone

Only request customer fields after enabling the required customer access scope and confirming the business needs the data.

---

## 6. Supabase Database Design

Do not store everything in one large table. Separate Shopify data from manual operational data.

### 6.1 Table: `shops`

Purpose: Store Shopify store configuration.

| Column | Type | Description |
|---|---|---|
| id | UUID | Primary key |
| shop_domain | Text | Example: `your-store.myshopify.com` |
| shop_name | Text | Store display name |
| is_active | Boolean | Active/inactive store |
| created_at | Timestamp | Record creation time |
| updated_at | Timestamp | Last update time |

Important: Shopify client secret and generated API tokens should not be stored in a browser-accessible table. For MVP, keep credentials in a local environment file. Later, move them to server secrets or Supabase Edge Function secrets.

---

### 6.2 Table: `orders`

Purpose: Store Shopify order data.

| Column | Type | Description |
|---|---|---|
| id | UUID | Primary key |
| shop_id | UUID | Related shop |
| shopify_order_id | Text | Unique Shopify order ID |
| order_name | Text | Example: `#14001` |
| order_date | Date | Shopify order created date |
| customer_name | Text | Customer display name |
| customer_email | Text | Optional; use only if required |
| customer_phone | Text | Optional; use only if required |
| total_price | Numeric | Order total |
| currency | Text | Example: INR |
| financial_status | Text | Paid/pending/refunded/etc. |
| fulfillment_status | Text | Fulfilled/unfulfilled/partial/etc. |
| shopify_updated_at | Timestamp | Last updated timestamp from Shopify |
| last_synced_at | Timestamp | Last time app synced this record |
| created_at | Timestamp | Record creation time |
| updated_at | Timestamp | Record update time |

Recommended constraints:

- `shopify_order_id` should be unique per shop.
- `order_name` should be searchable.
- `order_date` should be indexed for filtering.

---

### 6.3 Table: `order_tracking`

Purpose: Store courier, tracking, and delivery information.

| Column | Type | Description |
|---|---|---|
| id | UUID | Primary key |
| order_id | UUID | Related order |
| courier_date | Date | Dispatch/courier handover date |
| courier_name | Text | DTDC, India Post, ST, Professional, etc. |
| courier_charge | Numeric | Courier cost |
| tracking_id | Text | Tracking/consignment number |
| tracking_url | Text | Optional tracking URL |
| tracking_status | Text | Pending, Sent, In Transit, Delivered, Failed |
| delivery_date | Date | Delivery date |
| delivery_status | Text | Pending, In Transit, Delivered, Returned, Issue |
| created_at | Timestamp | Record creation time |
| updated_at | Timestamp | Record update time |

Recommended validation:

- Warn if same `tracking_id` is used for multiple unrelated orders.
- Do not require courier charge initially because some rows may be unknown.
- Standardize courier names using dropdown values.

---

### 6.4 Table: `order_communication`

Purpose: Store message status fields from the sheet.

| Column | Type | Description |
|---|---|---|
| id | UUID | Primary key |
| order_id | UUID | Related order |
| confirm_txt_status | Text | Pending, Sent, Failed, Not Needed |
| tracking_txt_status | Text | Pending, Sent, Failed, Not Needed |
| review_txt_status | Text | Pending, Sent, Received, Not Needed |
| confirm_sent_at | Timestamp | When confirmation was sent |
| tracking_sent_at | Timestamp | When tracking message was sent |
| review_sent_at | Timestamp | When review request was sent |
| created_at | Timestamp | Record creation time |
| updated_at | Timestamp | Record update time |

Suggested default values:

- `confirm_txt_status`: Pending
- `tracking_txt_status`: Pending
- `review_txt_status`: Pending

---

### 6.5 Table: `order_comments`

Purpose: Store review comments and internal notes.

| Column | Type | Description |
|---|---|---|
| id | UUID | Primary key |
| order_id | UUID | Related order |
| comment_type | Text | Review, Delivery Issue, Internal Note, Courier Issue |
| comment | Text | Comment text |
| created_by | Text | User/staff name or user ID |
| created_at | Timestamp | Comment creation time |

This table is better than keeping only one comment column because one order may have multiple updates over time.

---

### 6.6 Table: `sync_logs`

Purpose: Track Shopify sync history.

| Column | Type | Description |
|---|---|---|
| id | UUID | Primary key |
| sync_type | Text | Manual, Scheduled, Webhook |
| started_at | Timestamp | Sync start time |
| finished_at | Timestamp | Sync finish time |
| status | Text | Success, Partial, Failed |
| orders_checked | Number | Orders fetched from Shopify |
| orders_inserted | Number | New orders inserted |
| orders_updated | Number | Existing orders updated |
| error_message | Text | Error detail if failed |

---

### 6.7 Table: `audit_logs`

Purpose: Track manual edits.

| Column | Type | Description |
|---|---|---|
| id | UUID | Primary key |
| entity_type | Text | Order, Tracking, Communication, Comment |
| entity_id | UUID | Record changed |
| field_name | Text | Changed field |
| old_value | Text | Previous value |
| new_value | Text | New value |
| changed_by | Text | User/staff |
| changed_at | Timestamp | Change time |

This is useful when multiple staff members edit courier or delivery data.

---

## 7. Report Format Mapping

The app report should match the current sheet format.

| Sheet Column | App Field | Source | Editable |
|---|---|---|---|
| DATE | `orders.order_date` | Shopify | No |
| ORDER ID | `orders.order_name` | Shopify | No |
| PRICE | `orders.total_price` | Shopify | No |
| NAME | `orders.customer_name` | Shopify | No |
| CONFIRM TXT | `order_communication.confirm_txt_status` | App | Yes |
| COURIER DATE | `order_tracking.courier_date` | App/manual | Yes |
| COURIER NAME | `order_tracking.courier_name` | App/manual or Shopify fulfillment | Yes |
| COURIER CHARGE | `order_tracking.courier_charge` | App/manual | Yes |
| TRACKING ID | `order_tracking.tracking_id` | App/manual or Shopify fulfillment | Yes |
| TRACKING TXT | `order_communication.tracking_txt_status` | App | Yes |
| DELIVERY DATE | `order_tracking.delivery_date` | App/manual or courier API later | Yes |
| REVIEW TXT | `order_communication.review_txt_status` | App | Yes |
| REVIEW COMMENTS | Latest review comment | App | Yes |

---

## 8. Application Screens

### 8.1 Login Screen

MVP options:

- Simple local password login.
- Supabase Auth login.

Recommended: Use Supabase Auth if more than one person will use the app.

---

### 8.2 Dashboard Screen

Show summary cards:

| Card | Meaning |
|---|---|
| Today Orders | Orders created today |
| Total Sales Today | Sum of today's order price |
| Pending Dispatch | Orders without courier date or tracking ID |
| In Transit | Orders dispatched but not delivered |
| Delivered Today | Orders delivered today |
| Review Pending | Delivered orders without review request sent |
| Courier Charges This Month | Sum of courier charges |

---

### 8.3 Orders Report Screen

This is the main sheet-like screen.

Required features:

- Table view like spreadsheet.
- Date range filter.
- Search by order ID, name, tracking ID.
- Filter by courier name.
- Filter by delivery status.
- Filter by message status.
- Inline edit for courier and communication fields.
- Save changes button or auto-save.
- Export visible rows.

Recommended columns:

1. Date
2. Order ID
3. Price
4. Name
5. Confirm TXT
6. Courier Date
7. Courier Name
8. Courier Charge
9. Tracking ID
10. Tracking TXT
11. Delivery Date
12. Review TXT
13. Review Comments

---

### 8.4 Order Detail Screen

Show:

- Shopify order summary.
- Customer name.
- Amount.
- Fulfillment status.
- Courier information.
- Communication status.
- Comments timeline.
- Edit history.

---

### 8.5 Sync Orders Screen

Actions:

- Sync latest orders.
- Sync by date range.
- View last sync result.
- View sync errors.

Rules:

- New Shopify orders should be inserted.
- Existing Shopify orders should be updated only for Shopify-owned fields.
- Manual fields such as courier charge, review comment, and delivery date should not be overwritten by Shopify sync.

---

### 8.6 Courier Update Screen

Optional separate screen for fast operations.

Useful when staff want to update many dispatches quickly.

Fields:

- Order ID
- Courier date
- Courier name
- Courier charge
- Tracking ID
- Tracking message status

---

### 8.7 Export Screen

Export options:

- Export all orders by date range.
- Export current filtered table.
- Export courier report.
- Export pending review report.
- Export Excel format matching the old sheet.
- Export CSV.

---

### 8.8 Settings Screen

Settings:

- Shopify shop domain.
- Sync date range default.
- Default courier names.
- Default courier charges.
- Message status options.
- Export format settings.
- User roles.

Do not expose Shopify client secret or generated API tokens in the frontend settings screen unless they are handled through a secure backend-only secret flow.

---

## 9. Core Workflows

### 9.1 Manual Order Sync Workflow

1. User opens app.
2. User clicks Sync Orders.
3. Backend reads Shopify client credentials from secure local environment and requests an access token server-side.
4. Backend pulls orders from Shopify GraphQL Admin API.
5. Backend checks each order in Supabase.
6. If order does not exist, insert it.
7. If order exists, update Shopify-owned fields only.
8. Keep manual fields unchanged.
9. Create sync log.
10. Show result to user.

---

### 9.2 Manual Courier Update Workflow

1. User searches order ID.
2. User enters courier date, courier name, courier charge, and tracking ID.
3. App validates required fields.
4. App saves data to `order_tracking`.
5. App records audit log.
6. Order appears as dispatched or in transit.

---

### 9.3 Delivery Update Workflow

1. User filters in-transit orders.
2. User updates delivery date.
3. App sets delivery status to Delivered.
4. App marks review message as Pending if not already sent.
5. Order appears in review pending report.

---

### 9.4 Review Tracking Workflow

1. Order is delivered.
2. Review TXT status is Pending.
3. User sends review request manually or later through automation.
4. User changes Review TXT to Sent or Received.
5. User adds review comment.

---

## 10. Business Rules

### 10.1 Data Protection Rules

- Shopify client secret and generated API tokens must never be stored in frontend code.
- Supabase service role key must never be used in browser code.
- Browser should use anon/publishable key with Row Level Security enabled.
- Only backend routes or Edge Functions should use sensitive keys.
- Store only customer data that is actually needed for operations.

---

### 10.2 Sync Rules

- Shopify is the source of truth for order ID, order date, customer name, price, financial status, and fulfillment status.
- Supabase is the source of truth for courier charge, courier date, tracking status, delivery date, review status, and comments.
- Manual fields should not be overwritten during Shopify sync.
- Duplicate orders should be prevented by Shopify order ID.
- Duplicate tracking IDs should trigger a warning.

---

### 10.3 Status Rules

Suggested standard values:

| Field | Values |
|---|---|
| Confirm TXT | Pending, Sent, Failed, Not Needed |
| Tracking TXT | Pending, Sent, Failed, Not Needed |
| Review TXT | Pending, Sent, Received, Failed, Not Needed |
| Delivery Status | Pending, In Transit, Delivered, Returned, Issue |
| Sync Status | Success, Partial, Failed |

Avoid using only TRUE/FALSE because business statuses need more detail.

---

## 11. Filters and Reports

### 11.1 Required Filters

- Date range
- Order ID
- Customer name
- Courier name
- Tracking ID
- Delivery status
- Confirm TXT status
- Tracking TXT status
- Review TXT status

### 11.2 Required Reports

| Report | Purpose |
|---|---|
| Daily Orders | Orders by date |
| Courier Dispatch Report | Orders dispatched by date/courier |
| Pending Dispatch | Orders without courier details |
| Pending Tracking Message | Orders with tracking ID but tracking message not sent |
| In Transit | Orders dispatched but not delivered |
| Delivery Completed | Delivered orders |
| Review Pending | Delivered orders with no review request sent |
| Courier Charges | Total courier cost by date/month/courier |
| Delayed Delivery | Orders in transit longer than allowed days |
| Manual Issues | Orders with comments or delivery issues |

---

## 12. Export Requirements

The export should match the old sheet column order:

1. DATE
2. ORDER ID
3. PRICE
4. NAME
5. CONFIRM TXT
6. COURIER DATE
7. COURIER NAME
8. COURIER CHARGE
9. TRACKING ID
10. TRACKING TXT
11. DELIVERY DATE
12. REVIEW TXT
13. REVIEW COMMENTS

Export formats:

- Excel
- CSV

Optional later:

- Google Sheets sync
- Daily email report

---

## 13. Security Requirements

### 13.1 Local MVP

Use a local `.env` file for sensitive values:

- Shopify shop domain
- Shopify client ID
- Shopify client secret
- Supabase URL
- Supabase anon key
- Supabase service role key only if used by backend

Rules:

- Never expose the Shopify client secret or generated API tokens to browser code.
- Never expose Supabase service role key to browser code.
- Do not commit secrets to GitHub.
- Use Row Level Security in Supabase when users are added.

### 13.2 Future Hosted Version

Move secrets to:

- Hosting provider environment variables, or
- Supabase Edge Function secrets.

Use HTTPS for all webhook endpoints.

---

## 14. Development Phases

### Phase 1: MVP — Replace Spreadsheet

Goal: Basic working local app.

Main deliverables:

- Supabase schema for shops, orders, tracking, communication, comments, sync logs, and audit logs.
- Local app with secure backend-only Shopify sync route.
- Orders report screen with real database data.
- Manual update flows for courier, delivery, communication, and comments.
- CSV/Excel export in the same column order as the old sheet.

Recommended implementation order inside Phase 1:

1. Create Supabase project and define schema.
2. Create local app shell and environment configuration.
3. Build backend sync flow from Shopify to Supabase.
4. Build report table using Supabase data.
5. Add manual edit flows for non-Shopify fields.
6. Add sync logs and error reporting.
7. Add export feature.

Success criteria:

- User can run a manual sync without exposing secrets in the browser.
- New orders are inserted and existing orders are updated safely.
- Manual fields are preserved during re-sync.
- User can edit courier, delivery, and review-related fields from the app.
- Export matches old sheet format closely enough to replace current spreadsheet use.

---

### Phase 2: Operations Improvements

Goal: Make daily use faster.

Main deliverables:

- Full filtering and search.
- Dashboard summary cards.
- Operational report presets.
- Duplicate tracking warning.
- Audit logging for manual changes.
- Basic auth and roles if multiple users are involved.

Success criteria:

- Staff can find pending and exception orders in a few clicks.
- Repetitive spreadsheet filtering is no longer needed.
- Important manual edits are traceable.

---

### Phase 3: Automation

Goal: Reduce manual work.

Main deliverables:

- Shopify webhook ingestion.
- Scheduled sync fallback.
- Optional courier API integration.
- Optional communication automation.
- Delivery delay alerts.

Success criteria:

- New orders usually arrive without manual sync.
- Webhook failures do not cause silent data loss because scheduled sync can recover.
- At least one manual daily task is removed through automation.

---

### Phase 4: Advanced Reporting

Goal: Business intelligence.

Main deliverables:

- Monthly sales reporting.
- Courier cost and performance reporting.
- Delivery delay analysis.
- Profit estimate reporting if cost inputs are available.
- Optional Google Sheet export if still required by business users.

Success criteria:

- Management can answer sales and operations questions without editing raw exports manually.

---

## 15. Suggested User Roles

| Role | Permissions |
|---|---|
| Admin | Full access, settings, sync, export, users |
| Operations Staff | Update courier, tracking, delivery, comments |
| Viewer | View reports and export only |

For MVP, one admin user is enough.

---

## 16. Study Plan

Study in this order:

1. JavaScript basics
2. TypeScript basics
3. React or Next.js basics
4. Node.js backend basics
5. HTTP APIs
6. GraphQL basics
7. Shopify GraphQL Admin API
8. Supabase tables and PostgreSQL basics
9. Supabase Auth and Row Level Security
10. Excel/CSV export concepts
11. Deployment basics
12. Webhooks and background jobs

---

## 17. MVP Checklist

Use this checklist before starting development.

### Planning

- [ ] Confirm Shopify store domain.
- [ ] Confirm whether app is only for one store.
- [ ] Confirm required order history range.
- [ ] Confirm whether older than 60 days of orders are needed.
- [ ] Confirm who will use the app.
- [ ] Confirm export format.

### Supabase

- [ ] Create Supabase project.
- [ ] Create tables and foreign keys.
- [ ] Add unique constraints for shop/order identity.
- [ ] Add basic indexes for order date, order name, tracking ID, and status filters.
- [ ] Enable Row Level Security before multi-user usage.
- [ ] Define backup/export policy.

### Shopify

- [ ] Create custom app in Shopify Admin.
- [ ] Add required Admin API scopes.
- [ ] Copy Shopify client ID and client secret from the Dev Dashboard.
- [ ] Store token securely in backend/local environment.
- [ ] Test GraphQL orders query with the required fields.
- [ ] Test manual order sync with insert and update cases.

### App

- [ ] Create local app.
- [ ] Add environment variable validation.
- [ ] Build manual sync button.
- [ ] Build sync result and error display.
- [ ] Build orders report table.
- [ ] Build courier update flow.
- [ ] Build review/comment flow.
- [ ] Build delivery update flow.
- [ ] Build filters and search.
- [ ] Build export feature.
- [ ] Build sync logs screen.

### Testing

- [ ] Test new order insertion.
- [ ] Test existing order update.
- [ ] Test manual fields are not overwritten.
- [ ] Test duplicate order prevention.
- [ ] Test duplicate tracking warning.
- [ ] Test date range sync.
- [ ] Test pagination when Shopify returns many orders.
- [ ] Test partial failure logging.
- [ ] Test export format.
- [ ] Test date filters.
- [ ] Test search by order ID, name, and tracking ID.

---

## 18. Detailed Implementation Plan

This is the recommended build sequence for the first working version. It is designed to reduce risk, surface integration issues early, and keep the app usable at each milestone.

### Step 1: Finalize Scope and Required Fields

Outputs:

- Final confirmed sheet column mapping.
- Confirmed Shopify order history range.
- Confirmed required customer fields and privacy constraints.
- Confirmed user list for MVP.

Why first:

- Avoids rebuilding schema and exports later.

Acceptance check:

- Business owner agrees that the report columns and required workflows are complete enough for MVP.

### Step 2: Set Up Supabase Project and Database Schema

Outputs:

- Tables, foreign keys, indexes, and unique constraints.
- Seed data for shops and dropdown values if needed.
- Row Level Security plan, even if not fully enabled for single-user local MVP.

Why here:

- The database structure defines how sync, editing, filtering, and export will work.

Acceptance check:

- Orders, tracking, communication, comments, sync logs, and audit logs can all be inserted and queried cleanly.

### Step 3: Create Local App Skeleton and Secret Management

Outputs:

- Local Next.js or React app shell.
- Backend route layer for secure operations.
- `.env` structure for Shopify and Supabase credentials.

Why here:

- Secrets and backend boundaries should be correct before API work starts.

Acceptance check:

- App starts locally and no secret is exposed in browser code.

### Step 4: Implement Shopify Manual Sync Backend

Outputs:

- GraphQL orders query.
- Sync by recent orders and sync by date range.
- Upsert logic for Shopify-owned fields only.
- Sync log creation for success, partial success, and failure.

Why here:

- This is the highest-risk integration and should be validated early.

Acceptance check:

- Manual sync inserts new orders, updates changed Shopify fields, and preserves manual operational data.

### Step 5: Build Main Orders Report Screen

Outputs:

- Sheet-like table using real Supabase data.
- Core columns in the same order as the current sheet.
- Basic loading, empty, and error states.

Why here:

- The main report is the primary business workflow and should become visible as early as possible.

Acceptance check:

- A user can see synced orders in a usable table without opening Supabase directly.

### Step 6: Add Manual Operations Editing

Outputs:

- Edit flow for courier date, courier name, courier charge, tracking ID, delivery date, and communication statuses.
- Review comments entry.
- Audit log entries for edits.

Why here:

- Spreadsheet replacement is not complete until staff can maintain manual fields in the app.

Acceptance check:

- A staff member can fully process an order after sync without editing the spreadsheet.

### Step 7: Add Filters, Search, and Operational Presets

Outputs:

- Date range, order ID, name, tracking ID, courier, and status filters.
- Preset report views such as pending dispatch, in transit, delivered, and review pending.

Why here:

- After data entry works, speed of daily usage becomes the next priority.

Acceptance check:

- Staff can find target orders in seconds instead of manual scanning.

### Step 8: Add Export and Dashboard Summary

Outputs:

- CSV export.
- Excel export if required by users.
- Dashboard summary cards for operational visibility.

Why here:

- Export is important, but it is more valuable after the report and filters are already accurate.

Acceptance check:

- Exported data matches the table view and old sheet column order.

### Step 9: Harden Reliability and Multi-User Readiness

Outputs:

- Duplicate tracking warnings.
- Better validation and error messages.
- Basic auth and role handling if needed.
- Review of indexes and query performance.

Why here:

- Reliability issues become clearer only after realistic data and workflows exist.

Acceptance check:

- Daily use is stable enough that staff trust the app for regular operations.

### Step 10: Add Automation After MVP Stabilizes

Outputs:

- Webhooks.
- Scheduled sync.
- Optional courier and messaging integrations.

Why last:

- Automation should be added only after the manual workflow and data model are already proven.

Acceptance check:

- Automation reduces manual effort without changing the core report behavior unexpectedly.

Implementation note:

- Do not start with webhooks. A strong manual sync flow is the foundation for safe automation and easier debugging.

---

## 19. Common Mistakes to Avoid

- Do not store Shopify token in frontend code.
- Do not use Supabase service role key in browser code.
- Do not overwrite courier fields during Shopify sync.
- Do not use only TRUE/FALSE for communication statuses.
- Do not keep all data in one large table.
- Do not start with webhooks before manual sync works.
- Do not depend only on Google Sheets as the main database.
- Do not ignore duplicate tracking IDs.
- Do not skip audit logs if multiple staff edit records.

---

## 20. Future Enhancements

- Courier API tracking integration.
- WhatsApp message integration.
- SMS/email tracking update integration.
- Automatic review request after delivery.
- Delivery delay alerts.
- Monthly courier cost report.
- Staff productivity report.
- Google Sheets auto-sync.
- Cloud deployment.
- Mobile-friendly interface.

---

## 21. Official References

- Shopify REST Admin API legacy notice: https://shopify.dev/docs/api/admin-rest
- Shopify GraphQL Admin API: https://shopify.dev/docs/api/admin-graphql/latest
- Shopify GraphQL orders query: https://shopify.dev/docs/api/admin-graphql/latest/queries/orders
- Shopify GraphQL Order object: https://shopify.dev/docs/api/admin-graphql/latest/objects/Order
- Shopify webhooks: https://shopify.dev/docs/api/webhooks/latest
- Shopify webhook subscriptions: https://shopify.dev/docs/api/admin-graphql/latest/objects/WebhookSubscription
- Supabase Edge Functions: https://supabase.com/docs/guides/functions
- Supabase Edge Function secrets: https://supabase.com/docs/guides/functions/secrets

---

## 22. Final Recommendation

Build the first version as:

**Local Next.js app + Node.js backend routes + Supabase PostgreSQL + Shopify GraphQL Admin API + manual sync + Excel/CSV export**

After the report workflow is stable, add:

**Supabase Edge Function or hosted backend for Shopify webhooks and automation**

This approach is practical, secure, and suitable for replacing the current spreadsheet workflow step by step.
