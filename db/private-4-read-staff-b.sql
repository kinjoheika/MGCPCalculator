-- Signed-in access, step 4 of 4: the rest of the staff tables. Messengers cannot read them. Run in a New query tab.

drop policy if exists read_staff on quotes;
create policy read_staff on quotes for select to authenticated using (app_role() is not null and app_role() <> 'messenger');
drop policy if exists read_staff on price_requests;
create policy read_staff on price_requests for select to authenticated using (app_role() is not null and app_role() <> 'messenger');
drop policy if exists read_staff on acknowledgments;
create policy read_staff on acknowledgments for select to authenticated using (app_role() is not null and app_role() <> 'messenger');
drop policy if exists read_staff on pl_email_log;
create policy read_staff on pl_email_log for select to authenticated using (app_role() is not null and app_role() <> 'messenger');
drop policy if exists read_staff on events;
create policy read_staff on events for select to authenticated using (app_role() is not null and app_role() <> 'messenger');
