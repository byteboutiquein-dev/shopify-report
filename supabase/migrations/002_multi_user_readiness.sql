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

create policy "Users can read their own profile"
on public.user_profiles
for select
to authenticated
using (auth.uid() = user_id);

create policy "Admins can read all profiles"
on public.user_profiles
for select
to authenticated
using (public.current_app_role() = 'admin');

comment on table public.user_profiles is 'Supabase Auth profile and role mapping for future multi-user rollout.';
