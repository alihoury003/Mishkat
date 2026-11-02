/* ============================================================
   Mishkat — application
   Offline mushaf (604 pages, Arabic + Sahih International), a plan built
   from each person's own memorised pages, and a bilingual interface.
   ============================================================ */
'use strict';

const STORE = 'mishkat.v1';
const OLD_STORE = 'hifzAtlas.v1';
const TOTAL_PAGES = 604;
const SCENES = ['ridge', 'forest', 'sea'];
const SCENE_NAMES = { ridge: 'Dawn ridges', forest: 'Cedar light', sea: 'Night sea' };
const CYCLE_MS = 180000;
const OWNER_CODE = 'mishkat-314';        // change me
const OWNER_KEY = 'mishkat.owner';

// the plan built for you, akhi — so owner access never starts from zero
const OWNER_PROFILE = {
  name: 'Ali',
  budget: 45,
  startPage: 314,
  solid: [].concat(
    Array.from({ length: 23 }, (_, i) => 582 + i),   // Juz 30
    Array.from({ length: 12 }, (_, i) => 293 + i),   // Al-Kahf
    [562]                                            // Al-Mulk
  ),
  shaky: [].concat(
    Array.from({ length: 7 }, (_, i) => 305 + i),    // Maryam
    [312, 313],                                      // Taha 1–2
    Array.from({ length: 14 }, (_, i) => 235 + i)    // Yusuf
  )
};

const RECITERS = [
  { id: 'Husary_128kbps', name: 'Mahmoud Khalil Al-Husary — murattal' },
  { id: 'Minshawy_Murattal_128kbps', name: 'Muhammad Siddiq Al-Minshawi' },
  { id: 'Abdul_Basit_Murattal_192kbps', name: 'Abdul Basit Abdus-Samad' },
  { id: 'Alafasy_128kbps', name: 'Mishary Alafasy' },
  { id: 'MaherAlMuaiqly128kbps', name: 'Maher Al-Muaiqly' },
  { id: 'Abdurrahmaan_As-Sudais_192kbps', name: 'Abdurrahman As-Sudais' },
  { id: 'Abu_Bakr_Ash-Shaatree_128kbps', name: 'Abu Bakr Ash-Shaatree' },
  { id: 'Hudhaify_128kbps', name: 'Ali Al-Hudhaify' }
];
const audioUrl = (r, s, a) => `https://everyayah.com/data/${r}/${String(s).padStart(3, '0')}${String(a).padStart(3, '0')}.mp3`;

/* ============================================================
   DATA LAYER
   One browser can hold any number of people. Each person is a whole
   record — profile, anchor, log, page strengths, streak — in their own
   place in storage, so switching or leaving never costs anyone progress.
     mishkat.v2/index   → { version, active, people: [{id, name, updatedAt}] }
     mishkat.v2/p:<id>  → that person's complete state
     mishkat.auto/<id>  → the last automatic snapshot (safety net)
   Old single-slot saves (mishkat.v1 / hifzAtlas.v1) are adopted on first run.
   ============================================================ */
const VAULT = 'mishkat.v2';
const V_INDEX = VAULT + '/index';
const V_PERSON = (id) => VAULT + '/p:' + id;
const V_AUTO = (id) => VAULT + '/auto:' + id;
const V_META = 'mishkat.meta';       // { lastAuto, lastExport } — deliberately outside a person

const uid = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
function readJSON(key, fallback) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
  catch (e) { return fallback; }
}
function writeJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch (e) {
    // quota, or a locked-down browser: fall back to the old single slot so nothing is lost
    try { localStorage.setItem(STORE, JSON.stringify(value)); } catch (e2) { }
    return false;
  }
}
function vaultIndex() {
  let idx = readJSON(V_INDEX, null);
  if (!idx || !Array.isArray(idx.people)) {
    idx = { version: 2, active: null, people: [] };
    writeJSON(V_INDEX, idx);
  }
  return idx;
}
const vaultSaveIndex = (idx) => writeJSON(V_INDEX, idx);
const meta = () => readJSON(V_META, { lastAuto: null, lastExport: null });
const saveMeta = (m) => writeJSON(V_META, m);

/* every person in this browser, most recently used first */
function peopleList() {
  const idx = vaultIndex();
  return idx.people
    .map((p) => ({ id: p.id, name: p.name, updatedAt: p.updatedAt, active: p.id === idx.active }))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}
function activePersonId() { return vaultIndex().active; }

function setPeopleMeta(id, patch) {
  const idx = vaultIndex();
  const found = idx.people.find((p) => p.id === id);
  if (found) Object.assign(found, patch);
  else idx.people.push(Object.assign({ id }, patch));
  vaultSaveIndex(idx);
}

/* load a person's record into S (or null if there is none) */
function loadPerson(id) {
  if (!id) return null;
  const st = readJSON(V_PERSON(id), null);
  return st ? Object.assign(defaultState(), st) : null;
}

/* write S into the active person's slot, and stamp the index */
function savePerson() {
  const id = S.personId || activePersonId();
  if (!id) return false;
  S.personId = id;
  const ok = writeJSON(V_PERSON(id), S);
  setPeopleMeta(id, {
    name: (S.profile && S.profile.name) || '—',
    updatedAt: Date.now()
  });
  const idx = vaultIndex();
  if (idx.active !== id) { idx.active = id; vaultSaveIndex(idx); }
  wroteThisSession = true;
  return ok;
}

/* an automatic snapshot at most once a day — a real safety net, not a to-do */
let wroteThisSession = false;
function autoSnapshot(force) {
  const id = S.personId || activePersonId();
  if (!id || !S.profile) return;
  const m = meta();
  const today = todayISO();
  if (!force && m.lastAuto === today) return;
  writeJSON(V_AUTO(id), { app: 'mishkat', version: 2, auto: true, at: new Date().toISOString(), state: S });
  saveMeta(Object.assign(m, { lastAuto: today }));
  S.lastBackup = today;
  savePerson();
}
const autoSnapshotOf = (id) => readJSON(V_AUTO(id), null);

/* switch to another person in this browser */
function switchPerson(id) {
  const st = loadPerson(id);
  if (!st) return false;
  const idx = vaultIndex();
  idx.active = id; vaultSaveIndex(idx);
  S = st; S.personId = id; PLAN = null;
  shell(); applyTheme(); render();
  autoSnapshot();
  return true;
}

/* create a fresh person and make them active */
function createPerson(name) {
  const id = uid();
  const idx = vaultIndex();
  idx.people.push({ id, name: name || '—', updatedAt: Date.now() });
  idx.active = id;
  vaultSaveIndex(idx);
  S = defaultState();
  S.personId = id;
  S.profile = null;
  PLAN = null;
  savePerson();
  return id;
}

/* remove one person, keeping everyone else untouched */
function deletePerson(id) {
  const idx = vaultIndex();
  idx.people = idx.people.filter((p) => p.id !== id);
  try { localStorage.removeItem(V_PERSON(id)); localStorage.removeItem(V_AUTO(id)); } catch (e) { }
  const nextId = idx.people[0] ? idx.people[0].id : null;
  idx.active = nextId;
  vaultSaveIndex(idx);
  return nextId;
}

/* one-time adoption of the old single-slot save */
function adoptLegacy() {
  const raw = localStorage.getItem(STORE) || localStorage.getItem(OLD_STORE);
  if (!raw) return false;
  let st;
  try { st = JSON.parse(raw); } catch (e) { return false; }
  if (!st) return false;
  const id = uid();
  const idx = vaultIndex();
  idx.people.push({ id, name: (st.profile && st.profile.name) || '—', updatedAt: Date.now() });
  idx.active = id;
  vaultSaveIndex(idx);
  st.personId = id;
  writeJSON(V_PERSON(id), st);
  try { localStorage.removeItem(STORE); localStorage.removeItem(OLD_STORE); } catch (e) { }
  return true;
}

/* ---------------- state ---------------- */
const defaultState = () => ({
  theme: localStorage.getItem('mishkat.theme') || 'nature',
  scene: localStorage.getItem('mishkat.scene') || 'ridge',
  autoplay: localStorage.getItem('mishkat.autoplay') !== '0',
  reciter: localStorage.getItem('mishkat.reciter') || 'Husary_128kbps',
  lang: localStorage.getItem('mishkat.lang') || 'en',
  showEn: false,
  page: null,
  profile: null,       // { name, budget, solid: [], shaky: [], startPage, start }
  days: {},
  pages: {},
  streak: { count: 0, best: 0, last: null },
  lastBackup: null,
  skips: {},          // date -> true: the person chose to carry that day, not pause it
  promptAt: null,     // last time the catch-up card was answered
  onboardStep: 0
});

let S = (function loadState() {
  adoptLegacy();
  const id = activePersonId();
  const st = loadPerson(id);
  if (st) { st.personId = id; return st; }
  return defaultState();
})();
const save = () => { const r = savePerson(); if (typeof cloudTouch === 'function') cloudTouch(); return r; };

let QURAN = null, PLAN = null, JUZMAP = null, SURAHMAP = null;
let view = 'today';
let draft = null;   // onboarding scratch

const T = (k, v) => (typeof I18N !== 'undefined' ? I18N_T(S.lang, k, v) : k);
const I18N_T = (lang, key, vars) => {
  const dict = I18N[lang] || I18N.en;
  let s = dict[key] !== undefined ? dict[key] : (I18N.en[key] !== undefined ? I18N.en[key] : key);
  if (vars) for (const k in vars) s = s.replace(new RegExp('\\{' + k + '\\}', 'g'), vars[k]);
  return s;
};

/* ---------------- helpers ---------------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const iso = (d) => { const x = new Date(d); x.setHours(12, 0, 0, 0); return x.toISOString().slice(0, 10); };
const todayISO = () => iso(new Date());
const parseISO = (s) => new Date(s + 'T12:00:00');
const fmt = (s, o = { month: 'long', day: 'numeric', year: 'numeric' }) => parseISO(s).toLocaleDateString(S.lang === 'ar' ? 'ar' : 'en-GB', o);
const fmtShort = (s) => parseISO(s).toLocaleDateString(S.lang === 'ar' ? 'ar' : 'en-GB', { day: 'numeric', month: 'short' });
const dayName = (s) => parseISO(s).toLocaleDateString(S.lang === 'ar' ? 'ar' : 'en-GB', { weekday: 'long' });
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function toast(msg, ms = 2800) {
  let t = $('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = msg; t.classList.add('on');
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('on'), ms);
}

/* ---------------- owner access ---------------- */
const isOwner = () => !!localStorage.getItem(OWNER_KEY) && localStorage.getItem(OWNER_KEY) === S.personId;

const OWNER_LAST = 'mishkat.owner.last';   // remembers the record after "leave owner mode"
function peekPerson(id) {
  try { return JSON.parse(localStorage.getItem('mishkat.v2/p:' + id) || 'null'); } catch (e) { return null; }
}
function findOwnerRecord() {
  // 1. the remembered id, 2. any record that looks like the owner's plan
  const last = localStorage.getItem(OWNER_LAST);
  if (last && peekPerson(last)) return last;
  const list = vaultIndex().people || [];
  for (const p of list) {
    const rec = peekPerson(p.id);
    const pr = rec && rec.profile;
    if (pr && pr.name === OWNER_PROFILE.name && pr.startPage === OWNER_PROFILE.startPage) return p.id;
  }
  return null;
}

function unlockOwner() {
  // the owner is their own record in this browser — unlocking never overwrites
  // whoever else was using the device, and never makes a second copy of it
  const known = localStorage.getItem(OWNER_KEY) || findOwnerRecord();
  if (known && loadPerson(known)) {
    localStorage.setItem(OWNER_KEY, known);
    localStorage.setItem(OWNER_LAST, known);
    switchPerson(known);
    toast(S.lang === 'ar' ? 'خطة المالك محمّلة.' : 'Owner plan loaded.', 3200);
    return;
  }
  const id = createPerson(OWNER_PROFILE.name);
  localStorage.setItem(OWNER_KEY, id);
  localStorage.setItem(OWNER_LAST, id);
  S.profile = Object.assign({}, OWNER_PROFILE, { start: todayISO() });
  S.onboardStep = 0;
  buildPlan(); save();
  shell(); applyTheme();
  go('today');
  toast(S.lang === 'ar' ? 'خطة المالك محمّلة.' : 'Owner plan loaded.', 3200);
}
function lockOwner() {
  // leave owner mode: the owner record STAYS on the device (hidden behind the
  // code), because deleting it is how a plan gets lost by accident
  const ownerId = localStorage.getItem(OWNER_KEY);
  localStorage.removeItem(OWNER_KEY);
  // hand the device to somebody else — never leave the owner record open
  const others = (vaultIndex().people || []).filter((p) => p.id !== ownerId);
  const active = activePersonId();
  const pick = others.find((p) => p.id === active) || others.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
  if (pick && loadPerson(pick.id)) { switchPerson(pick.id); return; }
  S = defaultState(); PLAN = null;
  createPerson(''); save();
  startOnboarding();
}

function ownerModal(wrong) {
  let m = $('#ownerModal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'ownerModal'; m.className = 'modal on';
    document.body.appendChild(m);
  }
  m.className = 'modal on';
  m.innerHTML = `<div class="card modal-card" style="max-width:420px">
    <div class="card-h"><h3>${S.lang === 'ar' ? 'دخول المالك' : 'Owner access'}</h3><div class="right">✦</div></div>
    <p class="note">${S.lang === 'ar' ? 'أدخل رمز المالك لتحميل خطتك الخاصة.' : 'Enter the owner code to load your own plan.'}</p>
    <input type="password" id="ownerCode" class="ob-input" style="max-width:none;margin-top:12px;font-size:16px" placeholder="${S.lang === 'ar' ? 'الرمز' : 'code'}" ${wrong ? 'aria-invalid="true"' : ''}>
    ${wrong ? `<p class="note" style="color:#ffcf8a;margin-top:8px">${S.lang === 'ar' ? 'الرمز غير صحيح.' : 'That code is not right.'}</p>` : ''}
    <div class="row" style="margin-top:16px;justify-content:flex-end">
      <button class="btn ghost" data-owner-close>${S.lang === 'ar' ? 'إلغاء' : 'Cancel'}</button>
      <button class="btn pri" data-owner-go>${S.lang === 'ar' ? 'دخول' : 'Unlock'}</button>
    </div>
  </div>`;
  const input = $('#ownerCode');
  if (input) input.focus();
}

function ownerCard() {
  if (!isOwner()) return '';
  return `<div class="card owner-card" style="margin-bottom:18px">
    <div class="card-h"><h3>${esc(T('owner_badge'))}</h3><div class="right"><span class="badge ok">✦</span></div></div>
    <p class="note">${esc(T('owner_note'))}</p>
    <div class="row" style="margin-top:10px"><button class="btn sm ghost" data-owner-lock>${esc(T('owner_switch'))}</button></div>
    <p class="note" style="margin-top:8px">${esc(T('owner_back'))}</p>
  </div>`;
}

/* ---------------- plan ---------------- */
/* The profile keeps two things apart:
     profile  — what the person declared at onboarding (never rewritten)
     anchor   — the inputs the calendar is currently built from (start date, budget,
                pages carried, pages to solder). Missing days move the start; asking
                to "keep my date" raises the budget. */
function anchorOf() {
  const p = S.profile || {};
  if (!p.anchor) {
    p.anchor = {
      start: p.start || todayISO(),
      budget: p.budget || 45,
      startPage: p.startPage || 1,
      solid: (p.solid || []).slice(),
      shaky: (p.shaky || []).slice()
    };
  }
  return p.anchor;
}
const uniqSorted = (a) => [...new Set(a)].sort((x, y) => x - y);

function buildPlan() {
  const p = S.profile || { budget: 45, solid: [], shaky: [], startPage: 1 };
  const a = anchorOf();
  PLAN = MishkatPlan.build({
    budget: a.budget, startPage: a.startPage,
    solid: a.solid, shaky: a.shaky,
    scope: p.scope || { mode: 'all' },
    start: a.start
  });
  return PLAN;
}
/* a day counts as studied if anything at all was logged on it */
function studied(dateStr) {
  const d = S.days[dateStr];
  if (!d) return false;
  return !!((d.sabaq && d.sabaq.length) || (d.manzil && d.manzil.length) || d.sabqi || d.minutes || d.rating || d.finished);
}
const addISO = (dateStr, n) => iso(new Date(parseISO(dateStr).getTime() + n * 864e5));

/* every calendar day between the original start and yesterday that carries nothing.
   Counting from the original start (not the shifted one) keeps this idempotent —
   it can be recomputed on every load without the schedule creeping forward. */
function pausedDays() {
  const p = S.profile;
  if (!p) return 0;
  const orig = p.origStart || p.start;
  if (!orig) return 0;
  const t = todayISO();
  const a = anchorOf();
  // days already shifted past stay shifted; only days *ahead of the anchor* count,
  // so this stays idempotent — recomputing it on every load never creeps
  const from = a.start > orig ? a.start : orig;
  let n = 0;
  for (let d = from; d < t; d = addISO(d, 1)) if (!studied(d)) n++;
  return n;
}
function missedList() {
  const p = S.profile;
  if (!p) return [];
  const orig = p.origStart || p.start;
  const t = todayISO();
  const out = [];
  for (let d = orig; d < t; d = addISO(d, 1)) if (!studied(d)) out.push(d);
  return out;
}

/* move the calendar so today is the next thing you actually have to do */
function pauseForMissed() {
  const p = S.profile;
  if (!p) return false;
  if (!p.origStart) p.origStart = p.start || todayISO();
  const a = anchorOf();
  // converge in one pass: each shift uncovers the next unlogged day ahead of it
  let moved = false;
  for (let guard = 0; guard < 12; guard++) {
    const shift = pausedDays();               // days ahead of the anchor that carry nothing
    if (!shift) break;
    const next = addISO(a.start, shift);
    a.start = next > todayISO() ? todayISO() : next;
    moved = true;
  }
  if (!moved) return false;
  buildPlan(); save();
  return true;
}

/* rebuild the queue from where the person actually is: everything they have already
   recited counts as carried, everything they graded weak becomes soldering work */
