// Sets up the Supabase project for real use. Run it on your own computer; the service key never goes in the app or the repo.
//
//   $env:SUPABASE_SERVICE_KEY = "<service_role key>"          (PowerShell)
//   export SUPABASE_SERVICE_KEY="<service_role key>"           (bash)
//   node tools/provision.mjs                  create/update the logins and the structure, keep existing data
//   node tools/provision.mjs --wipe --yes     first delete EVERY row in the app's tables (demo data), then provision
//   node tools/provision.mjs --demo           also load the demo clients, margins and price history (testing only)
//   node tools/provision.mjs --import db/import.private.json   load the basic tables from the workbook (see tools/extract-workbook.py):
//                                             products, channels, zones, competitors, clients and client terms
//
// What it does:
//   1. Reads db/users.private.csv (id,name,role,email,password) and creates each login in Supabase Auth
//      (already confirmed, so no email is sent), or resets the password if the email already exists.
//   2. Writes the structure the app needs: users linked to their logins, channels, products, premium and discount
//      components, zones, the access table, a zero cost basis and an empty "v1" price list. No clients, margins or prices.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SUPABASE_URL } from '../js/config.js';
import { COLLECTIONS, SINGLETONS } from '../js/db.js';
import { ROLE_DEFAULTS, ACCESS_ROLES } from '../js/access.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const KEY = process.env.SUPABASE_SERVICE_KEY;
const URL_ = process.env.SUPABASE_URL || SUPABASE_URL;
if (!KEY || !URL_) { console.error('Set SUPABASE_SERVICE_KEY (and SUPABASE_URL if js/config.js is blank).'); process.exit(1); }
if (args.has('--wipe') && !args.has('--yes')) { console.error('--wipe deletes every row. Add --yes to confirm.'); process.exit(1); }

