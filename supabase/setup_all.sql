-- Shopify report app setup.
-- Run this file once in Supabase Dashboard > SQL Editor.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.shops (
  id uuid primary key default gen_random_uuid(),
  shop_domain text not null unique,
  shop_name text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shops_domain_format check (shop_domain ~ '^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$')
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  shopify_order_id text not null,
  order_name text not null,
  order_date date not null,
  customer_name text,
  customer_email text,
  customer_phone text,
  shipping_city text,
  shipping_state text,
  total_price numeric(12, 2) not null default 0,
  currency text not null default 'INR',
  financial_status text,
  fulfillment_status text,
  shopify_updated_at timestamptz,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_shopify_order_unique unique (shop_id, shopify_order_id),
  constraint orders_currency_format check (currency ~ '^[A-Z]{3}$')
);

-- Keep existing databases in sync when this combined setup file is re-run.
alter table public.orders
add column if not exists shipping_city text,
add column if not exists shipping_state text;

create table if not exists public.order_tracking (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  courier_date date,
  courier_name text,
  courier_charge numeric(10, 2),
  tracking_id text,
  tracking_url text,
  tracking_status text not null default 'Pending',
  tracking_checked_at timestamptz,
  tracking_check_error text,
  tracking_check_source text not null default 'Manual',
  tracking_provider text,
  delivery_date date,
  delivery_status text not null default 'Pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint order_tracking_order_unique unique (order_id),
  constraint order_tracking_status_check check (tracking_status in ('Pending', 'Sent', 'In Transit', 'Delivered', 'Failed')),
  constraint order_tracking_check_source_check check (tracking_check_source in ('Manual', 'Scheduled')),
  constraint order_delivery_status_check check (delivery_status in ('Pending', 'In Transit', 'Check Failed', 'Delivered', 'Returned', 'Issue')),
  constraint order_tracking_charge_nonnegative check (courier_charge is null or courier_charge >= 0)
);

-- Keep existing databases in sync when this combined setup file is re-run.
alter table public.order_tracking
add column if not exists tracking_checked_at timestamptz,
add column if not exists tracking_check_error text,
add column if not exists tracking_check_source text not null default 'Manual',
add column if not exists tracking_provider text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'order_tracking_check_source_check'
  ) then
    alter table public.order_tracking
    add constraint order_tracking_check_source_check
    check (tracking_check_source in ('Manual', 'Scheduled'));
  end if;
end $$;

alter table public.order_tracking
drop constraint if exists order_delivery_status_check;

alter table public.order_tracking
add constraint order_delivery_status_check
check (delivery_status in ('Pending', 'In Transit', 'Check Failed', 'Delivered', 'Returned', 'Issue'));

create table if not exists public.order_communication (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  confirm_txt_status text not null default 'Pending',
  tracking_txt_status text not null default 'Pending',
  review_txt_status text not null default 'Pending',
  confirm_sent_at timestamptz,
  tracking_sent_at timestamptz,
  review_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint order_communication_order_unique unique (order_id),
  constraint confirm_txt_status_check check (confirm_txt_status in ('Pending', 'Sent', 'Failed', 'Not Needed')),
  constraint tracking_txt_status_check check (tracking_txt_status in ('Pending', 'Sent', 'Failed', 'Not Needed')),
  constraint review_txt_status_check check (review_txt_status in ('Pending', 'Sent', 'Received', 'Failed', 'Not Needed'))
);

create table if not exists public.order_comments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  comment_type text not null default 'Internal Note',
  comment text not null,
  created_by text,
  created_at timestamptz not null default now(),
  constraint order_comments_type_check check (comment_type in ('Review', 'Delivery Issue', 'Internal Note', 'Courier Issue'))
);

create table if not exists public.sync_logs (
  id uuid primary key default gen_random_uuid(),
  sync_type text not null default 'Manual',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'Success',
  orders_checked integer not null default 0,
  orders_inserted integer not null default 0,
  orders_updated integer not null default 0,
  error_message text,
  created_at timestamptz not null default now(),
  constraint sync_logs_type_check check (sync_type in ('Manual', 'Scheduled', 'Webhook')),
  constraint sync_logs_status_check check (status in ('Success', 'Partial', 'Failed')),
  constraint sync_logs_counts_nonnegative check (
    orders_checked >= 0 and orders_inserted >= 0 and orders_updated >= 0
  )
);