function rebalance() {
  const p = S.profile;
  const a = anchorOf();
  const banked = Object.keys(S.pages).filter((k) => (S.pages[k].strength || 0) >= 1).map(Number);
  const weak = Object.keys(S.pages).filter((k) => (S.pages[k].strength || 0) < 1).map(Number);
  const solid = uniqSorted([...(p.solid || []), ...banked]);
  const shaky = uniqSorted([...(p.shaky || []), ...weak].filter((x) => !solid.includes(x)));
  a.solid = solid; a.shaky = shaky;
  a.start = todayISO();
  if (!p.origStart) p.origStart = a.start;
  p.origStart = todayISO();          // a rebalance is a fresh anchor: no backlog to pause
  buildPlan(); save();
}

/* the smallest honest budget that still lands on or before a target date */
function budgetFor(targetDate) {
  const a = anchorOf();
  const from = a.start;                       // you start again from today, not from the lost days
  let best = null;
  for (let b = 15; b <= 180; b += 5) {
    const probe = MishkatPlan.build({
      budget: b, startPage: a.startPage, solid: a.solid, shaky: a.shaky,
      scope: (S.profile && S.profile.scope) || { mode: 'all' }, start: from
    });
    if (probe.khatmDate <= targetDate) { best = b; break; }
  }
  return best;
}

function dayIndex(dateStr) {
  if (!PLAN) return 0;
  const list = PLAN.days;
  if (dateStr <= list[0].date) return 0;
  if (dateStr >= list[list.length - 1].date) return list.length - 1;
  let lo = 0, hi = list.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].date === dateStr) return mid;
    if (list[mid].date < dateStr) lo = mid + 1; else hi = mid - 1;
  }
  return Math.max(0, Math.min(list.length - 1, lo));
}
const dayEntry = (dateStr) => PLAN.days[dayIndex(dateStr)];

function dayStatus(dateStr) {
  const rec = S.days[dateStr] || {};
  const e = dayEntry(dateStr);
  const needNew = (e.new && e.new.length) ? e.new : (e.solidify || []);
  const done = (rec.sabaq || []).length >= needNew.length && rec.sabqi && (rec.manzil || []).length >= Math.min(1, (e.manzil || []).length);
  const any = (rec.sabaq || []).length || rec.sabqi || (rec.manzil || []).length;
  return done ? 'done' : any ? 'part' : '';
}

/* ---------------- quran access ---------------- */
const pageData = (p) => (QURAN ? QURAN.pages[p - 1] : null);
function pageTitle(p) {
  const pd = pageData(p);
  if (!pd) return T('page') + ' ' + p;
  return pd.s.map((s) => (S.lang === 'ar' ? s.arPlain || s.ar : s.en)).filter((v, i, a) => a.indexOf(v) === i).join(' · ');
}
function pageAyahs(p) {
  const pd = pageData(p);
  if (!pd) return [];
  const out = [];
  pd.s.forEach((s) => s.a.forEach((a) => out.push({ surah: s.n, surahEn: s.en, surahAr: s.ar, n: a[0], ar: a[1], en: a[2] })));
  return out;
}
function buildMaps() {
  JUZMAP = {}; SURAHMAP = {};
  QURAN.pages.forEach((pg) => {
    (JUZMAP[pg.j] = JUZMAP[pg.j] || []).push(pg.p);
    pg.s.forEach((s) => {
      const m = (SURAHMAP[s.n] = SURAHMAP[s.n] || { n: s.n, en: s.en, ar: s.arPlain || s.ar, pages: [] });
      if (m.pages.indexOf(pg.p) === -1) m.pages.push(pg.p);
    });
  });
  Object.values(JUZMAP).forEach((a) => a.sort((x, y) => x - y));
  Object.values(SURAHMAP).forEach((m) => m.pages.sort((x, y) => x - y));
}

/* ---------------- sync code (carry progress between devices) ---------------- */
async function makeSyncCode() {
  const json = JSON.stringify({ app: 'mishkat', v: 1, state: S });
  let payload;
  try {
    const cs = new CompressionStream('gzip');
    const buf = await new Response(new Blob([json]).stream().pipeThrough(cs)).arrayBuffer();
    payload = 'g1' + btoa(String.fromCharCode(...new Uint8Array(buf)));
  } catch (e) {
    payload = 'j1' + btoa(unescape(encodeURIComponent(json)));
  }
  return payload.replace(/=+$/, '');
}
async function readSyncCode(code) {
  const c = code.trim().replace(/\s+/g, '');
  if (c.startsWith('g1')) {
    const bin = Uint8Array.from(atob(c.slice(2)), (ch) => ch.charCodeAt(0));
    const ds = new DecompressionStream('gzip');
    const text = await new Response(new Blob([bin]).stream().pipeThrough(ds)).text();
    return JSON.parse(text);
  }
  if (c.startsWith('j1')) return JSON.parse(decodeURIComponent(escape(atob(c.slice(2)))));
  throw new Error('unknown code');
}
function daysSince(isoDate) {
  if (!isoDate) return null;
  return Math.round((parseISO(todayISO()) - parseISO(isoDate)) / 864e5);
}

/* ---------------- stats ---------------- */
function stats() {
  const keys = Object.keys(S.days);
  const banked = Object.values(S.pages).filter((p) => (p.strength || 0) >= 1).length +
    (S.profile ? (S.profile.solid || []).filter((p) => !S.pages[p]).length : 0);
  const learnedNew = Object.values(S.pages).filter((v) => v.src === 'new').length;
  const totalMinutes = keys.reduce((a, k) => a + (S.days[k].minutes || 0), 0);
  const daysDone = keys.filter((k) => dayStatus(k) === 'done').length;
  return {
    banked, learnedNew, totalMinutes, daysDone,
    pctBanked: Math.round((banked / TOTAL_PAGES) * 1000) / 10,
    pctPlan: Math.round((daysDone / PLAN.totalDays) * 1000) / 10,
    streak: S.streak.count, best: S.streak.best
  };
}
function touchStreak(done) {
  if (!done) return;
  const t = todayISO();
  if (S.streak.last === t) return;
  const y = iso(new Date(parseISO(t).getTime() - 864e5));
  S.streak.count = S.streak.last === y ? S.streak.count + 1 : 1;
  S.streak.best = Math.max(S.streak.best, S.streak.count);
  S.streak.last = t;
}
function session(dateStr) {
  if (!S.days[dateStr]) S.days[dateStr] = { sabaq: [], sabqi: 0, manzil: [], rating: 0, minutes: 0, note: '', finished: false };
  const s = S.days[dateStr];
  s.sabaq ||= []; s.manzil ||= [];
  return s;
}

/* ---------------- theme / scenes ---------------- */
function applyTheme() {
  document.body.className = 'w-' + S.theme;
  document.body.dataset.scene = S.scene;
  document.documentElement.lang = S.lang;
  document.documentElement.dir = I18N[S.lang].dir;
  document.body.classList.toggle('show-en', S.showEn);
  startSceneCycle();
}
let sceneTimer = null;
function startSceneCycle() {
  clearInterval(sceneTimer); sceneTimer = null;
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (S.autoplay === false || reduce || S.theme !== 'nature') return;
  sceneTimer = setInterval(() => {
    if (document.hidden) return;
    const i = SCENES.indexOf(S.scene);
    S.scene = SCENES[(i + 1) % SCENES.length];
    document.body.dataset.scene = S.scene;
    paintNav(); save();
  }, CYCLE_MS);
}

/* ============================================================
   ONBOARDING
   ============================================================ */
function startOnboarding() {
  if (!activePersonId()) { createPerson(); }
  const p = S.profile || {};
  draft = {
    step: S.onboardStep || 0,
    name: p.name || '',
    lang: S.lang,
    known: new Set(p.solid || []),
    startTouched: !!p.startPage,
    shaky: new Set(p.shaky || []),
    startPage: p.startPage || 1,
    budget: p.budget || 45,
    mode: (p.scope && p.scope.mode) || 'all',
    picks: modeSet((p.scope && p.scope.pages) || []),
    expanded: new Set()
  };
  view = 'onboard';
  render();
}

/* the draft says WHAT the person is aiming at, which pages they carry, and how long
   they can give each day — this turns that into the profile the engine expects */
const MODE_NAMES = { all: 'goal_all', juz: 'goal_juz', surah: 'goal_surah', pages: 'goal_pages' };
function modeSet(pages) { return new Set(pages || []); }

/* the goal is stored as a plain page list; the mode is only a label for the UI */
function scopePages(picks) {
  const all = [...picks];
  return all.length === 604 ? null : all.sort((a, b) => a - b);
}
function draftScope() {
  const pages = scopePages(draft.picks);
  if (!pages) return { mode: 'all' };
  return { mode: scopeModeOf(pages), pages };
}
function draftJourney() {
  return MishkatPlan.build({
    budget: draft.budget,
    startPage: +draft.startPage || 1,
    solid: [...draft.known],
    shaky: [...draft.shaky],
    scope: draftScope(),
    start: todayISO()
  });
}
/* The goal described as parts: whole juz, whole surahs, and runs of pages inside
   one juz ("Juz 29 · 562–569, 571–581"). This keeps "Juz 30 minus one page" from
   turning into thirty surah names. */
function scopeRuns(pages) {
  if (!pages || !pages.length) return [];
  const sorted = [...pages].sort((a, b) => a - b);
  const runs = [];
  let cur = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === sorted[i - 1] + 1) cur.push(sorted[i]);
    else { runs.push(cur); cur = [sorted[i]]; }
  }
  runs.push(cur);
  const parts = runs.map((run) => {
    const a = run[0], b = run[run.length - 1], inRun = new Set(run);
    const wholeJuz = Object.keys(JUZMAP || {}).map(Number).find((j) => {
      const jp = JUZMAP[j]; return jp.length === run.length && jp.every((p) => inRun.has(p));
    });
    if (wholeJuz) return { pages: run, kind: 'juz', juz: wholeJuz };
    const wholeSurah = Object.keys(SURAHMAP || {}).map(Number).find((n) => {
      const sp = SURAHMAP[n].pages; return sp.length === run.length && sp.every((p) => inRun.has(p));
    });
    if (wholeSurah) return { pages: run, kind: 'surah', surah: wholeSurah };
    if (a === b) return { pages: run, kind: 'single', a };
    const juzOf = Object.keys(JUZMAP || {}).map(Number).find((j) => (JUZMAP[j] || []).indexOf(a) >= 0 && (JUZMAP[j] || []).indexOf(b) >= 0);
    return juzOf ? { pages: run, kind: 'juzrange', juz: juzOf, a, b } : { pages: run, kind: 'range', a, b };
  });
  /* page runs that sit inside the same juz become one part */
  const byJuz = {};
  const out = [];
  parts.forEach((pt) => {
    if (pt.kind !== 'juzrange') { out.push(pt); return; }
    const key = 'j' + pt.juz;
    if (!byJuz[key]) { byJuz[key] = { kind: 'juzranges', juz: pt.juz, spans: [], pages: [] }; }
    byJuz[key].spans.push([pt.a, pt.b]);
    byJuz[key].pages.push(...pt.pages);
  });
  const merged = Object.values(byJuz);
  merged.forEach((m) => { m.spans.sort((x, y) => x[0] - y[0]); m.pages.sort((x, y) => x - y); });
  /* keep page order: juz runs are inserted where their first page belongs */
  return out.concat(merged).sort((x, y) => Math.min(...x.pages) - Math.min(...y.pages));
}
function runLabel(part) {
  switch (part.kind) {
    case 'juz': return `${T('juz')} ${part.juz}`;
    case 'surah': return surahName(part.surah);
    case 'single': return `${T('page_abbr')}${part.a}`;
    case 'range': return `${T('pages_word')} ${part.a}–${part.b}`;
    case 'juzranges':
      return `${T('juz')} ${part.juz} · ${part.spans.map(([a, b]) => a === b ? a : `${a}–${b}`).join(', ')}`;
    default: return '';
  }
}
function surahName(n) {
  const m = SURAHMAP && SURAHMAP[n];
  if (!m) return '—';
  return S.lang === 'ar' ? (m.arPlain || m.ar) : m.en;
}
/* "Juz 29 · Al-Mulk · p.100" — the honest one-line label for any goal */
function scopeLabelOf(pages, brief) {
  if (!pages || !pages.length) return T('goal_all');
  const names = scopeRuns(pages).map(runLabel);
  const shown = names.length <= 3 ? names : names.length <= 6 ? names.slice(0, 4).concat(`+${names.length - 4}`) : names.slice(0, 3).concat(`+${names.length - 3}`);
  const total = `${pages.length} ${pages.length === 1 ? T('page_one') : T('pages_word')}`;
  return brief ? shown.join(' · ') : `${shown.join(' · ')} — ${total}`;
}
function scopeModeOf(pages) {
  if (!pages || !pages.length) return 'all';
  const set = new Set(pages);
  const juzs = Object.keys(JUZMAP || {}).map(Number).filter((j) => (JUZMAP[j] || []).every((p) => set.has(p)));
  if (juzs.length && juzs.reduce((n, j) => n + JUZMAP[j].length, 0) === pages.length) return 'juz';
  const surahs = Object.keys(SURAHMAP || {}).map(Number).filter((n) => SURAHMAP[n].pages.every((p) => set.has(p)));
  if (surahs.length && surahs.reduce((n, x) => n + SURAHMAP[x].pages.length, 0) === pages.length) return 'surah';
  return 'pages';
}
function pagesFromJuz(list) {
  const out = new Set();
  list.forEach((j) => (JUZMAP[j] || []).forEach((p) => out.add(p)));
  return out;
}
function pagesFromSurah(list) {
  const out = new Set();
  list.forEach((n) => { const m = SURAHMAP[n]; if (m) m.pages.forEach((p) => out.add(p)); });
  return out;
}
/* which surahs / juz are wholly inside the current picks — used to light up the buttons */
function coveredBy(pages, kind) {
  const set = new Set(pages);
  const src = kind === 'juz' ? JUZMAP : SURAHMAP;
  return Object.keys(src).map(Number).filter((k) => {
    const list = kind === 'juz' ? src[k] : src[k].pages;
    return list.length && list.every((p) => set.has(p));
  });
}

function goalStep() {
  const modes = [
    { k: 'all', q: 'goal_q_all', s: 'goal_s_all', ic: '◎' },
    { k: 'juz', q: 'goal_q_juz', s: 'goal_s_juz', ic: '❖' },
    { k: 'surah', q: 'goal_q_surah', s: 'goal_s_surah', ic: '◈' },
    { k: 'mixed', q: 'goal_q_mixed', s: 'goal_s_mixed', ic: '⁂' }
  ];
  const picks = [...draft.picks].sort((a, b) => a - b);
  const runs = scopeRuns(picks);
  const everySurah = Object.values(SURAHMAP || {}).sort((a, b) => a.n - b.n);
  const litMode = !picks.length ? 'all'
    : runs.every((r) => r.kind === 'juz') ? 'juz'
      : runs.every((r) => r.kind === 'surah') ? 'surah' : 'mixed';

  let html = `<h2 class="ob-h">${esc(T('goal_h'))}</h2><p class="note">${esc(T('goal_hint2'))}</p>
    <div class="goal-grid">`;
  modes.forEach((m) => {
    html += `<button class="goal ${litMode === m.k ? 'on' : ''}" data-ob-mode="${m.k}">
      <span class="goal-ic">${m.ic}</span>
      <b>${esc(T(m.q))}</b>
      <span class="goal-sub">${esc(T(m.s))}</span>
    </button>`;
  });
  html += `</div>`;

  /* what is chosen so far — kinds listed apart, each removable */
  if (picks.length) {
    html += `<div class="goal-chosen">
      <div class="sub-head"><b>${esc(T('goal_chosen'))}</b><span class="note">${esc(T('picked_total', { n: picks.length }))}</span></div>`;
    const chip = (label, pages) => `<span class="gchip">${esc(label)}
        <button class="gchip-x" data-ob-exclude="${pages.join(',')}" title="${esc(T('goal_exclude_hint'))}">✕</button></span>`;
    runs.forEach((r) => { html += chip(runLabel(r), r.pages); });
    html += `</div>`;
  }

  /* juz: every juz, each opening its own pages so pages can be dropped */
  html += `<div class="pick-block">
    <div class="sub-head"><b>${esc(T('pick_juz'))}</b>
      <span class="row" style="gap:8px;align-items:center">
        <span class="note">${esc(T('pick_juz_hint'))}</span>
        <button class="mini wide" data-ob-open="j">${esc(T('all_pages'))}</button>
      </span></div>
    <div class="sub-grid">`;
  Object.keys(JUZMAP || {}).map(Number).sort((a, b) => a - b).forEach((j) => {
    const pages = JUZMAP[j];
    const on = pages.filter((p) => draft.picks.has(p)).length;
    const full = on === pages.length;
    const open = draft.expanded.has('j' + j);
    html += `<div class="jcell ${full ? 'full' : on ? 'part' : ''}">
      <button class="sub ${full ? 'on' : ''}" data-ob-pick="${j}" data-ob-kind="juz">
        <b>${esc(T('juz'))} ${j}</b><span>${pages[0]}–${pages[pages.length - 1]}${on && !full ? ` · ${on}/${pages.length}` : ''}</span>
      </button>
      <button class="mini x" data-ob-open="j${j}" title="${esc(T('pick_pages_hint'))}">${open ? '▾' : '▸'}</button>
    </div>`;
    if (open) {
      html += `<div class="jpages">${pages.map((p) => `<button class="pg ${draft.picks.has(p) ? 'on' : ''}" data-ob-page="${p}" title="p.${p} ${esc(pageTitle(p))}">${p}</button>`).join('')}</div>`;
    }
  });
  html += `</div></div>`;

  /* surahs: all 114, ordered, searchable in the eye by name */
  html += `<div class="pick-block">
    <div class="sub-head"><b>${esc(T('pick_surah'))}</b>
      <span class="row" style="gap:8px;align-items:center">
        <span class="note">${esc(T('pick_surah_hint', { n: everySurah.length }))}</span>
        <button class="mini wide" data-ob-open="s">${esc(T('all_pages'))}</button>
      </span></div>
    <div class="sub-grid cols">`;
  everySurah.forEach((m) => {
    const on = m.pages.filter((p) => draft.picks.has(p)).length;
    const full = on === m.pages.length;
    const open = draft.expanded.has('s' + m.n);
    html += `<div class="jcell ${full ? 'full' : on ? 'part' : ''}">
      <button class="sub ${full ? 'on' : ''}" data-ob-pick="${m.n}" data-ob-kind="surah" title="${esc(T('page_abbr') + m.pages[0] + ' · ' + (pageTitle(m.pages[0]) || ''))}">
        <b>${m.n}. ${esc(surahName(m.n))}</b><span>${m.pages.length} ${m.pages.length === 1 ? T('page_one') : T('pages_word')}${m.pages.length === 1 ? ` · ${T('page_abbr')}${m.pages[0]}` : ''}${on && !full ? ` · ${on}/${m.pages.length}` : ''}</span>
      </button>
      <button class="mini x" data-ob-open="s${m.n}" title="${esc(T('pick_pages_hint'))}">${open ? '▾' : '▸'}</button>
    </div>`;
    if (open) {
      html += `<div class="jpages">${m.pages.map((p) => `<button class="pg ${draft.picks.has(p) ? 'on' : ''}" data-ob-page="${p}" title="p.${p} ${esc(pageTitle(p))}">${p}</button>`).join('')}</div>`;
    }
  });
  html += `</div></div>`;

  /* any page at all */
  html += `<div class="pick-block">
    <div class="sub-head"><b>${esc(T('pick_pages'))}</b><span class="note">${esc(T('pick_pages_hint'))}</span></div>
    <div class="jpages bare">${Array.from({ length: 604 }, (_, i) => i + 1).map((p) => `<button class="pg ${draft.picks.has(p) ? 'on' : ''}" data-ob-page="${p}" title="p.${p} ${esc(pageTitle(p))}">${p}</button>`).join('')}</div>
  </div>`;

  html += `<div class="row" style="margin-top:14px;justify-content:space-between;flex-wrap:wrap;gap:8px">
      <span class="note">${esc(T('selected', { n: picks.length }))}</span>
      <span class="row">
        <button class="btn sm ghost" data-ob-pickclear>${esc(T('clear'))}</button>
        <button class="btn sm ghost" data-ob-all>${esc(T('select_all'))}</button>
      </span>
    </div>`;
  return html;
}

