// Creates db/users.private.csv: one login per person in the app, with a random password each.
// The file is git-ignored. Edit the emails in it (and add rows) before running tools/provision.mjs.
// It never overwrites an existing file. Run:  node tools/make-credentials.mjs

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'db', 'users.private.csv');
if (fs.existsSync(out)) { console.log(`${out} already exists; left as it is.`); process.exit(0); }

const seed = JSON.parse(fs.readFileSync(path.join(root, 'data', 'seed.json'), 'utf8'));
const users = [...seed.users, { id: 'u_acct_1', name: 'Accounting 1', role: 'accounting' }];
const slugs = { u_sales_1: 'sales1', u_sales_2: 'sales2', u_mgr_1: 'manager1', u_mgr_2: 'manager2', u_admin_1: 'admin', u_msgr_1: 'messenger1', u_msgr_2: 'messenger2', u_view_acct: 'viewer', u_acct_1: 'accounting1' };

// 16 characters from an alphabet without look-alikes (no 0/O, 1/l/I).
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const password = () => Array.from(crypto.randomBytes(16), b => ALPHA[b % ALPHA.length]).join('');

const lines = ['id,name,role,email,password'];
for (const u of users) lines.push([u.id, `"${u.name.replace(/"/g, '""')}"`, u.role, `${slugs[u.id] || u.id}@mgcpricing.example`, password()].join(','));
fs.writeFileSync(out, lines.join('\n') + '\n');
console.log(`Wrote ${users.length} logins to db/users.private.csv (git-ignored). Change the email addresses to real ones before provisioning.`);
