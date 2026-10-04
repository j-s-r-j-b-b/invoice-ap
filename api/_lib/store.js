// Tiny key-value store. Uses Upstash Redis (REST) when configured on Vercel,
// otherwise a local JSON file (dev) / /tmp file (temporary on serverless).
import fs from 'node:fs';
import path from 'node:path';
import { LEDGER, DEFAULT_RULES } from './seed.js';

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
export const storeKind = URL_ && TOKEN ? 'redis' : process.env.VERCEL ? 'temporary' : 'local-file';

const P = 'ap:';

async function redis(cmd) {
  const r = await fetch(URL_, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(cmd) });
  const j = await r.json();
  if (j.error) throw new Error('Redis: ' + j.error);
  return j.result;
}

const FILE = process.env.VERCEL ? '/tmp/ap-store.json' : path.join(process.cwd(), '.data', 'store.json');
function readFile() { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; } }
function writeFile(d) { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(d)); }

async function get(key) {
  if (storeKind === 'redis') { const v = await redis(['GET', P + key]); return v == null ? null : JSON.parse(v); }
  const d = readFile(); return d[key] ?? null;
}
async function set(key, val) {
  if (storeKind === 'redis') return redis(['SET', P + key, JSON.stringify(val)]);
  const d = readFile(); d[key] = val; writeFile(d);
}
async function del(keys) {
  if (!keys.length) return;
  if (storeKind === 'redis') return redis(['DEL', ...keys.map((k) => P + k)]);
  const d = readFile(); keys.forEach((k) => delete d[k]); writeFile(d);
}

// ---- domain helpers ----
export async function getRules() { return { ...DEFAULT_RULES, ...((await get('rules')) || {}) }; }
export async function saveRules(r) { await set('rules', r); return getRules(); }

export async function getLedger() { return (await get('ledger')) || LEDGER; }
export async function addToLedger(entry) { const l = await getLedger(); l.push(entry); await set('ledger', l); }

export async function listRunIds() { return (await get('runs')) || []; }
export async function getRun(id) { return get('run:' + id); }
export async function saveRun(run) {
  await set('run:' + run.id, run);
  const ids = await listRunIds();
  if (!ids.includes(run.id)) { ids.unshift(run.id); await set('runs', ids); }
}
export async function listRuns() {
  const ids = await listRunIds();
  if (!ids.length) return [];
  if (storeKind === 'redis') {
    const vals = await redis(['MGET', ...ids.map((i) => P + 'run:' + i)]);
    return vals.filter(Boolean).map((v) => JSON.parse(v));
  }
  const d = readFile(); return ids.map((i) => d['run:' + i]).filter(Boolean);
}

// Original documents, so a case can always show what was received (skipped if too large for the free DB tier).
export async function saveFile(id, file) { if (file.base64.length < 750000) await set('file:' + id, file); }
export async function getFile(id) { return get('file:' + id); }

export async function resetAll() {
  const ids = await listRunIds();
  await del([...ids.map((i) => 'run:' + i), ...ids.map((i) => 'file:' + i), 'runs', 'ledger', 'rules']);
}
