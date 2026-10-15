-- MGC Pricing — Supabase lock-down, part 1 of 4: tables and helper functions
-- Run the four parts in order, each in its own New query tab. Safe to run again.

-- MGC Pricing — Supabase schema, locked down for real data.
-- Run once in the Supabase SQL editor (Dashboard → SQL editor → New query → paste → Run). Safe to run again.
--
-- Every collection of the app's state is one table: id + the record as jsonb.
-- Nothing is readable or writable without logging in. A login only works if it is linked to a row of `users`
-- (users.data->>'authId' = the Supabase Auth user id; tools/provision.mjs sets that up).
-- What each person may do follows the app's access table (settings key 'accessRoles' plus per-user overrides).

create table if not exists settings (key text primary key, data jsonb not null, updated_at timestamptz not null default now());

do $$
declare t text;
begin
  foreach t in array array[
    'skus', 'channels', 'cost_basis', 'margin_rules', 'buffers', 'accounts', 'competitor_readings',
    'publications', 'proposals', 'quotes', 'price_requests', 'acknowledgments', 'pl_email_log', 'users', 'events'
  ] loop
    execute format('create table if not exists %I (id text primary key, data jsonb not null, updated_at timestamptz not null default now())', t);
  end loop;
end $$;

create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- ---- Who is asking ----
create or replace function app_user() returns jsonb language sql stable security definer set search_path = public as $$
  select data from users where data->>'authId' = auth.uid()::text limit 1
$$;
create or replace function app_role() returns text language sql stable security definer set search_path = public as $$
  select app_user()->>'role'
$$;
-- Access level of one part for the signed-in user: 0 None, 1 View, 2 Edit, 3 Approve.
create or replace function app_level(part text) returns int language sql stable security definer set search_path = public as $$
  select coalesce(
    (app_user()->'access'->>part)::int,
    (select (data->app_role()->>part)::int from settings where key = 'accessRoles'),
    0)
$$;
create or replace function app_in(roles text[]) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(app_role() = any(roles), false)
$$;