create table if not exists public.tracking_check_logs (
  id uuid primary key default gen_random_uuid(),
  check_source text not null default 'Manual',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'Success',
  orders_checked integer not null default 0,
  orders_updated integer not null default 0,
  orders_failed integer not null default 0,
  orders_skipped integer not null default 0,
  error_message text,
  created_at timestamptz not null default now(),
  constraint tracking_check_logs_source_check check (check_source in ('Manual', 'Scheduled')),
  constraint tracking_check_logs_status_check check (status in ('Success', 'Partial', 'Failed')),
  constraint tracking_check_logs_counts_nonnegative check (
    orders_checked >= 0 and orders_updated >= 0 and orders_failed >= 0 and orders_skipped >= 0
  )
);

create table if not exists public.tracking_check_log_items (
  id uuid primary key default gen_random_uuid(),
  log_id uuid not null references public.tracking_check_logs(id) on delete cascade,
  order_id uuid references public.orders(id) on delete set null,
  order_name text,
  courier_name text,
  tracking_id text,
  tracking_url text,
  status text not null,
  checked_at timestamptz,
  previous_courier_date date,
  fetched_courier_date date,
  new_courier_date date,
  previous_delivery_date date,
  fetched_delivery_date date,
  new_delivery_date date,
  previous_delivery_status text,
  fetched_delivery_status text,
  new_delivery_status text,
  previous_tracking_status text,
  fetched_tracking_status text,
  new_tracking_status text,
  error_message text,
  created_at timestamptz not null default now(),
  constraint tracking_check_log_items_status_check check (status in ('Fetched', 'Updated', 'Skipped', 'Failed'))
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid not null,
  field_name text not null,
  old_value text,
  new_value text,
  changed_by text,
  changed_at timestamptz not null default now(),
  constraint audit_logs_entity_type_check check (entity_type in ('Order', 'Tracking', 'Communication', 'Comment'))
);

create table if not exists public.app_settings (
  key text primary key,
  value text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_settings_key_check check (key in ('shopify_tracking_refresh_limit', 'shopify_order_refresh_days', 'delivery_delay_days'))
);

alter table public.app_settings
drop constraint if exists app_settings_key_check;

alter table public.app_settings
add constraint app_settings_key_check
check (key in ('shopify_tracking_refresh_limit', 'shopify_order_refresh_days', 'delivery_delay_days'));

insert into public.app_settings (key, value)
values
  ('shopify_tracking_refresh_limit', '1000'),
  ('shopify_order_refresh_days', '30'),
  ('delivery_delay_days', '4')
on conflict (key) do nothing;

create index if not exists orders_shop_date_idx on public.orders (shop_id, order_date desc);
create index if not exists orders_order_name_idx on public.orders (order_name);
create index if not exists orders_customer_name_idx on public.orders (customer_name);
create index if not exists orders_shipping_city_idx on public.orders (shipping_city);
create index if not exists orders_shipping_state_idx on public.orders (shipping_state);
create index if not exists orders_financial_status_idx on public.orders (financial_status);
create index if not exists orders_fulfillment_status_idx on public.orders (fulfillment_status);
create index if not exists order_tracking_tracking_id_idx on public.order_tracking (tracking_id) where tracking_id is not null;
create index if not exists order_tracking_courier_name_idx on public.order_tracking (courier_name);
create index if not exists order_tracking_delivery_status_idx on public.order_tracking (delivery_status);
create index if not exists order_tracking_tracking_status_idx on public.order_tracking (tracking_status);
create index if not exists order_tracking_checked_at_idx on public.order_tracking (tracking_checked_at desc);
create index if not exists order_tracking_check_source_idx on public.order_tracking (tracking_check_source);
create index if not exists order_tracking_provider_idx on public.order_tracking (tracking_provider);
create index if not exists order_communication_confirm_status_idx on public.order_communication (confirm_txt_status);
create index if not exists order_communication_tracking_status_idx on public.order_communication (tracking_txt_status);
create index if not exists order_communication_review_status_idx on public.order_communication (review_txt_status);
create index if not exists order_comments_order_created_idx on public.order_comments (order_id, created_at desc);
create index if not exists sync_logs_started_at_idx on public.sync_logs (started_at desc);
create index if not exists tracking_check_logs_started_at_idx on public.tracking_check_logs (started_at desc);
create index if not exists tracking_check_logs_source_idx on public.tracking_check_logs (check_source);
create index if not exists tracking_check_log_items_log_idx on public.tracking_check_log_items (log_id, created_at);
create index if not exists tracking_check_log_items_order_idx on public.tracking_check_log_items (order_id, created_at desc);
create index if not exists tracking_check_log_items_status_idx on public.tracking_check_log_items (status);
create index if not exists app_settings_updated_at_idx on public.app_settings (updated_at desc);
create index if not exists audit_logs_entity_idx on public.audit_logs (entity_type, entity_id, changed_at desc);

