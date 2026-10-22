-- MGC Pricing — Supabase lock-down, part 4 of 4: who can write
-- Run the four parts in order, each in its own New query tab. Safe to run again.

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
