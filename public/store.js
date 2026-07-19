// On-device storage (IndexedDB). Exposes an `api` object whose method surface
// mirrors the old REST server, so the view layer is unchanged. No network, no server.
import { PLAN, DEFAULT_SETTINGS, CUT_TARGETS } from './plan.js';

const DB_NAME = 'cutbuild';
const DB_VERSION = 1;
let _db;

function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('weight')) {
        const s = db.createObjectStore('weight', { keyPath: 'id', autoIncrement: true });
        s.createIndex('date', 'date', { unique: true });
      }
      if (!db.objectStoreNames.contains('food')) {
        const s = db.createObjectStore('food', { keyPath: 'id', autoIncrement: true });
        s.createIndex('date', 'date', { unique: false });
      }
      if (!db.objectStoreNames.contains('strength')) {
        const s = db.createObjectStore('strength', { keyPath: 'id', autoIncrement: true });
        s.createIndex('date', 'date', { unique: false });
      }
      if (!db.objectStoreNames.contains('runs')) db.createObjectStore('runs', { keyPath: 'id', autoIncrement: true });
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

const p = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
async function tx(store, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    Promise.resolve(fn(s)).then((v) => (out = v)).catch(reject);
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}
const allFromIndex = (store, index, key) =>
  tx(store, 'readonly', (s) => p(s.index(index).getAll(key)));
const all = (store) => tx(store, 'readonly', (s) => p(s.getAll()));

// ---- settings (seed once) ----
async function getSettings() {
  let s = await tx('settings', 'readonly', (st) => p(st.get(1)));
  if (!s) {
    s = { id: 1, ...DEFAULT_SETTINGS };
    await tx('settings', 'readwrite', (st) => p(st.put(s)));
  } else if (s.phase === undefined) {
    // Migrate pre-phase settings: default to Cut. If targets are still the old
    // defaults (2200/200/175/75), align them to the new Cut targets; else keep edits.
    const wasOldDefault = s.cal_target === 2200 && s.protein_target === 200 && s.carb_target === 175 && s.fat_target === 75;
    s = { ...s, phase: 'cut', ...(wasOldDefault ? CUT_TARGETS : {}) };
    await tx('settings', 'readwrite', (st) => p(st.put(s)));
  }
  return s;
}
async function updateSettings(body) {
  const cur = await getSettings();
  const next = { ...cur, ...body, id: 1 };
  await tx('settings', 'readwrite', (st) => p(st.put(next)));
  return next;
}

// ---- weight (upsert by date) ----
const listWeight = async () => (await all('weight')).sort((a, b) => a.date.localeCompare(b.date));
async function upsertWeight(date, weight) {
  return tx('weight', 'readwrite', async (s) => {
    const existing = await p(s.index('date').get(date));
    const rec = existing ? { ...existing, weight } : { date, weight };
    const id = await p(s.put(rec));
    return { ...rec, id };
  });
}

// ---- generic add / delete ----
const listByDate = async (store, date) => (await allFromIndex(store, 'date', date)).sort((a, b) => a.id - b.id);
async function add(store, rec) {
  return tx(store, 'readwrite', async (s) => { const id = await p(s.add(rec)); return { ...rec, id }; });
}
const remove = (store, id) => tx(store, 'readwrite', (s) => p(s.delete(Number(id))));
const listAll = async (store) => (await all(store)).sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.id - b.id);

const bySet = (a, b) => (a.set_no || 0) - (b.set_no || 0) || a.id - b.id;
const listStrengthAll = async () =>
  (await all('strength')).sort((a, b) => a.date.localeCompare(b.date) || bySet(a, b));
// Most recent PRIOR session's sets for an exercise (for the "previous" column).
async function prevStrengthSession(exercise, beforeDate) {
  const rows = (await all('strength')).filter((r) => r.exercise === exercise && r.date < beforeDate);
  if (!rows.length) return { date: null, sets: [] };
  const date = rows.reduce((m, r) => (r.date > m ? r.date : m), '');
  return { date, sets: rows.filter((r) => r.date === date).sort(bySet) };
}
async function updateStrength(id, patch) {
  return tx('strength', 'readwrite', async (s) => {
    const cur = await p(s.get(Number(id)));
    if (!cur) return null;
    const next = { ...cur, ...patch };
    await p(s.put(next));
    return next;
  });
}

// ---- REST-shaped facade ----
function parse(path) {
  const [pathname, qs] = path.split('?');
  return { pathname, params: new URLSearchParams(qs || '') };
}

export const api = {
  async get(path) {
    const { pathname, params } = parse(path);
    if (pathname === '/bootstrap') return { settings: await getSettings(), plan: PLAN };
    if (pathname === '/weight') return listWeight();
    if (pathname === '/food') return listByDate('food', params.get('date'));
    if (pathname === '/strength/all') return listStrengthAll();
    if (pathname === '/strength/prev') return prevStrengthSession(params.get('exercise'), params.get('before'));
    if (pathname === '/strength') return listByDate('strength', params.get('date'));
    if (pathname === '/runs') return listAll('runs');
    throw new Error('unknown GET ' + pathname);
  },
  async post(path, body) {
    if (path === '/weight') return upsertWeight(body.date, Number(body.weight));
    if (path === '/food') return add('food', {
      date: body.date, name: body.name,
      calories: body.calories | 0, protein: body.protein | 0, carbs: body.carbs | 0, fat: body.fat | 0,
    });
    if (path === '/strength') return add('strength', {
      date: body.date, session: body.session, exercise: body.exercise,
      set_no: body.set_no ?? null,
      weight: body.weight ?? null, reps: body.reps ?? null, sets: body.sets ?? null,
    });
    if (path === '/runs') return add('runs', {
      date: body.date, week: body.week ?? null, duration_min: body.duration_min ?? null,
      distance: body.distance ?? null, notes: body.notes ?? null,
    });
    throw new Error('unknown POST ' + path);
  },
  async put(path, body) {
    if (path === '/settings') return updateSettings(body);
    const m = path.match(/^\/strength\/(\d+)$/);
    if (m) return updateStrength(m[1], { weight: body.weight ?? null, reps: body.reps ?? null });
    throw new Error('unknown PUT ' + path);
  },
  async del(path) {
    const m = path.match(/^\/(weight|food|strength|runs)\/(\d+)$/);
    if (m) { await remove(m[1], m[2]); return { ok: true }; }
    throw new Error('unknown DELETE ' + path);
  },
};

// Small key/value helper for UI state that isn't core data (e.g. shopping checkboxes).
export const kv = {
  get(key, fallback) { try { return JSON.parse(localStorage.getItem('cb:' + key)) ?? fallback; } catch { return fallback; } },
  set(key, val) { localStorage.setItem('cb:' + key, JSON.stringify(val)); },
};