drop trigger if exists shops_set_updated_at on public.shops;
create trigger shops_set_updated_at
before update on public.shops
for each row execute function public.set_updated_at();

drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at
before update on public.orders
for each row execute function public.set_updated_at();

drop trigger if exists order_tracking_set_updated_at on public.order_tracking;
create trigger order_tracking_set_updated_at
before update on public.order_tracking
for each row execute function public.set_updated_at();

drop trigger if exists order_communication_set_updated_at on public.order_communication;
create trigger order_communication_set_updated_at
before update on public.order_communication
for each row execute function public.set_updated_at();

drop trigger if exists app_settings_set_updated_at on public.app_settings;
create trigger app_settings_set_updated_at
before update on public.app_settings
for each row execute function public.set_updated_at();

do $$
begin
  if not exists (select 1 from pg_type where typname = 'app_role') then
    create type public.app_role as enum ('admin', 'operations', 'viewer');
  end if;
end $$;

create table if not exists public.user_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  display_name text,
  role public.app_role not null default 'viewer',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_profiles_role_idx on public.user_profiles (role);
create index if not exists user_profiles_active_idx on public.user_profiles (is_active);

drop trigger if exists user_profiles_set_updated_at on public.user_profiles;
create trigger user_profiles_set_updated_at
before update on public.user_profiles
for each row execute function public.set_updated_at();

alter table public.user_profiles enable row level security;

create or replace function public.current_app_role()
returns public.app_role
language sql
security definer
set search_path = public
as $$
  select role
  from public.user_profiles
  where user_id = auth.uid()
    and is_active = true
  limit 1
$$;

drop policy if exists "Users can read their own profile" on public.user_profiles;
create policy "Users can read their own profile"
on public.user_profiles
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Admins can read all profiles" on public.user_profiles;
create policy "Admins can read all profiles"
on public.user_profiles
for select
to authenticated
using (public.current_app_role() = 'admin');

comment on table public.shops is 'Shopify store configuration. Shopify client credentials must stay in server environment variables.';
comment on table public.orders is 'Shopify-owned order fields synced from Shopify GraphQL Admin API.';
comment on column public.orders.shipping_city is 'Shipping destination city from Shopify shipping address.';
comment on column public.orders.shipping_state is 'Shipping destination state/province from Shopify shipping address.';
comment on table public.order_tracking is 'Manual courier, tracking, and delivery fields owned by operations staff.';
comment on column public.order_tracking.tracking_checked_at is 'Last time the app checked the courier tracking page.';
comment on column public.order_tracking.tracking_check_error is 'Last status-check error, if the courier tracking page could not be read.';
comment on column public.order_tracking.tracking_check_source is 'Whether the last courier status check was run manually or by schedule.';
comment on column public.order_tracking.tracking_provider is 'Tracking website/provider that returned the last successful courier status.';
comment on table public.order_communication is 'Manual message status fields from the spreadsheet workflow.';
comment on table public.order_comments is 'Review comments and internal operational notes.';
comment on table public.sync_logs is 'History of manual, scheduled, or webhook sync attempts.';
comment on table public.tracking_check_logs is 'History of manual and scheduled courier tracking status checks.';
comment on table public.tracking_check_log_items is 'Per-order result details for courier tracking status checks.';
comment on table public.app_settings is 'Operational settings configurable from the app UI.';
comment on table public.audit_logs is 'Manual edit history for operational fields.';
comment on table public.user_profiles is 'Supabase Auth profile and role mapping for future multi-user rollout.';

-- Make newly-created tables/columns visible to Supabase REST immediately after running this file.
notify pgrst, 'reload schema';
