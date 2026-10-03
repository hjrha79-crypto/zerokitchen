/*
 * test_inventory_count.js — ZEROKITCHEN_INVENTORY_COUNT_MODE_BOUNDED_BUILD_V0_1
 *
 * Three meanings of an inventory number, decided by what the person did:
 *   재고 점검 (count mode)   started once; every item actually counted → a physical observation
 *                            (TRUSTED_STOCK_CHECK, raw_text '재고 점검: 직접 센 수량'); same number recounted → a new one;
 *                            untouched items → nothing; 완료 → nothing written, nothing trusted in bulk
 *   기록 수정 (general edit)  inv_card_edit, never trusted (and it ends an earlier trust)
 *   재고 확인 (Home)          targeted re-check, TRUSTED_STOCK_CHECK '재고 확인: 직접 센 수량'
 * Trust is judged by the real _loadInventoryTrust / _inventoryTrustOf on the rows written.
 * REAL functions from index.html, MOCK Supabase client — no network, DB Write 0.
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
const NAMES = ['_saveInvQty', '_countModeSave', '_countCtl', '_renderCountBar', '_startCountMode', '_endCountMode',
  '_invAuditRetryBtn', '_retryInvAudit', '_loadInventoryTrust', '_inventoryTrustOf', '_trustedStockCheck'];
const SRC = Object.fromEntries(NAMES.map(n => [n, extractFn(n)]));
const COUNT_RAW = (/const COUNT_MODE_RAW_TEXT = '([^']+)';/.exec(HTML) || [])[1];
const MARKER = (/const TRUSTED_STOCK_CHECK = '([^']+)';/.exec(HTML) || [])[1];

let pass = 0, fail = 0;
function check(name, ok, detail = '') { if (ok) pass++; else fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); }

// ── MOCK db: items + kitchen_operations on a "server"; writes answer per mode list ('ok'|'error'|'reject'|'throw') ──
function makeDb(server, ops, modes = {}) {
  const writes = [];
  let clock = 0, nextOp = 5000;
  function builder(table) {
    let op = null, payload = null, m = 'ok'; const eqs = {}; let inF = null, gteF = null;
    const next = k => (modes[k] && modes[k].length ? modes[k].shift() : 'ok');
    const b = {
      select() { if (!op) op = 'select'; return b; }, order() { return b; }, limit() { return b; }, maybeSingle() { return b; },
      eq(c, v) { eqs[c] = v; return b; }, in(c, v) { inF = [c, v]; return b; }, gte(c, v) { gteF = [c, v]; return b; },
      update(p) { op = 'update'; payload = p; writes.push({ table, op, payload: p, eqs }); m = next('update'); if (m === 'throw') throw new Error('update threw'); return b; },
      insert(p) { op = 'insert'; payload = p; writes.push({ table, op, payload: p }); m = next('insert'); if (m === 'throw') throw new Error('insert threw'); return b; },
      then(resolve, reject) {
        if (op === 'select') {
          if (table === 'kitchen_operations') {
            let rows = ops.filter(o => Object.entries(eqs).every(([c, v]) => o[c] === v));
            if (inF) rows = rows.filter(o => inF[1].includes(o[inF[0]]));
            if (gteF) rows = rows.filter(o => o[gteF[0]] >= gteF[1]);
            return resolve({ data: rows.map(o => ({ ...o })), error: null });
          }
          const row = server.find(r => r.item_id === eqs.item_id);
          return resolve({ data: row ? { current_qty: row.current_qty } : null, error: null });
        }
        if (m === 'reject') return reject(new Error('request rejected'));
        if (m === 'error') return resolve({ data: null, error: { message: op + ' failed' } });
        if (op === 'update' && table === 'items') { const r = server.find(x => x.item_id === eqs.item_id); if (r) Object.assign(r, payload); }
        if (op === 'insert' && table === 'kitchen_operations') ops.push({ operation_id: nextOp++, created_at: `2026-10-04T10:${String(clock++).padStart(2, '0')}:00Z`, ...payload });
        resolve({ data: null, error: null });
      },
    };
    return b;
  }
  return { from: t => builder(t), _writes: writes };
}

const BASE_ITEMS = [
  { item_id: 1, item_name: '우유', unit: '박스', current_qty: 3, target_qty: 3 },
  { item_id: 21, item_name: '마늘빵', unit: '박스', current_qty: 2, target_qty: 2 },
  { item_id: 46, item_name: '위생장갑', unit: '개', current_qty: 1, target_qty: 2 },
  { item_id: 77, item_name: '스파게티니', unit: '개', current_qty: null, target_qty: 9 },
];
function makeInput(v) { const s = v === null || v === undefined ? '' : String(v); return { value: s, defaultValue: s, style: {}, classList: { toggle() {} } }; }

function makeEnv(opts = {}) {
  const server = BASE_ITEMS.map(i => ({ ...i }));
  const ops = opts.ops ? opts.ops.map(o => ({ ...o })) : [];
  const db = makeDb(server, ops, opts.modes || {});
  const SID = 1;
  let _items = BASE_ITEMS.map(i => ({ ...i }));
  const inputs = Object.fromEntries(_items.map(i => [i.item_id, makeInput(i.current_qty)]));
  const toasts = []; const showToast = t => toasts.push(t);
  const _invalidateDepletionCache = () => {};
  const bar = { innerHTML: '' };
  const ctls = {};
  const document = {
    getElementById: id => (id === 'invCountBar' ? bar : null),
    querySelector: sel => { const m = /\[data-count-iid="(\d+)"\]/.exec(sel); if (m) return ctls[m[1]] || (ctls[m[1]] = { outerHTML: '' }); return null; },
  };
  let renders = 0; const renderInventory = () => { renders++; };
  const console = { warn() {}, log() {}, error() {} };
  const setTimeout = () => 0;
  const prompt = () => opts.prompt ?? null;
  const refreshItems = async () => {}; const _renderOrderNeed = () => {};
  const TRUSTED_STOCK_CHECK = MARKER, COUNT_MODE_RAW_TEXT = COUNT_RAW;
  let _itemTrust = new Map();
  let _countMode = false, _countedIds = new Set(), _stockCheckBusy = false;
  const _countSaving = new Set(), _invQtySaving = new Set(), _invAuditPending = new Map(), _invAuditRetrying = new Set();
  const f = {};
  for (const n of NAMES) f[n] = eval(asExpr(SRC[n], n));
  // the functions call each other by name; give the eval scope those names
  const _countModeSave = f._countModeSave, _countCtl = f._countCtl, _renderCountBar = f._renderCountBar, _invAuditRetryBtn = f._invAuditRetryBtn,
    _inventoryTrustOf = f._inventoryTrustOf, _loadInventoryTrust = f._loadInventoryTrust;
  for (const n of NAMES) f[n] = eval(asExpr(SRC[n], n));
  void SID; void showToast; void _invalidateDepletionCache; void renderInventory; void console; void setTimeout; void prompt; void refreshItems; void _renderOrderNeed;
  void TRUSTED_STOCK_CHECK; void COUNT_MODE_RAW_TEXT; void _countSaving; void _invQtySaving; void _invAuditRetrying; void _stockCheckBusy;
  void _countModeSave; void _countCtl; void _renderCountBar; void _invAuditRetryBtn; void _inventoryTrustOf; void _loadInventoryTrust;
  return {
    f, db, ops, server, inputs, toasts, bar, renders: () => renders,
    get items() { return _items; }, item: id => _items.find(i => i.item_id === id),
    countMode: () => _countMode, counted: () => [..._countedIds], pending: _invAuditPending,
    trust: async () => { await f._loadInventoryTrust(); return _itemTrust; },
    // a user action on an input: type a value, then blur (the inline editor's onblur → _saveInvQty)
    type: async (id, v) => { inputs[id].value = String(v); await f._saveInvQty(id, inputs[id]); },
    same: async id => f._countModeSave(id, inputs[id], true),
  };
}
const rowsOf = (e, id) => e.ops.filter(o => o.item_id === id);
const trustedRow = r => r.input_method === MARKER && r.action_type === 'stock_check';
const itemWrites = e => e.db._writes.filter(w => w.table === 'items').length;

(async () => {
  check('marker reused: count mode writes the existing trusted marker, raw_text "재고 점검: 직접 센 수량"', MARKER === 'trusted_stock_check' && COUNT_RAW === '재고 점검: 직접 센 수량');

  // A. start → context shown, per-item control shown, nothing written
  { const e = makeEnv();
    e.f._renderCountBar();
    const idle = e.bar.innerHTML;
    e.f._startCountMode();
    e.f._renderCountBar();
    check('A start -> bar "재고 점검 중 — 실제로 센 수량만 입력해 주세요" + [재고 점검 완료]; before: "기록만 수정됩니다" + [재고 점검 시작]',
      e.countMode() && e.bar.innerHTML.includes('재고 점검 중 — 실제로 센 수량만 입력해 주세요') && e.bar.innerHTML.includes('재고 점검 완료') &&
      idle.includes('수량을 고치면 기록만 수정됩니다') && idle.includes('재고 점검 시작') && e.renders() === 1 && e.db._writes.length === 0);
    check('A card control in count mode: [그대로 맞음] for a recorded stock, none for an unknown stock; nothing outside count mode',
      e.f._countCtl(e.item(21)).includes('그대로 맞음') && !e.f._countCtl(e.item(77)).includes('그대로 맞음') && /\$\{_countCtl\(it\)\}/.test(extractFn('_renderInvCard')));
    const g = makeEnv(); check('A outside count mode the card has no count control', g.f._countCtl(g.item(21)) === ''); }

  // B. count mode, 3 → 2 typed → physical observation, trusted
  { const e = makeEnv(); e.f._startCountMode();
    await e.type(1, 2);
    const r = rowsOf(e, 1);
    const t = (await e.trust()).get(1);
    check('B count 3→2 -> items 2, one trusted row (qty 3→2, raw "재고 점검"), trusted at 2, "점검 기록"',
      e.server[0].current_qty === 2 && r.length === 1 && trustedRow(r[0]) && r[0].qty_before === 3 && r[0].qty_after === 2 && r[0].quantity === 2 && r[0].unit === '박스' &&
      r[0].raw_text === COUNT_RAW && t && t.trusted && t.lastQty === 2 && e.counted().includes(1) && e.toasts.some(x => x === '우유 2박스 점검 기록'), JSON.stringify({ r, t, toasts: e.toasts })); }

  // C. same number recounted → a new observation each time
  { const e = makeEnv(); e.f._startCountMode();
    await e.same(21);
    const r = rowsOf(e, 21);
    const t = (await e.trust()).get(21);
    check('C [그대로 맞음] on 2 -> one trusted row 2→2, trusted at 2', r.length === 1 && trustedRow(r[0]) && r[0].qty_before === 2 && r[0].qty_after === 2 && t && t.trusted && t.lastQty === 2, JSON.stringify(r));
    await e.same(21);
    check('C recounting the same number again -> a second observation (new row)', rowsOf(e, 21).length === 2 && rowsOf(e, 21).every(trustedRow));
    // outside count mode the same number writes nothing
    const g = makeEnv(); await g.type(21, 2);
    check('C general edit with the same number -> write 0', g.db._writes.length === 0); }

  // D. enter count mode, touch nothing (focus → blur on every row)
  { const e = makeEnv(); e.f._startCountMode();
    for (const id of [1, 21, 46, 77]) await e.f._saveInvQty(id, e.inputs[id]);
    check('D count mode, rows only focused/blurred -> write 0', e.db._writes.length === 0 && e.counted().length === 0);
    for (const id of [1, 21, 46]) await e.f._countModeSave(id, e.inputs[id], false);
    check('D the count save itself refuses an untouched row (write 0)', e.db._writes.length === 0); }

  // E. 3 items in the list, 2 counted → only those 2
  { const e = makeEnv(); e.f._startCountMode();
    await e.type(1, 1); await e.same(46);
    const tr = await e.trust();
    check('E 2 of 3 counted -> 2 rows, 2 trusted, the untouched item (마늘빵) unchanged and untrusted',
      e.ops.length === 2 && tr.get(1)?.trusted && tr.get(46)?.trusted && !tr.has(21) && e.server[1].current_qty === 2 && itemWrites(e) === 2, JSON.stringify([...tr.keys()])); }

  // F. partial failure: one update fails, one audit fails, one succeeds
  { const e = makeEnv({ modes: { update: ['ok', 'error', 'ok'], insert: ['ok', 'reject'] } }); e.f._startCountMode();
    await e.type(1, 1);        // ok
    await e.type(21, 5);       // update error
    await e.type(46, 4);       // update ok, audit rejected
    let tr = await e.trust();
    check('F partial: 우유 trusted; 마늘빵 update failed -> no row, input back to 2, untrusted; 위생장갑 stock 4 saved but no row -> untrusted',
      tr.get(1)?.trusted && !tr.has(21) && rowsOf(e, 21).length === 0 && e.inputs[21].value === '2' && e.server[1].current_qty === 2 &&
      !tr.has(46) && e.server[2].current_qty === 4 && rowsOf(e, 46).length === 0 && JSON.stringify(e.counted()) === '[1]' &&
      e.toasts.some(t => t.includes('마늘빵: 점검 수량을 저장하지 못했습니다')) && e.toasts.some(t => t.includes('위생장갑: 재고는 4개로 저장됐지만 점검 기록을 남기지 못했습니다')) &&
      !e.toasts.some(t => t.startsWith('마늘빵 ') || t.startsWith('위생장갑 ')), e.toasts.join(' | '));
    await e.type(21, 5); await e.same(46);
    tr = await e.trust();
    check('F retry: 마늘빵 typed again and 위생장갑 [그대로 맞음] -> both trusted', tr.get(21)?.trusted && tr.get(21).lastQty === 5 && tr.get(46)?.trusted && tr.get(46).lastQty === 4 && e.counted().length === 3); }
  for (const mode of ['reject', 'throw']) {
    const e = makeEnv({ modes: { update: [mode] } }); e.f._startCountMode();
    let threw = null; try { await e.type(1, 1); } catch (x) { threw = x; }
    check(`F update ${mode} -> no throw, nothing written, not counted`, threw === null && e.ops.length === 0 && e.server[0].current_qty === 3 && e.counted().length === 0);
  }

  // G. 완료 → no bulk write, no bulk trust
  { const e = makeEnv(); e.f._startCountMode();
    await e.type(1, 2);
    const before = e.db._writes.length;
    e.f._endCountMode();
    const tr = await e.trust();
    check('G 완료 -> no write, only the counted item trusted, mode off, "실제로 센 품목 1개"',
      e.db._writes.length === before && !e.countMode() && tr.size === 1 && tr.get(1)?.trusted && e.toasts.includes('재고 점검 완료 — 실제로 센 품목 1개'));
    e.inputs[21].value = '1'; await e.f._saveInvQty(21, e.inputs[21]);
    check('G after 완료, a changed number is a 기록 수정 again (inv_card_edit)', rowsOf(e, 21)[0]?.input_method === 'inv_card_edit'); }

  // H. general edit = correction
  { const e = makeEnv();
    await e.type(1, 2);
    const r = rowsOf(e, 1)[0];
    const tr = await e.trust();
    check('H general edit 3→2 -> inv_card_edit "재고 3→2", not trusted', r && r.input_method === 'inv_card_edit' && r.raw_text === '재고 3→2' && !tr.has(1));
    const c = makeEnv(); c.f._startCountMode(); await c.type(1, 2); c.f._endCountMode();
    await c.type(1, 1);
    check('H a correction after a count ends that trust (continuity unchanged)', (await c.trust()).get(1)?.trusted === false); }

  // I. Home targeted re-check stays the explicit trusted path
  { const e = makeEnv({ prompt: '2' });
    await e.f._trustedStockCheck(21);
    const r = rowsOf(e, 21)[0];
    check('I Home [재고 확인] -> trusted_stock_check "재고 확인: 직접 센 수량", trusted', r && trustedRow(r) && r.raw_text === '재고 확인: 직접 센 수량' && (await e.trust()).get(21)?.trusted); }

  // J. historical table_review / fast_path rows are not trust
  { const hist = [
      { operation_id: 1, store_id: 1, item_id: 21, created_at: '2026-05-13T00:00:00Z', action_type: 'stock_check', qty_before: 3, qty_after: 2, input_method: 'table_review', raw_text: '마늘빵 2박스' },
      { operation_id: 2, store_id: 1, item_id: 1, created_at: '2026-05-13T00:00:00Z', action_type: 'stock_check', qty_before: 1, qty_after: 3, input_method: 'fast_path', raw_text: '우유 3' }];
    const e = makeEnv({ ops: hist });
    const tr = await e.trust();
    check('J historical table_review / fast_path -> no trust', tr.size === 0);
    const rule = e.f._inventoryTrustOf(2, [hist[0]]);
    check('J the trust rule itself: a table_review observation is not a trust basis', rule.trusted === false && rule.reason === 'NO_TRUST_BASIS', JSON.stringify(rule));
    e.f._startCountMode(); e.f._endCountMode();
    check('J entering and leaving count mode does not promote them', (await e.trust()).size === 0 && e.db._writes.length === 0); }

  // cross-surface: the body Android's buildTrustedStockCheckInsert(…, COUNT_MODE_RAW_TEXT) writes, read here
  { const androidRow = { operation_id: 9, store_id: 1, item_id: 46, item_name: '위생장갑', action_type: 'stock_check', quantity: 1, unit: '개',
      qty_before: 1, qty_after: 1, input_method: 'trusted_stock_check', raw_text: '재고 점검: 직접 센 수량', created_at: '2026-10-04T09:00:00Z' };
    const e = makeEnv({ ops: [androidRow] });
    const t = (await e.trust()).get(46);
    check('an Android count-mode row is read as trusted here', t && t.trusted && t.lastQty === 1); }

  // guards
  { const e = makeEnv(); e.f._startCountMode();
    e.item(21).current_qty = 4;           // memory moved on; the card still shows 2
    await e.same(21);
    check('stale card: [그대로 맞음] while the record changed -> write 0, card refreshed to 4', e.db._writes.length === 0 && e.inputs[21].value === '4' && e.toasts.some(t => t.includes('기록이 바뀌었습니다')));
    await e.same(77);
    check('unknown stock: [그대로 맞음] writes nothing (UNKNOWN is not 0)', e.db._writes.length === 0 && e.toasts.some(t => t.includes('기록된 재고가 없습니다')));
    await e.type(77, 0);
    const r = rowsOf(e, 77)[0];
    check('unknown stock counted as 0 by typing -> trusted row qty_before null → 0', r && trustedRow(r) && r.qty_before === null && r.qty_after === 0); }
  { const e = makeEnv(); e.f._startCountMode();
    e.inputs[21].value = '9';
    await e.same(21);
    check('[그대로 맞음] with a typed number still in the field -> ignored (the typed number is saved by its blur)', e.db._writes.length === 0); }
  { const e = makeEnv(); e.f._startCountMode();
    e.inputs[1].value = '-1'; await e.f._saveInvQty(1, e.inputs[1]);
    e.inputs[46].value = '1e3'; await e.f._saveInvQty(46, e.inputs[46]);
    check('invalid counts (-1, 1e3) -> write 0, inputs restored', e.db._writes.length === 0 && e.inputs[1].value === '3' && e.inputs[46].value === '1'); }
  { const e = makeEnv(); e.f._startCountMode();
    await Promise.all([e.same(21), e.same(21)]);
    check('[그대로 맞음] pressed twice while saving -> one observation', rowsOf(e, 21).length === 1); }
  { const e = makeEnv({ modes: { insert: ['error'] } });
    await e.type(21, 1);                     // general edit: audit fails → pending
    e.f._startCountMode(); await e.same(21);
    check('a pending 기록 수정 audit blocks counting that item until retried', rowsOf(e, 21).length === 0 && e.pending.has(21) && e.toasts.some(t => t.includes('[기록 다시 시도]'))); }

  console.log(`\nDB Write: 0 (mock client only, no network/supabase import)`);
  console.log(`RESULT: ${pass} PASS / ${fail} FAIL (of ${pass + fail})`);
  process.exit(fail ? 1 : 0);
})();