const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
async function call(method, p, body, extra = {}) {
  const res = await fetch(`${URL_}${p}`, { method, headers: { ...H, ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${p} → ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

// ---- logins ----
const csv = fs.readFileSync(path.join(root, 'db', 'users.private.csv'), 'utf8').trim().split(/\r?\n/).slice(1).map(line => {
  const cells = []; let cur = '', q = false;
  for (const ch of line) { if (ch === '"') q = !q; else if (ch === ',' && !q) { cells.push(cur); cur = ''; } else cur += ch; }
  cells.push(cur);
  const [id, name, role, email, password] = cells;
  return { id, name, role, email: email.trim().toLowerCase(), password };
});
const existing = new Map(((await call('GET', '/auth/v1/admin/users?per_page=1000')).users || []).map(u => [u.email.toLowerCase(), u.id]));
const authIds = {};
for (const u of csv) {
  if (existing.has(u.email)) {
    authIds[u.id] = existing.get(u.email);
    await call('PUT', `/auth/v1/admin/users/${authIds[u.id]}`, { password: u.password, email_confirm: true });
    console.log(`updated login  ${u.email}`);
  } else {
    const made = await call('POST', '/auth/v1/admin/users', { email: u.email, password: u.password, email_confirm: true, user_metadata: { name: u.name } });
    authIds[u.id] = made.id;
    console.log(`created login  ${u.email}`);
  }
}

// ---- optional wipe ----
const tables = [...Object.values(COLLECTIONS).map(([t]) => t), 'settings'];
if (args.has('--wipe')) {
  for (const t of tables) {
    await call('DELETE', `/rest/v1/${t}?${t === 'settings' ? 'key' : 'id'}=not.is.null`, undefined, { Prefer: 'return=minimal' });
    console.log(`emptied        ${t}`);
  }
}

// ---- structure (and demo data with --demo) ----
const seed = JSON.parse(fs.readFileSync(path.join(root, 'data', 'seed.json'), 'utf8'));
const mock = args.has('--demo') && fs.existsSync(path.join(root, 'data', 'clients.mock.json')) ? JSON.parse(fs.readFileSync(path.join(root, 'data', 'clients.mock.json'), 'utf8')) : null;
const channelIds = seed.channels.map(c => c.id);
const baseUsers = new Map([...seed.users, { id: 'u_acct_1', name: 'Accounting 1', role: 'accounting', channels: ['*'], canDraft: false, canApprove: false }].map(u => [u.id, u]));
const users = csv.map(c => {
  const u = { ...(baseUsers.get(c.id) || { id: c.id, channels: ['manager', 'admin', 'accounting'].includes(c.role) ? ['*'] : c.role === 'messenger' ? [] : channelIds, canDraft: false, canApprove: false }), name: c.name, role: c.role, authId: authIds[c.id] };
  if (c.id === 'u_mgr_2') u.access = { mpl_approve: 3, mpl_publish: 3, appr_requests: 3 };
  return u;
});
const now = new Date().toISOString();
const state = {
  settings: seed.settings, premiumComponents: seed.premiumComponents, discountComponents: seed.discountComponents, zones: seed.zones, trackedBrands: args.has('--demo') ? seed.trackedBrands : [],
  accessRoles: Object.fromEntries(ACCESS_ROLES.concat('messenger').map(r => [r, ROLE_DEFAULTS[r]])),
  skus: seed.skus, channels: seed.channels, users,
};
if (args.has('--demo')) {
  for (const k of Object.keys(COLLECTIONS)) if (!(k in state)) state[k] = [...(seed[k] || []), ...(mock?.[k] || [])];
  state.users = users;
} else {
  state.costBasis = [{ id: 'cb_setup', acqPerKg: 0, haulingPerKg: 0, effectiveFrom: now.slice(0, 10), effectiveTo: null }];
  state.publications = [{ version: 1, publishedAt: now, proposalId: null, objective: 'Initial price list', instructedBy: null, verifiedBy: null, draftedBy: null, publishedBy: null }];
}

const importFile = process.argv.includes('--import') ? process.argv[process.argv.indexOf('--import') + 1] : null;
if (importFile) {
  const imp = JSON.parse(fs.readFileSync(path.resolve(importFile), 'utf8'));
  for (const k of ['skus', 'channels', 'zones', 'trackedBrands', 'accounts']) state[k] = imp[k];
  console.log(`import file     ${imp.skus.length} products, ${imp.channels.length} channels, ${imp.zones.length} zones, ${imp.trackedBrands.length} competitors, ${imp.accounts.length} clients`);
}

const rows = (key) => {
  const [, keyFn] = COLLECTIONS[key];
  return (state[key] || []).map(r => ({ id: keyFn(r), data: r }));
};
async function upsert(table, list, conflict) {
  for (let i = 0; i < list.length; i += 400) {
    await call('POST', `/rest/v1/${table}?on_conflict=${conflict}`, list.slice(i, i + 400), { Prefer: 'resolution=merge-duplicates,return=minimal' });
  }
}
for (const key of Object.keys(COLLECTIONS)) {
  if (!state[key]) continue;
  // Without --wipe an existing table keeps its rows; only users, channels, products are refreshed from the setup.
  if (!args.has('--wipe') && !args.has('--demo') && !['users', 'skus', 'channels', ...(importFile ? ['accounts'] : [])].includes(key)) {
    const have = await call('GET', `/rest/v1/${COLLECTIONS[key][0]}?select=id&limit=1`);
    if (have.length) { console.log(`kept           ${COLLECTIONS[key][0]} (has data)`); continue; }
  }
  await upsert(COLLECTIONS[key][0], rows(key), 'id');
  console.log(`wrote          ${COLLECTIONS[key][0]} (${rows(key).length})`);
}
const settingRows = SINGLETONS.filter(k => state[k] !== undefined).map(k => ({ key: k, data: state[k] }));
settingRows.push({ key: '_order', data: Object.fromEntries(['skus', 'channels', 'users'].map(k => [k, state[k].map(COLLECTIONS[k][1])])) });
// Never overwrite an access table someone has already edited.
const haveAccess = await call('GET', '/rest/v1/settings?select=key&key=eq.accessRoles');
await upsert('settings', haveAccess.length && !args.has('--wipe') ? settingRows.filter(r => r.key !== 'accessRoles') : settingRows, 'key');
console.log('wrote          settings');
console.log('\nDone. Sign in at the app with the emails and passwords in db/users.private.csv, then change the emails to real ones in the Supabase dashboard (Authentication → Users).');
