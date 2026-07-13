# Shopify Orders Reporting Web App — Implementation Plan

## 1. Goal

Build a local web app that syncs Shopify orders into Supabase, lets staff maintain manual courier and review data, and replaces the current spreadsheet workflow with a sheet-like report and export flow.

---

## 2. Recommended MVP Stack

- Frontend: Next.js with TypeScript
- Backend: Next.js server routes or server actions for secure operations
- Database: Supabase PostgreSQL
- Shopify integration: Shopify GraphQL Admin API
- Export: CSV first, Excel second if needed for formatting parity

Reason for this stack:

- Keeps Shopify secrets out of the browser
- Works well for a local MVP
- Supports later migration to hosted deployment and webhooks

---

## 3. Project Outcomes

The MVP is complete when:

- Shopify orders can be synced manually into Supabase
- Duplicate orders are prevented
- Manual business fields remain editable and are never overwritten by sync
- Staff can work from a report screen instead of the spreadsheet
- Export output matches the old sheet column order

---

## 4. Implementation Principles

- Keep Shopify-owned data separate from manual business data
- Start with manual sync, not webhooks
- Build the report workflow before advanced automation
- Use backend-only secret handling
- Make each milestone usable on its own

---

## 5. Delivery Phases

### Phase 0: Finalize Scope

Objective:

- Confirm the exact MVP behavior before building

Status:

- Implemented in `phase_0_scope.md`

Tasks:

- [ ] Confirm Shopify store domain
- [ ] Confirm whether this app is for one store only
- [ ] Confirm how much order history must be imported
- [ ] Confirm whether orders older than 60 days are required
- [ ] Confirm who will use the app in MVP
- [ ] Confirm whether CSV is enough or Excel formatting is required
- [x] Confirm final report columns and allowed status values
- [x] Define MVP in-scope and out-of-scope features
- [x] Define Shopify data fields required for sync

Deliverables:

- [x] Locked column mapping
- [x] Locked status options
- [x] Locked MVP feature list
- [x] Open business confirmation list

Exit criteria:

- Core MVP scope is locked, and remaining business-specific confirmations are listed before real Shopify connection.

---

### Phase 1: Database and Environment Setup

Objective:

- Create the foundation needed for sync and reporting

Status:

- Implemented

Tasks:

- [ ] Create Supabase project
- [x] Create `shops` table
- [x] Create `orders` table
- [x] Create `order_tracking` table
- [x] Create `order_communication` table
- [x] Create `order_comments` table
- [x] Create `sync_logs` table
- [x] Create `audit_logs` table
- [x] Add foreign keys
- [x] Add unique constraint for `shop_id + shopify_order_id`
- [x] Add indexes for `order_date`, `order_name`, `tracking_id`, and common status fields
- [x] Define local `.env` variables for Shopify and Supabase credentials

Deliverables:

- [x] Working database schema in `supabase/migrations/001_initial_schema.sql`
- [x] Local environment configuration template in `.env.example`

Exit criteria:

- Schema is ready to run in Supabase. Final insert/query validation should happen after a Supabase project is created.

---

### Phase 2: App Skeleton

Objective:

- Set up the local app structure with secure backend boundaries

Status:

- Implemented

Tasks:

- [x] Initialize Next.js app with TypeScript
- [x] Set up base layout and navigation
- [x] Add report page placeholder
- [x] Add sync page placeholder
- [x] Add settings page placeholder
- [x] Add shared database client setup
- [x] Add environment variable validation on startup

Deliverables:

- [x] Running local app
- [x] Secure server-side integration layer

Exit criteria:

- App builds successfully and secret-bearing Supabase setup is isolated to server-only code.

---

### Phase 3: Shopify Manual Sync

Objective:

- Pull Shopify orders into Supabase safely

Status:

- Implemented

Tasks:

- [x] Create Shopify GraphQL client on the server
- [x] Build orders query with required fields
- [x] Support sync for recent orders
- [x] Support sync by date range
- [x] Map Shopify data into internal order format
- [x] Upsert Shopify-owned fields only
- [x] Preserve manual tracking, communication, and comment data
- [x] Write sync logs for success, partial success, and failure
- [x] Return sync summary to the UI

Deliverables:

- [x] Manual sync endpoint at `/api/sync/orders`
- [x] Sync results visible in app

Exit criteria:

- Sync flow is implemented and fails gracefully when credentials are missing. Live insert/update validation requires real Supabase and Shopify credentials.

---

### Phase 4: Main Report Screen

Objective:

- Replace direct spreadsheet viewing with a usable in-app report

Status:

- Implemented

Tasks:

- [x] Build table with the business column order
- [x] Load data from Supabase
- [x] Add loading state
- [x] Add empty state
- [x] Add error state
- [x] Show latest review comment in the report

Deliverables:

- [x] Working sheet-like report page

