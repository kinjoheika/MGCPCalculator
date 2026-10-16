-- Signed-in access, step 1 of 4: helper functions and table grants. Run in a New query tab. Safe to run again.

create or replace function app_role() returns text language sql stable security definer set search_path = public as $$
  select data->>'role' from users where data->>'authId' = auth.uid()::text limit 1
$$;

create or replace function app_level(part text) returns int language sql stable security definer set search_path = public as $$
  select coalesce(
    (select (u.data->'access'->>part)::int from users u where u.data->>'authId' = auth.uid()::text limit 1),
    (select (s.data->(app_role())->>part)::int from settings s where s.key = 'accessRoles'),
    0)
$$;

revoke execute on function app_role() from public, anon;
revoke execute on function app_level(text) from public, anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