function onboardView() {
  const st = draft.step;
  const total = 5;
  const dots = Array.from({ length: total }, (_, i) => `<span class="ob-dot ${i === st ? 'on' : ''} ${i < st ? 'done' : ''}"></span>`).join('');
  const head = `<div class="ob-head"><div class="eyebrow"><span class="dot"></span>${esc(T('onboard_welcome'))}</div>
    <p class="lede" style="margin:0 0 6px">${esc(T('onboard_lede'))}</p>
    <div class="ob-dots">${dots}</div></div>`;

  let body = '';
  if (st === 0) {
    body = `<h2 class="ob-h">${esc(T('your_name'))}</h2>
      <input type="text" id="obName" value="${esc(draft.name)}" placeholder="${esc(T('name_ph'))}" class="ob-input" autocomplete="name" autocapitalize="words">
      <h2 class="ob-h" style="margin-top:26px">${esc(T('language'))}</h2>
      <div class="row">
        <button class="btn ${draft.lang === 'en' ? 'pri' : ''}" data-ob-lang="en">English</button>
        <button class="btn ${draft.lang === 'ar' ? 'pri' : ''}" data-ob-lang="ar">العربية</button>
      </div>`;
  } else if (st === 1) {
    body = goalStep();
  } else if (st === 2) {
    body = `<h2 class="ob-h">${esc(T('what_you_know'))}</h2>
      <p class="note">${esc(T('know_hint'))}</p>
      ${pickerHTML('known')}`;
  } else if (st === 3) {
    if (!draft.startTouched) {
      const known = [...draft.known].sort((a, b) => a - b);
      const scoped = draft.picks.size ? Math.min(...draft.picks) : 1;
      draft.startPage = !draft.picks.size ? (known.length ? Math.min(604, known[known.length - 1] + 1) : 1) : scoped;
    }
    body = `<h2 class="ob-h">${esc(T('daily_time'))}</h2>
      <p class="note">${esc(T('pace_hint'))}</p>
      <div class="row budget-row" style="margin:14px 0 26px">
        ${[20, 30, 45, 60, 90, 120].map((b) => `<button class="btn budget ${draft.budget === b ? 'pri' : ''}" data-ob-budget="${b}">${b}<small>${esc(T('min'))}</small></button>`).join('')}
      </div>
      <h2 class="ob-h">${esc(T('soldering'))}</h2>
      <p class="note">${esc(T('solder_hint'))}</p>
      ${(() => {
        const pool = draft.picks.size
          ? [...draft.known].filter((p) => draft.picks.has(p))
          : [...draft.known];
        pool.sort((a, b) => a - b);
        return pool.length
          ? `<div class="chips" style="margin-top:14px">${pool.map((p) => `<span class="chip ${draft.shaky.has(p) ? 'warn' : ''}" data-ob-shaky="${p}">p.${p}</span>`).join('')}</div>`
          : `<p class="note" style="margin-top:10px">${esc(T('nothing'))}</p>`;
      })()}
      <h2 class="ob-h" style="margin-top:26px">${esc(T('start_at'))}</h2>
      <p class="note">${esc(T('start_at_hint'))}</p>
      <div class="row" style="margin-top:12px">
        <input type="text" id="obStart" value="${draft.startPage}" class="ob-input" style="max-width:120px;text-align:center" inputmode="numeric">
        <span class="note">${esc(T('page'))} · ${esc(pageTitle(draft.startPage) || '')}</span>
      </div>`;
  } else {
    const probe = draftJourney();
    const weekly = Math.max(1, Math.round((draft.budget - 12) / 33 * 5.5));
    const scopeLabel = scopeLabelOf([...draft.picks]);
    body = `<h2 class="ob-h">${esc(T('summary'))}</h2>
      <div class="ob-summary">
        <div><span>${esc(T('summary_goal'))}</span><b class="sm">${esc(scopeLabel)}</b></div>
        <div><span>${esc(T('ar_fresh'))}</span><b>${probe.queueLength}</b></div>
        <div><span>${esc(T('summary_khatm'))}</span><b>${fmt(probe.khatmDate, { month: 'long', year: 'numeric' })}</b></div>
        <div><span>${esc(T('summary_weekly'))}</span><b>~${weekly}</b></div>
        <div><span>${esc(T('ar_solid'))}</span><b>${[...draft.known].length}</b></div>
        <div><span>${esc(T('ar_shaky'))}</span><b>${[...draft.shaky].length}</b></div>
      </div>
      <p class="note" style="margin-top:14px">${esc(T('summary_note'))}</p>
      ${probe.alreadyDone ? `<p class="note" style="color:var(--accent);margin-top:8px">${esc(T('summary_done'))}</p>` : ''}`;
  }

  const canNext = st !== 0 || draft.name.trim().length > 0;
  const blocked = false;   // an empty goal now simply means the whole mushaf
  return `<div class="ob-wrap"><div class="card ob-card">
    ${head}
    <div class="ob-body">${body}</div>
    <p class="note ob-restore">${T('ob_have_backup')} 
      <button class="linkish" data-go="people">${esc(T('ob_restore_link'))}</button></p>
    <div class="ob-foot">
      ${st > 0 ? `<button class="btn ghost" data-ob-back>${esc(T('back'))}</button>` : `<span></span>`}
      ${st < 4
      ? `<button class="btn pri" data-ob-next ${canNext && !blocked ? '' : 'disabled'}>${esc(T('next'))} →</button>`
      : `<button class="btn pri" data-ob-finish>${esc(T('start'))} →</button>`}
    </div>
  </div></div>`;
}

function pickerHTML(kind, bare) {
  const set = kind === 'known' ? draft.known : kind === 'picks' ? draft.picks : draft.shaky;
  const surahs = Object.values(SURAHMAP || {}).sort((a, b) => a.n - b.n);
  let html = bare ? `<div class="picker">` : `<div class="picker"><div class="picker-quick">`;
  if (!bare) {
    surahs.filter((s) => s.pages.length <= 24).slice(0, 14).forEach((s) => {
      const all = s.pages.every((p) => set.has(p));
      html += `<span class="chip ${all ? 'gold' : ''}" data-ob-surah="${s.n}">${esc(S.lang === 'ar' ? s.arPlain || s.ar : s.en)}</span>`;
    });
    html += `</div>`;
  }
  Object.keys(JUZMAP || {}).map(Number).sort((a, b) => a - b).forEach((j) => {
    const pages = JUZMAP[j];
    const all = pages.every((p) => set.has(p));
    html += `<div class="juz-row">
      <div class="juz-label"><b>${esc(T('juz'))} ${j}</b><span>${pages[0]}–${pages[pages.length - 1]}</span>
        <button class="mini" data-ob-juz="${j}">${all ? '−' : '+'}</button></div>
      <div class="juz-pages">
        ${pages.map((p) => `<button class="pg ${set.has(p) ? 'on' : ''}" data-ob-page="${p}" title="p.${p} ${esc(pageTitle(p))}">${p}</button>`).join('')}
      </div></div>`;
  });
  html += `</div>
    <div class="row" style="margin-top:14px;justify-content:space-between">
      <span class="note">${esc(T('selected', { n: set.size }))}</span>
      <span class="row">
        <button class="btn sm ghost" data-ob-clear>${esc(T('clear'))}</button>
        <button class="btn sm ghost" data-ob-all>${esc(T('select_all'))}</button>
      </span>
    </div>`;
  return html;
}

/* ============================================================
   SHELL
   ============================================================ */
function shell() {
  const name = S.profile && S.profile.name ? S.profile.name : '';
  document.body.innerHTML = `
  <div class="bg"><div class="layer l1"></div><div class="layer l2"></div><div class="layer l3"></div><div class="veil"></div><div class="tile"></div></div>
  <div class="topbar"><div class="topbar-in">
    <div class="brand">
      <div class="brand-mark"><img src="__LOGO__" alt="Mishkat"></div>
      <div class="brand-txt"><div class="brand-name">${esc(T('app'))}</div>
      <div class="brand-sub">${esc(T('tag'))}</div></div>
    </div>
    <nav class="nav" id="navBar">${navHTML()}</nav>
    <div class="themer">
      <button class="lang" data-lang-toggle title="Language">${S.lang === 'ar' ? 'EN' : 'ع'}</button>
      <span class="lbl">${esc(T('world'))}</span>
      <button class="sw n" data-theme="nature" title="Nature"></button>
      <button class="sw g" data-theme="geom" title="Geometry"></button>
      <button class="sw u" data-theme="nur" title="Nur"></button>
    </div>
    <div class="scenes" title="Scenes">
      <button class="sc" data-scene="ridge" title="Dawn ridges"></button>
      <button class="sc" data-scene="forest" title="Cedar light"></button>
      <button class="sc" data-scene="sea" title="Night sea"></button>
      <button class="sc-pause" data-autoplay title="Hold this scene">❚❚</button>
    </div>
  </div></div>
  <main class="wrap" id="app"></main>`;
  if (name) document.body.dataset.name = name;
}

function navHTML() {
  const has = S.profile && missedList().length;
  return `
      <button data-go="today">${esc(T('nav_today'))}</button>
      <button data-go="learn">${esc(T('nav_learn'))}</button>
      <button data-go="drill">${esc(T('nav_drill'))}</button>
      <button data-go="review">${esc(T('nav_review'))}</button>
      <button data-go="journey">${esc(T('nav_journey'))}</button>
      <button data-go="plan">${esc(T('nav_plan'))}</button>
      <button data-go="method">${esc(T('nav_method'))}</button>
      <button data-go="people">${esc(T('nav_people'))}</button>
      ${has ? `<button data-go="catchup" class="nav-catchup">⚑ ${esc(T('nav_catchup'))}</button>` : ''}`;
}

function paintNav() {
  const nb = $('#navBar');
  if (nb && S.profile) {
    const want = navHTML().replace(/\s+/g, ' ').trim();
    if (nb.innerHTML.replace(/\s+/g, ' ').trim() !== want) nb.innerHTML = navHTML();
  }
  $$('.nav button').forEach((b) => b.classList.toggle('on', b.dataset.go === view));
  $$('.sw').forEach((s) => s.classList.toggle('on', s.dataset.theme === S.theme));
  $$('.sc').forEach((s) => s.classList.toggle('on', s.dataset.scene === S.scene));
  const ap = $('.sc-pause');
  if (ap) ap.textContent = S.autoplay === false ? '▶' : '❚❚';
}

/* ============================================================
   TODAY
   ============================================================ */
function heroAyah() {
  const list = [
    { ar: 'وَلَقَدْ يَسَّرْنَا الْقُرْآنَ لِلذِّكْرِ فَهَلْ مِن مُّذَكِّرٍ', ref: 'Al-Qamar 54:17', ar_ref: 'القمر ٥٤:١٧', en: 'And We have certainly made the Qur’an easy for remembrance, so is there any who will remember?', tr_ar: 'يسّره الله للحفظ والتذكّر، فهل من متذكّر؟' },
    { ar: 'إِنَّا نَحْنُ نَزَّلْنَا الذِّكْرَ وَإِنَّا لَهُ لَحَافِظُونَ', ref: 'Al-Hijr 15:9', ar_ref: 'الحجر ١٥:٩', en: 'Indeed, it is We who sent down the Qur’an and indeed, We will be its guardian.', tr_ar: 'تكفّل الله بحفظ هذا الذكر، فهو محفوظٌ لا يضيع.' },
    { ar: 'كِتَابٌ أَنزَلْنَاهُ إِلَيْكَ مُبَارَكٌ لِّيَدَّبَّرُوا آيَاتِهِ', ref: 'Sad 38:29', ar_ref: 'ص ٣٨:٢٩', en: 'A blessed Book which We have revealed to you, that they might reflect upon its verses.', tr_ar: 'كتابٌ مبارك أُنزل ليتدبّر الناس آياته.' },
    { ar: 'وَرَتِّلِ الْقُرْآنَ تَرْتِيلًا', ref: 'Al-Muzzammil 73:4', ar_ref: 'المزمل ٧٣:٤', en: 'And recite the Qur’an with measured recitation.', tr_ar: 'اقرأه على تُؤدةٍ وتمهّل، لا على عجل.' },
    { ar: 'خَيْرُكُمْ مَنْ تَعَلَّمَ الْقُرْآنَ وَعَلَّمَهُ', ref: 'Sahih al-Bukhari 5027', ar_ref: 'صحيح البخاري ٥٠٢٧', en: 'The best of you are those who learn the Qur’an and teach it.', tr_ar: 'خير الناس من تعلّم القرآن وعلّمه غيره.' }
  ];
  const doy = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 864e5);
  return list[doy % list.length];
}

function typeLabel(e) {
  if (e.type === 'new') return S.lang === 'ar' ? 'سبقٌ جديد مع مراجعة' : 'New memorisation with revision';
  if (e.type === 'reset') return S.lang === 'ar' ? 'أسبوع التثبيت — الصفحات المتزلزلة' : 'Reset week — soldering the shaky pages';
  if (e.type === 'weekly') return S.lang === 'ar' ? 'تثبيت أسبوعي — بلا جديد' : 'Weekly consolidation — no new pages';
  if (e.type === 'khatm') return S.lang === 'ar' ? 'ختم القرآن — تلاوة كاملة' : 'Khatm — the whole Qur’an, in full';
  return S.lang === 'ar' ? 'يوم مراجعة — بلا جديد' : 'Revision day — no new pages';
}

function renderToday() {
  const t = todayISO();
  const e = dayEntry(t);
  const rec = S.days[t] || {};
  const ay = heroAyah();
  const st = stats();
  const hour = new Date().getHours();
  const greet = hour < 5 ? T('greet_night') : hour < 12 ? T('greet_morning') : hour < 17 ? T('greet_afternoon') : T('greet_evening');
  const name = S.profile.name ? '<bdi>' + esc(S.profile.name) + '</bdi> · ' : '';
  const set = (e.new && e.new.length ? e.new : e.solidify) || [];

  return `
  <section class="hero"><div class="hero-scrim"></div>
    <div class="hero-grid">
      <div>
        <div class="eyebrow"><span class="dot"></span>${name}${esc(greet)} · ${fmt(t, { weekday: 'long', day: 'numeric', month: 'long' })} · ${esc(T('day_of', { n: e.i + 1, total: PLAN.totalDays }))}</div>
        <h1 class="display">${esc(T('hero_title_1'))}<br><em>${esc(T('hero_title_2'))}</em></h1>
        <p class="lede">${T('hero_lede', { type: esc(typeLabel(e)) })}</p>
        ${scopeLine()}
        <div class="row">
          <button class="btn pri" data-go="learn">${esc(T('nav_learn'))} →</button>
          <button class="btn" data-go="review">${esc(T('nav_review'))}</button>
          <span class="badge ${e.ramadan ? 'warn' : ''}">${e.min.sabaq} / ${e.min.sabqi} / ${e.min.manzil} ${esc(T('min'))}</span>
        </div>
      </div>
      <div class="hero-ar">${ay.ar}<small>${esc(ay.ref)} — ${esc(ay.en)}</small></div>
    </div>
  </section>

  ${compactCatchup()}
  ${installWelcome()}
  ${backupNudge()}
  <div class="stats">
    <div class="stat"><div class="k">${esc(T('stat_streak'))}</div><div class="v">${st.streak}<small>${esc(T('days'))}</small></div><div class="d">${esc(T('best'))} ${st.best}</div></div>
    <div class="stat"><div class="k">${esc(T('stat_pages'))}</div><div class="v">${st.banked}<small>/ 604</small></div><div class="d">${st.pctBanked}% ${esc(T('of_mushaf'))}</div></div>
    <div class="stat"><div class="k">${esc(T('stat_minutes'))}</div><div class="v">${st.totalMinutes}<small>${esc(T('min'))}</small></div><div class="d">${st.daysDone} ${esc(T('sessions'))}</div></div>
    <div class="stat"><div class="k">${esc(T('stat_plan'))}</div><div class="v">${st.pctPlan}<small>%</small></div><div class="d">${esc(T('khatm_target', { date: fmt(PLAN.khatmDate, { month: 'short', year: 'numeric' }) }))}</div></div>
  </div>

  <div class="blocks">
    ${block('sabaq', '◈', T('sabaq'), 'السبق', T('sabaq_desc'), e.min.sabaq, set, e)}
    ${block('sabqi', '◉', T('sabqi'), 'السبقي', T('sabqi_desc'), e.min.sabqi, (e.sabqi || []).slice(0, 8), e)}
    ${block('manzil', '❖', T('manzil'), 'المنزل', e.rot >= 1 ? T('manzil_desc', { rot: e.rot }) : T('manzil_desc_empty'), e.min.manzil, (e.manzil || []).slice(0, 8), e)}
  </div>

  <div class="practice-grid" style="margin-top:22px">
    <div class="card verse-card">
      <div class="card-h"><h3>${esc(T('ayah_day'))}</h3><div class="right">${esc(S.lang === 'ar' ? ay.ar_ref : ay.ref)}</div></div>
      <div class="verse-ar">${ay.ar}</div>
      <p class="verse-tr">${esc(S.lang === 'ar' ? ay.tr_ar : ay.en)}</p>
      <div class="row" style="justify-content:center">
        <button class="btn sm" data-audio-single="${esc(ay.ref)}">▶ ${esc(T('listen'))}</button>
        <button class="btn sm ghost" data-go="method">${esc(T('why_method'))}</button>
      </div>
    </div>
    <div class="card">
      <div class="card-h"><h3>${esc(T('do_today'))}</h3><div class="right">${(rec.manzil || []).length}/${(e.manzil || []).length}</div></div>
      <div class="tasks">
        ${task(t, 'sabaq', set.length ? T('task_sabaq', { n: set.length }) : (S.lang === 'ar' ? 'السبق — لا جديد اليوم' : 'Sabaq — no new pages today'))}
        ${task(t, 'sabqi', T('task_sabqi'))}
        ${task(t, 'manzil', T('task_manzil'))}
        ${task(t, 'salah', T('task_salah'))}
      </div>
      <div class="row between" style="margin-top:6px">
        <span class="note">${esc(T('ar_solid'))}: ${S.profile.solid.length} · ${esc(T('ar_shaky'))}: ${S.profile.shaky.length}</span>
        <button class="btn sm pri" data-go="review">${esc(T('log_session'))}</button>
      </div>
    </div>
  </div>`;
}

