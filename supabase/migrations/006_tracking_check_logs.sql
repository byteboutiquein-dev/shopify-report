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

create index if not exists tracking_check_logs_started_at_idx on public.tracking_check_logs (started_at desc);
create index if not exists tracking_check_logs_source_idx on public.tracking_check_logs (check_source);
create index if not exists tracking_check_log_items_log_idx on public.tracking_check_log_items (log_id, created_at);
create index if not exists tracking_check_log_items_order_idx on public.tracking_check_log_items (order_id, created_at desc);
create index if not exists tracking_check_log_items_status_idx on public.tracking_check_log_items (status);

comment on table public.tracking_check_logs is 'History of manual and scheduled courier tracking status checks.';
comment on table public.tracking_check_log_items is 'Per-order result details for courier tracking status checks.';
