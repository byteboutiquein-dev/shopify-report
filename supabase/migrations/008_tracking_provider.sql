alter table public.order_tracking
add column if not exists tracking_provider text;

create index if not exists order_tracking_provider_idx on public.order_tracking (tracking_provider);

comment on column public.order_tracking.tracking_provider is 'Tracking website/provider that returned the last successful courier status.';

notify pgrst, 'reload schema';
