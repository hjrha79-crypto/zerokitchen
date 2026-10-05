/*
 * test_inventory_trust.js  — ZEROKITCHEN_TRUSTED_INVENTORY_GATE_BOUNDED_BUILD_V0_1
 *
 * Contract: a recorded current_qty is the current inventory only when
 *   1. the latest absolute observation (stock_check) is an explicit "재고 확인"
 *      (input_method = trusted_stock_check),
 *   2. every later stock-changing record continues the chain (prev.qty_after = next.qty_before),
 *   3. no simulation record is mixed in, and
 *   4. the last record's qty_after equals current_qty.
 * Otherwise a NEEDED / SUFFICIENT verdict becomes NEEDS_VERIFICATION (the recorded number is kept).
 * The need formula itself (_orderNeedOf), UNKNOWN, NO_TARGET and INVALID are unchanged.
 *
 * The REAL function bodies are extracted from index.html (brace-matched) and run against a
 * MOCK Supabase client. No real DB, no network. With `--live <items.json> <ops.json>` the same
 * functions are run over a read-only export of store 1.
 */

const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

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
const SRC = {};
for (const n of ['_orderNeedOf', '_inventoryTrustOf', '_admittedNeedOf', '_loadInventoryTrust', '_trustedStockCheck', '_renderOrderNeed', '_v3NeedLine']) SRC[n] = extractFn(n);
const TRUSTED = (/const TRUSTED_STOCK_CHECK = '([^']+)'/.exec(HTML) || [])[1];

// --- MOCK Supabase client: kitchen_operations reads honour eq / in / gte; every write is recorded.
// `server` holds the items as the database has them (an update that succeeds is applied there).
// Write failures: failInsert / failUpdate -> {error}; insertMode / updateMode 'throw' (the call throws)
// or 'reject' (the request rejects); 'rejectAfterApply' = applied on the server, then the response is lost.
function makeDb(ops, opts = {}, server = []) {
  const writes = [];
  let stamp = 0;
  function builder(table) {
    const eqs = {}; let ins = null, gte = null, op = null, payload = null;
    const mode = () => (op === 'insert' && table === 'kitchen_operations') ? opts.insertMode : (op === 'update' ? opts.updateMode : null);
    const b = {
      select() { return b; }, order() { return b; },
      eq(c, v) { eqs[c] = v; return b; }, in(c, v) { ins = [c, v]; return b; }, gte(c, v) { gte = [c, v]; return b; },
      insert(p) { op = 'insert'; payload = p; writes.push({ table, op, payload: p }); if (mode() === 'throw') throw new Error('insert threw'); return b; },
      update(p) { op = 'update'; payload = p; writes.push({ table, op, payload: p }); if (mode() === 'throw') throw new Error('update threw'); return b; },
      then(resolve, reject) {
        if (op) {
          const applyWrite = () => {
            if (op === 'insert' && table === 'kitchen_operations') ops.push({ operation_id: 9000 + ops.length, created_at: `2026-10-03T09:${String(stamp++).padStart(2, '0')}:00Z`, ...payload });
            if (op === 'update' && table === 'items') { const row = server.find(r => r.item_id === eqs.item_id); if (row) Object.assign(row, payload); }
          };
          if (mode() === 'reject') { reject(new Error('request rejected')); return; }
          if (mode() === 'rejectAfterApply') { applyWrite(); reject(new Error('response lost')); return; }
          const fail = (opts.failInsert && op === 'insert' && table === 'kitchen_operations') || (opts.failUpdate && op === 'update');
          if (!fail) applyWrite();
          resolve({ data: null, error: fail ? { message: 'write failed' } : null });
          return;
        }
        if (opts.failRead) { resolve({ data: null, error: { message: 'read failed' } }); return; }
        let rows = table === 'kitchen_operations' ? ops.slice() : [];
        for (const [c, v] of Object.entries(eqs)) rows = rows.filter(r => r[c] === v);
        if (ins) rows = rows.filter(r => ins[1].includes(r[ins[0]]));
        if (gte) rows = rows.filter(r => r[gte[0]] >= gte[1]);
        resolve({ data: rows, error: null });
      },
    };
    return b;
  }
  return { from: t => builder(t), _writes: writes };
}

