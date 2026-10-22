-- Make the database private: the public (anon) key can no longer read or write any table.
-- Run in the Supabase SQL editor in a New query tab. Three short lines, safe to run again.

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from anon;
