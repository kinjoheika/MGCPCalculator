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

-- ---- Start from nothing: remove every earlier policy (including the open stage-1 ones) ----
do $$
declare r record;
begin
  for r in select schemaname, tablename, policyname from pg_policies where schemaname = 'public' loop
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'settings', 'skus', 'channels', 'cost_basis', 'margin_rules', 'buffers', 'accounts', 'competitor_readings',
    'publications', 'proposals', 'quotes', 'price_requests', 'acknowledgments', 'pl_email_log', 'users', 'events'
  ] loop
    execute format('drop trigger if exists %I_touch on %I', t, t);
    execute format('create trigger %I_touch before update on %I for each row execute function touch_updated_at()', t, t);
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on %I from anon', t);
    begin
      execute format('alter publication supabase_realtime add table %I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- ---- Read ----
-- Messengers read only what Price Watch needs; everyone else with a linked login reads everything.
do $$
declare t text;
begin
  foreach t in array array['skus', 'channels', 'competitor_readings', 'settings', 'users'] loop
    execute format('create policy read_all on %I for select to authenticated using (app_role() is not null)', t);
  end loop;
  foreach t in array array['cost_basis', 'margin_rules', 'buffers', 'accounts', 'publications', 'proposals', 'quotes',
                           'price_requests', 'acknowledgments', 'pl_email_log', 'events'] loop
    execute format('create policy read_staff on %I for select to authenticated using (app_role() is not null and app_role() <> ''messenger'')', t);
  end loop;
end $$;

-- ---- Write ----
-- One helper to keep the policies short: insert, update and delete share the same rule.
create or replace procedure add_write_policy(tbl text, rule text) language plpgsql as $$
begin
  execute format('create policy w_insert on %I for insert to authenticated with check (%s)', tbl, rule);
  execute format('create policy w_update on %I for update to authenticated using (%s) with check (%s)', tbl, rule, rule);
  execute format('create policy w_delete on %I for delete to authenticated using (%s)', tbl, rule);
end $$;

-- People and the access table: Admin only.
call add_write_policy('users', 'app_role() = ''admin''');
-- Settings: configuration roles, except the access table itself (Admin only).
call add_write_policy('settings', '(key <> ''accessRoles'' and app_in(array[''admin'',''manager'',''seller''])) or app_role() = ''admin''');
-- Configuration lists.
call add_write_policy('skus', 'app_in(array[''admin'',''manager'',''seller''])');
call add_write_policy('channels', 'app_in(array[''admin'',''manager'',''seller''])');
-- Clients: configuration roles and Accounting (premiums), and whoever publishes (a publish applies client changes).
call add_write_policy('accounts', 'app_in(array[''admin'',''manager'',''seller'',''accounting'']) or app_level(''mpl_publish'') >= 3');
-- Price levers: whoever may edit that lever, or publish (a publish closes old rows and opens new ones).
call add_write_policy('cost_basis', 'app_level(''mpl_cost'') >= 2 or app_level(''mpl_publish'') >= 3');
call add_write_policy('margin_rules', 'app_level(''mpl_margin'') >= 2 or app_level(''mpl_publish'') >= 3');
call add_write_policy('buffers', 'app_level(''mpl_buffer'') >= 2 or app_level(''mpl_publish'') >= 3');
call add_write_policy('proposals', 'app_level(''mpl_draft'') >= 2 or app_level(''mpl_approve'') >= 3 or app_level(''mpl_publish'') >= 3');
call add_write_policy('publications', 'app_level(''mpl_publish'') >= 3');
-- Quotes and price requests: sales and managers raise them; deciding a request needs Approve on price requests.
call add_write_policy('quotes', 'app_in(array[''admin'',''manager'',''seller''])');
create policy w_insert on price_requests for insert to authenticated with check (app_in(array['admin','manager','seller']));
create policy w_update on price_requests for update to authenticated using (app_level('appr_requests') >= 3) with check (app_level('appr_requests') >= 3);
create policy w_delete on price_requests for delete to authenticated using (app_level('appr_requests') >= 3);
-- Competitor readings: any signed-in user adds one (messengers do); changing or removing one is for managers.
create policy w_insert on competitor_readings for insert to authenticated with check (app_role() is not null);
create policy w_update on competitor_readings for update to authenticated using (app_in(array['admin','manager'])) with check (app_in(array['admin','manager']));
create policy w_delete on competitor_readings for delete to authenticated using (app_in(array['admin','manager']));
-- Notices and emails.
call add_write_policy('acknowledgments', 'app_role() is not null and app_role() <> ''messenger''');
call add_write_policy('pl_email_log', 'app_role() is not null and app_role() <> ''messenger''');
-- The event log is append-only: insert for any signed-in user; no update or delete policy exists, so those are refused.
create policy w_insert on events for insert to authenticated with check (app_role() is not null);

drop procedure add_write_policy(text, text);
