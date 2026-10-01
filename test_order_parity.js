/*
 * test_order_parity.js  — ZK-WEB-ANDROID-CONTRACT-PARITY-001 (Web order truth)
 *
 * Contract (same truth as Android cff0ad4):
 *   - creating an order never changes items.unit
 *   - order_requests.unit = items.unit, qty = Inventory Unit quantity
 *   - the batch path plans with the one canonical _calcOrderQty (pack rounding)
 *   - order_unit_name / order_unit_qty are plan + display metadata only
 *
 * The REAL function bodies are extracted from index.html (brace-matched) and run
 * against a MOCK Supabase client. No real DB, no network — DB Write 0.
 */

const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

// --- extract a top-level `[async ]function NAME(...) { ... }` by brace matching ---
function extractFn(name) {
  let start = HTML.indexOf('async function ' + name + '(');
  if (start < 0) start = HTML.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('function not found: ' + name);
  const braceOpen = HTML.indexOf('{', start);
  let depth = 0, i = braceOpen;
  for (; i < HTML.length; i++) {
    const c = HTML[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return HTML.slice(start, i);
}
const asExpr = (src, name) => '(' + src.replace(new RegExp('^(async )?function ' + name), '$1function') + ')';

const SRC_process = extractFn('processRequest');
const SRC_dedup = extractFn('_insertOrderIfNotDup');
const SRC_batch = extractFn('_createOrderFromSuggestion');
const SRC_calc = extractFn('_calcOrderQty');

// --- MOCK Supabase client: no open orders, records every table write ---
function makeDb() {
  const writes = []; // { table, op, payload }
  function builder(table) {
    let inserted = null;
    const b = {
      select() { return b; }, eq() { return b; }, in() { return b; }, is() { return b; },
      limit() { return b; }, order() { return b; }, single() { return b; },
      insert(payload) { inserted = payload; writes.push({ table, op: 'insert', payload }); return b; },
      update(payload) { writes.push({ table, op: 'update', payload }); return b; },
      then(resolve) { resolve({ data: inserted !== null ? [inserted] : [], error: null }); },
    };
    return b;
  }
  return { from: t => builder(t), _writes: writes };
}

// --- environment holding the real functions with mocked globals ---
function makeEnv(items) {
  const db = makeDb();
  const SID = 1;
  let _items = items.map(i => ({ ...i }));
  const _vendors = [];
  const _orderRequests = [];
  const _orderedItemIds = new Set();
  const window = { _lastOrderSuggestion: null };
  const document = { querySelector: () => null, querySelectorAll: () => [] };
  const showToast = () => {};
  const confirm = () => false;
  const refreshItems = async () => {};
  const _invalidateDepletionCache = () => {};
  // eslint-disable-next-line no-eval
  const _calcOrderQty = eval(asExpr(SRC_calc, '_calcOrderQty'));
  // eslint-disable-next-line no-eval
  const _insertOrderIfNotDup = eval(asExpr(SRC_dedup, '_insertOrderIfNotDup'));
  // eslint-disable-next-line no-eval
  const processRequest = eval(asExpr(SRC_process, 'processRequest'));
  // eslint-disable-next-line no-eval
  const _createOrderFromSuggestion = eval(asExpr(SRC_batch, '_createOrderFromSuggestion'));
  const orders = () => db._writes.filter(w => w.table === 'order_requests' && w.op === 'insert').map(w => w.payload);
  const itemWrites = () => db._writes.filter(w => w.table === 'items');
  // batch path end to end: "발주" request -> suggestion -> "발주 생성"
  const batch = async () => {
    const res = await processRequest({ request_type: 'order_generate' });
    window._lastOrderSuggestion = res.items;
    await _createOrderFromSuggestion();
    return res;
  };
  return { db, processRequest, batch, orders, itemWrites, items: () => _items, _calcOrderQty };
}

const order = (name, quantity, unit) => ({
  request_type: 'inventory_update', items: [{ name, quantity, unit, action_type: 'order' }],
});
const item = (over) => ({ item_id: 49, item_name: '치즈', unit: '봉지', current_qty: 1, target_qty: 6,
  order_unit_qty: 6, order_unit_name: '박스', vendor_id: null, ...over });

let pass = 0, fail = 0;
function check(name, cond, detail) {
  const ok = !!cond;
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

(async () => {
  // U1  order creation does not mutate items.unit (purchase unit, foreign unit, own unit, no unit)
  {
    const seen = [];
    let good = true;
    for (const unit of ['박스', 'kg', '봉지', '']) {
      const env = makeEnv([item()]);
      const res = await env.processRequest(order('치즈', 1, unit));
      const unitWrites = env.itemWrites().filter(w => w.payload && 'unit' in w.payload).length;
      const kept = env.items()[0].unit === '봉지';
      const foreign = unit !== '' && unit !== '봉지';
      // a foreign-unit order is not saved at all (no conversion, no guess) and is reported
      const saved = env.orders().length;
      const right = unitWrites === 0 && kept && env.itemWrites().length === 0 &&
        (foreign ? saved === 0 && res.errors?.length === 1 : saved === 1 && !res.errors);
      good = good && right;
      seen.push(`[${unit || '-'}] itemWrites=${env.itemWrites().length} unit=${env.items()[0].unit} orders=${saved}`);
    }
    check('U1 order creation never mutates items.unit', good, seen.join(' ; '));
  }
  // U2  item.unit 봉지 / order_unit_name 박스 -> order.unit 봉지
  {
    const env = makeEnv([item()]);
    await env.processRequest(order('치즈', 6, ''));
    const env2 = makeEnv([item()]);
    await env2.processRequest(order('치즈', 6, ' 봉지 '));
    const u = [...env.orders(), ...env2.orders()].map(r => `${r.qty}${r.unit}`);
    check('U2 order.unit = items.unit', u.join(',') === '6봉지,6봉지', u.join(','));
  }
  // U3  batch need 5 / pack 6 -> qty 6 / unit 봉지
  {
    const env = makeEnv([item({ current_qty: 1, target_qty: 6 })]);
    await env.batch();
    const r = env.orders()[0] || {};
    check('U3 batch 5/6 -> qty 6 / unit 봉지', env.orders().length === 1 && r.qty === 6 && r.unit === '봉지', JSON.stringify(r));
  }
  // U4  batch need 7 / pack 6 -> qty 12 ; need 6 -> 6 ; float noise does not add a pack
  {
    const env = makeEnv([item({ current_qty: 1, target_qty: 8 })]);
    await env.batch();
    const env6 = makeEnv([item({ current_qty: 0, target_qty: 6 })]);
    await env6.batch();
    const envF = makeEnv([item({ current_qty: 2.3, target_qty: 8.3 })]);
    await envF.batch();
    const q = [env, env6, envF].map(e => (e.orders()[0] || {}).qty);
    check('U4 batch 7/6 -> 12, 6/6 -> 6, 8.3-2.3 -> 6', q.join(',') === '12,6,6', q.join(','));
  }
  // U5  no pack (1 / 0 / null / absent) -> the need itself
  {
    const q = [];
    for (const ouq of [1, 0, null, undefined]) {
      const env = makeEnv([item({ current_qty: 1, target_qty: 6, order_unit_qty: ouq, order_unit_name: '' })]);
      await env.batch();
      q.push((env.orders()[0] || {}).qty);
    }
    check('U5 no pack -> need unchanged', q.join(',') === '5,5,5,5', q.join(','));
  }
  // U6  purchase-unit display metadata never reaches a DB unit
  {
    const env = makeEnv([item()]);
    await env.batch();
    const env2 = makeEnv([item()]);
    await env2.processRequest(order('치즈', 6, ''));
    await env2.processRequest(order('치즈', 1, '박스'));
    const dbUnits = [...env.db._writes, ...env2.db._writes].filter(w => w.payload && 'unit' in w.payload).map(w => w.payload.unit);
    const asUnit = HTML.split('\n').filter(l => /\bunit:\s*[^,\n]*order_unit_name/.test(l));
    check('U6 order_unit_name never stored as a unit', dbUnits.length > 0 && !dbUnits.includes('박스') && asUnit.length === 0,
      `dbUnits=${JSON.stringify(dbUnits)} sourceHits=${asUnit.length}`);
  }

  console.log(`\nDB Write: 0 (mock client only, no network/supabase import)`);
  console.log(`RESULT: ${pass} PASS / ${fail} FAIL (of 6)`);
  process.exit(fail === 0 ? 0 : 1);
})();
