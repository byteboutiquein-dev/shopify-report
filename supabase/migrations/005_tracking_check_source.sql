alter table public.order_tracking
add column if not exists tracking_check_source text not null default 'Manual';

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

create index if not exists order_tracking_check_source_idx on public.order_tracking (tracking_check_source);

comment on column public.order_tracking.tracking_check_source is 'Whether the last courier status check was run manually or by schedule.';
