/*
 * test_open_supply.js — Verified Open Supply, Web client (v0.3 authority + delete atomicity)
 *
 * The app READS the server's supply truth (get_order_supply / get_open_supply). It has no identity the server
 * could trust (publishable key only), so it calls NO supply writer, sends no actor, and — once the server has the
 * feature — does not receive either (complete_order_receiving is trusted-backend only): the receive rows are read
 * only. Every real order is its own row. Item delete / duplicate merge / replace are ONE server transaction each
 * (delete_item_safely / merge_duplicate_items): the app no longer deletes in several requests, and a failure or a
 * history-bearing item changes nothing. Server semantics: migration-packages/verified-open-supply-001/tests.
 * REAL functions from index.html, MOCK db — DB Write 0.
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
const constLine = name => (new RegExp(`const ${name} = [^\\n]+`).exec(HTML) || [''])[0];
const ROWS_SRC = HTML.slice(HTML.indexOf('    // 1) pending → 표에 표시'), HTML.indexOf('    // 3) suggestItems → 칩으로'));
const FNS = ['_loadOrderSupply', '_isVerifiedOrder', '_openSupplyLabel', '_orderIdentity', '_receiveItemHtml', 'markReceived', '_receivingOutcome',
  'cancelOrder', '_tblDeleteRow', '_deleteItemAndCleanup', '_mergeItemsOnServer', '_mergeDup', '_replaceDup', '_mergeAllDups'];
const WRITERS = ['confirm_order_supply', 'receive_order_supply', 'cancel_order_supply', 'fail_order_supply', 'set_order_supply_health', 'confirm_supply_coverage', 'zk_receive_core'];

let pass = 0, fail = 0;
function check(name, ok, detail = '') { if (ok) pass++; else fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? '  — ' + detail : ''}`); }

function makeEnv({ orderSupply = [], openSupply = [], failRead = false, orders = [], rpc = {}, items } = {}) {
  const calls = [];
  const db = {
    async rpc(name, args) {
      calls.push({ rpc: name, args: JSON.parse(JSON.stringify(args)) });
      if (name === 'get_order_supply') return failRead ? { data: null, error: { message: 'Could not find the function' } } : { data: orderSupply, error: null };
      if (name === 'get_open_supply') return failRead ? { data: null, error: { message: 'Could not find the function' } } : { data: openSupply, error: null };
      const a = rpc[name];
      if (typeof a === 'function') return a(args);
      if (a !== undefined) return a;
      return { data: null, error: { message: `Could not find the function public.${name}` } };
    },
    from(table) {
      let op = 'select'; const eqs = {};
      const b = {
        select() { return b; }, limit() { return b; }, eq(c, v) { eqs[c] = v; return b; },
        delete() { op = 'delete'; return b; }, update() { op = 'update'; return b; }, insert() { op = 'insert'; return b; },
        then(res) { calls.push(op === 'select' ? { read: table } : { write: table, op, eqs: { ...eqs } }); return res({ data: [], error: null }); },
      };
      return b;
    },
  };
  const SID = 1, toasts = []; const showToast = t => toasts.push(t); let _storeEpoch = 0; const _storeChanged = ep => ep !== _storeEpoch;   // store switch guard (index.html)
  let answers = []; const confirm = () => (answers.length ? answers.shift() : true);
  const _vendors = [];
  let _orderRequests = orders.map(o => ({ ...o }));
  let _items = items || [{ item_id: 10, item_name: '우유', unit: '박스', current_qty: 2 }, { item_id: 11, item_name: '우유', unit: '박스', current_qty: 3 }];
  const aliases = [];
  const _invalidateDepletionCache = () => {}, _dismissedItemIds = new Set(), _updateOrderCount = () => {}, _updateTextOrderCache = () => {};
  const _renderOrderNeed = () => {}, _onOrderPatternUpdate = () => {}, _removeOrderRow = () => {}, renderInventory = () => {}, _showDupCleanup = () => {};
  const _saveAlias = (a, b) => aliases.push([a, b]);
  const document = { querySelector: () => null };
  const console = { warn() {}, log() {}, error() {} };
  let _orderSupply = new Map(), _openSupply = new Map(), _supplyAvailable = false;
  const _writerReady = false;   // no login / writer not ready → read only (the writer side: test_human_writer.js)
  for (const c of ['_fmtQty', '_VERIFIED_ORDER_LOCKED_MSG', '_RECEIVE_LOCKED_MSG', '_DELETE_HISTORY_MSG', '_DELETE_UNAVAILABLE_MSG']) eval(constLine(c).replace('const ', 'var '));
  const f = {};
  for (let k = 0; k < 2; k++) {
    for (const n of FNS) f[n] = eval(asExpr(extractFn(n), n));
    // eslint-disable-next-line no-unused-vars
    var _loadOrderSupply = f._loadOrderSupply, _isVerifiedOrder = f._isVerifiedOrder, _openSupplyLabel = f._openSupplyLabel, _orderIdentity = f._orderIdentity,
      _receivingOutcome = f._receivingOutcome, _deleteItemAndCleanup = f._deleteItemAndCleanup, _mergeItemsOnServer = f._mergeItemsOnServer;
  }
  const buildRows = (pendingItems, orderedItems) => {
    const _pendingItems = pendingItems, _orderedItems = orderedItems;
    const _pendingRows = [], _orderedRows = [], _seenIds = new Set();
    eval(ROWS_SRC);
    return { _pendingRows, _orderedRows };
  };
  void SID; void showToast; void confirm; void _vendors; void _invalidateDepletionCache; void _dismissedItemIds; void _updateOrderCount; void _updateTextOrderCache;
  void _renderOrderNeed; void _onOrderPatternUpdate; void _removeOrderRow; void renderInventory; void _showDupCleanup; void document; void console; void _fmtQty;
  return { f, calls, toasts, aliases, buildRows, answer: (...a) => { answers = a; }, available: () => _supplyAvailable, items: () => _items,
    row: (id, name = '우유', qty = 10, unit = '박스', created_at = '2026-10-04T04:05:00Z', item_id = 10) => f._receiveItemHtml({ order_id: id, item_id, name, orderQty: qty, unit, created_at }) };
}
const ORDER = id => ({ id, item_id: 10, item_name: '우유', qty: 10, unit: '박스', status: 'ordered', vendor_id: null, created_at: '2026-10-04T04:05:00Z' });
const sup = (o = {}) => ({ order_id: 1, item_id: 10, status: 'ordered', verified: true, verification: 'HUMAN_CONFIRMED', ordered_qty: 10, unit: '박스',
  accepted_qty: 0, remaining_qty: 10, outcome: 'OPEN', health: 'HEALTHY', order_state: 'OPEN', conflict_reason: null, ...o });
const writes = e => e.calls.filter(c => c.write);

(async () => {
  // ── reads, labels ─────────────────────────────────────────────────────────────────
  for (const [state, extra, expect] of [
    ['NONE_CONFIRMED', { known_healthy_open_qty: 0, total_open_qty: 0 }, '진행 중 주문 없음(확인됨)'],
    ['VERIFIED_OPEN', { known_healthy_open_qty: 6, total_open_qty: 6 }, '확인된 미입고 6박스'],
    ['AT_RISK', { known_healthy_open_qty: 2, known_at_risk_open_qty: 4, total_open_qty: 6 }, '미입고 2박스 · 확인 필요 4박스'],
    ['UNKNOWN', { known_healthy_open_qty: 6, known_at_risk_open_qty: 0, total_open_qty: null }, '다른 주문 확인 안 됨 (확인된 것만 6박스 이상)'],
    ['CONFLICT', { known_healthy_open_qty: 6, total_open_qty: null }, '공급 기록 확인 필요'],
  ]) {
    const e = makeEnv({ orderSupply: [sup()], openSupply: [{ item_id: 10, unit: '박스', open_supply_state: state, known_at_risk_open_qty: 0, ...extra }] });
    await e.f._loadOrderSupply();
    check(`item state ${state} → "${expect}"`, e.f._openSupplyLabel(10, '박스') === expect, e.f._openSupplyLabel(10, '박스'));
  }

  // ── AUTH-07: no dead / privileged action ─────────────────────────────────────────────
  { const e = makeEnv({ failRead: true, orders: [ORDER(1)] });
    await e.f._loadOrderSupply();
    const h = e.row(1);
    check('server WITHOUT the feature (today) → the old receive row with [입고] (unchanged contract there)', !e.available() && h.includes('_tblReceive(1)') && !h.includes('v4-supply-line'), h); }
  for (const s of [sup({ verified: false, order_state: 'UNVERIFIED_LEGACY' }), sup({ order_state: 'PARTIAL', accepted_qty: 4, remaining_qty: 6 }), sup({ order_state: 'CONFLICT', conflict_reason: 'OVER_RECEIPT' }), sup({ order_state: 'UNIT_UNRESOLVED' })]) {
    const e = makeEnv({ orderSupply: [s] });
    await e.f._loadOrderSupply();
    const h = e.row(1);
    check(`AUTH-07 server WITH the feature, ${s.order_state} row → read only (no button at all), says receiving is the trusted path's`,
      !h.includes('onclick') && h.includes('입고는 신뢰된 관리 경로에서만 기록합니다') && /주문 기록 #1 · /.test(h), h);
  }
  { const e = makeEnv({ orderSupply: [sup({ order_state: 'PARTIAL', accepted_qty: 4, remaining_qty: 6 })] });
    await e.f._loadOrderSupply();
    check('verified PARTIAL row shows "입고 4/10 · 남은 6박스"', e.row(1).includes('확인된 주문 · 입고 4/10 · 남은 6박스')); }
  { const e = makeEnv({ orderSupply: [sup()], orders: [ORDER(1)] });
    await e.f._loadOrderSupply();
    await e.f.markReceived(1);
    check('AUTH-01 (client) with the feature, markReceived sends nothing (no complete_order_receiving from the app)',
      !e.calls.some(c => c.rpc === 'complete_order_receiving') && e.toasts.includes('입고는 신뢰된 관리 경로에서만 기록합니다 (앱 입고 비활성)'), JSON.stringify(e.calls)); }
  { const e = makeEnv({ failRead: true, orders: [ORDER(1)], rpc: { complete_order_receiving: { data: null, error: { message: 'permission denied for function complete_order_receiving', code: '42501' } } } });
    await e.f._loadOrderSupply();
    await e.f.markReceived(1);
    check('a denial from the server is reported as "trusted path only", not as a retryable failure', e.toasts.includes('입고는 신뢰된 관리 경로에서만 기록합니다 (앱 입고 비활성)'), e.toasts.join(' | ')); }
  { const jwtRoles = [...HTML.matchAll(/eyJ[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+/g)].map(m => {
      try { return JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8')).role || null; } catch { return null; } });
    const code = HTML.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
    check('AUTH-06 no service_role secret in the app: every embedded JWT is not service_role, no code line mentions service_role',
      jwtRoles.every(r => r !== 'service_role') && !/service_role/i.test(code), JSON.stringify(jwtRoles)); }
  check('AUTH-07 index.html calls no supply writer and sends no actor',
    WRITERS.every(w => !HTML.includes(`'${w}'`)) && !/p_verified_by|p_authority|p_actor/.test(HTML));
  check('index.html never writes order_supply / order_receipts / coverage / policy directly',
    !/from\('(order_supply|order_receipts|supply_coverage_confirmations|supply_coverage_policy)'\)\s*\.(insert|update|upsert|delete)/.test(HTML));

  // ── multi-order (v0.2, kept) ─────────────────────────────────────────────────────────
  { const e = makeEnv();
    const A = ORDER(1), B = { ...ORDER(2), qty: 4, created_at: '2026-10-04T06:30:00Z' };
    check('NC-29 same item, orders A + B → two receive rows', e.buildRows([], [A, B])._orderedRows.map(r => r.order_id).join(',') === '1,2');
    const P = { id: 3, item_id: 10, item_name: '우유', qty: 2, unit: '박스', status: 'pending', vendor_id: null };
    const both = e.buildRows([P], [B]);
    check('NC-30 a pending row for the same item does not hide ordered B', both._pendingRows.length === 1 && both._orderedRows.map(r => r.order_id).join(',') === '2'); }
  { const e = makeEnv({ failRead: true, orders: [ORDER(1), { ...ORDER(2), qty: 4 }], rpc: { complete_order_receiving: { data: { code: 'SUCCESS', qty_after: 9 }, error: null } } });
    await e.f._loadOrderSupply();
    await e.f.markReceived(1);
    const rc = e.calls.filter(c => c.rpc === 'complete_order_receiving');
    check('NC-31 (old server) A\'s [입고] → order 1 only', rc.length === 1 && rc[0].args.p_order_id === 1, JSON.stringify(rc)); }
  { const e = makeEnv({ orders: [ORDER(1), { ...ORDER(2), qty: 4 }] });
    e.answer(); await e.f.cancelOrder(2);
    const w = writes(e);
    check('NC-32 B\'s (unverified) cancellation → one order_requests update for id 2 only', w.length === 1 && w[0].eqs.id === 2, JSON.stringify(w)); }
  { const e = makeEnv({ orders: [ORDER(1)], orderSupply: [sup()] });
    await e.f._loadOrderSupply();
    await e.f.cancelOrder(1);
    const tr = { dataset: { iid: '10', oid: '1' }, querySelector: () => ({ textContent: '우유' }), remove() {} };
    await e.f._tblDeleteRow({ closest: () => tr });
    check('a verified order cannot be cancelled / deleted from the app', writes(e).length === 0 && e.toasts.filter(t => t.includes('확인된 주문은 앱에서')).length === 2); }

  // ── DEL: one server transaction, no client cleanup sequence ──────────────────────────
  { const e = makeEnv({ rpc: { delete_item_safely: { data: { code: 'DELETED', item_id: 11 }, error: null } } });
    await e.f._deleteItemAndCleanup(11);
    const d = e.calls.filter(c => c.rpc === 'delete_item_safely');
    check('DEL-02/08 delete → exactly one delete_item_safely(store, item) call, no client table write, item removed locally',
      d.length === 1 && d[0].args.p_store_id === 1 && d[0].args.p_item_id === 11 && writes(e).length === 0 && !e.items().some(i => i.item_id === 11), JSON.stringify(e.calls)); }
  for (const [code, expect] of [['HISTORY_PRESERVED', '공급·입고 기록이 있는 품목이라 삭제할 수 없습니다 (기록 보존)'], ['DELETE_FAILED', '삭제하지 못했습니다 — 아무것도 지우지 않았습니다. 다시 시도해 주세요']]) {
    const e = makeEnv({ rpc: { delete_item_safely: { data: { code }, error: null } } });
    let err = null; try { await e.f._deleteItemAndCleanup(10); } catch (x) { err = x.message; }
    check(`DEL-01/03 ${code} → error "${expect}", item kept locally, no client write`, err === expect && e.items().some(i => i.item_id === 10) && writes(e).length === 0, err);
  }
  { const e = makeEnv();   // the server does not have delete_item_safely yet
    let err = null; try { await e.f._deleteItemAndCleanup(10); } catch (x) { err = x.message; }
    check('server without the delete owner → nothing deleted (no fallback to the old multi-request delete)', err === '지금은 삭제·합치기를 할 수 없습니다 (서버 업데이트 필요) — 아무것도 바뀌지 않았습니다' && writes(e).length === 0, err); }
  check('index.html no longer deletes an item in several client requests', !/from\('order_requests'\)\s*\.delete\(\)/.test(HTML) && !/from\('items'\)\.delete\(\)/.test(extractFn('_deleteItemAndCleanup')));

  // ── merge / replace ──────────────────────────────────────────────────────────────────
  { const e = makeEnv({ rpc: { merge_duplicate_items: { data: { code: 'MERGED', current_qty: 5 }, error: null } } });
    await e.f._mergeDup('우유');
    const m = e.calls.filter(c => c.rpc === 'merge_duplicate_items');
    check('DEL-07 merge → one merge_duplicate_items(target 10, sources [11], SUM) call; local target 5, source gone; no client write',
      m.length === 1 && m[0].args.p_target_item_id === 10 && JSON.stringify(m[0].args.p_source_item_ids) === '[11]' && m[0].args.p_mode === 'SUM' &&
      e.items().length === 1 && e.items()[0].current_qty === 5 && writes(e).length === 0, JSON.stringify(e.calls)); }
  { const e = makeEnv({ rpc: { merge_duplicate_items: { data: { code: 'MERGED', current_qty: 3 }, error: null } } });
    await e.f._replaceDup('우유');
    const m = e.calls.filter(c => c.rpc === 'merge_duplicate_items')[0];
    check('replace → REPLACE with the latest item\'s value (11)', m && m.args.p_mode === 'REPLACE' && m.args.p_value_item_id === 11 && e.items()[0].current_qty === 3, JSON.stringify(m)); }
  for (const code of ['MERGE_FAILED', 'HISTORY_PRESERVED', 'STOCK_UNKNOWN']) {
    const e = makeEnv({ rpc: { merge_duplicate_items: { data: { code }, error: null } } });
    await e.f._mergeDup('우유');
    check(`DEL-05/06 merge ${code} → nothing changed locally (target 2, source kept), no alias, reason shown`,
      e.items().length === 2 && e.items()[0].current_qty === 2 && e.aliases.length === 0 && writes(e).length === 0 && e.toasts.length === 1, e.toasts.join(' | '));
  }
  { const e = makeEnv();
    await e.f._mergeAllDups();
    check('merge all without the server owner → nothing merged (0), no client write', e.items().length === 2 && writes(e).length === 0 && e.toasts.includes('0종 중복 품목 정리 완료')); }

  console.log(`\nDB Write: 0 (mock client only)`);
  console.log(`RESULT: ${pass} PASS / ${fail} FAIL (of ${pass + fail})`);
  process.exit(fail ? 1 : 0);
})();
