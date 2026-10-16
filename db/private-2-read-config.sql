-- Signed-in access, step 2 of 4: anyone signed in with a linked user can read the configuration tables. Run in a New query tab.

drop policy if exists read_signed on skus;
create policy read_signed on skus for select to authenticated using (app_role() is not null);
drop policy if exists read_signed on channels;
create policy read_signed on channels for select to authenticated using (app_role() is not null);
drop policy if exists read_signed on settings;
create policy read_signed on settings for select to authenticated using (app_role() is not null);
drop policy if exists read_signed on users;
create policy read_signed on users for select to authenticated using (app_role() is not null);
drop policy if exists read_signed on competitor_readings;
create policy read_signed on competitor_readings for select to authenticated using (app_role() is not null);