/* ---------- catching up after missed days ---------- */
function catchupState() {
  if (!S.profile) return null;
  const missed = missedList();
  if (!missed.length) return null;
  const key = missed.length + '|' + missed[missed.length - 1];
  if (S.promptAt === key) return null;          // already answered for this backlog
  const days = missed.length;
  const anchor = anchorOf();
  const orig = S.profile.origStart || S.profile.start;
  const behind = Math.max(0, Math.round((parseISO(anchor.start) - parseISO(orig)) / 864e5));
  // the date you were promised when you started — not the date the missed days pushed it to
  const sc = (S.profile && S.profile.scope) || { mode: 'all' };
  const target = MishkatPlan.build({
    budget: anchor.budget, startPage: anchor.startPage, solid: anchor.solid, shaky: anchor.shaky,
    scope: sc, start: orig
  }).khatmDate;
  const need = budgetFor(target);
  return { missed, days, behind, target, need, key };
}

function catchupCard() {
  const c = catchupState();
  if (!c) return '';
  const extra = c.need && c.need > PLAN.budget ? c.need - PLAN.budget : 0;
  return `<div class="catchup card">
    <div class="cu-top">
      <div class="cu-badge">⏸</div>
      <div>
        <h3>${esc(T('cu_title', { n: c.days }))}</h3>
        <p class="note">${esc(T('cu_body', { n: c.days, date: fmt(PLAN.start, { day: 'numeric', month: 'short' }) }))}</p>
      </div>
    </div>
    <div class="cu-opts">
      <button class="cu-opt" data-catchup="carry">
        <b>${esc(T('cu_carry'))}</b><span>${esc(T('cu_carry_s'))}</span></button>
      <button class="cu-opt" data-catchup="pause">
        <b>${esc(T('cu_pause'))}</b><span>${esc(T('cu_pause_s'))}</span></button>
      ${extra ? `<button class="cu-opt" data-catchup="recover">
        <b>${esc(T('cu_recover', { n: c.need, date: fmt(c.target, { month: 'short', year: 'numeric' }) }))}</b><span>${esc(T('cu_recover_s', { extra }))}</span></button>` : ''}
      <button class="cu-opt" data-catchup="rebuild">
        <b>${esc(T('cu_rebuild'))}</b><span>${esc(T('cu_rebuild_s'))}</span></button>
    </div>
    <button class="cu-skip" data-skipcatch>${esc(T('cu_skip'))}</button>
  </div>`;
}

/* the card shown at the top of Today only when something is waiting */
function scopeLine() {
  const p = S.profile || {};
  const sc = p.scope || { mode: 'all' };
  if (sc.mode === 'all' || !(sc.pages || []).length) return '';
  const pages = sc.pages;
  const range = `${Math.min(...pages)}–${Math.max(...pages)}`;
  return `<div class="scope-line"><b>${esc(T('summary_goal'))}:</b> ${esc(scopeLabelOf(pages, true))} <span>· ${esc(T('pages_word'))} ${esc(range)}</span></div>`;
}

function compactCatchup() {
  const c = catchupState();
  if (!c) return '';
  return `<button class="cu-strip" data-go="catchup">
    <span class="cu-strip-i">⏸</span>
    <span>${esc(T('cu_strip', { n: c.days }))}</span>
    <span class="cu-strip-go">${esc(T('cu_strip_go'))} →</span>
  </button>`;
}

function renderCatchup() {
  const c = catchupState() || { missed: missedList(), days: missedList().length, behind: 0, target: PLAN.khatmDate, need: null, key: '' };
  const rows = c.missed.slice(-14).reverse().map((d) => `<div class="miss-row">
      <span>${esc(fmt(d, { weekday: 'short', day: 'numeric', month: 'short' }))}</span>
      <button class="mini" data-forget="${d}" title="${esc(T('cu_fill'))}">${esc(T('cu_fill'))}</button>
    </div>`).join('');
  return `
  <section class="hero" style="padding:34px 0 6px"><div class="hero-scrim"></div>
    <div class="eyebrow"><span class="dot"></span>${esc(T('nav_catchup'))}</div>
    <h1 class="display">${esc(T('cu_page_t1'))} <em>${esc(T('cu_page_t2'))}</em></h1>
    <p class="lede">${esc(T('cu_page_lede'))}</p>
  </section>

  ${catchupCard()}

  <div class="card">
    <div class="card-h"><h3>${esc(T('cu_missed'))}</h3><div class="right">${c.days}</div></div>
    <p class="note">${esc(T('cu_missed_note'))}</p>
    <div class="miss-list">${rows || `<p class="note">${esc(T('cu_none'))}</p>`}</div>
  </div>`;
}


/* ============================================================
   CLOUD BACKUP (optional) — Supabase, called with plain fetch
   The device stays the source of truth; the cloud is a second copy.
   ============================================================ */
const CLOUD_SQL = `-- Mishkat: one row per person, readable only by its owner
create table if not exists public.progress (
  owner       uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  name        text,
  record      jsonb not null,
  updated_at  timestamptz not null default now(),
  device      text
);

alter table public.progress enable row level security;

drop policy if exists "own row read"   on public.progress;
drop policy if exists "own row write"  on public.progress;
drop policy if exists "own row update" on public.progress;

create policy "own row read"   on public.progress for select using (auth.uid() = owner);
create policy "own row write"  on public.progress for insert with check (auth.uid() = owner);
create policy "own row update" on public.progress for update using (auth.uid() = owner) with check (auth.uid() = owner);`;

const cloudOn = () => typeof MishkatSync !== 'undefined' && MishkatSync.status().configured;
const cloudSignedIn = () => cloudOn() && MishkatSync.status().signedIn;

function cloudCard() {
  const st = cloudOn() ? MishkatSync.status() : { configured: false, signedIn: false, email: '', lastPush: 0, lastError: null };
  const signed = st.signedIn;

  const setup = `
    <div class="cloud-setup">
      <ol class="cloud-steps">
        <li>${esc(T('cl_step1'))}</li>
        <li>${esc(T('cl_step2'))}
          <pre class="cloud-sql" id="cloudSql">${esc(CLOUD_SQL)}</pre>
          <button class="btn sm ghost" data-cloud-sqlcopy>${esc(T('cl_copy_sql'))}</button></li>
        <li>${esc(T('cl_step3'))}</li>
        <li>${esc(T('cl_step4'))}</li>
      </ol>
      <div class="cloud-fields">
        <label>${esc(T('cl_url'))}<input class="ob-input" id="cloudUrl" placeholder="https://xxxx.supabase.co" value="${esc(st.url || '')}" autocapitalize="off" autocorrect="off" spellcheck="false"></label>
        <label>${esc(T('cl_anon'))}<input class="ob-input" id="cloudAnon" placeholder="eyJhbGciOi…" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"></label>
        <button class="btn pri sm" data-cloud-save>${esc(T('cl_save'))}</button>
      </div>
    </div>`;

  const account = !st.configured ? '' : !signed ? `
    <div class="cloud-auth">
      <p class="note">${esc(T('cl_what_body'))}</p>
      <div class="cloud-fields">
        <label>${esc(T('cl_email'))}<input class="ob-input" id="cloudEmail" type="email" inputmode="email" autocomplete="email" placeholder="you@example.com"></label>
        <button class="btn sm" data-cloud-send>${esc(T('cl_send'))}</button>
      </div>
      <div class="cloud-fields ${cloudCodeShown ? 'on' : ''}">
        <label>${esc(T('cl_code'))}<input class="ob-input" id="cloudCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456"></label>
        <button class="btn pri sm" data-cloud-verify>${esc(T('cl_verify'))}</button>
      </div>
    </div>` : `
    <div class="cloud-account">
      <p class="note">${esc(T('cl_signed_as'))} <b>${esc(st.email || '')}</b> · ${esc(T('cl_last'))}: ${st.lastPush ? new Date(st.lastPush).toLocaleDateString(S.lang === 'ar' ? 'ar' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : esc(T('cl_never'))}</p>
      <p class="note cloud-health ${cloudProbe && cloudProbe.ok ? 'good' : cloudProbe ? 'bad' : ''}">${cloudProbe ? (cloudProbe.ok ? '✓ ' + esc(T('cl_ok')) : '✗ ' + esc(cloudDiag(cloudProbe))) : ''}</p>
      <div class="row">
        <button class="btn sm" data-cloud-push>${esc(T('cl_push'))}</button>
        <button class="btn sm ghost" data-cloud-pull>${esc(T('cl_pull'))}</button>
        <button class="btn sm ghost" data-cloud-signout>${esc(T('cl_signout'))}</button>
      </div>
    </div>`;

  return `<div class="card cloud-card" style="margin-top:16px">
    <div class="card-h"><h3>${esc(T('cl_title'))}</h3>
      <div class="right"><span class="badge ${signed ? 'ok' : ''}">${signed ? esc(T('cl_on')) : onlyConfigured(st) ? esc(T('cl_not_set')) : esc(T('cl_off'))}</span></div></div>
    <p class="note">${esc(T('cl_lede'))}</p>
    ${account}
    ${onlyConfigured(st) ? `<p class="note" style="margin-top:12px">${esc(T('cl_conn'))} <b>${esc(st.url)}</b> · <button class="linkish" data-cloud-forget>${esc(T('cl_disconnect'))}</button></p>` : ''}
    ${!cloudOn() ? setup : ''}
    <p class="note" style="margin-top:14px">${esc(T('cl_what'))}: ${esc(T('cl_what_body'))}</p>
  </div>`;
}
const onlyConfigured = (st) => st.configured && !st.signedIn;
let cloudCodeShown = false;
let cloudProbe = null;

function cloudDiag(res) {
  if (!res) return '';
  if (res.code === 'OK') return T('cl_ok');
  if (res.code === 'TABLE_MISSING') return T('cl_e_table');
  if (res.code === 'KEY_REJECTED') return T('cl_e_key');
  if (res.code === 'RLS_OR_KEY') return T('cl_e_rls');
  if (res.code === 'NETWORK') return T('cl_e_net');
  return T('cl_err') + ' (' + (res.status || res.code) + ')';
}
async function cloudCheck() {
  if (!cloudOn()) return;
  try { cloudProbe = await MishkatSync.test(); } catch (e) { cloudProbe = { ok: false, code: 'NETWORK' }; }
  const el = $('.cloud-health');
  if (el) {
    el.textContent = (cloudProbe.ok ? '✓ ' : '✗ ') + (cloudProbe.ok ? T('cl_ok') : cloudDiag(cloudProbe));
    el.className = 'note cloud-health ' + (cloudProbe.ok ? 'good' : 'bad');
  }
}

/* device ↔ cloud reconciliation, and the quiet background loop */
async function cloudPush(silent) {
  if (!cloudSignedIn()) return false;
  try {
    await MishkatSync.push(S, (S.profile && S.profile.name) || '—');
    if (!silent) toast(T('cl_pushed'), 2800);
    render();
    return true;
  } catch (e) {
    MishkatSync.noteError(String(e.message || e));
    if (!silent) toast(T('cl_err') + ': ' + String(e.message || e).slice(0, 60), 4200);
    return false;
  }
}
async function cloudPull(silent) {
  if (!cloudSignedIn()) return false;
  try {
    const row = await MishkatSync.pull();
    if (!row || !row.record) { if (!silent) toast(T('cl_no_cloud'), 3200); return false; }
    const cloudState = row.record;
    const localCount = Object.keys(S.days || {}).length;
    const cloudCount = Object.keys(cloudState.days || {}).length;
    if (!silent && cloudCount > localCount) {
      const ok = confirm(T('cl_conflict', { local: localCount, cloud: cloudCount }) + '\n\n' + T('cl_keep_cloud'));
      if (!ok) return false;
    }
    const keepId = S.personId;
    S = Object.assign(defaultState(), cloudState);
    S.personId = keepId;
    PLAN = null; save(); shell(); applyTheme();
    if (S.profile) { buildPlan(); go('today'); } else startOnboarding();
    if (!silent) toast(T('cl_pulled'), 3600);
    return true;
  } catch (e) {
    MishkatSync.noteError(String(e.message || e));
    if (!silent) toast(T('cl_err') + ': ' + String(e.message || e).slice(0, 60), 4200);
    return false;
  }
}
/* upload shortly after any change, at most every few minutes; never blocks the UI */
let cloudTimer = null, cloudLastAuto = 0;
function cloudTouch() {
  if (!cloudSignedIn()) return;
  clearTimeout(cloudTimer);
  cloudTimer = setTimeout(() => {
    const now = Date.now();
    if (now - cloudLastAuto < 120000) return;
    cloudLastAuto = now;
    cloudPush(true);
  }, 4000);
}


/* ============================================================
   ADD TO HOME SCREEN — the app is already a PWA; this makes it obvious.
   On iOS only Safari can install; on Android Chrome (and Edge) show a real prompt.
   ============================================================ */
const INSTALL_DONE = 'mishkat.install.done';      // installed: never ask again
const INSTALL_WELCOME = 'mishkat.install.welcome';  // shown right after setting up
const INSTALL_HIDDEN = 'mishkat.install.hidden';    // "not now": keep the People card
const standalone = () => (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isSafari = () => isIOS() && /^((?!chrome|android|crios|fxios|edgios).)*safari/i.test(navigator.userAgent);
const isFirefox = () => /Firefox|FxiOS/i.test(navigator.userAgent);
let installEvent = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvent = e; });

function installCard() {
  if (standalone() || localStorage.getItem(INSTALL_DONE)) return '';
  return renderInstallCard(false);
}
function installWelcome() {
  if (standalone() || localStorage.getItem(INSTALL_DONE)) return '';
  if (localStorage.getItem(INSTALL_WELCOME)) return '';   // dismissed after setup
  return renderInstallCard(true);
}
function renderInstallCard(welcome) {
  const step = (n, txt) => `<li><b>${n}</b> ${esc(txt)}</li>`;
  let inner;
  if (isIOS()) {
    inner = isSafari() ? `
      <ol class="inst-steps has-share">
        ${step(1, T('inst_ios_1'))}
        ${step(2, T('inst_ios_2'))}
        ${step(3, T('inst_ios_3'))}
        ${step(4, T('inst_ios_4'))}
      </ol>
      <p class="note">${esc(T('inst_ios_note'))}</p>`
      : `<p class="note">${esc(T('inst_ios_safari'))}</p>
         <ol class="inst-steps">
           ${step(1, T('inst_ios_1'))}
           ${step(2, T('inst_ios_2'))}
           ${step(3, T('inst_ios_3'))}
           ${step(4, T('inst_ios_4'))}
         </ol>`;
  } else if (installEvent) {
    inner = `<p class="note">${esc(T('inst_android_lede'))}</p>
      <div class="row" style="margin-top:10px"><button class="btn pri sm" data-install-go>${esc(T('inst_install'))}</button></div>`;
  } else if (isFirefox()) {
    inner = `<ol class="inst-steps">${step(1, T('inst_ff_1'))}${step(2, T('inst_ff_2'))}</ol>
      <p class="note">${esc(T('inst_ff_note'))}</p>`;
  } else {
    inner = `<p class="note">${esc(T('inst_android_lede'))}</p>
      <ol class="inst-steps">${step(1, T('inst_android_1'))}${step(2, T('inst_android_2'))}</ol>
      <p class="note">${esc(T('inst_android_note'))}</p>`;
  }
  return `<div class="card install-card${welcome ? ' install-welcome' : ''}" style="margin-top:${welcome ? '18' : '16'}px">
    <div class="card-h"><h3>${esc(welcome ? T('inst_welcome_title') : T('inst_title'))}</h3><div class="right"><span class="badge">${esc(T('inst_badge'))}</span></div></div>
    <p class="note">${esc(welcome ? T('inst_welcome_lede') : T('inst_lede'))}</p>
    ${inner}
    <div class="row" style="margin-top:12px;align-items:center">
      <button class="btn sm ghost" data-install-hide>${esc(T(welcome ? 'inst_welcome_hide' : 'inst_hide'))}</button>
      ${welcome ? `<span class="note">${esc(T('inst_welcome_kept'))}</span>` : ''}
    </div>
  </div>`;
}

/* ============================================================
   PEOPLE — this browser can hold more than one hafiz
   ============================================================ */
