/*
 * test_receiving.js  — ZK-WEB-ANDROID-CONTRACT-PARITY-001 (Web receiving)
 *
 * Contract: receiving goes through the complete_order_receiving RPC only. The web
 * client never writes items / kitchen_operations / order_requests for a receiving,
 * and only the server's SUCCESS code is shown as a success.
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

const SRC_outcome = extractFn('_receivingOutcome');
const SRC_markReceived = extractFn('markReceived');
const SRC_tblReceive = extractFn('_tblReceive');

// --- MOCK Supabase client: records every table write and every rpc call ---
function makeDb(rpcAnswer) {
  const writes = []; // { table, op, payload }
  const rpcs = [];   // { fn, args }
  function builder(table) {
    const b = {
      select() { return b; }, eq() { return b; }, in() { return b; }, is() { return b; },
      limit() { return b; }, order() { return b; },
      insert(payload) { writes.push({ table, op: 'insert', payload }); return b; },
      update(payload) { writes.push({ table, op: 'update', payload }); return b; },
      upsert(payload) { writes.push({ table, op: 'upsert', payload }); return b; },
      delete() { writes.push({ table, op: 'delete' }); return b; },
      then(resolve) { resolve({ data: [], error: null }); },
    };
    return b;
  }
  return {
    from: t => builder(t),
    rpc(fn, args) {
      rpcs.push({ fn, args });
      if (rpcAnswer instanceof Error) return Promise.reject(rpcAnswer);
      return Promise.resolve(rpcAnswer);
    },
    _writes: writes, _rpcs: rpcs,
  };
}

// --- environment holding the real functions with mocked globals ---
function makeEnv(rpcAnswer, opts = {}) {
  const db = makeDb(rpcAnswer);
  const SID = opts.sid || 1;
  const _items = [{ item_id: 49, item_name: '치즈', unit: '봉지', current_qty: opts.currentQty === undefined ? 4 : opts.currentQty }];
  const _orderRequests = [{ id: 7, store_id: SID, item_id: 49, item_name: '치즈', qty: 6, unit: '봉지', status: 'ordered' }];
  const toasts = [];
  const pattern = { calls: 0 };
  const removed = { count: 0 };
  const receiveItem = { remove() { removed.count++; } };
  const document = {
    querySelector(sel) {
      if (sel.startsWith('.v4-receive-btn')) return { closest: () => receiveItem };
      return null;
    },
    querySelectorAll: () => [],
  };
  const showToast = m => toasts.push(m);
  const _removeOrderRow = () => {};
  const _invalidateDepletionCache = () => {};
  const _onOrderPatternUpdate = () => { pattern.calls++; };
  // eslint-disable-next-line no-eval
  const _receivingOutcome = eval(asExpr(SRC_outcome, '_receivingOutcome'));
  // eslint-disable-next-line no-eval
  const markReceived = eval(asExpr(SRC_markReceived, 'markReceived'));
  // eslint-disable-next-line no-eval
  const _tblReceive = eval(asExpr(SRC_tblReceive, '_tblReceive'));
  return { db, _items, toasts, pattern, removed, _tblReceive, _receivingOutcome };
}

const ok = data => ({ data, error: null });
const SUCCESS = ok({ code: 'SUCCESS', order_id: 7, item_id: 49, qty_before: 4, qty_after: 10, unit: '봉지' });

let pass = 0, fail = 0;
function check(name, cond, detail) {
  const good = !!cond;
  if (good) pass++; else fail++;
  console.log(`${good ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

// A refused / unknown receiving: no client write, stock cache untouched, row kept,
// no success toast, no pattern recalculation.
function refused(env, before) {
  const t = env.toasts.join(' | ');
  return env.db._writes.length === 0 && env._items[0].current_qty === before &&
    env.removed.count === 0 && env.pattern.calls === 0 &&
    env.toasts.length === 1 && !t.includes('입고 완료');
}
const brief = env => `writes=${env.db._writes.length} qty=${env._items[0].current_qty} removed=${env.removed.count} toast=${JSON.stringify(env.toasts)}`;

(async () => {
  // R1  SUCCESS -> success shown, stock cache = server qty_after, row leaves the list
  {
    const env = makeEnv(SUCCESS);
    await env._tblReceive(7);
    check('R1 SUCCESS -> success', env.toasts.join('').includes('입고 완료') && env._items[0].current_qty === 10 &&
      env.removed.count === 1 && env.pattern.calls === 1, brief(env));
  }
  // R2  STOCK_UNKNOWN -> no item write, not done, recovery guidance
  {
    const env = makeEnv(ok({ code: 'STOCK_UNKNOWN', order_id: 7, item_id: 49 }), { currentQty: null });
    await env._tblReceive(7);
    check('R2 STOCK_UNKNOWN -> refused + guidance', refused(env, null) && env.toasts[0].includes('현재 재고를 먼저'), brief(env));
  }
  // R3  UNIT_MISMATCH -> write 0
  {
    const env = makeEnv(ok({ code: 'UNIT_MISMATCH', order_unit: '박스', item_unit: '봉지' }));
    await env._tblReceive(7);
    check('R3 UNIT_MISMATCH -> refused', refused(env, 4), brief(env));
  }
  // R4  STORE_MISMATCH -> write 0 (store 2 is sent as store 2, never rewritten to 1)
  {
    const env = makeEnv(ok({ code: 'STORE_MISMATCH' }), { sid: 2 });
    await env._tblReceive(7);
    check('R4 STORE_MISMATCH -> refused', refused(env, 4) && env.db._rpcs[0].args.p_store_id === 2, brief(env));
  }
  // R5  ALREADY_COMPLETED -> no duplicate inventory write, not a success
  {
    const env = makeEnv(ok({ code: 'ALREADY_COMPLETED', order_id: 7 }));
    await env._tblReceive(7);
    check('R5 ALREADY_COMPLETED -> no duplicate stock', env.db._writes.length === 0 && env._items[0].current_qty === 4 &&
      env.pattern.calls === 0 && !env.toasts.join('').includes('입고 완료') && env.removed.count === 1, brief(env));
  }
  // R6  DATA_CONFLICT -> never a success
  {
    const env = makeEnv(ok({ code: 'DATA_CONFLICT', reason: 'done_without_audit' }));
    await env._tblReceive(7);
    check('R6 DATA_CONFLICT -> refused', refused(env, 4), brief(env));
  }
  // R7  WRITE_FAILED -> never a success
  {
    const env = makeEnv(ok({ code: 'WRITE_FAILED' }));
    await env._tblReceive(7);
    check('R7 WRITE_FAILED -> refused', refused(env, 4), brief(env));
  }
  // R8  unknown code / no code / transport error / thrown call -> never a success
  {
    const answers = [ok({ code: 'SOME_FUTURE_CODE' }), ok({}), ok(null), { data: null, error: { message: 'x' } },
      { data: { code: 'SUCCESS', qty_after: 10 }, error: { message: 'x' } }, new Error('network')];
    let all = true; const seen = [];
    for (const a of answers) {
      const env = makeEnv(a);
      await env._tblReceive(7);
      const r = refused(env, 4); all = all && r; seen.push(r ? 'refused' : 'ACCEPTED');
    }
    check('R8 unknown / unreadable answer -> refused', all, seen.join(','));
  }
  // R9-R11  the live receiving path performs no direct table write, on any answer
  {
    const tables = { items: 0, kitchen_operations: 0, order_requests: 0 };
    let rpcOk = true;
    for (const a of [SUCCESS, ok({ code: 'ALREADY_COMPLETED', order_id: 7 }), ok({ code: 'STOCK_UNKNOWN' }), ok({ code: 'X' })]) {
      const env = makeEnv(a);
      await env._tblReceive(7);
      for (const w of env.db._writes) if (w.table in tables) tables[w.table]++;
      const c = env.db._rpcs;
      rpcOk = rpcOk && c.length === 1 && c[0].fn === 'complete_order_receiving' &&
        JSON.stringify(c[0].args) === JSON.stringify({ p_order_id: 7, p_store_id: 1 });
    }
    const src = SRC_markReceived;
    check('R9 no direct items update', tables.items === 0 && !/from\(\s*['"]items['"]\s*\)/.test(src) && rpcOk,
      `items writes=${tables.items} rpcOnly=${rpcOk}`);
    check('R10 no direct audit insert', tables.kitchen_operations === 0 && !/from\(\s*['"]kitchen_operations['"]\s*\)/.test(src),
      `kitchen_operations writes=${tables.kitchen_operations}`);
    check('R11 no direct done update', tables.order_requests === 0 && !/from\(\s*['"]order_requests['"]\s*\)/.test(src),
      `order_requests writes=${tables.order_requests}`);
  }

  console.log(`\nDB Write: 0 (mock client only, no network/supabase import)`);
  console.log(`RESULT: ${pass} PASS / ${fail} FAIL (of 11)`);
  process.exit(fail === 0 ? 0 : 1);
})();
