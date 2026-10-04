/*
 * test_open_supply.js — ZEROKITCHEN_VERIFIED_OPEN_SUPPLY_PARTIAL_RECEIPT_BOUNDED_BUILD_V0_1 (Web client)
 *
 * The Web client only READS the server's supply truth (get_order_supply / get_open_supply) and WRITES through the
 * server owner functions (confirm_order_supply / receive_order_supply / cancel_order_supply / confirm_supply_coverage,
 * complete_order_receiving for 전체 입고). It never treats 'ordered' alone as a verified order, never writes
 * order_supply / order_receipts directly, and keeps the old receive row when the server does not have the feature.
 * The server semantics themselves are verified against the real migration in
 * migration-packages/verified-open-supply-001/tests (run_matrix / run_nc / run_client_web).
 * REAL functions from index.html, MOCK db — no network, DB Write 0.
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
const FNS = ['_loadOrderSupply', '_isVerifiedOrder', '_openSupplyLabel', '_receiveItemHtml', '_confirmOrderSupply', '_receivePartial', '_cancelSupplyOrder', '_tblDeleteRow'];
const FMT = (/const _fmtQty = [^\n]+/.exec(HTML) || [''])[0];

let pass = 0, fail = 0;
function check(name, ok, detail = '') { if (ok) pass++; else fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? '  — ' + detail : ''}`); }

function makeEnv({ orderSupply = [], openSupply = [], rpcAnswers = {}, failRead = false, orders = [] } = {}) {
  const calls = [];
  const db = {
    async rpc(name, args) {
      calls.push({ rpc: name, args: { ...args } });
      if (name === 'get_order_supply') return failRead ? { data: null, error: { message: 'Could not find the function' } } : { data: orderSupply, error: null };
      if (name === 'get_open_supply') return failRead ? { data: null, error: { message: 'Could not find the function' } } : { data: openSupply, error: null };
      const a = rpcAnswers[name];
      if (typeof a === 'function') return a(args);
      return { data: a || { code: 'WRITE_FAILED' }, error: null };
    },
    from(table) { calls.push({ from: table }); const b = { update() { calls.push({ write: table, op: 'update' }); return b; }, insert() { calls.push({ write: table, op: 'insert' }); return b; }, eq() { return b; }, then(r) { r({ data: null, error: null }); } }; return b; },
  };
  const SID = 1, toasts = []; const showToast = t => toasts.push(t);
  let answers = []; const confirm = () => (answers.length ? answers.shift() : true); const prompt = () => (answers.length ? answers.shift() : '');
  const _vendors = [], _orderRequests = orders.map(o => ({ ...o }));
  let _items = [{ item_id: 10, item_name: '우유', unit: '박스', current_qty: 2 }];
  let renders = 0; const renderOrder = async () => { renders++; };
  const _invalidateDepletionCache = () => {}, _dismissedItemIds = new Set(), _updateOrderCount = () => {}, _updateTextOrderCache = () => {};
  const console = { warn() {}, log() {}, error() {} };
  let _orderSupply = new Map(), _openSupply = new Map(), _supplyAvailable = false; const _receiptKeys = new Map();
  const crypto = { randomUUID: (() => { let n = 0; return () => `uuid-${++n}`; })() };
  eval(FMT.replace('const ', 'var '));
  const f = {};
  for (let pass2 = 0; pass2 < 2; pass2++) {
    for (const n of FNS) f[n] = eval(asExpr(extractFn(n), n));
    // eslint-disable-next-line no-unused-vars
    var _loadOrderSupply = f._loadOrderSupply, _isVerifiedOrder = f._isVerifiedOrder, _openSupplyLabel = f._openSupplyLabel, _cancelSupplyOrder = f._cancelSupplyOrder;
  }
  void SID; void showToast; void confirm; void prompt; void _vendors; void renderOrder; void _invalidateDepletionCache; void _dismissedItemIds;
  void _updateOrderCount; void _updateTextOrderCache; void console; void crypto; void _fmtQty; void _items;
  return { f, calls, toasts, renders: () => renders, answer: (...a) => { answers = a; }, keys: _receiptKeys, available: () => _supplyAvailable,
    row: (id, name = '우유', qty = 10, unit = '박스') => f._receiveItemHtml({ order_id: id, item_id: 10, name, orderQty: qty, unit }) };
}
const ORDER = { id: 1, item_id: 10, item_name: '우유', qty: 10, unit: '박스', status: 'ordered', vendor_id: null };
const sup = (o = {}) => ({ order_id: 1, item_id: 10, status: 'ordered', verified: true, verification: 'HUMAN_CONFIRMED', ordered_qty: 10, unit: '박스',
  accepted_qty: 0, remaining_qty: 10, outcome: 'OPEN', health: 'HEALTHY', order_state: 'OPEN', conflict_reason: null, ...o });

(async () => {
  // fail-soft
  { const e = makeEnv({ failRead: true, orders: [ORDER] });
    await e.f._loadOrderSupply();
    const h = e.row(1);
    check('server without the feature → _supplyAvailable false, the old receive row (only [입고])', !e.available() && !h.includes('v4-supply-line') && h.includes('_tblReceive(1)') && !h.includes('주문 확인'), h); }

  // 'ordered' alone is not a verified order
  { const e = makeEnv({ orderSupply: [sup({ verified: false, verification: null, order_state: 'UNVERIFIED_LEGACY', accepted_qty: 0, remaining_qty: null, outcome: null, health: null })], openSupply: [{ item_id: 10, unit: '박스', open_supply_state: 'UNKNOWN', known_healthy_open_qty: 0, known_at_risk_open_qty: 0, total_open_qty: null }], orders: [ORDER] });
    await e.f._loadOrderSupply();
    const h = e.row(1);
    check("an 'ordered' row without evidence reads 주문 확인 전 — 공급으로 세지 않음, offers [주문 확인], no partial receipt / cancel",
      h.includes('주문 확인 전 — 공급으로 세지 않음') && h.includes('_confirmOrderSupply(1)') && !h.includes('_receivePartial') && !h.includes('_cancelSupplyOrder') && !e.f._isVerifiedOrder(1), h);
    check('item with no confirmed coverage reads 다른 주문 확인 안 됨 (no total)', h.includes('다른 주문 확인 안 됨') && !/미입고 \d/.test(h), h); }

  // states → labels (state before numbers)
  const label = (state, extra = {}) => { const e = makeEnv(); return e; };
  void label;
  for (const [state, extra, expect] of [
    ['NONE_CONFIRMED', { known_healthy_open_qty: 0, total_open_qty: 0 }, '진행 중 주문 없음(확인됨)'],
    ['VERIFIED_OPEN', { known_healthy_open_qty: 6, total_open_qty: 6 }, '확인된 미입고 6박스'],
    ['AT_RISK', { known_healthy_open_qty: 2, known_at_risk_open_qty: 4, total_open_qty: 6 }, '미입고 2박스 · 도착 위험 4박스'],
    ['UNKNOWN', { known_healthy_open_qty: 6, known_at_risk_open_qty: 0, total_open_qty: null }, '다른 주문 확인 안 됨 (확인된 것만 6박스 이상)'],
    ['CONFLICT', { known_healthy_open_qty: 6, total_open_qty: null }, '공급 기록 확인 필요'],
  ]) {
    const e = makeEnv({ orderSupply: [sup()], openSupply: [{ item_id: 10, unit: '박스', open_supply_state: state, known_at_risk_open_qty: 0, ...extra }], orders: [ORDER] });
    await e.f._loadOrderSupply();
    check(`item state ${state} → "${expect}"`, e.f._openSupplyLabel(10, '박스') === expect, e.f._openSupplyLabel(10, '박스'));
  }

  // verified OPEN / PARTIAL / AT_RISK / CONFLICT / UNIT_UNRESOLVED rows
  { const e = makeEnv({ orderSupply: [sup({ order_state: 'PARTIAL', accepted_qty: 4, remaining_qty: 6 })], orders: [ORDER] });
    await e.f._loadOrderSupply();
    const h = e.row(1);
    check('verified PARTIAL row: "확인된 주문 · 입고 4/10 · 남은 6박스", [일부 입고] [남은 전량 입고] [주문 취소]',
      h.includes('확인된 주문 · 입고 4/10 · 남은 6박스') && h.includes('_receivePartial(1)') && h.includes('남은 전량 입고') && h.includes('_cancelSupplyOrder(1)'), h); }
  { const e = makeEnv({ orderSupply: [sup({ health: 'AT_RISK' })], orders: [ORDER] }); await e.f._loadOrderSupply();
    check('AT_RISK order row says 도착 위험', e.row(1).includes('도착 위험')); }
  { const e = makeEnv({ orderSupply: [sup({ order_state: 'CONFLICT', conflict_reason: 'OVER_RECEIPT' })], orders: [ORDER] }); await e.f._loadOrderSupply();
    const h = e.row(1);
    check('CONFLICT row: 공급 기록 확인 필요 (OVER_RECEIPT), no receive / cancel action', h.includes('공급 기록 확인 필요 (OVER_RECEIPT)') && !h.includes('_receivePartial') && !h.includes('_tblReceive'), h); }
  { const e = makeEnv({ orderSupply: [sup({ order_state: 'UNIT_UNRESOLVED' })], orders: [ORDER] }); await e.f._loadOrderSupply();
    check('UNIT_UNRESOLVED row: 단위가 바뀌어 확인 필요, no actions', e.row(1).includes('단위가 바뀌어 확인 필요') && !e.row(1).includes('onclick')); }

  // confirm: explicit, HUMAN_CONFIRMED, coverage only when the person says so
  { const e = makeEnv({ orders: [ORDER], rpcAnswers: { confirm_order_supply: { code: 'CONFIRMED' }, confirm_supply_coverage: { code: 'COVERAGE_CONFIRMED' } } });
    e.answer(false); await e.f._confirmOrderSupply(1);
    check('[주문 확인] declined → nothing sent', !e.calls.some(c => c.rpc === 'confirm_order_supply'));
    e.answer(true, 'A-77', false); await e.f._confirmOrderSupply(1);
    const c = e.calls.find(x => x.rpc === 'confirm_order_supply');
    check('[주문 확인] → confirm_order_supply HUMAN_CONFIRMED by web, ref A-77; coverage NOT sent when declined',
      c && c.args.p_verification === 'HUMAN_CONFIRMED' && c.args.p_verified_by === 'web' && c.args.p_external_order_ref === 'A-77' && !e.calls.some(x => x.rpc === 'confirm_supply_coverage'), JSON.stringify(c));
    e.answer(true, '', true); await e.f._confirmOrderSupply(1);
    const cv = e.calls.find(x => x.rpc === 'confirm_supply_coverage');
    check('coverage sent only on an explicit yes (HUMAN_CONFIRMED, ALL_OPEN_ORDERS)', cv && cv.args.p_source === 'HUMAN_CONFIRMED' && cv.args.p_item_id === 10 && cv.args.p_scope === 'ALL_OPEN_ORDERS', JSON.stringify(cv)); }
  { const e = makeEnv({ orders: [ORDER], rpcAnswers: { confirm_order_supply: { code: 'UNIT_UNRESOLVED' } } });
    e.answer(true, ''); await e.f._confirmOrderSupply(1);
    check('UNIT_UNRESOLVED → told, no coverage question sent', e.toasts.some(t => t.includes('단위')) && !e.calls.some(x => x.rpc === 'confirm_supply_coverage')); }

  // partial receipt: server owner only, idempotent retry key
  { let n = 0;
    const e = makeEnv({ orderSupply: [sup()], orders: [ORDER], rpcAnswers: { receive_order_supply: args => { n++; if (n === 1) throw new Error('network'); return { data: { code: 'ALREADY_RECORDED' }, error: null }; } } });
    await e.f._loadOrderSupply();
    e.answer('4'); await e.f._receivePartial(1);
    const k1 = e.calls.filter(c => c.rpc === 'receive_order_supply')[0].args.p_idempotency_key;
    check('receive throws → key kept, "다시 눌러도 두 번 들어가지 않습니다"', e.keys.get(1) === k1 && e.toasts.some(t => t.includes('두 번 들어가지 않습니다')));
    e.answer('4'); await e.f._receivePartial(1);
    const k2 = e.calls.filter(c => c.rpc === 'receive_order_supply')[1].args.p_idempotency_key;
    check('retry reuses the same key; definitive answer clears it', k1 === k2 && !e.keys.has(1) && e.toasts.some(t => t.includes('이미 기록된 입고'))); }
  { const e = makeEnv({ orderSupply: [sup()], orders: [ORDER], rpcAnswers: { receive_order_supply: { code: 'SUCCESS', received_qty: 4, cumulative_received: 4, ordered_qty: 10, qty_after: 6 } } });
    await e.f._loadOrderSupply();
    for (const bad of ['0', '-1', 'abc', '1e3']) { e.answer(bad); await e.f._receivePartial(1); }
    check('invalid quantities (0, -1, abc, 1e3) → nothing sent', !e.calls.some(c => c.rpc === 'receive_order_supply'));
    e.answer('4'); await e.f._receivePartial(1);
    const c = e.calls.find(x => x.rpc === 'receive_order_supply');
    check('valid → receive_order_supply(order, store, 4, key, web, PHYSICAL_RECEIPT); toast 누적 4/10', c && c.args.p_received_qty === 4 && c.args.p_source === 'PHYSICAL_RECEIPT' && c.args.p_authority === 'web' &&
      e.toasts.some(t => t.includes('누적 4/10')), JSON.stringify(c)); }
  { const e = makeEnv({ orderSupply: [sup({ verified: false, order_state: 'UNVERIFIED_LEGACY' })], orders: [ORDER] });
    await e.f._loadOrderSupply(); e.answer('4'); await e.f._receivePartial(1);
    check('partial receipt is not offered / not sent for an unverified order', !e.calls.some(c => c.rpc === 'receive_order_supply')); }

  // cancel / delete / qty edit of a verified order never write order_requests directly
  { const e = makeEnv({ orderSupply: [sup()], orders: [ORDER], rpcAnswers: { cancel_order_supply: { code: 'CANCELLED' } } });
    await e.f._loadOrderSupply(); e.answer(true); await e.f._cancelSupplyOrder(1);
    check('[주문 취소] → cancel_order_supply, no direct write', e.calls.some(c => c.rpc === 'cancel_order_supply') && !e.calls.some(c => c.write));
    const tr = { dataset: { iid: '10', oid: '1' }, querySelector: () => ({ textContent: '우유' }), remove() {} };
    e.answer(true); await e.f._tblDeleteRow({ closest: () => tr });
    check('row ✕ on a verified order → server cancel, not a direct status update', !e.calls.some(c => c.write === 'order_requests')); }
  check('_inlineEditOrderQty refuses a verified order', /if \(_isVerifiedOrder\(orderId\)\) \{ showToast\('확인된 주문의 수량은 바꿀 수 없습니다/.test(extractFn('_inlineEditOrderQty')));
  check('cancelOrder routes a verified order to the server path', /if \(_isVerifiedOrder\(orderId\)\) return _cancelSupplyOrder\(orderId\);/.test(extractFn('cancelOrder')));

  // the client never writes the supply tables, never moves stock from a status
  check('index.html never writes order_supply / order_receipts / supply_coverage_confirmations directly',
    !/from\('(order_supply|order_receipts|supply_coverage_confirmations)'\)\s*\.(insert|update|upsert|delete)/.test(HTML));
  check('stock changes from supply come only from the receipt answer (qty_after), never from a status',
    /item\.current_qty = Number\(d\.qty_after\)/.test(extractFn('_receivePartial')) && !/current_qty/.test(extractFn('_cancelSupplyOrder')) && !/current_qty/.test(extractFn('_confirmOrderSupply')));
  check('renderOrder loads the supply truth with the orders', /await _loadOrderSupply\(\);/.test(extractFn('renderOrder')));

  console.log(`\nDB Write: 0 (mock client only)`);
  console.log(`RESULT: ${pass} PASS / ${fail} FAIL (of ${pass + fail})`);
  process.exit(fail ? 1 : 0);
})();
