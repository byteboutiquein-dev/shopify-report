create table if not exists public.app_settings (
  key text primary key,
  value text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_settings_key_check check (key in ('shopify_tracking_refresh_limit', 'delivery_delay_days'))
);

insert into public.app_settings (key, value)
values
  ('shopify_tracking_refresh_limit', '1000'),
  ('delivery_delay_days', '4')
on conflict (key) do nothing;

create index if not exists app_settings_updated_at_idx on public.app_settings (updated_at desc);

drop trigger if exists app_settings_set_updated_at on public.app_settings;
create trigger app_settings_set_updated_at
before update on public.app_settings
for each row execute function public.set_updated_at();

comment on table public.app_settings is 'Operational settings configurable from the app UI.';
