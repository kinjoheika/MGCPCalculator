// Prototype store: seed load, localStorage persistence, append-only event log.
// Every mutation goes through commit(event, mutationFn). That is the single choke point
// that writes the log. Later this becomes the API layer.

const KEY = 'mgc_pricing_v1';
const USER_KEY = 'mgc_pricing_v1_user';

export const ACTIONS = [
  'DRAFT', 'SIMULATE', 'APPROVE', 'PUBLISH', 'QUOTE_SENT', 'REQUEST_LOWER',
  'REQUEST_DECIDED', 'READING_CAPTURED', 'BOARD_ACKNOWLEDGED', 'ACCOUNTS_IMPORTED', 'CONFIG_CHANGED', 'PRICE_LIST_ISSUED', 'CLIENT_TERMS_SAVED',
];

let state = null;
let seed = null;
const listeners = new Set();

function clone(x) {
  return JSON.parse(JSON.stringify(x));
}

function lsGet(k) {
  try { return localStorage.getItem(k); } catch { return null; }
}
function lsSet(k, v) {
  try { localStorage.setItem(k, v); } catch { /* storage unavailable */ }
}
function lsDel(k) {
  try { localStorage.removeItem(k); } catch { /* storage unavailable */ }
}

export function uid(prefix) {
  const rnd = (crypto.getRandomValues ? crypto.getRandomValues(new Uint32Array(1))[0] : Math.random() * 2 ** 32).toString(36);
  return `${prefix}_${Date.now().toString(36)}${rnd}`;
}

export async function sha256(value) {
  const text = JSON.stringify(value);
  if (crypto.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  // Insecure-context fallback (file://). Clearly labelled so nobody mistakes it for SHA-256.
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return 'fnv1a-' + (h >>> 0).toString(16).padStart(8, '0');
}

export async function init() {
  const res = await fetch('data/seed.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(`Could not load data/seed.json (${res.status})`);
  seed = await res.json();
  const raw = lsGet(KEY);
  if (raw) {
    try { state = JSON.parse(raw); } catch { state = clone(seed); }
    // Bring saved sessions up to date with channels added to the seed later.
    for (const c of seed.channels) if (!state.channels.some(x => x.id === c.id)) state.channels.push(clone(c));
    state.buffers ||= [];
    for (const b of seed.buffers || []) if (!state.buffers.some(x => x.channelId === b.channelId)) state.buffers.push(clone(b));
  } else {
    state = clone(seed);
  }
  return state;
}

export function get() {
  return state;
}

export function getSeed() {
  return seed;
}

function save() {
  lsSet(KEY, JSON.stringify(state));
}

function emit() {
  for (const fn of listeners) fn(state);
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ---- Current user (prototype stand-in for auth; not part of the data) ----

export function currentUser() {
  const id = lsGet(USER_KEY) || 'u_mgr_1';
  return state.users.find(u => u.id === id) || state.users[0];
}

export function setCurrentUser(id) {
  lsSet(USER_KEY, id);
  emit();
}

// ---- The single mutation choke point ----
//
// evt: { action, entity, entityId, field, before, after, proposalId, objective,
//        instructedBy, verifiedBy, hashOf? }
// hashOf (optional) is hashed into snapshotHash and not stored on the event.
// mutationFn(draft, event) mutates a copy of state; it may throw to abort (nothing is written).

export async function commit(evt, mutationFn) {
  if (!ACTIONS.includes(evt.action)) throw new Error(`Unknown action ${evt.action}`);
  const user = currentUser();
  const { hashOf, ...rest } = evt;
  const event = {
    id: uid('ev'),
    timestamp: new Date().toISOString(),
    actorId: user ? user.id : null,
    actorRole: user ? user.role : null,
    action: null, entity: null, entityId: null, field: null, before: null, after: null,
    proposalId: null, objective: null, instructedBy: null, verifiedBy: null, snapshotHash: null,
    ...rest,
  };
  if (hashOf !== undefined) event.snapshotHash = await sha256(hashOf);

  const draft = clone(state);
  const result = mutationFn ? mutationFn(draft, event) : undefined;
  draft.events.push(event);
  state = draft;
  save();
  emit();
  return { event, result };
}

// ---- Demo tools (not domain mutations, so no event) ----

export function reset() {
  lsDel(KEY);
  state = clone(seed);
  save();
  emit();
}

export function exportJson() {
  return JSON.stringify(state, null, 2);
}

export function importJson(text) {
  const next = JSON.parse(text);
  const required = ['costBasis', 'skus', 'channels', 'marginRules', 'accounts', 'users', 'events', 'publications'];
  const missing = required.filter(k => !Array.isArray(next[k]));
  if (missing.length) throw new Error(`Import is missing: ${missing.join(', ')}`);
  for (const k of ['buffers', 'proposals', 'quotes', 'priceRequests', 'acknowledgments', 'competitorReadings'])
    if (!Array.isArray(next[k])) next[k] = [];
  state = next;
  save();
  emit();
}
