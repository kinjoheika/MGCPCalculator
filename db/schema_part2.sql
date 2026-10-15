-- MGC Pricing — Supabase lock-down, part 2 of 4: remove the old open rules, switch security on
-- Run the four parts in order, each in its own New query tab. Safe to run again.

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

