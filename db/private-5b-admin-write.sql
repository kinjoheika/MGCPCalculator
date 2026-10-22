-- Temporary write access, part 5b of 5b: Admin can change these tables. The event log only takes new rows. Run in a New query tab.
-- Replaced by the role rules once the access questions are answered.

drop policy if exists admin_write on publications;
create policy admin_write on publications for all to authenticated using (app_role() = 'admin') with check (app_role() = 'admin');
drop policy if exists admin_write on proposals;
create policy admin_write on proposals for all to authenticated using (app_role() = 'admin') with check (app_role() = 'admin');
drop policy if exists admin_write on quotes;
create policy admin_write on quotes for all to authenticated using (app_role() = 'admin') with check (app_role() = 'admin');
drop policy if exists admin_write on price_requests;
create policy admin_write on price_requests for all to authenticated using (app_role() = 'admin') with check (app_role() = 'admin');
drop policy if exists admin_write on acknowledgments;
create policy admin_write on acknowledgments for all to authenticated using (app_role() = 'admin') with check (app_role() = 'admin');
drop policy if exists admin_write on pl_email_log;
create policy admin_write on pl_email_log for all to authenticated using (app_role() = 'admin') with check (app_role() = 'admin');
drop policy if exists admin_write on competitor_readings;
create policy admin_write on competitor_readings for all to authenticated using (app_role() = 'admin') with check (app_role() = 'admin');
drop policy if exists admin_insert on events;
create policy admin_insert on events for insert to authenticated with check (app_role() = 'admin');
