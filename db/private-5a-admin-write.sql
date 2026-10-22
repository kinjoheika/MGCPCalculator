-- Temporary write access, part 5a of 5b: Admin can add, change and remove rows in these tables. Run in a New query tab.
-- Replaced by the role rules once the access questions are answered.

drop policy if exists admin_write on skus;
create policy admin_write on skus for all to authenticated using (app_role() = 'admin') with check (app_role() = 'admin');
drop policy if exists admin_write on channels;
create policy admin_write on channels for all to authenticated using (app_role() = 'admin') with check (app_role() = 'admin');
drop policy if exists admin_write on settings;
create policy admin_write on settings for all to authenticated using (app_role() = 'admin') with check (app_role() = 'admin');
drop policy if exists admin_write on users;
create policy admin_write on users for all to authenticated using (app_role() = 'admin') with check (app_role() = 'admin');
drop policy if exists admin_write on accounts;
create policy admin_write on accounts for all to authenticated using (app_role() = 'admin') with check (app_role() = 'admin');
drop policy if exists admin_write on cost_basis;
create policy admin_write on cost_basis for all to authenticated using (app_role() = 'admin') with check (app_role() = 'admin');
drop policy if exists admin_write on margin_rules;
create policy admin_write on margin_rules for all to authenticated using (app_role() = 'admin') with check (app_role() = 'admin');
drop policy if exists admin_write on buffers;
create policy admin_write on buffers for all to authenticated using (app_role() = 'admin') with check (app_role() = 'admin');
