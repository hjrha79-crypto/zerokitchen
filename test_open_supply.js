/*
 * test_open_supply.js — Verified Open Supply, Web client (v0.2 blocker fix)
 *
 * The app READS the server's supply truth (get_order_supply / get_open_supply). It has no identity the server
 * could trust (publishable key only), so it never calls a supply WRITER (confirm / receive / cancel / fail /
 * health / coverage — trusted backend only) and never sends an actor. Its only receiving is the unchanged
 * [입고]/[남은 전량 입고] → complete_order_receiving, per order id. Every real order is its own row (same item
 * included); a verified order cannot be cancelled / edited / deleted from the app; deleting an item with supply
 * history deletes NOTHING. The server semantics are verified on the real migration in
 * migration-packages/verified-open-supply-001/tests. REAL functions from index.html, MOCK db — DB Write 0.
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
  'cancelOrder', '_tblDeleteRow', '_itemDeleteBlocker', '_deleteItemAndCleanup', '_mergeDup', '_replaceDup'];
const WRITERS = ['confirm_order_supply', 'receive_order_supply', 'cancel_order_supply', 'fail_order_supply', 'set_order_supply_health', 'confirm_supply_coverage', 'zk_receive_core'];

let pass = 0, fail = 0;
function check(name, ok, detail = '') { if (ok) pass++; else fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? '  — ' + detail : ''}`); }

function makeEnv({ orderSupply = [], openSupply = [], failRead = false, orders = [], tables = {}, failOn = {}, items } = {}) {
  const calls = [];
  const db = {
    async rpc(name, args) {
      calls.push({ rpc: name, args: { ...args } });
      if (name === 'get_order_supply') return failRead ? { data: null, error: { message: 'Could not find the function' } } : { data: orderSupply, error: null };
      if (name === 'get_open_supply') return failRead ? { data: null, error: { message: 'Could not find the function' } } : { data: openSupply, error: null };
      if (name === 'complete_order_receiving') return { data: { code: 'SUCCESS', qty_after: 9 }, error: null };
      return { data: null, error: { message: 'permission denied' } };
    },
    from(table) {
      let op = 'select'; const eqs = {};
      const b = {
        select() { return b; }, limit() { return b; }, eq(c, v) { eqs[c] = v; return b; },
        delete() { op = 'delete'; return b; }, update() { op = 'update'; return b; }, insert() { op = 'insert'; return b; },
        then(res) {
          if (op !== 'select') calls.push({ write: table, op, eqs: { ...eqs } });
          else calls.push({ read: table, eqs: { ...eqs } });
          const f = failOn[`${op}:${table}`];
          if (f) return res({ data: null, error: f });
          if (op === 'select') {
            const t = tables[table];
            if (t === undefined) return res({ data: null, error: { code: 'PGRST205', message: `Could not find the table 'public.${table}'` } });
            return res({ data: t.filter(r => Object.entries(eqs).every(([k, v]) => r[k] === v)), error: null });
          }
          return res({ data: [], error: null });
        },
      };
      return b;
    },
  };
  const SID = 1, toasts = []; const showToast = t => toasts.push(t);
  let answers = []; const confirm = () => (answers.length ? answers.shift() : true);
  const _vendors = [];
  let _orderRequests = orders.map(o => ({ ...o }));
  let _items = items || [{ item_id: 10, item_name: '우유', unit: '박스', current_qty: 2 }, { item_id: 11, item_name: '우유', unit: '박스', current_qty: 1 }];
  const _invalidateDepletionCache = () => {}, _dismissedItemIds = new Set(), _updateOrderCount = () => {}, _updateTextOrderCache = () => {};
  const _renderOrderNeed = () => {}, _onOrderPatternUpdate = () => {}, _removeOrderRow = () => {}, _saveAlias = () => {}, renderInventory = () => {}, _showDupCleanup = () => {};
  const document = { querySelector: () => null };
  const console = { warn() {}, log() {}, error() {} };
  let _orderSupply = new Map(), _openSupply = new Map(), _supplyAvailable = false;
  for (const c of ['_fmtQty', '_VERIFIED_ORDER_LOCKED_MSG', '_DELETE_HISTORY_MSG']) eval(constLine(c).replace('const ', 'var '));
  const f = {};
  for (let k = 0; k < 2; k++) {
    for (const n of FNS) f[n] = eval(asExpr(extractFn(n), n));
    // eslint-disable-next-line no-unused-vars
    var _loadOrderSupply = f._loadOrderSupply, _isVerifiedOrder = f._isVerifiedOrder, _openSupplyLabel = f._openSupplyLabel, _orderIdentity = f._orderIdentity,
      _receivingOutcome = f._receivingOutcome, _itemDeleteBlocker = f._itemDeleteBlocker, _deleteItemAndCleanup = f._deleteItemAndCleanup;
  }
  // the ordered-row building block of renderOrder, run on its own
  const buildRows = (pendingItems, orderedItems) => {
    const _pendingItems = pendingItems, _orderedItems = orderedItems;
    const _pendingRows = [], _orderedRows = [], _seenIds = new Set();
    eval(ROWS_SRC);
    return { _pendingRows, _orderedRows };
  };
  void SID; void showToast; void confirm; void _vendors; void _invalidateDepletionCache; void _dismissedItemIds; void _updateOrderCount; void _updateTextOrderCache;
  void _renderOrderNeed; void _onOrderPatternUpdate; void _removeOrderRow; void _saveAlias; void renderInventory; void _showDupCleanup; void document; void console; void _fmtQty;
  return { f, calls, toasts, buildRows, answer: (...a) => { answers = a; }, available: () => _supplyAvailable, items: () => _items,
    row: (id, name = '우유', qty = 10, unit = '박스', created_at = '2026-10-04T04:05:00Z', item_id = 10) => f._receiveItemHtml({ order_id: id, item_id, name, orderQty: qty, unit, created_at }) };
}
const ORDER = id => ({ id, item_id: 10, item_name: '우유', qty: 10, unit: '박스', status: 'ordered', vendor_id: null, created_at: '2026-10-04T04:05:00Z' });
const sup = (o = {}) => ({ order_id: 1, item_id: 10, status: 'ordered', verified: true, verification: 'HUMAN_CONFIRMED', ordered_qty: 10, unit: '박스',
  accepted_qty: 0, remaining_qty: 10, outcome: 'OPEN', health: 'HEALTHY', order_state: 'OPEN', conflict_reason: null, ...o });

(async () => {
  // ── reads, fail-soft, labels ───────────────────────────────────────────────────────
  { const e = makeEnv({ failRead: true, orders: [ORDER(1)] });
    await e.f._loadOrderSupply();
    const h = e.row(1);
    check('server without the feature → the old receive row (only [입고])', !e.available() && !h.includes('v4-supply-line') && h.includes('_tblReceive(1)'), h); }
  for (const [state, extra, expect] of [
    ['NONE_CONFIRMED', { known_healthy_open_qty: 0, total_open_qty: 0 }, '진행 중 주문 없음(확인됨)'],
    ['VERIFIED_OPEN', { known_healthy_open_qty: 6, total_open_qty: 6 }, '확인된 미입고 6박스'],
    ['AT_RISK', { known_healthy_open_qty: 2, known_at_risk_open_qty: 4, total_open_qty: 6 }, '미입고 2박스 · 도착 위험 4박스'],
    ['UNKNOWN', { known_healthy_open_qty: 6, known_at_risk_open_qty: 0, total_open_qty: null }, '다른 주문 확인 안 됨 (확인된 것만 6박스 이상)'],
    ['CONFLICT', { known_healthy_open_qty: 6, total_open_qty: null }, '공급 기록 확인 필요'],
  ]) {
    const e = makeEnv({ orderSupply: [sup()], openSupply: [{ item_id: 10, unit: '박스', open_supply_state: state, known_at_risk_open_qty: 0, ...extra }] });
    await e.f._loadOrderSupply();
    check(`item state ${state} → "${expect}"`, e.f._openSupplyLabel(10, '박스') === expect, e.f._openSupplyLabel(10, '박스'));
  }

  // ── rows: no client writer, only the legacy full receipt, per order id ──────────────
  { const e = makeEnv({ orderSupply: [sup({ verified: false, verification: null, order_state: 'UNVERIFIED_LEGACY' })] });
    await e.f._loadOrderSupply();
    const h = e.row(1);
    check("an 'ordered' row without evidence: 주문 확인 전 — 공급으로 세지 않음, only [입고] (no confirm / partial / cancel)",
      h.includes('주문 확인 전 — 공급으로 세지 않음') && h.includes('_tblReceive(1)') && !/_confirmOrderSupply|_receivePartial|_cancelSupplyOrder/.test(h), h); }
  { const e = makeEnv({ orderSupply: [sup({ order_state: 'PARTIAL', accepted_qty: 4, remaining_qty: 6 })] });
    await e.f._loadOrderSupply();
    const h = e.row(1);
    check('verified PARTIAL row: identity "주문 #1 · 10/4 13:05" + "입고 4/10 · 남은 6박스", only [남은 전량 입고] for order 1',
      /주문 #1 · 10\/4 \d\d:05/.test(h) && h.includes('확인된 주문 · 입고 4/10 · 남은 6박스') && h.includes('onclick="_tblReceive(1)">남은 전량 입고') &&
      (h.match(/onclick=/g) || []).length === 1, h); }
  for (const st of ['CONFLICT', 'UNIT_UNRESOLVED']) {
    const e = makeEnv({ orderSupply: [sup({ order_state: st, conflict_reason: 'OVER_RECEIPT' })] });
    await e.f._loadOrderSupply();
    check(`${st} row: no action at all`, !e.row(1).includes('onclick'), e.row(1));
  }
  check('NC-18 index.html calls no supply writer RPC and sends no actor', WRITERS.every(w => !HTML.includes(`'${w}'`)) && !/p_verified_by|p_authority|p_actor/.test(HTML));
  check('index.html never writes order_supply / order_receipts / coverage / policy directly',
    !/from\('(order_supply|order_receipts|supply_coverage_confirmations|supply_coverage_policy)'\)\s*\.(insert|update|upsert|delete)/.test(HTML));

  // ── NC-29..32 multi-order ─────────────────────────────────────────────────────────
  { const e = makeEnv();
    const A = ORDER(1), B = { ...ORDER(2), qty: 4, created_at: '2026-10-04T06:30:00Z' };
    const { _orderedRows } = e.buildRows([], [A, B]);
    check('NC-29 same item, orders A + B → two receive rows (order 1 and order 2)', _orderedRows.map(r => r.order_id).join(',') === '1,2', JSON.stringify(_orderedRows));
    const P = { id: 3, item_id: 10, item_name: '우유', qty: 2, unit: '박스', status: 'pending', vendor_id: null };
    const both = e.buildRows([P], [B]);
    check('NC-30 a pending row for the same item does not hide ordered B', both._pendingRows.length === 1 && both._orderedRows.map(r => r.order_id).join(',') === '2', JSON.stringify(both));
    const e2 = makeEnv({ orderSupply: [sup({ order_id: 1, verified: false, order_state: 'UNVERIFIED_LEGACY' }), sup({ order_id: 2, ordered_qty: 4, remaining_qty: 4 })] });
    await e2.f._loadOrderSupply();
    const hA = e2.row(1), hB = e2.row(2, '우유', 4, '박스', '2026-10-04T06:30:00Z');
    check('NC-29 each row shows its own order identity and state', hA.includes('주문 #1') && hA.includes('주문 확인 전') && hB.includes('주문 #2') && hB.includes('입고 0/4 · 남은 4박스') && !hA.includes('_tblReceive(2)') && !hB.includes('_tblReceive(1)'), hA + hB); }
  { const e = makeEnv({ orders: [ORDER(1), { ...ORDER(2), qty: 4 }] });
    await e.f.markReceived(1);
    const rc = e.calls.filter(c => c.rpc === 'complete_order_receiving');
    check('NC-31 A\'s receipt → complete_order_receiving for order 1 only', rc.length === 1 && rc[0].args.p_order_id === 1 && rc[0].args.p_store_id === 1, JSON.stringify(rc)); }
  { const e = makeEnv({ orders: [ORDER(1), { ...ORDER(2), qty: 4 }] });
    e.answer(); await e.f.cancelOrder(2);
    const w = e.calls.filter(c => c.write === 'order_requests');
    check('NC-32 B\'s (unverified) cancellation → one order_requests update for id 2 only', w.length === 1 && w[0].eqs.id === 2, JSON.stringify(w)); }
  { const e = makeEnv({ orders: [ORDER(1)], orderSupply: [sup()] });
    await e.f._loadOrderSupply();
    await e.f.cancelOrder(1);
    const tr = { dataset: { iid: '10', oid: '1' }, querySelector: () => ({ textContent: '우유' }), remove() {} };
    await e.f._tblDeleteRow({ closest: () => tr });
    check('a verified order cannot be cancelled / deleted from the app (no write, explicit message)',
      !e.calls.some(c => c.write) && e.toasts.filter(t => t.includes('확인된 주문은 앱에서 취소·수정할 수 없습니다')).length === 2, JSON.stringify(e.calls)); }
  check('_inlineEditOrderQty refuses a verified order', /if \(_isVerifiedOrder\(orderId\)\) \{ showToast\(_VERIFIED_ORDER_LOCKED_MSG/.test(extractFn('_inlineEditOrderQty')));

  // ── NC-33/34 item delete ────────────────────────────────────────────────────────────
  { const e = makeEnv({ tables: { order_supply: [{ store_id: 1, item_id: 10 }], order_receipts: [] } });
    let err = null; try { await e.f._deleteItemAndCleanup(10); } catch (x) { err = x.message; }
    check('NC-33 item with supply history → refused before anything is deleted (orders, daily_orders, vendor map, op links, item all kept)',
      err === '공급·입고 기록이 있는 품목이라 삭제할 수 없습니다 (기록 보존)' && !e.calls.some(c => c.write), JSON.stringify(e.calls)); }
  { const e = makeEnv({ tables: { order_supply: [], order_receipts: [{ store_id: 1, item_id: 10 }] } });
    let err = null; try { await e.f._deleteItemAndCleanup(10); } catch (x) { err = x.message; }
    check('NC-33 receipts-only history also refuses, zero writes', !!err && !e.calls.some(c => c.write)); }
  { const e = makeEnv({ tables: { order_supply: [], order_receipts: [] }, failOn: { 'delete:order_requests': { message: 'update or delete on table "order_requests" violates foreign key constraint' } } });
    let err = null; try { await e.f._deleteItemAndCleanup(10); } catch (x) { err = x.message; }
    check('NC-33 race: the order delete fails (RESTRICT) → stop there; daily_orders / vendor map / ops / item untouched',
      err === '공급·입고 기록이 있는 품목이라 삭제할 수 없습니다 (기록 보존)' && e.calls.filter(c => c.write).map(c => c.write).join(',') === 'order_requests', JSON.stringify(e.calls.filter(c => c.write))); }
  { const e = makeEnv({ failOn: { 'select:order_supply': { code: '08006', message: 'network' } } });
    let err = null; try { await e.f._deleteItemAndCleanup(10); } catch (x) { err = x.message; }
    check('NC-33 history check itself fails → refuse (fail closed), zero writes', !!err && !e.calls.some(c => c.write), err); }
  { const e = makeEnv();   // tables missing on the server (feature not installed) → no history possible
    let err = null; try { await e.f._deleteItemAndCleanup(11); } catch (x) { err = x.message; }
    check('NC-34 dependency-free item (server without supply tables) → normal delete: orders, daily_orders, vendor map, op links, item',
      err === null && e.calls.filter(c => c.write).map(c => c.write).join(',') === 'order_requests,daily_orders,item_vendor_map,kitchen_operations,items' && !e.items().some(i => i.item_id === 11), err || JSON.stringify(e.calls)); }
  { const e = makeEnv({ tables: { order_supply: [], order_receipts: [] } });
    let err = null; try { await e.f._deleteItemAndCleanup(11); } catch (x) { err = x.message; }
    check('NC-34 dependency-free item (tables present, no rows) → normal delete', err === null && e.calls.filter(c => c.write).length === 5); }
  { const e = makeEnv({ tables: { order_supply: [{ store_id: 1, item_id: 11 }], order_receipts: [] } });
    await e.f._mergeDup('우유');
    check('duplicate merge with a history item → nothing written (no half merge), reason shown', !e.calls.some(c => c.write) && e.toasts.some(t => t.includes('기록 보존')), JSON.stringify(e.calls.filter(c => c.write)));
    await e.f._replaceDup('우유');
    check('duplicate replace with a history item → nothing written', !e.calls.some(c => c.write)); }

  console.log(`\nDB Write: 0 (mock client only)`);
  console.log(`RESULT: ${pass} PASS / ${fail} FAIL (of ${pass + fail})`);
  process.exit(fail ? 1 : 0);
})();
