/*
 * test_order_dedup.js  — ZK-WEB-DUP-GUARD-FIX-001
 *
 * Verifies that v3OrderNow routes its order_requests creation through the shared
 * dedup entry point _insertOrderIfNotDup, so a pending/ordered order for the same
 * item is not duplicated.
 *
 * The REAL function bodies are extracted from index.html (brace-matched) and run
 * against a MOCK Supabase client. No real DB, no network — DB Write 0.
 */

const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

// --- extract a top-level `async function NAME(...) { ... }` by brace matching ---
function extractFn(name) {
  const sig = 'async function ' + name + '(';
  const start = HTML.indexOf(sig);
  if (start < 0) throw new Error('function not found: ' + name);
  const braceOpen = HTML.indexOf('{', start);
  let depth = 0, i = braceOpen;
  for (; i < HTML.length; i++) {
    const c = HTML[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return HTML.slice(start, i); // full "async function NAME(...) {...}"
}

const SRC_dedup = extractFn('_insertOrderIfNotDup');
const SRC_v3OrderNow = extractFn('v3OrderNow');

// --- MOCK Supabase client that actually applies eq/in filters (so a 'done' row
//     is correctly excluded by the pending/ordered dedup SELECT). ---
function makeDb(orderRows) {
  const inserts = []; // records order_requests inserts only
  function builder(table) {
    const filters = [];
    let inFilter = null;
    let insertedRow = null;
    const b = {
      select() { return b; },
      eq(col, val) { filters.push([col, val]); return b; },
      in(col, arr) { inFilter = [col, arr]; return b; },
      is() { return b; },
      limit() { return b; },
      update() { return b; },
      upsert() { return Promise.resolve({ data: [], error: null }); },
      insert(row) {
        insertedRow = row;
        if (table === 'order_requests') inserts.push(row);
        return b;
      },
      then(resolve) {
        if (insertedRow !== null) { resolve({ data: [insertedRow], error: null }); return; }
        let rows = table === 'order_requests' ? orderRows.slice() : [];
        for (const [c, v] of filters) rows = rows.filter(r => r[c] === v);
        if (inFilter) { const [c, arr] = inFilter; rows = rows.filter(r => arr.includes(r[c])); }
        resolve({ data: rows, error: null });
      },
    };
    return b;
  }
  return { from: t => builder(t), _inserts: inserts };
}

// --- build an environment holding the real functions with mocked globals ---
function makeEnv(orderRows, spy) {
  const db = makeDb(orderRows);
  const SID = 1;
  const document = { querySelector: () => null, querySelectorAll: () => [] };
  const showToast = () => {};
  const renderOrder = async () => {};
  const recordNotificationOnAction = async () => {};
  const _dismissedItemIds = new Set();

  // declaration -> expression so we can capture the reference
  // eslint-disable-next-line no-eval
  let _insertOrderIfNotDup = eval('(' + SRC_dedup.replace(/^async function _insertOrderIfNotDup/, 'async function') + ')');
  if (spy) {
    const real = _insertOrderIfNotDup;
    _insertOrderIfNotDup = async function (...a) { spy.calls++; spy.lastArg = a[0]; return real(...a); };
  }
  // eslint-disable-next-line no-eval
  const v3OrderNow = eval('(' + SRC_v3OrderNow.replace(/^async function v3OrderNow/, 'async function') + ')');
  return { db, v3OrderNow, _insertOrderIfNotDup };
}

function row(status) { return { store_id: 1, item_id: 49, item_name: '코카콜라', qty: 1, unit: '박스', status }; }

let pass = 0, fail = 0;
function check(name, cond, detail) {
  const ok = !!cond;
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

(async () => {
  // CASE 1  existing=pending -> insert 0
  {
    const env = makeEnv([row('pending')]);
    await env.v3OrderNow(49, '코카콜라', 2);
    check('CASE 1 existing=pending -> insert 0', env.db._inserts.length === 0, `inserts=${env.db._inserts.length}`);
  }
  // CASE 2  existing=ordered -> insert 0
  {
    const env = makeEnv([row('ordered')]);
    await env.v3OrderNow(49, '코카콜라', 2);
    check('CASE 2 existing=ordered -> insert 0', env.db._inserts.length === 0, `inserts=${env.db._inserts.length}`);
  }
  // CASE 3  existing=done -> insert 1
  {
    const env = makeEnv([row('done')]);
    await env.v3OrderNow(49, '코카콜라', 2);
    check('CASE 3 existing=done -> insert 1', env.db._inserts.length === 1, `inserts=${env.db._inserts.length}`);
  }
  // CASE 4  existing=cancelled -> insert 1
  {
    const env = makeEnv([row('cancelled')]);
    await env.v3OrderNow(49, '코카콜라', 2);
    check('CASE 4 existing=cancelled -> insert 1', env.db._inserts.length === 1, `inserts=${env.db._inserts.length}`);
  }
  // CASE 5  existing=none -> insert 1
  {
    const env = makeEnv([]);
    await env.v3OrderNow(49, '코카콜라', 2);
    check('CASE 5 existing=none -> insert 1', env.db._inserts.length === 1, `inserts=${env.db._inserts.length}`);
  }
  // CASE 6  v3OrderNow source does NOT contain a direct order_requests insert
  {
    const direct = /from\(\s*['"]order_requests['"]\s*\)\s*\.insert/.test(SRC_v3OrderNow);
    check('CASE 6 v3OrderNow has no direct order_requests.insert', direct === false, direct ? 'direct insert still present' : 'none');
  }
  // CASE 7  v3OrderNow calls _insertOrderIfNotDup exactly once
  {
    const spy = { calls: 0, lastArg: null };
    const env = makeEnv([], spy);
    await env.v3OrderNow(49, '코카콜라', 2);
    check('CASE 7 _insertOrderIfNotDup called exactly once', spy.calls === 1, `calls=${spy.calls}`);
  }
  // CASE 8  store_id/item_id/qty/unit/vendor_id preserved through the guard
  {
    const spy = { calls: 0, lastArg: null };
    const env = makeEnv([], spy);
    await env.v3OrderNow(49, '코카콜라', 2);
    const p = spy.lastArg || {};
    const inserted = env.db._inserts[0] || {};
    const okKeys = p.store_id === 1 && p.item_id === 49 && p.qty === 2 &&
      p.item_name === '코카콜라' && p.status === 'pending';
    // unit / vendor_id are intentionally absent (DB-defaulted) — same as the old direct insert.
    const defaultsUntouched = !('unit' in p) && !('vendor_id' in p) &&
      !('unit' in inserted) && !('vendor_id' in inserted);
    check('CASE 8 payload preserved (store/item/qty/name/status; unit&vendor DB-default)',
      okKeys && defaultsUntouched, JSON.stringify(p));
  }

  console.log(`\nDB Write: 0 (mock client only, no network/supabase import)`);
  console.log(`RESULT: ${pass} PASS / ${fail} FAIL (of 8)`);
  process.exit(fail === 0 ? 0 : 1);
})();
