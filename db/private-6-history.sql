-- Client price history table, part 6. Staff can read it; only the loader (service key) writes it. Run in a New query tab.

create table if not exists client_price_history (id text primary key, data jsonb not null, updated_at timestamptz not null default now());
alter table client_price_history enable row level security;
grant select on client_price_history to authenticated;
drop policy if exists read_staff on client_price_history;
create policy read_staff on client_price_history for select to authenticated using (app_role() is not null and app_role() <> 'messenger');
