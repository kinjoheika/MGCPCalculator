-- Signed-in access, step 3 of 4: staff can read prices and clients. Messengers cannot. Run in a New query tab.

drop policy if exists read_staff on accounts;
create policy read_staff on accounts for select to authenticated using (app_role() is not null and app_role() <> 'messenger');
drop policy if exists read_staff on cost_basis;
create policy read_staff on cost_basis for select to authenticated using (app_role() is not null and app_role() <> 'messenger');
drop policy if exists read_staff on margin_rules;
create policy read_staff on margin_rules for select to authenticated using (app_role() is not null and app_role() <> 'messenger');
drop policy if exists read_staff on buffers;
create policy read_staff on buffers for select to authenticated using (app_role() is not null and app_role() <> 'messenger');
drop policy if exists read_staff on publications;
create policy read_staff on publications for select to authenticated using (app_role() is not null and app_role() <> 'messenger');
drop policy if exists read_staff on proposals;
create policy read_staff on proposals for select to authenticated using (app_role() is not null and app_role() <> 'messenger');