let opSeq = 0;
const at = n => `2026-10-01T0${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}:00Z`;
const op = (item_id, action_type, qty_before, qty_after, input_method = 'api', raw_text = '') =>
  ({ store_id: 1, item_id, operation_id: ++opSeq, created_at: at(opSeq), action_type, qty_before, qty_after, input_method, raw_text });
const item = (item_id, item_name, current_qty, target_qty, unit) => ({ item_id, item_name, current_qty, target_qty, unit, order_unit_qty: 1, order_unit_name: '' });

function makeEnv(items, ops, opts = {}) {
  const server = opts.server || items.map(i => ({ ...i }));
  const db = makeDb(ops, opts, server);
  const SID = 1; let _storeEpoch = 0; const _storeChanged = ep => ep !== _storeEpoch;   // store switch guard (index.html)
  let _items = items.map(i => ({ ...i }));
  let refreshCalls = 0;
  const refreshItems = async () => { refreshCalls++; _items = server.map(i => ({ ...i })); };
  const _orderRequests = [];
  let _itemTrust = new Map();
  let _stockCheckBusy = false;
  const el = { innerHTML: null };
  const document = { getElementById: id => (id === 'orderNeedCard' ? el : null) };
  const toasts = [];
  const showToast = m => toasts.push(m);
  const prompt = opts.prompt === undefined ? undefined : (() => opts.prompt);
  const _invalidateDepletionCache = () => {};
  const TRUSTED_STOCK_CHECK = TRUSTED;
  const f = {};
  // eslint-disable-next-line no-eval
  for (const n of Object.keys(SRC)) f[n] = eval(asExpr(SRC[n], n));
  const { _orderNeedOf, _inventoryTrustOf, _admittedNeedOf, _loadInventoryTrust, _renderOrderNeed } = f;
  void _orderNeedOf; void _inventoryTrustOf; void _admittedNeedOf; void _loadInventoryTrust; void _renderOrderNeed; void prompt; void TRUSTED_STOCK_CHECK; void refreshItems;
  return {
    db, f, el, toasts, server, refreshes: () => refreshCalls,
    get items() { return _items; }, trust: () => _itemTrust, setTrust: m => { _itemTrust = m; },
  };
}

let pass = 0, fail = 0, total = 0;
function check(name, cond, detail) {
  const ok = !!cond; total++;
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}
const show = n => `${n.state}${n.state === 'NEEDED' ? ' ' + n.qty + n.unit : ''}${n.state === 'NEEDS_VERIFICATION' ? ' recorded=' + n.recorded + n.unit + ' reason=' + n.reason : ''}`;

// Gate one item end to end: trust from its ops, then the admitted need.
async function gate(it, ops) {
  const env = makeEnv([it], ops);
  await env.f._loadInventoryTrust();
  return { need: env.f._admittedNeedOf(env.items[0]), trust: env.trust().get(it.item_id) || null, env };
}