Exit criteria:

- Report page reads from Supabase and displays synced rows when database credentials are configured.

---

### Phase 5: Manual Operations Editing

Objective:

- Let staff manage the business-owned fields inside the app

Status:

- Implemented

Tasks:

- [x] Add edit flow for courier date
- [x] Add edit flow for courier name
- [x] Add edit flow for courier charge
- [x] Add edit flow for tracking ID
- [x] Add edit flow for delivery date
- [x] Add edit flow for confirm, tracking, and review message statuses
- [x] Add review comments entry
- [x] Add audit log creation on manual edits

Deliverables:

- [x] Editable operational fields
- [x] Edit history support through `audit_logs`

Exit criteria:

- Staff can edit operational fields from the Orders report after Supabase credentials are configured.

---

### Phase 6: Filters and Operational Views

Objective:

- Make daily order handling fast

Status:

- Implemented

Tasks:

- [x] Add date range filter
- [x] Add order ID filter
- [x] Add customer name filter
- [x] Add tracking ID filter
- [x] Add courier name filter
- [x] Add delivery status filter
- [x] Add confirm, tracking, and review status filters
- [x] Add saved operational views for pending dispatch, in transit, delivered, and review pending

Deliverables:

- [x] Searchable and filterable report
- [x] Fast operational views

Exit criteria:

- Staff can filter the report and switch between operational views without leaving the Orders screen.

---

### Phase 7: Export and Sync Visibility

Objective:

- Preserve current export workflow and improve transparency

Status:

- Implemented

Tasks:

- [x] Add CSV export for current filtered rows
- [x] Add date-range export through report date filters
- [ ] Add Excel export if needed
- [x] Build sync logs screen
- [x] Show sync errors clearly

Deliverables:

- [x] Export feature
- [x] Sync history screen

Exit criteria:

- CSV export output matches the report column order.
- Staff can understand whether sync succeeded or failed from the Sync page.

---

### Phase 8: Reliability and Multi-User Readiness

Objective:

- Prepare the app for steady operations

Status:

- Implemented

Tasks:

- [x] Add duplicate tracking ID warning
- [x] Improve validation and form errors
- [x] Review indexes and slow queries
- [ ] Add Supabase Auth if more than one user needs access
- [x] Add basic roles for admin, operations staff, and viewer
- [x] Review Row Level Security rules before multi-user rollout

Deliverables:

- [x] Safer data entry
- [x] More reliable daily use
- [x] Multi-user readiness migration and checklist

Exit criteria:

- Staff get duplicate tracking warnings and clearer validation. Full multi-user rollout still requires enabling Supabase Auth in the app UI.

---

### Phase 9: Automation After MVP

Objective:

- Reduce manual workload only after the core workflow is stable

Tasks:

- Add Shopify webhooks
- Add scheduled sync fallback
- Add optional courier API integration
- Add optional communication automation
- Add delivery delay alerts

Deliverables:

- Reduced manual syncing
- Stronger operational automation

Exit criteria:

- Automation removes manual effort without destabilizing the report workflow

---

## 6. Suggested Build Order

1. Finalize scope and report fields
2. Build Supabase schema
3. Create local app shell
4. Implement manual Shopify sync
5. Build the report screen
6. Add manual editing
7. Add filters and saved views
8. Add export and sync logs
9. Improve reliability and multi-user readiness
10. Add automation later

This order keeps the highest-risk integration early while still prioritizing the report workflow over optional automation.

---

## 7. Suggested Folder Direction

This is one practical structure for the app:

```text
src/
  app/
    page.tsx
    orders/
    sync/
    settings/
  components/
    orders/
    dashboard/
    forms/
  lib/
    supabase/
    shopify/
    validation/
    export/
  server/
    sync/
    orders/
    audit/
```

This is only a starting direction and can be adjusted to match the chosen framework style.

---

## 8. Key Acceptance Checks

Before calling the MVP done, verify:

- Manual sync inserts new orders
- Manual sync updates existing orders
- Manual fields are not overwritten by sync
- Duplicate orders are blocked
- Duplicate tracking IDs trigger a warning
- Filters return expected rows
- Export columns match the old sheet order
- Sync failures are visible to the user

---

## 9. Risks to Watch

- Shopify token accidentally exposed to frontend code
- Sync logic overwriting manual tracking or review fields
- Incomplete handling of Shopify pagination
- Missing indexes causing slow report queries
- Export mismatches with the current business sheet
- Starting webhook work before manual sync is proven

---

## 10. Immediate Next Actions

The best next implementation sequence is:

1. Confirm the final report columns and required order history range.
2. Create the Supabase schema and constraints.
3. Scaffold the Next.js app and environment setup.
4. Implement the Shopify manual sync backend.
5. Build the first real report table against Supabase data.

This gives the project a fast path to the first working version without overbuilding.
