/*
 * test_order_unit.js  — ZK-ANDROID-PORT-011 (Web order-unit contract)
 *
 * Contract (same truth as Android cff0ad4):
 *   order_requests.qty  = planned Inventory Unit quantity
 *   order_requests.unit = items.unit
 *   order_unit_name     = display-only Purchase Unit metadata, never a stored/ordered unit
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
const asExpr = (src, name) => '(' + src.replace(new RegExp('^(async )?function ' + name.replace('$', '\\$')), '$1function') + ')';

const SRC_dedup = extractFn('_insertOrderIfNotDup');
const SRC_v3OrderNow = extractFn('v3OrderNow');
const SRC_batch = extractFn('_createOrderFromSuggestion');
const SRC_calc = extractFn('_calcOrderQty');

// --- MOCK Supabase client: no open orders, records order_requests inserts ---
function makeDb() {
  const inserts = [];
  function builder(table) {
    let insertedRow = null;
    const b = {
      select() { return b; }, eq() { return b; }, in() { return b; }, is() { return b; },
      limit() { return b; }, update() { return b; },
      upsert() { return Promise.resolve({ data: [], error: null }); },
      insert(row) { insertedRow = row; if (table === 'order_requests') inserts.push(row); return b; },
      then(resolve) { resolve({ data: insertedRow !== null ? [insertedRow] : [], error: null }); },
    };
    return b;
  }
  return { from: t => builder(t), _inserts: inserts };
}

// --- environment holding the real functions with mocked globals ---
function makeEnv(_items, suggestion) {
  const db = makeDb();
  const SID = 1;
  const document = { querySelector: () => null, querySelectorAll: () => [] };
  const window = { _lastOrderSuggestion: suggestion || null };
  const showToast = () => {};
  const renderOrder = async () => {};
  const recordNotificationOnAction = async () => {};
  // eslint-disable-next-line no-eval
  const _insertOrderIfNotDup = eval(asExpr(SRC_dedup, '_insertOrderIfNotDup'));
  // eslint-disable-next-line no-eval
  const v3OrderNow = eval(asExpr(SRC_v3OrderNow, 'v3OrderNow'));
  // eslint-disable-next-line no-eval
  const _createOrderFromSuggestion = eval(asExpr(SRC_batch, '_createOrderFromSuggestion'));
  return { db, v3OrderNow, _createOrderFromSuggestion };
}
// eslint-disable-next-line no-eval
const _calcOrderQty = eval(asExpr(SRC_calc, '_calcOrderQty'));

// Mirrors the receiving RPC unit gate (exact btrim match, blank/NULL -> mismatch).
function receivable(orderUnit, itemUnit) {
  const o = (orderUnit ?? '').trim(), i = (itemUnit ?? '').trim();
  return o !== '' && i !== '' && o === i;
}

const PACKED = { item_id: 49, item_name: '치즈', unit: '봉지', order_unit_qty: 6, order_unit_name: '박스', vendor_id: null };
const PLAIN = { item_id: 50, item_name: '양파', unit: 'kg', order_unit_qty: 1, order_unit_name: '', vendor_id: null };

let pass = 0, fail = 0;
function check(name, cond, detail) {
  const ok = !!cond;
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

(async () => {
  // W1  unit 봉지 / orderUnitName 박스 / planned qty 6 -> insert qty 6, unit 봉지
  {
    const env = makeEnv([PACKED]);
    await env.v3OrderNow(49, '치즈', 6);
    const r = env.db._inserts[0] || {};
    check('W1 packed item -> qty 6 / unit 봉지', r.qty === 6 && r.unit === '봉지', JSON.stringify(r));
  }
  // W2  no Purchase Unit -> qty/unit are the item's own
  {
    const env = makeEnv([PLAIN]);
    await env.v3OrderNow(50, '양파', 3);
    const r = env.db._inserts[0] || {};
    check('W2 no purchase unit -> qty 3 / unit kg', r.qty === 3 && r.unit === 'kg', JSON.stringify(r));
  }
  // W3  order_unit_name is never a stored / ordered unit
  {
    const single = makeEnv([PACKED]);
    await single.v3OrderNow(49, '치즈', 6);
    const batch = makeEnv([PACKED], [{ name: '치즈', suggested_qty: 5, unit: PACKED.unit, vendor_id: null }]);
    await batch._createOrderFromSuggestion();
    const stored = [...single.db._inserts, ...batch.db._inserts].map(r => r.unit);
    const asUnit = HTML.split('\n').filter(l => /\bunit:\s*[^,\n]*order_unit_name/.test(l));
    check('W3 order_unit_name never used as a unit',
      stored.length === 2 && !stored.includes('박스') && asUnit.length === 0,
      `stored=${JSON.stringify(stored)} sourceHits=${asUnit.length}`);
  }
  // W4  batch path (order suggestion -> 발주 생성)
  {
    const env = makeEnv([PACKED, PLAIN], [
      { name: '치즈', suggested_qty: 5, unit: PACKED.unit, vendor_id: null },
      { name: '양파', suggested_qty: 2, unit: PLAIN.unit, vendor_id: null },
    ]);
    await env._createOrderFromSuggestion();
    const u = env.db._inserts.map(r => `${r.qty}${r.unit}`);
    check('W4 batch path stores items.unit', u.join(',') === '5봉지,2kg', u.join(','));
  }
  // W5  single path (v3 notification -> 주문하기)
  {
    const env = makeEnv([PACKED, PLAIN]);
    await env.v3OrderNow(49, '치즈', 12);
    const r = env.db._inserts[0] || {};
    check('W5 single path stores items.unit', env.db._inserts.length === 1 && r.qty === 12 && r.unit === '봉지', JSON.stringify(r));
  }
  // W6  stored row passes the receiving exact-unit gate
  {
    const env = makeEnv([PACKED]);
    await env.v3OrderNow(49, '치즈', 6);
    const r = env.db._inserts[0] || {};
    check('W6 receiving exact-match compatible', receivable(r.unit, PACKED.unit) && !receivable('박스', PACKED.unit) && !receivable('개', PACKED.unit),
      `order.unit=${r.unit} item.unit=${PACKED.unit}`);
  }
  // W7  rounding: need 5 / pack 6 -> qty 6 (Inventory Units)
  {
    const o = _calcOrderQty(1, 6, null, 6);
    check('W7 need 5 / pack 6 -> 6', o.rawQty === 5 && o.qty === 6, JSON.stringify(o));
  }
  // W8  exact multiple: need 6 / pack 6 -> 6
  {
    const o = _calcOrderQty(0, 6, null, 6);
    check('W8 need 6 / pack 6 -> 6', o.rawQty === 6 && o.qty === 6, JSON.stringify(o));
  }

  console.log(`\nDB Write: 0 (mock client only, no network/supabase import)`);
  console.log(`RESULT: ${pass} PASS / ${fail} FAIL (of 8)`);
  process.exit(fail === 0 ? 0 : 1);
})();
