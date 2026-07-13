# Multi-User Readiness

The current app is still a local admin-first MVP. Before more than one staff member uses it daily, complete these steps.

## Roles

The `002_multi_user_readiness.sql` migration adds:

- `admin`
- `operations`
- `viewer`

Recommended access:

| Role | Access |
|---|---|
| admin | Settings, sync, export, user management, all edits |
| operations | Orders report, courier edits, delivery edits, comments |
| viewer | Read-only report and export |

## Rollout Checklist

- Enable Supabase Auth in the app UI.
- Create the first admin profile manually in `user_profiles`.
- Add Row Level Security policies to operational tables before browser-side writes are introduced.
- Keep Shopify client secret and Supabase service role key server-side only.
- Keep operational writes routed through server endpoints until role checks are fully implemented.

The current server-side app uses the Supabase service role key only in server modules, so it is safe for the local MVP when `.env.local` is kept private.
