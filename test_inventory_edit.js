/*
 * test_inventory_edit.js — ZEROKITCHEN_WEB_FIELD_DEFECT_BOUNDED_FIX_V0_1
 *
 * DEFECT A  inventory inline quantity edit (_saveInvQty)
 *   - only a value the user actually changed (vs the drawn baseline el.defaultValue) is written;
 *     a stale input whose memory moved on is never written back by a plain focus→blur
 *   - success ("이름: a→b단위") only after the items update AND the audit insert succeeded
 *   - update {error}/reject/throw: memory unchanged, no audit, input restored, retry possible
 *   - audit {error}/reject/throw: stock re-read, partial message, never the success text
 * DEFECT B  logo → Home goes through switchTab('input', homeNav): Home loaders run, hash = #home,
 *   developer 5-tap kept.
 *
 * REAL function bodies are extracted from index.html and run against a MOCK Supabase client and
 * a minimal DOM. No network — DB Write 0.
 */
const fs = require('fs');
const path = require('path');
const HTML = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

function extractFn(name) {
  let start = HTML.indexOf('async function ' + name + '(');
  if (start < 0) start = HTML.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('function not found: ' + name);
  let depth = 0, i = HTML.indexOf('{', start);
  for (; i < HTML.length; i++) { const c = HTML[i]; if (c === '{') depth++; else if (c === '}') { depth--; if (depth === 0) { i++; break; } } }
  return HTML.slice(start, i);
}
const asExpr = (src, name) => '(' + src.replace(new RegExp('^(async )?function ' + name), '$1function') + ')';
const SAVE_SRC = extractFn('_saveInvQty');
const SWITCH_SRC = extractFn('switchTab');
const INIT_SRC = extractFn('init');
const DEV_SRC = (/\(function initDevMode\(\) \{[\s\S]*?\n\}\)\(\);/.exec(HTML) || [''])[0];
const MAPS_SRC = (/const _tabHashMap = [^\n]*\nconst _hashTabMap = [^\n]*/.exec(HTML) || [''])[0];

let pass = 0, fail = 0;
function check(name, ok, detail = '') { if (ok) pass++; else fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); }

// ── MOCK db: items rows on a server; update / insert answer per mode ('ok' | 'error' | 'reject' | 'throw') ──
function makeDb(server, modes = {}) {
  const writes = [];
  const reads = [];
  function builder(table) {
    let op = null, payload = null; const eqs = {};
    const mode = () => (op === 'update' ? (modes.update || []).shift() : op === 'insert' ? (modes.insert || []).shift() : null) || 'ok';
    let m = 'ok';
    const b = {
      select() { if (!op) op = 'select'; return b; }, maybeSingle() { return b; }, single() { return b; },
      eq(c, v) { eqs[c] = v; return b; },
      update(p) { op = 'update'; payload = p; writes.push({ table, op, payload: p }); m = mode(); if (m === 'throw') throw new Error('update threw'); return b; },
      insert(p) { op = 'insert'; payload = p; writes.push({ table, op, payload: p }); m = mode(); if (m === 'throw') throw new Error('insert threw'); return b; },
      then(resolve, reject) {
        if (op === 'select') {
          reads.push({ table, eqs: { ...eqs } });
          const row = server.find(r => r.item_id === eqs.item_id);
          return resolve({ data: row ? { current_qty: row.current_qty } : null, error: null });
        }
        if (m === 'reject') return reject(new Error('request rejected'));
        if (m === 'error') return resolve({ data: null, error: { message: op + ' failed' } });
        if (op === 'update' && table === 'items') { const row = server.find(r => r.item_id === eqs.item_id); if (row) Object.assign(row, payload); }
        resolve({ data: null, error: null });
      },
    };
    return b;
  }
  return { from: t => builder(t), _writes: writes, _reads: reads };
}

function makeEl(drawn) {
  // a number input as the browser has it: value (what is shown) and defaultValue (the drawn value attribute)
  const cls = new Set();
  return { value: String(drawn), defaultValue: String(drawn), style: {}, classList: { toggle: (c, on) => (on ? cls.add(c) : cls.delete(c)), has: c => cls.has(c) } };
}

