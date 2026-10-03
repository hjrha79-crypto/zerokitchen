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

const RETRY_SRC = extractFn('_retryInvAudit');
const BTN_SRC = extractFn('_invAuditRetryBtn');

// ── MOCK db: items rows and kitchen_operations rows on a server.
// update / insert answer per mode: 'ok' | 'error' | 'reject' | 'throw' | 'lost' (applied on the server, then the
// response is lost = reject); kitchen_operations reads answer per `opsReadModes` ('ok' | 'error' | 'reject').
function makeDb(server, modes = {}, ops = []) {
  const writes = [];
  const reads = [];
  let nextOp = 1000;
  function builder(table) {
    let op = null, payload = null; const eqs = {};
    const mode = () => (op === 'update' ? (modes.update || []).shift() : op === 'insert' ? (modes.insert || []).shift() : null) || 'ok';
    let m = 'ok';
    const b = {
      select() { if (!op) op = 'select'; return b; }, maybeSingle() { return b; }, single() { return b; },
      order() { return b; }, limit() { return b; },
      eq(c, v) { eqs[c] = v; return b; },
      update(p) { op = 'update'; payload = p; writes.push({ table, op, payload: p }); m = mode(); if (m === 'throw') throw new Error('update threw'); return b; },
      insert(p) { op = 'insert'; payload = p; writes.push({ table, op, payload: p }); m = mode(); if (m === 'throw') throw new Error('insert threw'); return b; },
      then(resolve, reject) {
        if (op === 'select') {
          reads.push({ table, eqs: { ...eqs } });
          if (table === 'kitchen_operations') {
            const rm = (modes.opsRead || []).shift() || 'ok';
            if (rm === 'reject') return reject(new Error('read rejected'));
            if (rm === 'error') return resolve({ data: null, error: { message: 'read failed' } });
            const mine = ops.filter(o => o.store_id === eqs.store_id && o.item_id === eqs.item_id);
            return resolve({ data: mine.length ? [mine[mine.length - 1]] : [], error: null });   // newest first, limit 1
          }
          const row = server.find(r => r.item_id === eqs.item_id);
          return resolve({ data: row ? { current_qty: row.current_qty } : null, error: null });
        }
        if (m === 'reject') return reject(new Error('request rejected'));
        if (m === 'error') return resolve({ data: null, error: { message: op + ' failed' } });
        if (op === 'update' && table === 'items') { const row = server.find(r => r.item_id === eqs.item_id); if (row) Object.assign(row, payload); }
        if (op === 'insert' && table === 'kitchen_operations') ops.push({ operation_id: nextOp++, ...payload });
        if (m === 'lost') return reject(new Error('response lost'));
        resolve({ data: null, error: null });
      },
    };
    return b;
  }
  return { from: t => builder(t), _writes: writes, _reads: reads, _ops: ops };
}

function makeEl(drawn) {
  // a number input as the browser has it: value (what is shown) and defaultValue (the drawn value attribute)
  const cls = new Set();
  return { value: String(drawn), defaultValue: String(drawn), style: {}, classList: { toggle: (c, on) => (on ? cls.add(c) : cls.delete(c)), has: c => cls.has(c) } };
}