function renderPeople() {
  const me = S.personId;
  const hasProfile = !!S.profile;
  const list = peopleList();
  const rows = list.map((p) => {
    const rec = loadPerson(p.id);
    const prof = (rec && rec.profile) || {};
    const snap = autoSnapshotOf(p.id);
    const when = p.updatedAt ? new Date(p.updatedAt).toLocaleDateString(S.lang === 'ar' ? 'ar' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
    const scp = (prof.scope && prof.scope.pages) || [];
    const goal = scopeLabelOf(scp, true) || T('goal_q_all');
    const sessions = Object.keys((rec && rec.days) || {}).length;
    const detail = prof.budget
      ? `${goal} · ${prof.budget} ${T('min')} · ${sessions} ${T('sessions')}`
      : T('pp_no_plan');
    return `<div class="person ${p.id === me ? 'on' : ''}">
      <div class="person-main">
        <b>${esc(p.name)}${p.id === me ? ` <span class="badge ok">${esc(T('pp_this'))}</span>` : ''}</b>
        <span class="note">${esc(detail)} · ${esc(when)}${snap ? ` · ${esc(T('pp_snap'))}` : ''}</span>
      </div>
      <div class="row">
        ${p.id === me ? '' : `<button class="btn sm" data-person-open="${p.id}">${esc(T('pp_open'))}</button>`}
        <button class="btn sm ghost" data-person-export="${p.id}">${esc(T('pp_export'))}</button>
        ${p.id === me ? '' : `<button class="btn sm ghost danger" data-person-del="${p.id}">${esc(T('pp_delete'))}</button>`}
      </div>
    </div>`;
  }).join('');

  if (!hasProfile) {
    return `
    <section class="hero" style="padding:34px 0 6px"><div class="hero-scrim"></div>
      <div class="eyebrow"><span class="dot"></span>${esc(T('nav_people'))}</div>
      <h1 class="display">${esc(T('pp_empty_t1'))} <em>${esc(T('pp_empty_t2'))}</em></h1>
      <p class="lede">${esc(T('pp_empty_lede'))}</p>
    </section>
    ${cloudCard()}
    <div class="card" style="margin-top:16px">
      <div class="card-h"><h3>${esc(T('pp_import'))}</h3></div>
      <p class="note">${esc(T('pp_import_note'))}</p>
      <div class="row" style="margin-top:12px">
        <button class="btn sm ghost" data-owner-start>${esc(T('owner_enter'))}</button>
        <button class="btn sm ghost" data-import>${esc(T('pp_import'))}</button>
        <input type="file" id="importFile" accept="application/json,.json" hidden>
        <button class="btn sm ghost" data-go="onboard">${esc(T('pp_start_fresh'))}</button>
      </div>
    </div>`;
  }

  return `
  <section class="hero" style="padding:34px 0 6px"><div class="hero-scrim"></div>
    <div class="eyebrow"><span class="dot"></span>${esc(T('nav_people'))}</div>
    <h1 class="display">${esc(T('pp_title_1'))} <em>${esc(T('pp_title_2'))}</em></h1>
    <p class="lede">${esc(T('pp_lede'))}</p>
  </section>

  <div class="card">
    <div class="card-h"><h3>${esc(T('pp_who'))}</h3><div class="right">${list.length}</div></div>
    <p class="note">${esc(T('pp_who_note'))}</p>
    <div class="people">${rows}</div>
    <div class="row" style="margin-top:14px">
      <button class="btn pri sm" data-person-new>＋ ${esc(T('pp_add'))}</button>
      <button class="btn sm ghost" data-import>${esc(T('pp_import'))}</button>
      <input type="file" id="importFile" accept="application/json,.json" hidden>
    </div>
  </div>

  <div class="card" style="margin-top:16px">
    <div class="card-h"><h3>${esc(T('pp_safety'))}</h3><div class="right">${esc(T('pp_auto'))}</div></div>
    <p class="note">${esc(T('pp_safety_note'))}</p>
    ${autoSnapshotOf(S.personId) ? `<div class="row" style="margin-top:12px">
      <button class="btn sm ghost" data-person-restore>${esc(T('pp_restore'))}</button>
      <span class="note">${esc(T('pp_snap_at', { date: new Date((autoSnapshotOf(S.personId) || {}).at || Date.now()).toLocaleDateString(S.lang === 'ar' ? 'ar' : 'en-GB', { day: 'numeric', month: 'short' }) }))}</span>
    </div>` : ''}
    <div class="row" style="margin-top:12px">
      <button class="btn sm" data-export>⤓ ${esc(T('pp_export_mine'))}</button>
      <button class="btn sm ghost" data-sync-out>${esc(T('sync_out'))}</button>
      <button class="btn sm ghost" data-sync-in>${esc(T('sync_in'))}</button>
    </div>
    <div id="syncBox"></div>
    <p class="note" style="margin-top:14px">${esc(T('pp_honest'))}</p>
    ${isOwner() ? '' : `<div class="row" style="margin-top:10px"><button class="btn sm ghost" data-owner-start>${esc(T('owner_enter'))}</button></div>`}
  </div>

  ${installCard()}

  ${cloudCard()}

  ${isOwner() ? ownerCard() : ''}`;
}

/* write any state record to a file the person can keep anywhere */
function exportJSON(state, who) {
  const safe = String(who || 'me').replace(/[^\w\u0600-\u06FF-]+/g, '-').slice(0, 24);
  const blob = new Blob([JSON.stringify({
    app: 'mishkat', version: 2, kind: 'person', exported: new Date().toISOString(), name: who, state
  }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'mishkat-' + safe + '-' + todayISO() + '.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function exportPerson(id) {
  const st = loadPerson(id);
  if (!st) return toast(T('pp_missing'), 3200);
  exportJSON(st, (st.profile && st.profile.name) || id);
  toast(T('pp_exported'), 3000);
}

function backupNudge() {
  const tracked = Object.keys(S.days).length;
  if (tracked < 3) return '';
  const d = daysSince(S.lastBackup);
  if (d !== null && d < 14) return '';
  return `<div class="nudge">
    <span>${esc(T('nudge_text', { n: d === null ? '—' : d }))}</span>
    <button class="btn sm" data-go="journey">${esc(T('nudge_btn'))}</button>
  </div>`;
}

function block(kind, icon, title, ar, desc, mins, pages, e) {
  const t = todayISO();
  const rec = S.days[t] || {};
  const doneArr = kind === 'sabaq' ? (rec.sabaq || []) : kind === 'manzil' ? (rec.manzil || []) : [];
  return `<div class="card blk hov">
    <div class="blk-h"><div class="blk-ic">${icon}</div><div class="blk-t">${esc(title)}</div><div class="blk-ar">${ar}</div>
      <div class="blk-min">${mins} ${esc(T('min'))}</div></div>
    <p class="blk-desc">${esc(desc)}</p>
    <div class="chips">
      ${pages.length ? pages.map((p) => `<span class="chip ${doneArr.includes(p) ? 'gold' : ''}" data-page="${p}">p.${p} · ${esc(pageTitle(p))}</span>`).join('') : `<span class="chip plain">${esc(T('nothing'))}</span>`}
    </div>
    <div class="blk-foot">
      ${pages.length ? `<button class="btn sm" data-go="learn" data-page-open="${pages[0]}">${esc(T('drill'))}</button>` : ''}
      <button class="btn sm ghost" data-mark="${kind}">${esc(kind === 'sabqi' ? T('mark_recited') : T('mark_done'))}</button>
    </div>
  </div>`;
}

function task(date, key, label) {
  const rec = S.days[date] || {};
  return `<label class="task"><input type="checkbox" data-task="${key}" ${rec[key] ? 'checked' : ''}><span>${esc(label)}</span></label>`;
}

/* ============================================================
   LEARN
   ============================================================ */
const player = { queue: [], idx: 0, audio: null, repeat: 1, reps: {} };

function renderLearn() {
  const t = todayISO();
  const e = dayEntry(t);
  const assigned = [...(e.new || []), ...(e.solidify || []), ...(e.sabqi || [])];
  const p = S.page || assigned[0] || 1;
  S.page = p;
  const pd = pageData(p);
  if (!pd) return `<div class="card"><p class="note">…</p></div>`;
  const ayahs = pageAyahs(p);

  return `
  <section class="hero" style="padding:34px 0 6px"><div class="hero-scrim"></div>
    <div class="eyebrow"><span class="dot"></span>${esc(T('practice'))} · ${esc(T('page'))} ${p} · ${esc(T('juz'))} ${pd.j}</div>
    <h1 class="display">${esc(T('learn_title_1'))}<br><em>${esc(T('learn_title_2'))}</em></h1>
    <p class="lede">${T('learn_lede')}</p>
  </section>

  <div class="practice-grid">
    <div class="card mushaf">
      <div class="mushaf-head">
        <div class="pg-title">${esc(T('page'))} ${p}</div>
        <div class="pg-sub">${esc(T('juz'))} ${pd.j} · ${esc(pageTitle(p))}</div>
        <div class="pg-nav">
          <button class="btn sm" data-pg="-1">${I18N[S.lang].dir === 'rtl' ? '→' : '←'}</button>
          <input type="text" id="pgJump" value="${p}" style="width:64px;text-align:center" inputmode="numeric">
          <button class="btn sm" data-pg="1">${I18N[S.lang].dir === 'rtl' ? '←' : '→'}</button>
        </div>
      </div>
      <div class="row" style="margin-bottom:16px">
        <button class="btn sm" data-mode="normal">${esc(T('normal'))}</button>
        <button class="btn sm" data-mode="blur">${esc(T('blur'))}</button>
        <button class="btn sm" data-mode="blind">${esc(T('blind'))}</button>
        <button class="btn sm ghost" data-toggle-en>${esc(S.showEn ? T('hide_tr') : T('show_tr'))}</button>
        <span class="badge" id="modeBadge">${esc(T('normal'))}</span>
      </div>
      <div class="ayah-list" id="mushaf">${pageHTML(p, 'normal')}</div>
      <div class="row" style="margin-top:18px;justify-content:space-between">
        <span class="note">${esc(T('ayah_on_page', { n: ayahs.length }))}</span>
        <div class="row">
          <button class="btn sm ghost" data-go="review">${esc(T('recited_log'))}</button>
          <button class="btn sm pri" data-go="drill">${esc(T('guided'))}</button>
        </div>
      </div>
    </div>

    <div class="drill">
      <div class="panel">
        <h4>${esc(T('recitation'))}</h4>
        <p class="hint">${esc(T('recitation_hint'))}</p>
        <select id="reciterSel">
          ${RECITERS.map((r) => `<option value="${r.id}" ${S.reciter === r.id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}
        </select>
        <div class="row" style="margin-top:10px">
          <button class="btn sm" data-play-page>▶ ${esc(T('play_page'))}</button>
          <button class="btn sm ghost" data-stop>■ ${esc(T('stop'))}</button>
        </div>
        <div class="row" style="margin-top:10px">
          <label class="note" style="flex:1">${esc(T('repeat_each'))} <b id="repLbl">3×</b></label>
          <input type="range" min="1" max="10" value="3" id="repeatRange" style="max-width:130px">
        </div>
        <div class="row" style="margin-top:8px">
          <label class="note" style="flex:1">${esc(T('speed'))} <b id="spdLbl">1.0×</b></label>
          <input type="range" min="60" max="110" value="100" id="speedRange" style="max-width:130px">
        </div>
      </div>

      <div class="panel">
        <h4>${esc(T('takrar'))}</h4>
        <p class="hint">${esc(T('takrar_hint'))}</p>
        <div class="tap-count">
          <button class="tap-btn" id="tapBtn">+1</button>
          <div class="tap-meta"><b id="tapCount">0</b> / <span id="tapTarget">10</span> ${esc(T('reps'))}<br><span id="tapPhase">${esc(T('phase_reading'))}</span></div>
        </div>
        <div class="row">
          <button class="btn sm ghost" data-tap-target="10">10×</button>
          <button class="btn sm ghost" data-tap-target="20">20×</button>
          <button class="btn sm ghost" data-tap-target="40">40×</button>
          <button class="btn sm ghost" data-tap-reset>reset</button>
        </div>
      </div>

      <div class="panel">
        <h4>${esc(T('mic_title'))}</h4>
        <p class="hint">${esc(T('mic_hint'))}</p>
        <div class="mic-wrap">
          <button class="mic" id="micBtn">🎙</button>
          <div class="mic-hint" id="micHint">${esc(T('mic_hint'))}</div>
        </div>
        <div class="transcript" id="transcript">…</div>
        <div class="row" id="scoreRow" style="margin-top:10px"></div>
      </div>
    </div>
  </div>`;
}

function pageHTML(p, mode) {
  const pd = pageData(p);
  let html = '';
  pd.s.forEach((s) => {
    html += `<div class="surah-band">سُورَةُ ${esc(s.arPlain || s.ar)}${S.lang === 'ar' ? '' : ' · ' + esc(s.en)}</div>`;
    if (mode === 'blind') {
      s.a.forEach((a) => { html += `<span class="ayah hide-all" data-ayah="${a[0]}" data-surah="${s.n}">${'&nbsp;'.repeat(8)}</span><span class="ayah-num">${a[0]}</span> `; });
    } else {
      s.a.forEach((a) => {
        const words = a[1].split(/\s+/).map((w) => `<span class="w">${w}</span>`).join(' ');
        html += `<span class="ayah ${mode === 'blur' ? 'hidden-word' : ''}" data-ayah="${a[0]}" data-surah="${s.n}">
          <span class="ayah-num" data-play="${s.n}:${a[0]}">${a[0]}</span> ${words}</span> `;
      });
    }
    html += `<div class="tr-line">${s.a.map((a) => `<b>${a[0]}.</b> ${esc(a[2] || '')}`).join(' ')}</div>`;
  });
  return html;
}
function setMode(mode) {
  const el = $('#mushaf'); if (!el) return;
  el.innerHTML = pageHTML(S.page, mode);
  const b = $('#modeBadge'); if (b) b.textContent = T(mode);
  $$('[data-mode]').forEach((x) => x.classList.toggle('pri', x.dataset.mode === mode));
}

/* audio */
function audioPage(p) {
  player.queue = pageAyahs(p).map((a) => ({ surah: a.surah, n: a.n }));
  player.idx = 0; playNext();
}
function playNext() {
  if (!player.queue.length || player.idx >= player.queue.length) { stopAudio(); return; }
  const cur = player.queue[player.idx];
  const a = new Audio(audioUrl(S.reciter, cur.surah, cur.n));
  a.playbackRate = parseFloat($('#speedRange')?.value || 100) / 100;
  player.audio = a; highlight(cur.surah, cur.n);
  a.onended = () => {
    const k = cur.surah + ':' + cur.n;
    player.reps[k] = (player.reps[k] || 0) + 1;
    if (player.reps[k] < (player.repeat || 1)) playNext();
    else { player.reps[k] = 0; player.idx++; playNext(); }
  };
  a.onerror = () => { stopAudio(); toast(S.lang === 'ar' ? 'التلاوة تحتاج اتصالًا بالإنترنت (everyayah.com).' : 'Audio needs an internet connection (everyayah.com).', 5200); };
  a.play().catch(() => { });
}
function stopAudio() {
  if (player.audio) { try { player.audio.pause(); } catch (e) { } }
  player.audio = null; player.queue = []; player.idx = 0;
  $$('.ayah.playing').forEach((e) => e.classList.remove('playing'));
}
function highlight(s, n) {
  $$('.ayah.playing').forEach((e) => e.classList.remove('playing'));
  const el = $(`.ayah[data-ayah="${n}"][data-surah="${s}"]`);
  if (el) { el.classList.add('playing'); el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
}
function playSingle(surah, ayah) {
  stopAudio();
  const a = new Audio(audioUrl(S.reciter, surah, ayah));
  player.audio = a; highlight(surah, ayah);
  a.onerror = () => toast(S.lang === 'ar' ? 'التلاوة تحتاج اتصالًا.' : 'Audio needs a connection.', 4200);
  a.play().catch(() => { });
}

/* speech */
let recog = null, listening = false;
const AR_NORM = (s) => String(s)
  .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED\u08F0-\u08FF]/g, '')
  .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
  .replace(/ة/g, 'ه').replace(/[^\u0621-\u064A\s]/g, '').replace(/\s+/g, ' ').trim();

function initMic() {
  const btn = $('#micBtn'); if (!btn) return;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { $('#micHint').textContent = T('mic_unsupported'); btn.disabled = true; return; }
  btn.onclick = () => {
    if (listening) { recog && recog.stop(); return; }
    recog = new SR();
    recog.lang = 'ar-SA'; recog.interimResults = true; recog.continuous = true; recog.maxAlternatives = 1;
    let final = '';
    recog.onstart = () => { listening = true; btn.classList.add('rec'); $('#micHint').textContent = T('mic_listening'); };
    recog.onerror = (ev) => { listening = false; btn.classList.remove('rec'); $('#micHint').textContent = T('mic_denied', { err: ev.error }); };
    recog.onend = () => { listening = false; btn.classList.remove('rec'); if (final) score(final); };
    recog.onresult = (ev) => {
      let txt = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) txt += ev.results[i][0].transcript;
      final = txt; $('#transcript').textContent = txt || '…';
    };
    recog.start();
  };
}
function score(heard) {
  const target = pageAyahs(S.page).map((a) => a.ar).join(' ');
  const H = AR_NORM(heard).split(' ').filter(Boolean);
  const T_ = AR_NORM(target).split(' ').filter(Boolean);
  const pool = [...H];
  let hit = 0;
  T_.forEach((w) => { const i = pool.indexOf(w); if (i >= 0) { hit++; pool.splice(i, 1); } });
  const pct = T_.length ? Math.round((hit / T_.length) * 100) : 0;
  const row = $('#scoreRow'); if (!row) return;
  row.innerHTML = `<span class="badge ${pct > 85 ? 'ok' : 'warn'}">${esc(T('word_match', { pct }))}</span>
    <span class="note">${esc(T('match_note', { hit, total: T_.length }))}</span>`;
  if (pct >= 85) toast(T('clean'));
}

/* ============================================================
   DRILL
   ============================================================ */
function renderDrill() {
  const p = S.page || 1;
  const ayahs = pageAyahs(p);
  const chunks = [];
  for (let i = 0; i < ayahs.length; i += 2) chunks.push(ayahs.slice(i, i + 2));
  return `
  <section class="hero" style="padding:34px 0 6px"><div class="hero-scrim"></div>
    <div class="eyebrow"><span class="dot"></span>${esc(T('guided'))} · ${esc(T('page'))} ${p} · ${chunks.length}</div>
    <h1 class="display">${esc(T('guided_title_1'))} <em>${esc(T('guided_title_2'))}</em></h1>
    <p class="lede">${esc(T('guided_lede'))}</p>
  </section>
  <div class="two">
    <div>
      ${chunks.map((ch, ci) => `
        <div class="card" style="margin-bottom:14px">
          <div class="row between" style="margin-bottom:10px">
            <div class="card-h" style="margin:0"><h3>${esc(T('chunk'))} ${ci + 1}</h3>
              <div class="right">${esc(S.lang === 'ar' ? ch[0].surahAr : ch[0].surahEn)} ${ch[0].n}${ch.length > 1 ? '–' + ch[ch.length - 1].n : ''}</div></div>
            <button class="btn sm" data-chunk-audio="${ch.map((a) => a.surah + ':' + a.n).join(',')}">▶ ${esc(T('listen'))}</button>
          </div>
          <div class="ayah-list" style="font-size:clamp(19px,2.2vw,26px);line-height:2.2">
            ${ch.map((a) => `<span class="ayah" data-ayah="${a.n}" data-surah="${a.surah}"><span class="ayah-num">${a.n}</span> ${a.ar.split(/\s+/).map((w) => `<span class="w">${w}</span>`).join(' ')}</span> `).join('')}
          </div>
          <p class="verse-tr" style="text-align:start;margin:10px 0 0">${esc(ch.map((a) => a.en).join(' '))}</p>
          <div class="tasks" style="margin-top:14px">
            <label class="task"><input type="checkbox"><span>${esc(T('listened'))}</span></label>
            <label class="task"><input type="checkbox"><span>${esc(T('read_ten'))}</span></label>
            <label class="task"><input type="checkbox"><span>${esc(T('recited_ten'))}</span></label>
            <label class="task"><input type="checkbox"><span>${esc(T('linked'))}</span></label>
          </div>
        </div>`).join('')}
    </div>
    <div class="drill">
      <div class="panel">
        <h4>${esc(T('after_holds'))}</h4>
        <p class="hint">${esc(T('grade_hint'))}</p>
        <div class="rate-row">
          <button class="rate r0" data-rate="0">${esc(T('forgot'))}<br><small>${esc(T('again_tomorrow'))}</small></button>
          <button class="rate r1" data-rate="1">${esc(T('shaky'))}<br><small>${esc(T('in_2'))}</small></button>
          <button class="rate r2" data-rate="2">${esc(T('solid'))}<br><small>${esc(T('in_10'))}</small></button>
          <button class="rate r3" data-rate="3">${esc(T('automatic'))}<br><small>${esc(T('rotation'))}</small></button>
        </div>
        <div class="note" id="rateMsg" style="margin-top:14px">${esc(T('nothing_graded'))}</div>
      </div>
      <div class="panel">
        <h4>${esc(T('ten_word'))}</h4>
        <p class="hint">${esc(T('ten_word_body'))}</p>
        <input type="text" id="weakNote" placeholder="${esc(T('weak_placeholder'))}">
        <button class="btn sm wide" style="margin-top:10px" data-save-note>${esc(T('save_note'))}</button>
      </div>
      <div class="panel">
        <h4>${esc(T('sleep'))}</h4>
        <p class="note">${esc(T('sleep_body'))}</p>
      </div>
    </div>
  </div>`;
}

/* ============================================================
   REVIEW
   ============================================================ */
function renderReview() {
  const t = todayISO();
  const e = dayEntry(t);
  const rec = session(t);
  const manzil = e.manzil || [];
  const sabqi = e.sabqi || [];
  const set = (e.new && e.new.length ? e.new : e.solidify) || [];
  const st = stats();
  const weak = Object.entries(S.pages).filter(([, v]) => (v.strength || 0) < 2).map(([k]) => +k).slice(0, 24);

  return `
  <section class="hero" style="padding:34px 0 6px"><div class="hero-scrim"></div>
    <div class="eyebrow"><span class="dot"></span>${esc(T('nav_review'))} · ${fmt(t, { weekday: 'long', day: 'numeric', month: 'long' })}</div>
    <h1 class="display">${esc(T('review_title_1'))} <em>${esc(T('review_title_2'))}</em></h1>
    <p class="lede">${esc(T('review_lede'))}</p>
  </section>

  <div class="two">
    <div class="card">
      <div class="card-h"><h3>${esc(T('sabaq_pages'))}</h3><div class="right">${(rec.sabaq || []).length}/${set.length}</div></div>
      <div class="chips">
        ${set.map((p) => `<span class="chip ${(rec.sabaq || []).includes(p) ? 'gold' : ''}" data-tick="sabaq" data-p="${p}">p.${p} · ${esc(pageTitle(p))}</span>`).join('') || `<span class="chip plain">${esc(T('nothing'))}</span>`}
      </div>
    </div>
    <div class="card">
      <div class="card-h"><h3>${esc(T('sabqi_last'))}</h3><div class="right">${rec.sabqi ? '✓' : '—'}</div></div>
      <div class="chips">${sabqi.map((p) => `<span class="chip plain">p.${p} · ${esc(pageTitle(p))}</span>`).join('') || `<span class="chip plain">${esc(T('nothing'))}</span>`}</div>
      <button class="btn sm wide" style="margin-top:12px" data-tick="sabqi">${esc(T('mark_recited'))}</button>
      <p class="note" style="margin-top:10px">${esc(T('sabqi_note'))}</p>
    </div>
  </div>

  <div class="card" style="margin-top:16px">
    <div class="card-h"><h3>${esc(T('manzil_vault'))}</h3><div class="right">${esc(T('rotation_every', { rot: e.rot }))}</div></div>
    <div class="chips">${manzil.map((p) => `<span class="chip ${(rec.manzil || []).includes(p) ? 'gold' : ''}" data-tick="manzil" data-p="${p}">p.${p} · ${esc(pageTitle(p))}</span>`).join('') || `<span class="chip plain">—</span>`}</div>
    <div class="row" style="margin-top:14px">
      <button class="btn sm" data-tick="manzilAll">${esc(T('tick_all'))}</button>
      <button class="btn sm ghost" data-go="learn">${esc(T('open_mushaf'))}</button>
      <span class="note">${esc(T('pages_about', { n: manzil.length, min: Math.round(manzil.length * 2.5) }))}</span>
    </div>
  </div>

  <div class="two" style="margin-top:16px">
    <div class="card">
      <div class="card-h"><h3>${esc(T('weak_pages'))}</h3><div class="right">${weak.length}</div></div>
      <p class="note">${esc(T('weak_note'))}</p>
      <div class="chips" style="margin-top:10px">${weak.map((p) => `<span class="chip" data-page-open="${p}">p.${p} · ${esc(pageTitle(p))}</span>`).join('') || `<span class="chip plain">${esc(T('nothing_weak'))}</span>`}</div>
    </div>
    <div class="card">
      <div class="card-h"><h3>${esc(T('log_this'))}</h3><div class="right">${rec.minutes || 0} ${esc(T('min'))}</div></div>
      <div class="row" style="margin-bottom:12px">
        <label class="note" style="flex:1">${esc(T('mins_focused'))}</label>
        <input type="text" id="minsIn" value="${rec.minutes || S.profile.budget}" style="width:74px;text-align:center">
      </div>
      <div class="row" style="margin-bottom:12px">
        <label class="note" style="flex:1">${esc(T('how_feel'))}</label>
        <select id="feelSel">
          <option value="0">${esc(T('feel_0'))}</option>
          <option value="1">${esc(T('feel_1'))}</option>
          <option value="2" selected>${esc(T('feel_2'))}</option>
          <option value="3">${esc(T('feel_3'))}</option>
        </select>
      </div>
      <textarea id="noteIn" rows="2" placeholder="${esc(T('note_ph'))}">${esc(rec.note || '')}</textarea>
      <button class="btn pri wide" style="margin-top:12px" data-finish>${esc(T('finish'))}</button>
      <p class="note" style="margin-top:10px">${esc(T('finish_note'))}</p>
    </div>
  </div>

  <div class="card" style="margin-top:16px">
    <div class="card-h"><h3>${esc(T('consistency'))}</h3><div class="right">${st.streak} · ${esc(T('best'))} ${st.best}</div></div>
    ${miniCalendar()}
  </div>`;
}

function miniCalendar() {
  const cells = [];
  const limit = Math.min(PLAN.days.length, 180);
  for (let i = 0; i < limit; i++) {
    const d = PLAN.days[i];
    cells.push(`<div class="cell ${dayStatus(d.date)} ${d.date === todayISO() ? 'today' : ''} ${d.ramadan ? 'ram' : ''}" title="${fmt(d.date)} — ${d.type}"></div>`);
  }
  return `<div class="cal">${cells.join('')}</div>`;
}

/* ============================================================
   JOURNEY
   ============================================================ */
function renderJourney() {
  const st = stats();
  const t = todayISO();
  const cells = [];
  for (let p = 1; p <= TOTAL_PAGES; p++) {
    const known = (S.profile.solid || []).includes(p);
    const shaky = (S.profile.shaky || []).includes(p);
    const mine = S.pages[p] && S.pages[p].strength >= 1;
    cells.push(`<div class="pc ${mine || known ? 'firm' : shaky ? 'warm' : ''}" title="p.${p} — ${esc(pageTitle(p))}"></div>`);
  }
  const months = {};
  PLAN.days.forEach((d) => { (months[d.date.slice(0, 7)] ||= []).push(d); });

  return `
  <section class="hero" style="padding:34px 0 6px"><div class="hero-scrim"></div>
    <div class="eyebrow"><span class="dot"></span>${esc(T('nav_journey'))} · 604 · ${PLAN.totalDays}</div>
    <h1 class="display">${esc(T('journey_title_1'))} <em>${esc(T('journey_title_2'))}</em></h1>
    <p class="lede">${esc(T('journey_lede'))}</p>
  </section>

  ${ownerCard()}

  <div class="stats">
    <div class="stat"><div class="k">${esc(T('stat_pages'))}</div><div class="v">${st.banked}<small>/604</small></div><div class="d">${st.pctBanked}%</div></div>
    <div class="stat"><div class="k">${esc(T('baseline_solid'))}</div><div class="v">${S.profile.solid.length}<small></small></div><div class="d">${esc(T('ar_shaky'))}: ${S.profile.shaky.length}</div></div>
    <div class="stat"><div class="k">${esc(T('learned_since'))}</div><div class="v">${st.learnedNew}<small></small></div><div class="d">${esc(T('sessions'))}: ${st.daysDone}</div></div>
    <div class="stat"><div class="k">${esc(T('khatm'))}</div><div class="v">${fmt(PLAN.khatmDate, { month: 'short' })}<small>${fmt(PLAN.khatmDate, { year: 'numeric' })}</small></div><div class="d">${PLAN.totalDays} ${esc(T('days'))}</div></div>
  </div>

  <div class="card">
    <div class="card-h"><h3>${esc(T('mushaf_map'))}</h3><div class="right">604</div></div>
    <div class="pagemap">${cells.join('')}</div>
    <div class="legend">
      <span><i style="background:var(--accent)"></i> ${esc(T('carried'))}</span>
      <span><i style="background:color-mix(in srgb,var(--accent) 45%,transparent)"></i> ${esc(T('needs_solder'))}</span>
      <span><i style="background:rgba(255,255,255,.06)"></i> ${esc(T('not_yet'))}</span>
    </div>
  </div>

  <div class="card" style="margin-top:16px">
    <div class="card-h"><h3>${esc(T('backup'))}</h3><div class="right">localStorage</div></div>
    <p class="note">${esc(T('backup_body'))}</p>
    <div class="row" style="margin-top:12px">
      <button class="btn sm" data-export>${esc(T('export'))}</button>
      <button class="btn sm ghost" data-import>${esc(T('import'))}</button>
      <input type="file" id="importFile" accept="application/json,.json" hidden>
      <button class="btn sm ghost" data-reset>${esc(T('reset'))}</button>
      <span class="note">${esc(T('backup_info', { sessions: Object.keys(S.days).length, pages: Object.keys(S.pages).length }))}</span>
    </div>
    <div class="row" style="margin-top:10px">
      <button class="btn sm" data-sync-out>${esc(T('sync_out'))}</button>
      <button class="btn sm ghost" data-sync-in>${esc(T('sync_in'))}</button>
      <span class="note">${esc(T('sync_note'))}</span>
    </div>
    <div id="syncBox"></div>
  </div>

  <div class="card" style="margin-top:16px">
    <div class="card-h"><h3>${esc(T('storage_title'))}</h3><div class="right">${isOwner() ? '✦ owner' : ''}</div></div>
    <div class="note storage-note">${T('storage_body').split('\n\n').map((par) => `<p>${esc(par)}</p>`).join('')}</div>
    ${isOwner() ? `<div class="row" style="margin-top:12px">
      <span class="badge ok">${esc(T('owner_badge'))}</span>
      <button class="btn sm ghost" data-owner-lock>${esc(T('owner_switch'))}</button>
      <button class="btn sm ghost" data-owner-panel>${esc(T('owner_code'))}</button>
    </div>` : ''}
  </div>

  <div class="section-head"><h2>${esc(T('month_by_month'))}</h2><p>${esc(T('month_note'))}</p></div>
  <div class="months">
    ${Object.entries(months).slice(0, 18).map(([k, days]) => `
      <div class="month">
        <h5><span>${new Date(k + '-15T12:00:00').toLocaleDateString(S.lang === 'ar' ? 'ar' : 'en-GB', { month: 'long', year: 'numeric' })}</span>
        <span>${days.filter((d) => dayStatus(d.date) === 'done').length}/${days.length}</span></h5>
        <div class="grid7">${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((x) => `<div class="dow">${x}</div>`).join('')}
        ${(() => { const first = parseISO(days[0].date).getDay(); const pad = (first + 6) % 7; return '<div></div>'.repeat(pad); })()}
        ${days.map((d) => `<div class="cell ${dayStatus(d.date)} ${d.date === t ? 'today' : ''} ${d.ramadan ? 'ram' : ''}" title="${fmt(d.date)}"></div>`).join('')}</div>
      </div>`).join('')}
  </div>`;
}

/* ============================================================
   PLAN
   ============================================================ */
function renderPlan() {
  const t = todayISO();
  const idx = dayIndex(t);
  const upcoming = PLAN.days.slice(idx, idx + 14);
  const cap = MishkatPlan.capacity(S.profile, anchorOf().budget);
  const weekly = Math.max(1, Math.round((anchorOf().budget - 12) / 33 * 5.5));

  return `
  <section class="hero" style="padding:34px 0 6px"><div class="hero-scrim"></div>
    <div class="eyebrow"><span class="dot"></span>${fmt(PLAN.start)} → ${fmt(PLAN.khatmDate)} · ${anchorOf().budget} ${esc(T('min'))}</div>
    <h1 class="display">${esc(T('plan_title_1'))} <em>${esc(T('plan_title_2'))}</em></h1>
    <p class="lede">${esc(T('plan_lede'))}</p>
  </section>

  <div class="two">
    <div class="card">
      <div class="card-h"><h3>${esc(T('arithmetic'))}</h3></div>
      <table style="width:100%;border-collapse:collapse;font-size:12.5px">
        <tr><td style="padding:7px 0;color:var(--muted)">${esc(T('summary_goal'))}</td><td style="text-align:end"><b>${PLAN.targetSize}${PLAN.wholeMushaf ? '' : ' ' + esc(T('pages_word'))}</b></td></tr>
        <tr><td style="padding:7px 0;color:var(--muted)">${esc(T('ar_solid'))}</td><td style="text-align:end"><b>${S.profile.solid.length}</b></td></tr>
        <tr><td style="padding:7px 0;color:var(--muted)">${esc(T('ar_shaky'))}</td><td style="text-align:end"><b>${PLAN.shakyCount || 0}</b></td></tr>
        <tr><td style="padding:7px 0;color:var(--muted)">${esc(T('ar_fresh'))}</td><td style="text-align:end"><b>${PLAN.queueLength}</b></td></tr>
        <tr><td style="padding:7px 0;color:var(--muted)">${esc(T('ar_budget'))}</td><td style="text-align:end"><b>${S.profile.budget} ${esc(T('min'))}</b></td></tr>
        <tr><td style="padding:7px 0;color:var(--muted)">${esc(T('ar_week'))}</td><td style="text-align:end"><b>~${weekly}</b></td></tr>
        <tr><td style="padding:7px 0;color:var(--muted)">${esc(T('ar_rot'))}</td><td style="text-align:end"><b>${PLAN.rotationAtKhatm} ${esc(T('days'))}</b></td></tr>
        <tr style="border-top:1px solid var(--line)"><td style="padding:9px 0">${esc(T('ar_khatm'))}</td><td style="text-align:end"><b style="color:var(--accent)">${fmt(PLAN.khatmDate)}</b></td></tr>
      </table>
      <p class="note" style="margin-top:12px">${esc(T('ar_note', { months: PLAN.months }))}</p>
      <div class="row" style="margin-top:14px">
        <button class="btn sm" data-edit-plan>${esc(T('edit_plan'))}</button>
        <span class="note">${esc(T('edit_plan_note'))}</span>
      </div>
    </div>

    <div class="card">
      <div class="card-h"><h3>${esc(T('more_time'))}</h3></div>
      <p class="note">${esc(T('more_time_note'))}</p>
      <table style="width:100%;border-collapse:collapse;font-size:12.5px;margin-top:10px">
        <tr><th style="text-align:start;color:var(--muted);font-weight:600;padding-bottom:8px">${esc(T('col_budget'))}</th>
        <th style="text-align:end;color:var(--muted);font-weight:600">${esc(T('col_khatm'))}</th>
        <th style="text-align:end;color:var(--muted);font-weight:600">${esc(T('col_rot'))}</th></tr>
        ${cap.map((c) => `<tr><td style="padding:6px 0">${c.budget} ${esc(T('min'))}</td><td style="text-align:end">${fmt(c.khatm, { month: 'short', year: 'numeric' })}</td><td style="text-align:end">${c.rotation}</td></tr>`).join('')}
      </table>
    </div>
  </div>

  <div class="section-head"><h2>${esc(T('phases'))}</h2></div>
  <div class="three">
    <div class="card hov"><div class="card-h"><h3>${esc(T('phase_0'))}</h3></div><p class="note">${T('phase_0_body')}</p></div>
    <div class="card hov"><div class="card-h"><h3>${esc(T('phase_1'))}</h3></div><p class="note">${T('phase_1_body')}</p></div>
    <div class="card hov"><div class="card-h"><h3>${esc(T('phase_2'))}</h3></div><p class="note">${T('phase_2_body')}</p></div>
  </div>

  <div class="section-head"><h2>${esc(T('next_14'))}</h2></div>
  <div class="list">
    ${upcoming.map((d) => `
      <div class="li">
        <div class="n">${fmtShort(d.date)}</div>
        <div class="t">${dayName(d.date)} · ${esc(d.type === 'new' ? T('sabaq') + ' ' + (d.new || []).length : d.type === 'reset' ? (d.solidify || []).length + ' × ' + T('sabqi') : d.type === 'weekly' ? T('weekly') || d.type : T('nav_review'))}
          ${(d.new || []).length ? `<span class="pp">· ${esc(pageTitle(d.new[0]))}</span>` : ''}</div>
        <div class="pp">${d.min.sabaq}/${d.min.sabqi}/${d.min.manzil}′</div>
        <div class="tag">${d.ramadan ? 'Ramadan' : 'S' + (d.stage || 1)}</div>
      </div>`).join('')}
  </div>

  <div class="section-head"><h2>${esc(T('ramadan_windows'))}</h2><p>${esc(T('ramadan_note'))}</p></div>
  <div class="row">
    ${MishkatPlan.RAMADAN.map(([a, b]) => `<span class="chip gold plain">${fmt(a, { day: 'numeric', month: 'short', year: 'numeric' })} → ${fmt(b, { day: 'numeric', month: 'short' })}</span>`).join('')}
  </div>`;
}

/* ============================================================
   METHOD
   ============================================================ */
function renderMethod() {
  const cards = [['m1', 'm1b'], ['m2', 'm2b'], ['m3', 'm3b'], ['m4', 'm4b'], ['m5', 'm5b'], ['m_trad', 'm_trad_b']];
  return `
  <section class="hero" style="padding:34px 0 6px"><div class="hero-scrim"></div>
    <div class="eyebrow"><span class="dot"></span>${esc(T('nav_method'))}</div>
    <h1 class="display">${esc(T('method_title_1'))} <em>${esc(T('method_title_2'))}</em></h1>
    <p class="lede">${esc(T('method_lede'))}</p>
  </section>
  <div class="two">
    ${cards.map(([h, b]) => `<div class="card"><div class="card-h"><h3>${esc(T(h))}</h3></div><p class="note">${T(b)}</p></div>`).join('')}
  </div>

  <div class="section-head"><h2>${esc(T('nonneg'))}</h2></div>
  <div class="three">
    <div class="card"><div class="card-h"><h3>${esc(T('n1'))}</h3></div><p class="note">${esc(T('n1b'))}</p></div>
    <div class="card"><div class="card-h"><h3>${esc(T('n2'))}</h3></div><p class="note">${esc(T('n2b'))}</p></div>
    <div class="card"><div class="card-h"><h3>${esc(T('n3'))}</h3></div><p class="note">${esc(T('n3b'))}</p></div>
  </div>

  <div class="section-head"><h2>${esc(T('good_day'))}</h2><p>${esc(T('good_day_note'))}</p></div>
  <div class="card">
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <tr><td style="padding:8px 0;color:var(--accent);width:140px"><b>${esc(T('sabaq'))}</b></td><td>${esc(T('sabaq_desc'))}</td></tr>
      <tr><td style="padding:8px 0;color:var(--accent)"><b>${esc(T('sabqi'))}</b></td><td>${esc(T('sabqi_desc'))}</td></tr>
      <tr><td style="padding:8px 0;color:var(--accent)"><b>${esc(T('manzil'))}</b></td><td>${esc(T('manzil_desc', { rot: PLAN.rotationAtKhatm }))}</td></tr>
      <tr><td style="padding:8px 0;color:var(--accent)"><b>${esc(T('task_salah'))}</b></td><td>${esc(T('task_salah'))}</td></tr>
    </table>
  </div>

  <div class="section-head"><h2>${esc(T('sources'))}</h2><p>${esc(T('sources_note'))}</p></div>
  <div class="card">
    <ul style="margin:0;padding-inline-start:18px;font-size:12.5px;line-height:2;color:var(--muted)">
      <li>Roediger &amp; Karpicke (2006), <em>Test-enhanced learning</em>, Psychological Science.</li>
      <li>Karpicke &amp; Roediger (2008), <em>The critical importance of retrieval for learning</em>, Science.</li>
      <li>Cepeda, Pashler, Vul, Wixted &amp; Rohrer (2006), <em>Distributed practice in verbal recall tasks</em>.</li>
      <li>Latimier, Peyre &amp; Ramus (2021), <em>A meta-analytic review of spaced retrieval practice</em>.</li>
      <li>Bjork &amp; Bjork, <em>Desirable difficulties in theory and practice</em>.</li>
      <li>Classical hifz pedagogy: Sabaq / Sabqi / Manzil, and the takrar repetition counts.</li>
      <li>Qur’an: Tanzil Uthmani (604 pages) · Sahih International · everyayah.com recitations.</li>
    </ul>
  </div>

  <div class="section-head"><h2>${esc(T('dua'))}</h2></div>
  <div class="card verse-card">
    <div class="verse-ar">${T('dua_ar')}</div>
    <p class="verse-tr">${esc(T('dua_tr'))}</p>
    <p class="note" style="text-align:center;margin-top:8px">${T('dua_note')}</p>
  </div>`;
}

/* ============================================================
   ROUTER
   ============================================================ */
const VIEWS = {
  today: renderToday, learn: renderLearn, drill: renderDrill, review: renderReview,
  journey: renderJourney, plan: renderPlan, method: renderMethod, catchup: renderCatchup, people: renderPeople
};

function render() {
  const app = $('#app');
  if ((view === 'onboard' || !S.profile) && view !== 'people') {
    app.innerHTML = onboardView();
    paintNav();
    const input = $('#obName');
    if (input && draft.step === 0) input.focus();
    return;
  }
  pauseForMissed();
  PLAN = PLAN || buildPlan();
  app.innerHTML = `${VIEWS[view]()}
    <footer><div>${esc(T('footer_a'))}</div><div>${esc(T('footer_b'))}</div></footer>`;
  paintNav();
  if (view === 'learn') { setMode('normal'); initMic(); }
  if (view === 'people' && cloudOn()) setTimeout(cloudCheck, 60);
}

function go(v, opts = {}) {
  view = v;
  if (S.profile) pauseForMissed();
  if (location.hash !== '#' + v) history.replaceState(null, '', '#' + v);
  if (opts.page) S.page = opts.page;
  window.scrollTo({ top: 0, behavior: 'smooth' });
  render();
}

/* ============================================================
   EVENTS
   ============================================================ */
const OB_SEL = '[data-ob-next],[data-ob-back],[data-ob-finish],[data-ob-lang],[data-ob-page],[data-ob-juz],[data-ob-surah],[data-ob-shaky],[data-ob-clear],[data-ob-all],[data-ob-budget],[data-ob-mode],[data-ob-pick],[data-ob-pickclear],[data-ob-exclude],[data-ob-open]';
const PERSON_SEL = '[data-person-open],[data-person-export],[data-person-del],[data-person-new],[data-person-restore],[data-cloud-save],[data-cloud-send],[data-cloud-verify],[data-cloud-push],[data-cloud-pull],[data-cloud-signout],[data-cloud-forget],[data-cloud-sqlcopy],[data-owner-go],[data-owner-close],[data-owner-lock],[data-owner-panel],[data-owner-start],[data-install-go],[data-install-hide]';
const CATCH_SEL = '[data-forget],[data-catchup],[data-skipcatch],[data-viewcatch]';
const SYNC_SEL = '[data-sync-out],[data-sync-in],[data-copy-sync],[data-apply-sync]';

/* hidden owner trigger: triple-click the logo mark, or tap the logo 7× within 3s */
let brandTaps = [];
document.addEventListener('click', (ev) => {
  const mark = ev.target.closest('.brand-mark');
  if (mark) {
    const now = Date.now();
    brandTaps.push(now);
    brandTaps = brandTaps.filter((t) => now - t < 3000);
    if (brandTaps.length >= 7) { brandTaps = []; ownerModal(false); }
    return;
  }
  if (ev.target.id === 'ownerModal') { ev.target.classList.remove('on'); return; }

  const el = ev.target.closest('[data-go],[data-theme],[data-scene],[data-autoplay],[data-lang-toggle],[data-page],[data-page-open],[data-mark],[data-tick],[data-mode],[data-pg],[data-play-page],[data-stop],[data-chunk-audio],[data-rate],[data-finish],[data-save-note],[data-tap-target],[data-tap-reset],[data-toggle-en],[data-audio-single],[data-play],[data-export],[data-import],[data-reset],[data-edit-plan],' + OB_SEL + ',' + PERSON_SEL + ',' + CATCH_SEL + ',' + SYNC_SEL);
  if (!el) return;

  /* ---- language */
  if (el.dataset.langToggle !== undefined) {
    S.lang = S.lang === 'ar' ? 'en' : 'ar';
    localStorage.setItem('mishkat.lang', S.lang);
    if (draft) draft.lang = S.lang;
    save(); shell(); applyTheme(); render();
    return;
  }

  /* ---- onboarding */
  if (el.dataset.obLang) {
    draft.lang = el.dataset.obLang; S.lang = el.dataset.obLang;
    localStorage.setItem('mishkat.lang', S.lang);
    shell(); applyTheme(); render(); return;
  }
  if (el.dataset.obPage) {
    const p = +el.dataset.obPage;
    const set = draft.step === 1 ? draft.picks : draft.step === 3 ? draft.shaky : draft.known;
    if (set.has(p)) set.delete(p); else set.add(p);
    if (draft.step === 1 && !draft.known.has(p)) draft.shaky.delete(p);
    render(); return;
  }
  if (el.dataset.obJuz) {
    const pages = JUZMAP[+el.dataset.obJuz];
    const set = draft.step === 1 ? draft.picks : draft.step === 3 ? draft.shaky : draft.known;
    const all = pages.every((p) => set.has(p));
    pages.forEach((p) => all ? set.delete(p) : set.add(p));
    render(); return;
  }
  if (el.dataset.obSurah) {
    const m = SURAHMAP[+el.dataset.obSurah];
    const set = draft.step === 1 ? draft.picks : draft.known;
    const all = m.pages.every((p) => set.has(p));
    m.pages.forEach((p) => all ? set.delete(p) : set.add(p));
    render(); return;
  }
  if (el.dataset.obMode) {
    const m = el.dataset.obMode;
    if (m === 'all') {
      draft.picks.clear(); draft.expanded.clear(); draft.startTouched = false;
      toast(T('goal_all_set'), 3000); render(); return;
    }
    if (m === 'juz') { draft.expanded.add('j'); }
    else if (m === 'surah') { draft.expanded.add('s'); }
    render(); return;   // picks are kept: changing the kind never throws work away
  }
  if (el.dataset.obOpen) {
    const key = el.dataset.obOpen;
    if (key === 'j' || key === 's') {          // "show the pages" for every group
      const prefix = key;
      const groups = prefix === 'j' ? Object.keys(JUZMAP || {}).map((j) => 'j' + j) : Object.values(SURAHMAP || {}).map((m) => 's' + m.n);
      const openAll = !groups.every((g) => draft.expanded.has(g));
      groups.forEach((g) => openAll ? draft.expanded.add(g) : draft.expanded.delete(g));
    } else if (draft.expanded.has(key)) draft.expanded.delete(key);
    else draft.expanded.add(key);
    render(); return;
  }
  if (el.dataset.obExclude) {
    const pages = String(el.dataset.obExclude).split(',').filter(Boolean).map(Number);
    pages.forEach((p) => draft.picks.delete(p));     // drop just this part, keep the rest
    draft.startTouched = false; render(); return;
  }
  if (el.dataset.obPick) {
    const kind = el.dataset.obKind || 'juz';
    const pages = kind === 'juz' ? (JUZMAP[+el.dataset.obPick] || []) : ((SURAHMAP[+el.dataset.obPick] || {}).pages || []);
    const all = pages.length && pages.every((p) => draft.picks.has(p));
    pages.forEach((p) => all ? draft.picks.delete(p) : draft.picks.add(p));
    draft.startTouched = false;
    render(); return;
  }
  if (el.dataset.obPickclear !== undefined) { draft.picks.clear(); render(); return; }
  if (el.dataset.obShaky) {
    const p = +el.dataset.obShaky;
    if (draft.shaky.has(p)) draft.shaky.delete(p); else draft.shaky.add(p);
    render(); return;
  }
  if (el.dataset.obClear !== undefined) { (draft.step === 1 ? draft.picks : draft.step === 3 ? draft.shaky : draft.known).clear(); render(); return; }
  if (el.dataset.obAll !== undefined) {
    const set = draft.step === 1 ? draft.picks : draft.known;
    for (let p = 1; p <= 604; p++) set.add(p);
    render(); return;
  }
  if (el.dataset.obBudget) { draft.budget = +el.dataset.obBudget; render(); return; }
  if (el.dataset.obBack !== undefined) { draft.step = Math.max(0, draft.step - 1); render(); return; }
  if (el.dataset.obNext !== undefined) {
    if (draft.step === 0) draft.name = ($('#obName')?.value || draft.name).trim();
    if (draft.step === 3) {
      S.profile = Object.assign({}, S.profile || {}, {
        budget: draft.budget,
        startPage: clamp(+($('#obStart')?.value || draft.startPage), 1, 604),
        solid: [...draft.known].sort((a, b) => a - b),
        shaky: [...draft.shaky].sort((a, b) => a - b),
        scope: draftScope(),
        start: (S.profile && S.profile.start) || todayISO()
      });
    }
    draft.step = Math.min(4, draft.step + 1);
    render(); return;
  }
  if (el.dataset.obFinish !== undefined) {
    S.profile = {
      name: draft.name.trim() || (S.lang === 'ar' ? 'صاحبي' : 'friend'),
      budget: draft.budget,
      startPage: clamp(+($('#obStart')?.value || draft.startPage), 1, 604),
      solid: [...draft.known].sort((a, b) => a - b),
      shaky: [...draft.shaky].sort((a, b) => a - b),
      scope: draftScope(),
      start: todayISO()
    };
    S.onboardStep = 0;
    S.skips = {};
    buildPlan(); save();
    go('today');
    toast(T('as_salam') + (S.profile.name ? ', ' + S.profile.name : '') + ' — ' + fmt(PLAN.khatmDate, { month: 'long', year: 'numeric' }), 4200);
    return;
  }

  /* ---- owner */
  if (el.dataset.ownerClose !== undefined) { $('.modal')?.classList.remove('on'); return; }
  if (el.dataset.ownerStart !== undefined) { ownerModal(false); return; }
  if (el.dataset.ownerGo !== undefined) {
    const val = ($('#ownerCode')?.value || '').trim();
    if (val === OWNER_CODE) { $('.modal')?.classList.remove('on'); unlockOwner(); }
    else { ownerModal(true); }
    return;
  }
  if (el.dataset.ownerLock !== undefined) {
    if (!confirm(S.lang === 'ar' ? 'تخرج من وضع المالك وتبدأ من الصفر؟ (تقدّمك يبقى محفوظًا في بيانات المتصفح)' : 'Leave owner mode and start fresh? (Your owner progress stays in this browser.')) return;
    lockOwner(); return;
  }
  if (el.dataset.ownerPanel !== undefined) {
    unlockOwner(); $('.modal')?.classList.remove('on'); return;
  }

  /* ---- sync code */
  if (el.dataset.syncOut !== undefined) {
    makeSyncCode().then((code) => {
      const box = $('#syncBox');
      if (box) box.innerHTML = `<div class="sync-box">
        <p class="note">${esc(T('sync_help'))}</p>
        <textarea id="syncText" rows="4" readonly>${esc(code)}</textarea>
        <div class="row" style="margin-top:8px">
          <button class="btn sm pri" data-copy-sync>${esc(T('sync_copy'))}</button>
          <span class="note">${code.length} ${S.lang === 'ar' ? 'حرفًا' : 'characters'}</span>
        </div></div>`;
    });
    return;
  }
  if (el.dataset.syncIn !== undefined) {
    const box = $('#syncBox');
    if (box) box.innerHTML = `<div class="sync-box">
      <p class="note">${esc(T('sync_help_in'))}</p>
      <textarea id="syncText" rows="4" placeholder="${esc(T('sync_ph'))}"></textarea>
      <div class="row" style="margin-top:8px"><button class="btn sm pri" data-apply-sync>${esc(T('sync_apply'))}</button></div></div>`;
    return;
  }
  if (el.dataset.copySync !== undefined) {
    const t = $('#syncText');
    if (t) { t.select(); navigator.clipboard?.writeText(t.value).catch(() => {}); document.execCommand && document.execCommand('copy'); toast(T('sync_copied'), 2600); }
    return;
  }
  if (el.dataset.applySync !== undefined) {
    const code = ($('#syncText')?.value || '').trim();
    if (!code) return toast(T('sync_ph'), 2600);
    readSyncCode(code).then((data) => {
      const st = data.state || data;
      if (!st || !st.days) throw new Error('bad code');
      S = Object.assign(defaultState(), st);
      save(); PLAN = null; shell(); applyTheme();
      if (S.profile) { buildPlan(); go('today'); } else startOnboarding();
      toast(T('sync_done'), 3400);
    }).catch(() => toast(T('sync_bad'), 4200));
    return;
  }

  /* ---- add to home screen */
  if (el.dataset.installGo !== undefined) {
    if (!installEvent) { toast(T('inst_unavailable'), 3600); return; }
    const ev = installEvent; installEvent = null;
    ev.prompt();
    ev.userChoice.then((choice) => {
      localStorage.setItem(INSTALL_WELCOME, '1');
      if (choice && choice.outcome === 'accepted') { localStorage.setItem(INSTALL_DONE, '1'); toast(T('inst_done'), 3600); }
      render();
    }).catch(() => render());
    return;
  }
  if (el.dataset.installHide !== undefined) {
    localStorage.setItem(INSTALL_WELCOME, '1');   // do not push it on Today again…
    render();                                     // …but keep it on the People page
    toast(T('inst_hidden'), 3600); return;
  }

  /* ---- cloud backup */
  if (el.dataset.cloudSqlcopy !== undefined) {
    const txt = CLOUD_SQL;
    navigator.clipboard?.writeText(txt).catch(() => {});
    const pre = $('#cloudSql'); if (pre) { const r = document.createRange(); r.selectNode(pre); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); }
    toast(T('sync_copied'), 2400);
    return;
  }
  if (el.dataset.cloudSave !== undefined) {
    const url = ($('#cloudUrl')?.value || '').trim();
    const anon = ($('#cloudAnon')?.value || '').trim();
    if (!/^https?:\/\//.test(url) || anon.length < 20) return toast(T('cl_err') + ': URL / key', 3200);
    MishkatSync.setCfg(url, anon);
    cloudProbe = null;
    toast(T('cl_saved'), 2600); render(); setTimeout(cloudCheck, 400); return;
  }
  if (el.dataset.cloudForget !== undefined) {
    if (!confirm(T('cl_disconnect') + '?')) return;
    MishkatSync.clearAll(); render(); return;
  }
  if (el.dataset.cloudSend !== undefined) {
    const em = ($('#cloudEmail')?.value || '').trim();
    if (!/.+@.+\..+/.test(em)) return toast(T('cl_err') + ': email', 2600);
    MishkatSync.sendCode(em).then(() => { cloudCodeShown = true; render(); toast(T('cl_sent'), 4200); })
      .catch((e) => toast(T('cl_err') + ': ' + String(e.message || e).slice(0, 90), 5200));
    return;
  }
  if (el.dataset.cloudVerify !== undefined) {
    const em = ($('#cloudEmail')?.value || '').trim();
    const code = ($('#cloudCode')?.value || '').trim();
    MishkatSync.verifyCode(em, code).then(async () => {
      cloudCodeShown = false;
      render();
      await cloudPull(true);        // take the cloud copy if this device is new
      await cloudPush(true);        // or push what this device has
      toast(T('cl_signed_as') + ' ' + em, 3600);
    }).catch((e) => toast(T('cl_err') + ': ' + String(e.message || e).slice(0, 90), 5200));
    return;
  }
  if (el.dataset.cloudPush !== undefined) { cloudPush(false); return; }
  if (el.dataset.cloudPull !== undefined) { cloudPull(false); return; }
  if (el.dataset.cloudSignout !== undefined) { MishkatSync.signOut(); render(); return; }

  /* ---- people in this browser */
  if (el.dataset.personOpen) { switchPerson(el.dataset.personOpen); toast(T('pp_switched'), 2800); return; }
  if (el.dataset.personNew !== undefined) {
    if (!confirm(S.lang === 'ar' ? 'تُضاف صفحة جديدة لشخص آخر على هذا المتصفح؟ ملفك الحالي يبقى كما هو.' : 'Add a new person to this browser? Your own record stays exactly as it is.')) return;
    createPerson('');
    startOnboarding();
    return;
  }
  if (el.dataset.personRestore !== undefined) {
    const snap = autoSnapshotOf(S.personId);
    if (!snap || !snap.state) return toast(T('pp_missing'), 3000);
    if (!confirm(S.lang === 'ar' ? 'تُستعاد نسخة اليوم التلقائية مكان بياناتك الحالية؟ تقدّم اليوم الحالي سيضيع.' : 'Restore today’s automatic snapshot over your current data? Anything done since then would be lost.')) return;
    const keepId = S.personId;
    S = Object.assign(defaultState(), snap.state);
    S.personId = keepId;
    PLAN = null; save(); shell(); applyTheme(); render();
    toast(T('pp_restored'), 3600);
    return;
  }
  if (el.dataset.personExport) {
    exportPerson(el.dataset.personExport);
    return;
  }
  if (el.dataset.personDel) {
    const id = el.dataset.personDel;
    const who = (peopleList().find((p) => p.id === id) || {}).name || '';
    if (!confirm(S.lang === 'ar' ? `تحذف ملف «${who}» من هذا المتصفح؟ لا رجعة — صدّر نسخة أولًا إن أردت.` : `Delete ${who}'s record from this browser? This cannot be undone — export a copy first if you might want it.`)) return;
    const next = deletePerson(id);
    if (next) switchPerson(next); else { S = defaultState(); shell(); applyTheme(); startOnboarding(); }
    toast(T('pp_deleted'), 3000);
    return;
  }

  /* ---- catch-up choices */
  if (el.dataset.catchup) {
    const choice = el.dataset.catchup;
    const state = catchupState();
    S.promptAt = state ? state.key : null;
    if (choice === 'carry') {
      rebalance();
      toast(T('cu_done_carry'), 4200);
    } else if (choice === 'pause') {
      // the calendar has already moved past the missed days; keep it moved and stay quiet
      go('today');
      toast(T('cu_done_pause'), 4200);
    } else if (choice === 'recover') {
      const target = state ? state.target : PLAN.khatmDate;
      const need = (state && state.need) || budgetFor(target);
      if (need) {
        const a = anchorOf();
        a.budget = need; if (S.profile) S.profile.budget = need;
        buildPlan(); save();
        toast(T('cu_done_recover', { n: need }), 4600);
      } else {
        rebalance();
        toast(T('cu_done_carry'), 4200);
      }
    } else if (choice === 'rebuild') {
      S.promptAt = null;
      rebalance();
      startOnboarding();
      return;
    }
    go('today');
    return;
  }
  if (el.dataset.skipcatch !== undefined) {
    const c = catchupState();
    if (c) { S.promptAt = c.key; save(); }
    render(); return;
  }
  if (el.dataset.forget) {
    const d = el.dataset.forget;
    if (!S.days[d]) S.days[d] = { sabaq: [], sabqi: 0, manzil: [], rating: 0, minutes: 0, note: '', finished: true };
    else S.days[d].finished = true;
    S.promptAt = null;
    pauseForMissed(); save(); render();
    toast(T('cu_filled'), 3200);
    return;
  }

  /* ---- navigation & chrome */
  if (el.dataset.go) {
    if (el.dataset.go === 'guide') { go('method'); return; }
    go(el.dataset.go, { page: el.dataset.pageOpen ? +el.dataset.pageOpen : null });
    return;
  }
  if (el.dataset.theme) { S.theme = el.dataset.theme; localStorage.setItem('mishkat.theme', S.theme); save(); applyTheme(); paintNav(); return; }
  if (el.dataset.scene) { S.scene = el.dataset.scene; localStorage.setItem('mishkat.scene', S.scene); save(); applyTheme(); paintNav(); return; }
  if (el.dataset.autoplay !== undefined) {
    S.autoplay = S.autoplay === false;
    localStorage.setItem('mishkat.autoplay', S.autoplay ? '1' : '0');
    save(); applyTheme(); paintNav(); return;
  }
  if (el.dataset.page) { go('learn', { page: +el.dataset.page }); return; }
  if (el.dataset.pageOpen) { go('learn', { page: +el.dataset.pageOpen }); return; }
  if (el.dataset.editPlan !== undefined) { startOnboarding(); return; }

  /* ---- marking */
  if (el.dataset.mark) {
    const t = todayISO(); const e = dayEntry(t); const s = session(t);
    if (el.dataset.mark === 'sabaq') {
      const set = (e.new && e.new.length ? e.new : e.solidify) || [];
      s.sabaq = [...set];
      set.forEach((p) => { S.pages[p] = { strength: Math.max(1, (S.pages[p] && S.pages[p].strength) || 0), last: t, src: 'new' }; });
    }
    if (el.dataset.mark === 'manzil') s.manzil = [...(e.manzil || [])];
    if (el.dataset.mark === 'sabqi') s.sabqi = 1;
    touchStreak(true); save(); toast(S.lang === 'ar' ? 'سُجّل. تقبّل الله.' : 'Logged. May Allah accept.'); render(); return;
  }
  if (el.dataset.tick) {
    const t = todayISO(); const e = dayEntry(t); const s = session(t);
    const kind = el.dataset.tick;
    if (kind === 'sabqi') s.sabqi = 1;
    else if (kind === 'manzilAll') s.manzil = [...(e.manzil || [])];
    else {
      const p = +el.dataset.p;
      const arr = kind === 'sabaq' ? s.sabaq : s.manzil;
      const i = arr.indexOf(p);
      if (i >= 0) arr.splice(i, 1);
      else { arr.push(p); S.pages[p] = { strength: Math.max(1, (S.pages[p] && S.pages[p].strength) || 0), last: t, src: (S.pages[p] && S.pages[p].src) || (kind === 'sabaq' ? 'new' : 'review') }; }
    }
    save(); render(); return;
  }

  /* ---- mushaf */
  if (el.dataset.mode) { setMode(el.dataset.mode); return; }
  if (el.dataset.pg) { S.page = clamp((S.page || 1) + +el.dataset.pg, 1, 604); render(); return; }
  if (el.dataset.playPage !== undefined) { audioPage(S.page); return; }
  if (el.dataset.stop !== undefined) { stopAudio(); return; }
  if (el.dataset.chunkAudio) {
    player.queue = el.dataset.chunkAudio.split(',').map((x) => ({ surah: +x.split(':')[0], n: +x.split(':')[1] }));
    player.idx = 0; player.repeat = parseInt($('#repeatRange')?.value || 3); playNext(); return;
  }
  if (el.dataset.play) { const [s, n] = el.dataset.play.split(':').map(Number); player.repeat = 1; playSingle(s, n); return; }
  if (el.dataset.toggleEn !== undefined) { S.showEn = !S.showEn; document.body.classList.toggle('show-en', S.showEn); save(); return; }
  if (el.dataset.audioSingle) { const m = el.dataset.audioSingle.match(/(\d+):(\d+)/); if (m) playSingle(+m[1], +m[2]); return; }

  /* ---- grading */
  if (el.dataset.rate) {
    const r = +el.dataset.rate; const t = todayISO(); const p = S.page;
    S.pages[p] = { strength: r, last: t, src: (S.pages[p] && S.pages[p].src) || 'new' };
    save();
    const msg = $('#rateMsg'); if (msg) msg.textContent = T('grade_msg_' + r);
    toast((S.lang === 'ar' ? 'قيّمت الصفحة ' : 'Page graded ') + p);
    return;
  }
  if (el.dataset.saveNote !== undefined) {
    const v = $('#weakNote')?.value?.trim(); if (!v) return toast(S.lang === 'ar' ? 'اكتب موضع التعثّر أولًا.' : 'Write the weak spot first.');
    session(todayISO()).note = v; save(); toast(S.lang === 'ar' ? 'حُفظ في سجل اليوم.' : 'Saved to today’s log.'); return;
  }
  if (el.dataset.finish !== undefined) {
    const t = todayISO(); const s = session(t);
    s.minutes = parseInt($('#minsIn')?.value || 0) || 0;
    s.rating = +($('#feelSel')?.value || 2);
    s.note = $('#noteIn')?.value || s.note;
    const de = dayEntry(t);
    ((de.new && de.new.length ? de.new : de.solidify) || []).forEach((p) => {
      S.pages[p] = { strength: Math.max(s.rating || 0, (S.pages[p] && S.pages[p].strength) || 0), last: t, src: 'new' };
    });
    session(t).finished = true;
    touchStreak(true); save();
    toast(S.lang === 'ar' ? 'أُغلق يومك. مواصلتك: ' + S.streak.count : 'Day sealed. Streak: ' + S.streak.count + ' days.', 3600);
    render(); return;
  }

  /* ---- takrar */
  if (el.dataset.tapTarget) { tap.target = +el.dataset.tapTarget; paintTap(); return; }
  if (el.dataset.tapReset) { tap.n = 0; paintTap(); return; }

  /* ---- backup */
  if (el.dataset.export !== undefined) {
    exportJSON(S, (S.profile && S.profile.name) || 'me');
    S.lastBackup = todayISO(); save();
    saveMeta(Object.assign(meta(), { lastExport: todayISO() }));
    toast(S.lang === 'ar' ? 'صُدّرت النسخة — ضعها في السحابة أو أرسلها لنفسك.' : 'Backup downloaded — drop it in Drive or message it to yourself.', 4200);
    return;
  }
  if (el.dataset.import !== undefined) { $('#importFile').click(); return; }
  if (el.dataset.reset !== undefined) {
    const who = (S.profile && S.profile.name) || T('pp_this');
    if (!confirm(S.lang === 'ar' ? `تمسح تقدّم «${who}» فقط، في هذا المتصفح؟ الملفات الأخرى تبقى.` : `Reset ${who}'s progress in this browser only? Other people's records are untouched.`)) return;
    const keepId = S.personId;
    S = defaultState();
    S.personId = keepId;
    PLAN = null; save(); shell(); applyTheme(); startOnboarding();
    return;
  }
});

/* inputs */
document.addEventListener('change', async (ev) => {
  if (ev.target.id === 'importFile' && ev.target.files && ev.target.files[0]) {
    try {
      const data = JSON.parse(await ev.target.files[0].text());
      const st = data.state || data;
      if (!st || !st.days) throw new Error('not a Mishkat backup');
      const id = uid();
      const idx = vaultIndex();
      idx.people.push({ id, name: (st.profile && st.profile.name) || data.name || '—', updatedAt: Date.now() });
      idx.active = id;
      vaultSaveIndex(idx);
      st.personId = id;
      writeJSON(V_PERSON(id), st);
      S = Object.assign(defaultState(), st);
      PLAN = null; shell(); applyTheme();
      if (S.profile) { buildPlan(); go('today'); } else startOnboarding();
      toast(T('pp_imported'), 4200);
    } catch (e) { toast((S.lang === 'ar' ? 'تعذّر قراءة الملف: ' : 'Could not read that file: ') + e.message, 4200); }
    ev.target.value = '';
  }
  if (ev.target.id === 'reciterSel') { S.reciter = ev.target.value; localStorage.setItem('mishkat.reciter', S.reciter); save(); }
  const cb = ev.target.closest('[data-task]');
  if (cb) { const t = todayISO(); session(t)[cb.dataset.task] = cb.checked ? 1 : 0; save(); touchStreak(dayStatus(t) === 'done'); save(); }
});

document.addEventListener('input', (ev) => {
  if (ev.target.id === 'repeatRange') { const v = +ev.target.value; player.repeat = v; const l = $('#repLbl'); if (l) l.textContent = v + '×'; }
  if (ev.target.id === 'speedRange') { const l = $('#spdLbl'); if (l) l.textContent = (ev.target.value / 100).toFixed(1) + '×'; }
  if (ev.target.id === 'pgJump') { const v = parseInt(ev.target.value); if (v >= 1 && v <= 604) { S.page = v; render(); } }
  if (ev.target.id === 'ownerCode') { /* handled on Enter below */ }
  if (ev.target.id === 'obStart') { draft.startPage = parseInt(ev.target.value) || 1; draft.startTouched = true; }
  if (ev.target.id === 'obName') { draft.name = ev.target.value; const b = $('[data-ob-next]'); if (b) b.disabled = !ev.target.value.trim(); }
});

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' && ev.target.id === 'ownerCode') {
    ev.preventDefault();
    const val = (ev.target.value || '').trim();
    if (val === OWNER_CODE) { $('.modal')?.classList.remove('on'); unlockOwner(); }
    else ownerModal(true);
  }
  if (ev.key === 'Escape') { $('.modal')?.classList.remove('on'); }
});