(async () => {
  if (process.argv[2] === '--live') {
    // ── Production acceptance (read-only export): what the gate says about store 1 today ──
    const items = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
    const ops = JSON.parse(fs.readFileSync(process.argv[4], 'utf8'));
    const env = makeEnv(items, ops);
    await env.f._loadInventoryTrust();
    const by = name => env.items.find(i => i.item_name === name);
    const cases = [['우유', 1], ['파인애플', 174], ['치즈', 10], ['파마산 치즈', 32], ['스파게티니', 77]];
    for (const [name, id] of cases) {
      const it = by(name);
      const n = env.f._admittedNeedOf(it);
      const full = env.f._inventoryTrustOf(it.current_qty, ops.filter(o => o.item_id === it.item_id));
      check(`LIVE ${name}(${id}) -> NEEDS_VERIFICATION, recorded kept`, it.item_id === id && n.state === 'NEEDS_VERIFICATION' && n.recorded === Number(it.current_qty),
        `${show(n)} | full-history verdict=${full.trusted ? 'TRUSTED' : full.reason}`);
    }
    env.f._renderOrderNeed();
    const html = env.el.innerHTML;
    const st = {}; for (const i of env.items) { const s = env.f._admittedNeedOf(i).state; st[s] = (st[s] || 0) + 1; }
    const anchors = ops.filter(o => o.input_method === TRUSTED).length;
    check('LIVE card: no confirmed need, no confirmed "nothing to order", verification listed',
      !/data-need-iid=/.test(html) && !html.includes('지금 발주 필요한 품목 없음') && html.includes('확정된 발주 필요 없음') && !html.includes('data-ok-iid='),
      `states=${JSON.stringify(st)} trusted anchors in store=${anchors}`);
    console.log(`RESULT: ${pass} PASS / ${fail} FAIL (of ${total})`);
    process.exit(fail === 0 ? 0 : 1);
  }

  const T = TRUSTED;
  check('marker: reserved input_method is "trusted_stock_check"', T === 'trusted_stock_check', String(T));

  // CASE A  trusted shortage
  { const r = await gate(item(1, 'A', 2, 6, '캔'), [op(1, 'stock_check', 0, 2, T)]);
    check('A trusted 2 / target 6 -> NEEDED 4', r.need.state === 'NEEDED' && r.need.qty === 4 && r.trust.trusted, show(r.need)); }
  // CASE B  trusted sufficient
  { const r = await gate(item(1, 'B', 8, 6, '개'), [op(1, 'stock_check', 0, 8, T)]);
    check('B trusted 8 / target 6 -> SUFFICIENT', r.need.state === 'SUFFICIENT', show(r.need)); }
  // CASE C  untrusted numeric shortage
  { const r = await gate(item(1, 'C', 2, 6, '캔'), [op(1, 'stock_check', 0, 2, 'android_edit')]);
    check('C untrusted 2 / 6 -> NEEDS_VERIFICATION, no confirmed need, recorded 2', r.need.state === 'NEEDS_VERIFICATION' && r.need.qty === 0 && r.need.recorded === 2 && r.need.reason === 'NO_TRUST_BASIS', show(r.need)); }
  // CASE D  untrusted numeric sufficient
  { const r = await gate(item(1, 'D', 8, 6, '개'), [op(1, 'stock_check', 0, 8, 'table_review')]);
    check('D untrusted 8 / 6 -> NEEDS_VERIFICATION, no confirmed sufficient', r.need.state === 'NEEDS_VERIFICATION' && r.need.recorded === 8, show(r.need)); }
  // no audit history at all
  { const r = await gate(item(1, 'D2', 8, 6, '개'), []);
    check('D no history -> NEEDS_VERIFICATION (NO_TRUST_BASIS)', r.need.state === 'NEEDS_VERIFICATION' && r.need.reason === 'NO_TRUST_BASIS', show(r.need)); }
  // CASE E  UNKNOWN stays UNKNOWN (with or without trust)
  { const a = await gate(item(1, 'E', null, 6, 'kg'), []), b = await gate(item(1, 'E', null, 6, 'kg'), [op(1, 'stock_check', 0, 3, T)]);
    check('E current null -> UNKNOWN, never 0, never NEEDS_VERIFICATION', a.need.state === 'UNKNOWN' && b.need.state === 'UNKNOWN' && a.need.qty === 0, `${show(a.need)} / ${show(b.need)}`); }
  // CASE F  NO_TARGET untouched by the gate
  { const s = [];
    for (const tq of [0, null]) for (const ops of [[], [op(1, 'stock_check', 0, 5, T)]]) s.push((await gate(item(1, 'F', 5, tq, '개'), ops)).need.state);
    check('F target 0 / null -> NO_TARGET (trusted or not)', s.every(x => x === 'NO_TARGET'), s.join(',')); }
  // INVALID untouched
  { const r = await gate(item(1, 'INV', -1, 6, '개'), [op(1, 'stock_check', 0, -1, T)]);
    check('INVALID stays INVALID', r.need.state === 'INVALID', show(r.need)); }
  // CASE G  simulation
  { const prodLike = await gate(item(1, 'G', 2, 6, '캔'), [op(1, 'order', null, 0, 'table_review'), op(1, 'stock_check', 0, 2, 'api', 'simulation baseline 001: 재고 0→2')]);
    const afterTrusted = await gate(item(1, 'G2', 6, 6, '개'), [op(1, 'stock_check', 0, 8, T), op(1, 'consume', 8, 6, 'api', 'simulation baseline 001')]);
    const typed = await gate(item(1, 'G3', 6, 6, '개'), [op(1, 'stock_check', 0, 8, T), op(1, 'consume', 8, 6, 'simulation')]);
    check('G simulation record -> NEEDS_VERIFICATION (latest sim observation / sim after trusted)',
      prodLike.need.state === 'NEEDS_VERIFICATION' && afterTrusted.need.state === 'NEEDS_VERIFICATION' && afterTrusted.need.reason === 'SIMULATION' && typed.need.reason === 'SIMULATION',
      `${show(prodLike.need)} | ${show(afterTrusted.need)} | ${show(typed.need)}`); }
  // CASE H  broken continuity
  { const gap = await gate(item(1, 'H', 7, 9, '개'), [op(1, 'stock_check', 0, 10, T), op(1, 'consume', 9, 7, 'android_edit')]);
    const nul = await gate(item(1, 'H2', 7, 9, '개'), [op(1, 'stock_check', 0, 10, T), op(1, 'consume', null, 7, 'api')]);
    check('H broken chain (10 -> before 9) / missing qty_before -> NEEDS_VERIFICATION (BROKEN_CONTINUITY)',
      gap.need.reason === 'BROKEN_CONTINUITY' && nul.need.reason === 'BROKEN_CONTINUITY' && gap.need.state === 'NEEDS_VERIFICATION', `${show(gap.need)} | ${show(nul.need)}`); }
  // CASE I  latest audit / current mismatch
  { const r = await gate(item(1, 'I', 7, 9, '개'), [op(1, 'stock_check', 0, 5, T)]);
    check('I last qty_after 5 vs current 7 -> NEEDS_VERIFICATION (CONFLICT)', r.need.state === 'NEEDS_VERIFICATION' && r.need.reason === 'CONFLICT', show(r.need)); }
  // CASE J  trusted observation + clean audited continuation (order records are skipped)
  { const r = await gate(item(1, 'J', 9, 12, '개'), [op(1, 'stock_check', 0, 10, T), op(1, 'consume', 10, 7, 'android_edit'), op(1, 'order', 7, 7, 'api'), op(1, 'inbound', 7, 9, 'fast_path')]);
    check('J trusted + consume + order + inbound, chain intact -> TRUSTED (NEEDED 3)', r.trust.trusted && r.need.state === 'NEEDED' && r.need.qty === 3, show(r.need)); }
  // CASE K  trusted baseline + canonical receiving continuation
  { const r = await gate(item(1, 'K', 8, 6, '캔'), [op(1, 'stock_check', 0, 2, T), op(1, 'inbound', 2, 8, 'order_complete', '발주 #1 입고 완료')]);
    check('K trusted 2 + receiving 2->8 -> trust kept (SUFFICIENT)', r.trust.trusted && r.need.state === 'SUFFICIENT', show(r.need)); }
  // CASE L  untrusted baseline + receiving: no automatic promotion
  { const r = await gate(item(1, 'L', 8, 6, '캔'), [op(1, 'stock_check', 0, 2, 'android_edit'), op(1, 'inbound', 2, 8, 'order_complete')]);
    const none = await gate(item(1, 'L2', 8, 6, '캔'), [op(1, 'inbound', 2, 8, 'order_complete')]);
    check('L untrusted baseline + receiving -> NEEDS_VERIFICATION (no promotion)', r.need.state === 'NEEDS_VERIFICATION' && none.need.state === 'NEEDS_VERIFICATION', `${show(r.need)} | ${show(none.need)}`); }
  // a later ordinary stock edit after a trusted check ends the trust
  { const r = await gate(item(1, 'M', 4, 6, '개'), [op(1, 'stock_check', 0, 5, T), op(1, 'stock_check', 5, 4, 'android_edit')]);
    check('M trusted check, then an ordinary stock edit -> NEEDS_VERIFICATION', r.need.state === 'NEEDS_VERIFICATION' && r.need.reason === 'NO_TRUST_BASIS', show(r.need)); }
  // the gate re-checks the cached verdict against current_qty (stock changed on screen after loading)
  { const r = await gate(item(1, 'N', 2, 6, '캔'), [op(1, 'stock_check', 0, 2, T)]);
    r.env.items[0].current_qty = 3;
    const n = r.env.f._admittedNeedOf(r.env.items[0]);
    check('N current changed after the verdict was loaded -> NEEDS_VERIFICATION until re-read', n.state === 'NEEDS_VERIFICATION' && n.reason === 'CONFLICT', show(n)); }
  // the formula itself is unchanged (D-034): admitted NEEDED qty == _orderNeedOf qty
  { const it = item(1, 'P', 3.1, 5.3, 'kg');
    const r = await gate(it, [op(1, 'stock_check', 0, 3.1, T)]);
    check('formula unchanged: trusted 3.1 / 5.3 -> 2.2 (same as _orderNeedOf)', r.need.qty === 2.2 && r.need.qty === r.env.f._orderNeedOf(it).qty, show(r.need)); }

  // ── the rule itself (_inventoryTrustOf), without the loader and gate re-checks in front of it ──
  { const env = makeEnv([], []);
    const rule = (cur, ops) => env.f._inventoryTrustOf(cur, ops);
    const cases = [
      ['trusted', rule(2, [op(1, 'stock_check', 0, 2, T)]), true, null],
      ['untrusted observation', rule(2, [op(1, 'stock_check', 0, 2, 'android_edit')]), false, 'NO_TRUST_BASIS'],
      ['simulation after trusted', rule(6, [op(1, 'stock_check', 0, 8, T), op(1, 'consume', 8, 6, 'api', 'simulation baseline 001')]), false, 'SIMULATION'],
      ['broken chain', rule(7, [op(1, 'stock_check', 0, 10, T), op(1, 'consume', 9, 7, 'api')]), false, 'BROKEN_CONTINUITY'],
      ['last record vs current', rule(7, [op(1, 'stock_check', 0, 5, T)]), false, 'CONFLICT'],
      ['current unknown', rule(null, [op(1, 'stock_check', 0, 5, T)]), false, 'CONFLICT'],
      ['untrusted baseline + receiving', rule(8, [op(1, 'stock_check', 0, 2, 'android_edit'), op(1, 'inbound', 2, 8, 'order_complete')]), false, 'NO_TRUST_BASIS'],
      ['receiving only', rule(8, [op(1, 'inbound', 2, 8, 'order_complete')]), false, 'NO_TRUST_BASIS'],
      ['ordinary edit after trusted', rule(4, [op(1, 'stock_check', 0, 5, T), op(1, 'stock_check', 5, 4, 'android_edit')]), false, 'NO_TRUST_BASIS'],
    ];
    const bad = cases.filter(([, r, ok, reason]) => r.trusted !== ok || (reason && r.reason !== reason));
    check('rule: each condition decided by _inventoryTrustOf itself', bad.length === 0,
      bad.length ? 'WRONG: ' + bad.map(([n, r]) => `${n}=${r.trusted ? 'TRUSTED' : r.reason}`).join(', ') : cases.map(([n, r]) => `${n}=${r.trusted ? 'TRUSTED' : r.reason}`).join(', ')); }

  // ── loader ──
  { const env = makeEnv([item(1, 'a', 2, 6, '캔'), item(2, 'b', 8, 6, '개')], [op(1, 'stock_check', 0, 2, T), op(2, 'stock_check', 0, 8, 'android_edit')]);
    await env.f._loadInventoryTrust();
    check('loader: reads only, trust for anchored items, none for others', env.db._writes.length === 0 && env.trust().get(1).trusted && !env.trust().has(2), `trust keys=${[...env.trust().keys()]}`);
    const bad = makeEnv([item(1, 'a', 2, 6, '캔')], [op(1, 'stock_check', 0, 2, T)], { failRead: true });
    bad.setTrust(new Map([[1, { trusted: true, lastQty: 2 }]]));
    await bad.f._loadInventoryTrust();
    check('loader: read failure -> everything unverified (fail closed, stale trust dropped)', bad.trust().size === 0 && bad.f._admittedNeedOf(bad.items[0]).state === 'NEEDS_VERIFICATION', ''); }

  // ── Home card ──
  { const items = [item(1, '우유', 1, 3, '박스'), item(174, '파인애플', 2, 6, '캔'), item(10, '치즈', 8, 6, '개'), item(5, '양파', null, 6, 'kg'), item(9, '신규', 0, 0, '개')];
    const ops = [op(1, 'stock_check', 4, 1, 'api', 'simulation baseline 001'), op(174, 'stock_check', 0, 2, 'api', 'simulation baseline 001'), op(10, 'stock_check', 0, 8, 'api', 'simulation baseline 001')];
    const env = makeEnv(items, ops);
    await env.f._loadInventoryTrust(); env.f._renderOrderNeed();
    const html = env.el.innerHTML;
    check('card (no trusted stock): no confirmed need or sufficient rows, no "nothing to order" claim',
      !/data-need-iid=/.test(html) && !/data-ok-iid=/.test(html) && !html.includes('지금 발주 필요한 품목 없음') && html.includes('확정된 발주 필요 없음 — 재고 확인 필요 4개'), '');
    check('card: recorded but untrusted rows show the recorded number and a check button',
      html.includes('우유 — 기록 재고 1박스 / 목표 3박스') && html.includes('파인애플 — 기록 재고 2캔 / 목표 6캔') && html.includes('치즈 — 기록 재고 8개 / 목표 6개') &&
      (html.match(/data-verify-iid=/g) || []).length === 3 && html.includes("_trustedStockCheck(174)"), '');
    check('card: UNKNOWN listed separately from recorded-but-untrusted', html.includes('data-unknown-iid="5"') && html.includes('양파 — 재고 기록 없음') && !html.includes('data-verify-iid="5"'), '');
    check('card: drawing writes nothing', env.db._writes.length === 0, `writes=${env.db._writes.length}`); }
  { // trusted + untrusted mixed
    const items = [item(1, '우유', 1, 3, '박스'), item(10, '치즈', 8, 6, '개')];
    const env = makeEnv(items, [op(1, 'stock_check', 4, 1, T), op(10, 'stock_check', 0, 8, 'api', 'simulation baseline 001')]);
    await env.f._loadInventoryTrust(); env.f._renderOrderNeed();
    const html = env.el.innerHTML;
    check('card (mixed): trusted shortage confirmed, untrusted kept in verification', html.includes('data-need-iid="1"') && html.includes('지금 발주 필요 1개 품목') && html.includes('data-verify-iid="10"') && !html.includes('data-ok-iid="10"'), ''); }

  // ── "재고 확인": the explicit action that starts trust ──
  { const items = [item(174, '파인애플', 2, 6, '캔')];
    const base = [op(174, 'stock_check', 0, 2, 'api', 'simulation baseline 001')];
    const ops = { slice: () => base.map(o => ({ ...o })) }; // every env gets its own copy (the mock appends inserts)
    const env = makeEnv(items, ops.slice(), { prompt: '3' });
    await env.f._loadInventoryTrust();
    const before = env.f._admittedNeedOf(env.items[0]).state;
    await env.f._trustedStockCheck(174);
    const w = env.db._writes;
    const upd = w.find(x => x.table === 'items' && x.op === 'update'), ins = w.find(x => x.table === 'kitchen_operations' && x.op === 'insert');
    const after = env.f._admittedNeedOf(env.items[0]);
    check('stock check: writes items + one trusted stock_check audit (before 2 -> after 3)',
      w.length === 2 && upd.payload.current_qty === 3 && ins.payload.input_method === T && ins.payload.action_type === 'stock_check' && ins.payload.qty_before === 2 && ins.payload.qty_after === 3 && ins.payload.unit === '캔',
      JSON.stringify(ins && ins.payload));
    check('stock check: NEEDS_VERIFICATION -> trusted NEEDED 3 after the check', before === 'NEEDS_VERIFICATION' && after.state === 'NEEDED' && after.qty === 3, `${before} -> ${show(after)}`);
    const unk = makeEnv([item(5, '양파', null, 6, 'kg')], [], { prompt: '2.5' });
    await unk.f._trustedStockCheck(5);
    const ui = unk.db._writes.find(x => x.table === 'kitchen_operations');
    check('stock check on UNKNOWN: qty_before null, then trusted', ui && ui.payload.qty_before === null && unk.f._admittedNeedOf(unk.items[0]).state === 'NEEDED', show(unk.f._admittedNeedOf(unk.items[0])));
    let noWrite = true; const seen = [];
    for (const p of [null, '', 'abc', '-1', '3,000', '1e3']) { const e = makeEnv(items, ops.slice(), { prompt: p }); await e.f._trustedStockCheck(174); noWrite = noWrite && e.db._writes.length === 0; seen.push(`${JSON.stringify(p)}:${e.db._writes.length}`); }
    const noPrompt = makeEnv(items, ops.slice()); await noPrompt.f._trustedStockCheck(174);
    check('stock check: cancel / invalid input / no prompt -> no write', noWrite && noPrompt.db._writes.length === 0, seen.join(' '));
    // ── recovery failures: every path ends with no false success, the card re-drawn from a re-read
    //    verdict, and a retry possible ──
    const NOT_DONE = '재고 확인이 완료되지 않았습니다';
    const auditCases = [['C audit {error}', { failInsert: true }], ['D audit request rejects', { insertMode: 'reject' }],
      ['E audit call throws', { insertMode: 'throw' }], ['E2 audit applied but the response is lost', { insertMode: 'rejectAfterApply' }]];
    for (const [name, o] of auditCases) {
      const e = makeEnv(items, ops.slice(), { prompt: '3', ...o });
      await e.f._loadInventoryTrust();
      let threw = null; try { await e.f._trustedStockCheck(174); } catch (x) { threw = x; }
      const n = e.f._admittedNeedOf(e.items[0]);
      const lost = o.insertMode === 'rejectAfterApply';
      const html = e.el.innerHTML || '';
      check(`${name} -> no throw, never "확인됨", card re-drawn, stock 3 kept, ${lost ? 'reload decides (trusted)' : 'still NEEDS_VERIFICATION'}`,
        threw === null && !e.toasts.some(t => t.includes('확인됨')) && e.toasts.some(t => t.includes(NOT_DONE)) && e.items[0].current_qty === 3 &&
        (lost ? n.state === 'NEEDED' : (n.state === 'NEEDS_VERIFICATION' && html.includes('data-verify-iid="174"') && html.includes('기록 재고 3캔'))),
        `${show(n)} | ${e.toasts.join(' | ')}${threw ? ' | THREW ' + threw.message : ''}`);
    }
    const updCases = [['B item update {error}', { failUpdate: true }], ['B2 item update rejects', { updateMode: 'reject' }],
      ['B3 item update throws', { updateMode: 'throw' }], ['B4 item update applied, response lost', { updateMode: 'rejectAfterApply' }]];
    for (const [name, o] of updCases) {
      const e = makeEnv(items, ops.slice(), { prompt: '3', ...o });
      await e.f._loadInventoryTrust();
      let threw = null; try { await e.f._trustedStockCheck(174); } catch (x) { threw = x; }
      const applied = o.updateMode === 'rejectAfterApply';
      check(`${name} -> no audit, nothing trusted, stock re-read (${applied ? '3 on the server' : 'still 2'}), "저장하지 못했습니다"`,
        threw === null && !e.db._writes.some(x => x.table === 'kitchen_operations') && e.refreshes() === 1 &&
        e.items[0].current_qty === (applied ? 3 : 2) && e.f._admittedNeedOf(e.items[0]).state === 'NEEDS_VERIFICATION' &&
        e.toasts.some(t => t.includes('저장하지 못했습니다')) && !e.toasts.some(t => t.includes('확인됨')), `${e.toasts.join(' | ')}${threw ? ' | THREW ' + threw.message : ''}`);
    }
    // G  retry after a failed audit succeeds; the env is re-used as the user would
    { const shared = ops.slice();
      const e = makeEnv(items, shared, { prompt: '3', insertMode: 'reject' });
      await e.f._loadInventoryTrust(); await e.f._trustedStockCheck(174);
      const first = e.f._admittedNeedOf(e.items[0]).state;
      const retry = makeEnv(e.items, shared, { prompt: '3', server: e.server });
      await retry.f._loadInventoryTrust(); await retry.f._trustedStockCheck(174);
      const n = retry.f._admittedNeedOf(retry.items[0]);
      check('G retry after a failed audit -> trusted NEEDED 3, "확인됨"', first === 'NEEDS_VERIFICATION' && n.state === 'NEEDED' && n.qty === 3 && retry.toasts.some(t => t.includes('확인됨')) && (retry.el.innerHTML || '').includes('data-need-iid="174"'), show(n)); }
    // A/F  success re-draws the card from the re-read verdict
    { const e = makeEnv(items, ops.slice(), { prompt: '2' });
      await e.f._loadInventoryTrust(); e.f._renderOrderNeed();
      const beforeHtml = e.el.innerHTML;
      await e.f._trustedStockCheck(174);
      check('A success: card goes from "재고 확인 필요" to "지금 발주 필요 … 4캔"', beforeHtml.includes('data-verify-iid="174"') && e.el.innerHTML.includes('data-need-iid="174"') && e.el.innerHTML.includes('4캔') && !e.el.innerHTML.includes('data-verify-iid="174"'), ''); }
    // H  reload / tab re-entry: a fresh screen reading the same rows keeps the trust
    { const shared = ops.slice();
      const e = makeEnv(items, shared, { prompt: '2' });
      await e.f._loadInventoryTrust(); await e.f._trustedStockCheck(174);
      const fresh = makeEnv(e.server, shared);
      await fresh.f._loadInventoryTrust();
      const n = fresh.f._admittedNeedOf(fresh.items[0]);
      check('H reload / re-entry -> still trusted NEEDED 4', n.state === 'NEEDED' && n.qty === 4, show(n)); }
    // I  repeated checks: the latest count wins
    { const shared = ops.slice();
      const a = makeEnv(items, shared, { prompt: '2' }); await a.f._loadInventoryTrust(); await a.f._trustedStockCheck(174);
      const b = makeEnv(a.server, shared, { prompt: '5', server: a.server }); await b.f._loadInventoryTrust(); await b.f._trustedStockCheck(174);
      const n = b.f._admittedNeedOf(b.items[0]);
      check('I repeated check -> latest count (5) trusted, NEEDED 1', n.state === 'NEEDED' && n.qty === 1, show(n)); }
    // J  an ordinary edit after the check ends the trust (as the table / inventory edits write it)
    { const shared = ops.slice();
      const a = makeEnv(items, shared, { prompt: '2' }); await a.f._loadInventoryTrust(); await a.f._trustedStockCheck(174);
      shared.push({ ...op(174, 'stock_check', 2, 3, 'table_edit'), created_at: '2026-10-03T10:00:00Z' });
      a.server[0].current_qty = 3;
      const fresh = makeEnv(a.server, shared); await fresh.f._loadInventoryTrust();
      const n = fresh.f._admittedNeedOf(fresh.items[0]);
      check('J ordinary edit after the check -> NEEDS_VERIFICATION again', n.state === 'NEEDS_VERIFICATION' && n.recorded === 3, show(n)); }
    // a second press while a check is running is ignored
    { let release; const gate = new Promise(r => { release = r; });
      const e = makeEnv(items, ops.slice(), { prompt: '3' });
      const realFrom = e.db.from; let calls = 0;
      e.db.from = t => { const b = realFrom(t); if (t === 'items') { const u = b.update; b.update = p => { calls++; const r = u(p); const then = r.then; r.then = (res, rej) => gate.then(() => then(res, rej)); return r; }; } return b; };
      const p1 = e.f._trustedStockCheck(174); const p2 = e.f._trustedStockCheck(174);
      release(); await Promise.all([p1, p2]);
      check('double press while a check runs -> one write', calls === 1, `item updates=${calls}`); } }

  // ── reminder state line follows the gate ──
  { const env = makeEnv([item(174, '파인애플', 2, 6, '캔')], [op(174, 'stock_check', 0, 2, 'api', 'simulation baseline 001')]);
    await env.f._loadInventoryTrust();
    const line = env.f._v3NeedLine(174);
    check('reminder line: untrusted -> "기록 재고 … 재고 확인 필요", never "현재 부족"', line.state === 'NEEDS_VERIFICATION' && line.text === '기록 재고 2캔 / 목표 6캔 — 재고 확인 필요' && !line.text.includes('현재 부족'), line.text); }

  console.log(`\nDB Write: 0 (mock client only, no network/supabase import)`);
  console.log(`RESULT: ${pass} PASS / ${fail} FAIL (of ${total})`);
  process.exit(fail === 0 ? 0 : 1);
})();