function makeEnv(memQty, opts = {}) {
  const server = [{ item_id: 21, current_qty: opts.serverQty === undefined ? memQty : opts.serverQty }, { item_id: 39, current_qty: 2 }];
  const db = makeDb(server, opts.modes || {}, opts.ops || []);
  const SID = 1;
  const _items = [{ item_id: 21, item_name: '마늘빵', unit: '박스', current_qty: memQty }, { item_id: 39, item_name: '칵테일냅킨', unit: '박스', current_qty: 2 }];
  const toasts = [];
  const showToast = t => toasts.push(t);
  let depletionInvalidations = 0;
  const _invalidateDepletionCache = () => { depletionInvalidations++; };
  // one inventory card for item 21 (where the retry button is placed), nothing else
  const card = { kids: [], classList: { toggle() {} }, querySelector: sel => sel === '[data-audit-retry]' ? (card.kids[0] || null) : sel === '.inv-qty-wrap' ? { insertAdjacentHTML: (w, h) => { if (h) card.kids.push({ html: h, remove: () => { card.kids.length = 0; } }); } } : null };
  const document = {
    getElementById: id => id === 'ic_21' ? card : null,
    querySelector: sel => (sel === '[data-audit-retry="21"]' ? card.kids[0] || null : null),
  };
  const console = { warn() {}, log() {}, error() {} };
  const setTimeout = () => 0;
  // the top-level state next to the functions in index.html, fresh per env
  const _invQtySaving = new Set();
  const _invAuditPending = new Map();
  const _invAuditRetrying = new Set();
  const _invAuditRetryBtn = eval(asExpr(BTN_SRC, '_invAuditRetryBtn'));
  const retry = eval(asExpr(RETRY_SRC, '_retryInvAudit'));
  const f = eval(asExpr(SAVE_SRC, '_saveInvQty'));
  void SID; void showToast; void _invalidateDepletionCache; void document; void console; void setTimeout; void _invQtySaving; void _invAuditRetrying;
  return { db, server, items: _items, toasts, save: f, retry, pending: _invAuditPending, card, btn: _invAuditRetryBtn, invalidations: () => depletionInvalidations };
}
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

  // ═══ AUDIT RETRY (stock saved, audit failed → retry the audit only) ═══
  const T32 = r => r.input_method === 'inv_card_edit' && r.action_type === 'stock_check' && r.qty_before === 3 && r.qty_after === 2;
  const failedSave = async (insertMode, opts = {}) => {
    const e = makeEnv(3, { ...opts, modes: { insert: [insertMode], ...(opts.modes || {}) } }); const el = makeEl(3);
    el.value = '2'; await e.save(21, el); return { e, el };
  };
  // A. audit {error} → pending holds the transition, retry button shown, partial message
  { const { e, el } = await failedSave('error');
    const p = e.pending.get(21);
    check('A audit error -> pending 3→2 (inv_card_edit, body kept), stock 2 persisted, retry button, partial message with [기록 다시 시도]',
      !!p && T32(p) && p.store_id === 1 && p.item_name === '마늘빵' && p.unit === '박스' && p.quantity === 2 && p.raw_text === '재고 3→2' &&
      e.server[0].current_qty === 2 && e.items[0].current_qty === 2 && el.defaultValue === '2' && e.card.kids.length === 1 && /data-audit-retry="21"/.test(e.card.kids[0].html) &&
      e.toasts.some(t => t.includes('[기록 다시 시도]')) && !e.toasts.some(SUCCESS), e.toasts.join(' | '));
    // B. retry → audit INSERT only, pending cleared, button removed
    await e.retry(21);
    check('B retry -> item write 0 more (still 1), exactly 1 audit row 3→2, pending cleared, button removed, "기록 저장 완료"',
      itemWrites(e) === 1 && e.db._ops.filter(T32).length === 1 && e.db._ops.length === 1 && !e.pending.has(21) && e.card.kids.length === 0 &&
      e.toasts.some(t => t.includes('재고 수정 기록 저장 완료 (3→2박스)')) && e.server[0].current_qty === 2 && e.items[0].current_qty === 2 && el.defaultValue === '2',
      `items=${itemWrites(e)} ops=${e.db._ops.length} ${e.toasts.join(' | ')}`);
    // I. after the retry, an unchanged blur writes nothing
    await e.save(21, el);
    check('I after retry success, unchanged blur -> write 0', itemWrites(e) === 1 && e.db._ops.length === 1);
    // J. the retried row is a general edit, never trusted
    check('J retried audit stays inv_card_edit (never trusted_stock_check)', e.db._ops.every(o => o.input_method === 'inv_card_edit')); }

  // C/D/E. the retry itself fails → pending kept, no false success, no item write, no revert; a later retry works
  for (const mode of ['error', 'reject', 'throw']) {
    const { e, el } = await failedSave('error', { modes: { insert: ['error', mode] } });
    let threw = null; try { await e.retry(21); } catch (x) { threw = x; }
    check(`${({ error: 'C', reject: 'D', throw: 'E' })[mode]} retry ${mode} -> no throw, pending kept, no row, no item write, stock stays 2, "아직 저장하지 못했습니다"`,
      threw === null && e.pending.has(21) && e.db._ops.length === 0 && itemWrites(e) === 1 && e.items[0].current_qty === 2 && e.server[0].current_qty === 2 && el.defaultValue === '2' &&
      e.card.kids.length === 1 && !e.toasts.some(t => t.includes('저장 완료')) && e.toasts.some(t => t.includes('아직 저장하지 못했습니다')), `${e.toasts.join(' | ')}${threw ? ' THREW ' + threw.message : ''}`);
    await e.retry(21);
    check(`retry again after ${mode} -> 1 row, pending cleared`, e.db._ops.filter(T32).length === 1 && !e.pending.has(21) && itemWrites(e) === 1);
  }
  // readback failure before the retry insert → nothing inserted, pending kept
  for (const rm of ['error', 'reject']) {
    const { e } = await failedSave('error', { modes: { opsRead: [rm] } });
    await e.retry(21);
    check(`retry readback ${rm} -> no insert, pending kept`, e.db._ops.length === 0 && e.pending.has(21) && auditWrites(e).length === 1);
  }

  // F. the first audit insert was stored but its response was lost → readback finds it, no second row
  { const { e } = await failedSave('lost');
    check('F response lost: stored row exists, pending created (client could not know)', e.db._ops.filter(T32).length === 1 && e.pending.has(21));
    await e.retry(21);
    check('F retry -> readback finds the stored 3→2, insert 0, exactly 1 row, pending cleared',
      auditWrites(e).length === 1 && e.db._ops.filter(T32).length === 1 && !e.pending.has(21) && e.toasts.some(t => t.includes('저장 완료')), `inserts=${auditWrites(e).length} rows=${e.db._ops.length}`); }
  // F2. an older identical transition (3→2, then 2→3) must not be mistaken for the lost one
  { const older = [{ operation_id: 1, store_id: 1, item_id: 21, action_type: 'stock_check', input_method: 'inv_card_edit', qty_before: 3, qty_after: 2 },
      { operation_id: 2, store_id: 1, item_id: 21, action_type: 'stock_check', input_method: 'inv_card_edit', qty_before: 2, qty_after: 3 }];
    const { e } = await failedSave('error', { ops: older.map(o => ({ ...o })) });
    await e.retry(21);
    check('F2 older identical 3→2 (followed by 2→3) is not taken as stored -> retry inserts the missing row', e.db._ops.filter(T32).length === 2 && e.db._ops.length === 3 && !e.pending.has(21));
    const l = await failedSave('lost', { ops: older.map(o => ({ ...o })) });
    await l.e.retry(21);
    check('F2 same history, response lost -> no duplicate (2 rows 3→2 total: old + this one)', l.e.db._ops.filter(T32).length === 2 && l.e.db._ops.length === 3 && !l.e.pending.has(21)); }

  // G. same item, new edit while its audit is pending → blocked, nothing written
  { const { e, el } = await failedSave('error');
    el.value = '1'; await e.save(21, el);
    check('G same item new edit while pending -> blocked: item write 0, audit 0, input back to 2, pending 3→2 kept, message',
      itemWrites(e) === 1 && auditWrites(e).length === 1 && el.value === '2' && e.items[0].current_qty === 2 && T32(e.pending.get(21)) &&
      e.toasts.some(t => t.includes('이전 재고 수정 기록 저장이 완료되지 않았습니다')), e.toasts.join(' | '));
    // H. a different item is still editable
    const el39 = makeEl(2); el39.value = '1'; await e.save(39, el39);
    check('H other item edit while 21 is pending -> allowed and saved (2→1)', e.server[1].current_qty === 1 && e.db._ops.some(o => o.item_id === 39 && o.qty_after === 1) && e.toasts.some(t => t === '칵테일냅킨: 2→1박스') && e.pending.has(21));
    // after the retry the same item can be edited again, in order
    await e.retry(21); el.value = '1'; await e.save(21, el);
    const rows21 = e.db._ops.filter(o => o.item_id === 21).map(o => `${o.qty_before}→${o.qty_after}`);
    check('after retry, the next edit of 21 saves; audit order 3→2 then 2→1', JSON.stringify(rows21) === '["3→2","2→1"]' && e.server[0].current_qty === 1, JSON.stringify(rows21)); }

  // double press on the retry button → one insert
  { const { e } = await failedSave('error');
    await Promise.all([e.retry(21), e.retry(21)]);
    check('retry pressed twice while running -> one insert', auditWrites(e).length === 2 && e.db._ops.length === 1); }
  // a success never leaves a pending entry or a button; the card renders the button only while pending
  { const e = makeEnv(3); const el = makeEl(3); el.value = '2'; await e.save(21, el);
    check('plain success -> no pending, no retry button', !e.pending.has(21) && e.card.kids.length === 0 && e.btn(21) === '');
    const { e: f } = await failedSave('error');
    check('retry button HTML only while pending; inventory card renders it', /onclick="_retryInvAudit\(21\)"/.test(f.btn(21)) && f.btn(39) === '' && /\$\{_invAuditRetryBtn\(it\.item_id\)\}/.test(extractFn('_renderInvCard'))); }

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