/* tap counter */
const tap = { n: 0, target: 10 };
function paintTap() {
  const c = $('#tapCount'), tg = $('#tapTarget'), ph = $('#tapPhase');
  if (!c) return;
  c.textContent = tap.n; tg.textContent = tap.target;
  ph.textContent = tap.n < tap.target / 2 ? T('phase_reading') : tap.n < tap.target ? T('phase_half') : T('phase_memory');
}
document.addEventListener('click', (ev) => {
  if (ev.target.id === 'tapBtn') { tap.n++; paintTap(); if (tap.n === tap.target) toast(T('clean')); }
});

/* ============================================================
   BOOT
   ============================================================ */
/* the mushaf's surah names carry Qur'anic marks (sukun U+06E1, dagger alif U+0670…)
   that most UI typefaces lack — strip them for titles/chips, keep the full text in the ayat */
const plainAr = (t) => String(t || '')
  .replace(/[\u0670\u06DF-\u06ED\u064B-\u0652]/g, '')
  .replace(/\u0671/g, '\u0627').trim();

function normalize(raw) {
  raw.pages.forEach((pg) => {
    pg.j = pg.j || pg.juz;
    pg.s = (pg.surahs || pg.s || []).map((s) => ({ n: s.n, ar: s.ar, arPlain: plainAr(s.ar), en: s.en, a: s.ayahs || s.a }));
  });
  return raw;
}
async function loadQuran() {
  const b64 = __QURAN_B64__;
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  if (typeof DecompressionStream !== 'function') throw new Error('This browser cannot decompress the embedded mushaf.');
  const stream = new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip'));
  return normalize(JSON.parse(await new Response(stream).text()));
}