function makeEnv(memQty, opts = {}) {
  const server = [{ item_id: 21, current_qty: opts.serverQty === undefined ? memQty : opts.serverQty }];
  const db = makeDb(server, opts.modes || {});
  const SID = 1;
  const _items = [{ item_id: 21, item_name: '마늘빵', unit: '박스', current_qty: memQty }];
  const toasts = [];
  const showToast = t => toasts.push(t);
  let depletionInvalidations = 0;
  const _invalidateDepletionCache = () => { depletionInvalidations++; };
  const document = { getElementById: () => null };
  const console = { warn() {}, log() {}, error() {} };
  const setTimeout = () => 0;
  const f = eval(asExpr(SAVE_SRC.replace(/^async function _saveInvQty/, 'async function _saveInvQty'), '_saveInvQty'));
  // _invQtySaving is a top-level const next to the function in index.html
  void SID; void showToast; void _invalidateDepletionCache; void document; void console; void setTimeout;
  return { db, server, items: _items, toasts, save: f, invalidations: () => depletionInvalidations };
}
// the in-flight set lives at top level in index.html; give each eval scope one
const _invQtySaving = new Set();
const SUCCESS = t => /: [\d.]+→[\d.]+박스$/.test(t);
const itemWrites = e => e.db._writes.filter(w => w.table === 'items').length;
const auditWrites = e => e.db._writes.filter(w => w.table === 'kitchen_operations');

