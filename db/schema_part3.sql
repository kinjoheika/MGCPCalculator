-- MGC Pricing — Supabase lock-down, part 3 of 4: who can read
-- Run the four parts in order, each in its own New query tab. Safe to run again.

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