(async function boot() {
  S.lang = localStorage.getItem('mishkat.lang') || S.lang;
  S.theme = localStorage.getItem('mishkat.theme') || S.theme;
  S.scene = localStorage.getItem('mishkat.scene') || S.scene;
  S.autoplay = localStorage.getItem('mishkat.autoplay') !== '0';
  S.reciter = localStorage.getItem('mishkat.reciter') || S.reciter;
  shell(); applyTheme();
  $('#app').innerHTML = `<div class="card" style="margin-top:60px"><p class="note">…</p></div>`;
  try {
    QURAN = await loadQuran();
    buildMaps();
    if (S.profile) { buildPlan(); view = (location.hash || '').replace('#', '') || 'today'; if (!VIEWS[view] && view !== 'onboard') view = 'today'; render(); }
    else startOnboarding();
    if (S.profile) autoSnapshot();
    if ((location.hash || '') === '#mishkat') { history.replaceState(null, '', location.pathname + location.search); ownerModal(); }
    window.addEventListener('hashchange', () => {
      const h = (location.hash || '').replace('#', '');
      if (h === 'mishkat') { history.replaceState(null, '', location.pathname + location.search); ownerModal(); return; }
      if (VIEWS[h] && S.profile && h !== view) { view = h; render(); }
    });
  } catch (e) {
    $('#app').innerHTML = `<div class="card" style="margin-top:60px"><h3>Could not load the mushaf</h3>
      <p class="note">${esc(e.message)} If you are viewing this in a sandboxed preview, download the file and open it in your browser.</p></div>`;
  }
})();
