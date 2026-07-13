# Supabase Setup

Fast setup:

1. Open Supabase Dashboard.
2. Go to SQL Editor.
3. Paste and run `setup_all.sql`.

Migration-file setup:

1. `migrations/001_initial_schema.sql`
2. `migrations/002_multi_user_readiness.sql`

For the local MVP, secrets live in `.env.local` and Shopify credentials stay server-side. Do not expose `SHOPIFY_CLIENT_SECRET` or `SUPABASE_SERVICE_ROLE_KEY` in browser code.

Before multi-user usage, follow `multi_user_readiness.md` and add role-aware policies for the operational tables.
