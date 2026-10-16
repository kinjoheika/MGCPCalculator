// Loads db/history.private.json (made by tools/extract-history.py) into the client_price_history table.
// Needs the service key in the environment; never put it in a file. Run after db/private-6-history.sql:
//
//   $env:SUPABASE_SERVICE_KEY = "<service_role key>"
//   $env:SUPABASE_URL = "https://<your-project>.supabase.co"
//   node tools/load-history.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const KEY = process.env.SUPABASE_SERVICE_KEY;
const URL_ = process.env.SUPABASE_URL;
if (!KEY || !URL_) { console.error('Set SUPABASE_SERVICE_KEY and SUPABASE_URL first.'); process.exit(1); }

const { rows } = JSON.parse(fs.readFileSync(path.join(root, 'db', 'history.private.json'), 'utf8'));
const records = rows.map(r => ({
  id: `${r.accountId}|${r.channelId}|${r.effectiveDate}|${r.skuId}`,
  data: r,
}));

const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' };
for (let i = 0; i < records.length; i += 400) {
  const res = await fetch(`${URL_}/rest/v1/client_price_history?on_conflict=id`, { method: 'POST', headers: H, body: JSON.stringify(records.slice(i, i + 400)) });
  if (!res.ok) { console.error(`Failed at row ${i}: ${res.status} ${(await res.text()).slice(0, 300)}`); process.exit(1); }
}
console.log(`Loaded ${records.length} price points into client_price_history.`);