(async () => {
  // ═══ DEFECT A ═══
  // 1. unchanged focus → blur
  { const e = makeEnv(3); const el = makeEl(3);
    await e.save(21, el);
    check('1 unchanged focus→blur -> write 0, audit 0, toast 0', e.db._writes.length === 0 && e.toasts.length === 0); }

  // 2. the FIELD case: drawn 3, memory became 2, input still shows 3, focus→blur
  { const e = makeEnv(2); const el = makeEl(3);
    await e.save(21, el);
    check('2 stale drawn 3 + memory 2, focus→blur -> write 0, audit 0, toast 0, 2 not overwritten',
      e.db._writes.length === 0 && e.toasts.length === 0 && e.items[0].current_qty === 2 && e.server[0].current_qty === 2,
      `writes=${e.db._writes.length} mem=${e.items[0].current_qty} server=${e.server[0].current_qty}`); }

  // 3. actual edit 3 → 2
  { const e = makeEnv(3); const el = makeEl(3);
    el.value = '2'; await e.save(21, el);
    const a = auditWrites(e);
    check('3 edit 3→2 -> one item update, one audit (inv_card_edit 3→2), memory 2, success toast',
      itemWrites(e) === 1 && e.server[0].current_qty === 2 && a.length === 1 && a[0].payload.input_method === 'inv_card_edit' &&
      a[0].payload.qty_before === 3 && a[0].payload.qty_after === 2 && e.items[0].current_qty === 2 && e.toasts.length === 1 && SUCCESS(e.toasts[0]),
      e.toasts.join(' | '));
    // 4 + 12. baseline refreshed: a later unchanged blur writes nothing
    check('12 baseline refreshed after success (defaultValue = "2")', el.defaultValue === '2', el.defaultValue);
    await e.save(21, el);
    check('4 second blur unchanged -> no duplicate write', itemWrites(e) === 1 && auditWrites(e).length === 1 && e.toasts.length === 1);
    check('general edit is never the trusted marker', a[0].payload.input_method !== 'trusted_stock_check'); }

  // stale drawn 3, memory 2, user really types 5 -> saved; qty_before is the latest known stock (2)
  { const e = makeEnv(2); const el = makeEl(3);
    el.value = '5'; await e.save(21, el);
    check('stale input but a real edit (→5) -> saved, qty_before = memory 2', e.server[0].current_qty === 5 && auditWrites(e)[0].payload.qty_before === 2 && SUCCESS(e.toasts[0]), e.toasts.join(' | ')); }

  // "3" → "3.0" is not a change of quantity
  { const e = makeEnv(3); const el = makeEl(3); el.value = '3.0'; await e.save(21, el);
    check('same number re-typed ("3.0") -> write 0', e.db._writes.length === 0 && el.value === '3'); }

  // invalid input -> restored, write 0
  { const e = makeEnv(3); const el = makeEl(3); el.value = '-1'; await e.save(21, el);
    check('invalid (-1) -> write 0, input restored to 3', e.db._writes.length === 0 && el.value === '3' && el.defaultValue === '3', e.toasts.join(' | ')); }

  // 5–7. update failures
  for (const mode of ['error', 'reject', 'throw']) {
    const e = makeEnv(3, { modes: { update: [mode] } }); const el = makeEl(3);
    el.value = '2';
    let threw = null; try { await e.save(21, el); } catch (x) { threw = x; }
    check(`${({ error: 5, reject: 6, throw: 7 })[mode]} update ${mode} -> no throw, no success toast, no audit, memory 3, input restored to 3, failure shown`,
      threw === null && !e.toasts.some(SUCCESS) && auditWrites(e).length === 0 && e.items[0].current_qty === 3 && el.value === '3' && el.defaultValue === '3' &&
      e.toasts.some(t => t.includes('저장하지 못했습니다')), `${e.toasts.join(' | ')}${threw ? ' THREW ' + threw.message : ''}`);
    // 11. retry: the user types again and it saves
    el.value = '2'; await e.save(21, el);
    check(`11 retry after update ${mode} -> saved 2 with success`, e.server[0].current_qty === 2 && e.items[0].current_qty === 2 && SUCCESS(e.toasts[e.toasts.length - 1]), e.toasts.join(' | '));
  }

  // 8–10. audit failures
  for (const mode of ['error', 'reject', 'throw']) {
    const e = makeEnv(3, { modes: { insert: [mode] } }); const el = makeEl(3);
    el.value = '2';
    let threw = null; try { await e.save(21, el); } catch (x) { threw = x; }
    check(`${({ error: 8, reject: 9, throw: 10 })[mode]} audit ${mode} -> no throw, no success toast, stock re-read (2), partial message`,
      threw === null && !e.toasts.some(SUCCESS) && e.db._reads.length === 1 && e.items[0].current_qty === 2 && el.value === '2' && el.defaultValue === '2' &&
      e.toasts.some(t => t.includes('수정 기록을 남기지 못했습니다')), `${e.toasts.join(' | ')}${threw ? ' THREW ' + threw.message : ''}`);
    await e.save(21, el);
    check(`after audit ${mode}: an unchanged blur writes nothing more`, itemWrites(e) === 1);
  }

  // concurrent blur while a save is in flight -> one write
  { let release; const gate = new Promise(r => { release = r; });
    const e = makeEnv(3); const el = makeEl(3);
    const realFrom = e.db.from;
    e.db.from = t => { const b = realFrom(t); if (t === 'items') { const u = b.update; b.update = p => { const r = u(p); const th = r.then; r.then = (res, rej) => gate.then(() => th(res, rej)); return r; }; } return b; };
    el.value = '2';
    const p1 = e.save(21, el); const p2 = e.save(21, el);
    release(); await Promise.all([p1, p2]);
    check('blur again while saving -> one item update', itemWrites(e) === 1, `updates=${itemWrites(e)}`); }

  // ═══ DEFECT B ═══
  function makeNavEnv(hash, devModeStored = 'false') {
    const calls = { renderOrder: 0, notif: 0, refreshItems: 0, renderInventory: 0, observation: 0, switchTab: [] };
    const mk = id => { const s = new Set(); return { id, classList: { add: c => s.add(c), remove: c => s.delete(c), contains: c => s.has(c) }, style: {}, textContent: '' }; };
    const tabs = { input: mk('tab-input'), inventory: mk('tab-inventory'), settings: mk('tab-settings') };
    const navs = [mk('nav0'), mk('nav1'), mk('nav2')];
    const logo = mk('logoBtn');
    const devBody = mk('devToolsBody'); devBody.style.display = 'none';
    const els = { 'tab-input': tabs.input, 'tab-inventory': tabs.inventory, 'tab-settings': tabs.settings, logoBtn: logo, devToolsBody: devBody, devToolsToggle: mk('devToolsToggle'), reviewPanel: mk('reviewPanel') };
    const document = {
      getElementById: id => els[id] || null,
      querySelectorAll: sel => sel === '.tab' ? Object.values(tabs) : sel === '.nav' ? navs : [],
      querySelector: sel => sel === '.nav' ? navs[0] : null,
    };
    const location = { hash };
    const history = { replaceState: (a, b, h) => { location.hash = h; } };
    const store = { zk_dev_mode: devModeStored };
    const localStorage = { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } };
    const toasts = []; const showToast = t => toasts.push(t);
    const renderOrder = () => { calls.renderOrder++; };
    const renderV3Notifications = async () => { calls.notif++; };
    const refreshItems = async () => { calls.refreshItems++; };
    const renderInventory = () => { calls.renderInventory++; };
    const _loadObservation = () => { calls.observation++; };
    const _items = [];
    const setTimeout = () => 0, clearTimeout = () => {};
    const console = { error() {}, warn() {}, log() {} };
    const realSwitch = eval(asExpr(SWITCH_SRC, 'switchTab'));
    const switchTab = (n, btn) => { calls.switchTab.push(n); return realSwitch(n, btn); };
    eval(MAPS_SRC.replace(/const /g, 'var '));
    let _devTapCount = 0, _devTapTimer = null, _devMode = localStorage.getItem('zk_dev_mode') === 'true';
    eval(DEV_SRC);
    void renderOrder; void renderV3Notifications; void refreshItems; void renderInventory; void _loadObservation; void _items; void showToast; void history; void setTimeout; void clearTimeout; void console; void switchTab;
    const hashTabOnLoad = () => eval('_hashTabMap')[(location.hash || '').replace('#', '')];
    return { calls, tabs, navs, logo, location, store, toasts, devBody, devMode: () => _devMode, hashTabOnLoad,
      goInventory: () => realSwitch('inventory', navs[1]) };
  }
  const click = env => env.logo.onclick({ preventDefault() {} });

  { const env = makeNavEnv('#inventory');
    await env.goInventory();
    env.calls.renderOrder = 0; env.calls.notif = 0; env.calls.switchTab = [];
    click(env); await new Promise(r => setImmediate(r));
    check('13 inventory → logo -> switchTab("input", home nav) (canonical path)', env.calls.switchTab.length === 1 && env.calls.switchTab[0] === 'input' &&
      env.tabs.input.classList.contains('active') && !env.tabs.inventory.classList.contains('active') && env.navs[0].classList.contains('active') && !env.navs[1].classList.contains('active'),
      JSON.stringify(env.calls.switchTab));
    check('14 Home loaders run (renderOrder + notifications)', env.calls.renderOrder === 1 && env.calls.notif === 1, JSON.stringify(env.calls));
    check('15 hash #inventory -> #home', env.location.hash === '#home', env.location.hash);
    // 16. a refresh reads the hash in init: #home maps to the Home tab, so init keeps Home
    check('16 refresh after logo -> init restores Home (#home → input, no tab switch)', env.hashTabOnLoad() === 'input' && /if \(hashTab && hashTab !== 'input'\)/.test(INIT_SRC), env.hashTabOnLoad()); }

  // 17. developer 5-tap kept
  { const env = makeNavEnv('#home');
    for (let i = 0; i < 4; i++) click(env);
    const after4 = env.devMode();
    click(env);
    check('17 5 taps toggle developer mode ON (4 do not), stored, dev tools shown', after4 === false && env.devMode() === true && env.store.zk_dev_mode === 'true' &&
      env.devBody.style.display === 'block' && env.toasts.includes('🔧 개발자 모드 ON'), JSON.stringify({ after4, now: env.devMode(), toasts: env.toasts }));
    for (let i = 0; i < 5; i++) click(env);
    check('17 another 5 taps -> OFF', env.devMode() === false && env.store.zk_dev_mode === 'false' && env.devBody.style.display === 'none'); }

  // source: the logo handler no longer touches the tab DOM itself
  { const handler = (/logo\.onclick = \(e\) => \{([\s\S]*?)\n  \};/.exec(DEV_SRC) || [, ''])[1];
    check('logo handler: no direct tab/nav DOM switching, calls switchTab', /switchTab\('input', document\.querySelector\('\.nav'\)\)/.test(handler) && !/classList\.(add|remove)\('active'\)/.test(handler)); }

  console.log(`\nDB Write: 0 (mock client only, no network/supabase import)`);
  console.log(`RESULT: ${pass} PASS / ${fail} FAIL (of ${pass + fail})`);
  process.exit(fail ? 1 : 0);
})();
