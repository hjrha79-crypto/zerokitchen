/*
 * test_truth_safety.js — USER MODE Truth Safety P0 (ZEROKITCHEN_USER_MODE_TRUTH_SAFETY_P0_V0_1)
 *
 * A  COPY ≠ ORDER      발주 복사는 클립보드만 — order_requests 상태를 바꾸지 않고 "주문 완료"라고 말하지 않는다.
 * B  UNKNOWN ≠ ZERO    발주표 재고 칸: 빈 칸·바꾸지 않음은 쓰기 0, 명시한 "0"만 0, 소수 유지, 재고 모름 → qty_before null.
 * C  UNDO ≠ DELETE     되돌리기는 이전 값 복원 + 되돌리기 기록 추가 (삭제 0). 그 뒤 바뀐 재고는 덮지 않고, 두 번 되돌리지 않는다.
 * REAL functions from index.html, in-memory MOCK db — DB Write 0.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const HTML = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
function extractFn(name) {
  let start = HTML.indexOf('async function ' + name + '(');
  if (start < 0) start = HTML.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('function not found: ' + name);
  let depth = 0, i = HTML.indexOf('{', start);
  for (; i < HTML.length; i++) { const c = HTML[i]; if (c === '{') depth++; else if (c === '}') { depth--; if (depth === 0) { i++; break; } } }
  return HTML.slice(start, i);
}
const has = name => HTML.includes('function ' + name + '(');
const SRC = [...['_isKnownQty', '_copyVendorGroup', '_copyAllGroups', '_tblEdit', '_tblEditStock', 'undoOperations'].map(extractFn)].join('\n');

let pass = 0, fail = 0;
const ok = (id, cond, note) => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'} ${id}${note ? ' — ' + note : ''}`); };

// in-memory db: tables of rows; records every write
function makeDb(tables) {
  const writes = [];
  let nextOp = 1000;
  function builder(table) {
    const f = []; let op = 'select', payload = null, wantRows = false;
    const match = r => f.every(([k, c, v]) => k === 'eq' ? r[c] === v : k === 'in' ? v.includes(r[c]) : k === 'is' ? (r[c] ?? null) === v : true);
    const b = {
      select() { if (op !== 'select') wantRows = true; return b; },
      eq(c, v) { f.push(['eq', c, v]); return b; }, in(c, v) { f.push(['in', c, v]); return b; }, is(c, v) { f.push(['is', c, v]); return b; },
      limit() { return b; }, order() { return b; }, single() { return b; },
      update(p) { op = 'update'; payload = p; return b; }, insert(p) { op = 'insert'; payload = p; return b; }, delete() { op = 'delete'; return b; },
      then(res) {
        const rows = tables[table] || (tables[table] = []);
        if (op === 'select') return res({ data: rows.filter(match).map(r => ({ ...r })), error: null });
        if (op === 'insert') { const r = { operation_id: nextOp++, ...payload }; rows.push(r); writes.push({ table, op, row: r }); return res({ data: [r], error: null }); }
        if (op === 'update') { const hit = rows.filter(match); hit.forEach(r => Object.assign(r, payload)); writes.push({ table, op, payload, n: hit.length }); return res({ data: wantRows ? hit.map(r => ({ ...r })) : null, error: null }); }
        if (op === 'delete') { const hit = rows.filter(match); tables[table] = rows.filter(r => !match(r)); writes.push({ table, op, n: hit.length }); return res({ data: null, error: null }); }
      },
    };
    return b;
  }
  return { db: { from: builder }, writes, tables };
}

function env(tables, extra = {}) {
  const m = makeDb(tables), toasts = [], results = [], clip = [];
  const ctx = {
    console, db: m.db, SID: 1, _items: (tables.items || []).map(r => r), confirm: () => true,
    showToast: t => toasts.push(t), addResult: (raw, msg, type) => results.push({ raw, msg, type }),
    navigator: { clipboard: { writeText: async t => { clip.push(t); } } }, window: { _textOrderCache: extra.cache || [] },
    _closeCopySheet: () => {}, _updateTextOrderCache: () => {}, _purchaseUnitNote: () => '', _invalidateDepletionCache: () => {},
    _renderOrderNeed: () => {}, refreshItems: async () => {}, renderInventory: () => {}, _isVerifiedOrder: () => false,
    _renderOrderKeepScroll: () => {}, document: { createElement: () => ({}) },
  };
  vm.createContext(ctx);
  vm.runInContext(SRC + '\nthis.f = { _copyVendorGroup, _copyAllGroups, _tblEdit, _tblEditStock, undoOperations };', ctx);
  return { f: ctx.f, ...m, toasts, results, clip, ctx };
}
// fake table cell + input for _tblEditStock (blur → save)
function cell(ctx) {
  const input = { value: '', focus() {}, select() {} };
  const td = { textContent: '', className: '', attrs: {}, appendChild() {}, setAttribute(k, v) { this.attrs[k] = v; }, closest: () => null };
  ctx.document.createElement = () => input;
  return { td, input };
}

(async () => {
  // ── A: COPY ≠ ORDER ─────────────────────────────────────────────────────────
  const cache = [{ item_id: 10, order_id: 201, name: '치즈', qty: 8, unit: '개', vendor: '식봄' }, { item_id: 65, order_id: 202, name: '다진 마늘', qty: 5, unit: '개', vendor: '식봄' }];
  const orders = () => [{ id: 201, item_id: 10, status: 'pending', qty: 8 }, { id: 202, item_id: 65, status: 'pending', qty: 5 }];
  const a1 = env({ order_requests: orders(), order_supply: [] }, { cache });
  await a1.f._copyVendorGroup('식봄', [10, 65]);
  ok('A1 vendor copy → clipboard has both lines, DB writes 0 (no order_requests / order_supply change)', a1.clip[0] === '치즈 8개\n다진 마늘 5개' && a1.writes.length === 0, JSON.stringify(a1.clip));
  ok('A2 both plans stay pending (actionable)', a1.tables.order_requests.every(r => r.status === 'pending'));
  ok('A3 message says copied, never "주문 완료"/"발주 완료"/"주문됨"', /복사했습니다/.test(a1.toasts[0]) && !/주문 완료|발주 완료|주문됨/.test(a1.toasts.join(' ')), a1.toasts[0]);
  const a2 = env({ order_requests: orders(), order_supply: [] }, { cache });
  await a2.f._copyAllGroups();
  ok('A1b all-vendor copy → "[식봄]" block, DB writes 0, message honest', /^\[식봄\]\n치즈 8개\n다진 마늘 5개$/.test(a2.clip[0]) && a2.writes.length === 0 && !/주문 완료/.test(a2.toasts[0]), a2.toasts[0]);
  ok('A4/A5 no order_supply row → no open supply / no 입고 대기 from copying', a1.tables.order_supply.length === 0 && a2.tables.order_supply.length === 0);
  ok('A6 the copy → "ordered" path is gone from the page (_markRowOrdered removed; live copy functions never write order_requests)',
    !has('_markRowOrdered') && !/order_requests/.test(extractFn('_copyVendorGroup') + extractFn('_copyAllGroups')));
  const sheet = extractFn('_copyAllMerged');
  ok('A3b copy sheet buttons read "복사" (no "발주" button that sounds like ordering); header button "발주 복사"',
    /📋 \$\{vendor\} 복사/.test(sheet) && /전체 복사/.test(sheet) && !/\$\{vendor\} 발주</.test(sheet) && !/>발주하기</.test(HTML) && (HTML.match(/>발주 복사</g) || []).length === 2);
  ok('A3c no reachable toast says "복사 + 주문 완료"', !/복사 \+ 주문 완료/.test(HTML));

  // ── B: UNKNOWN ≠ ZERO (발주표 재고 칸) ─────────────────────────────────────────
  const B = async (current, typed) => {
    const e = env({ items: [{ item_id: 7, item_name: '우유', unit: '박스', current_qty: current }], kitchen_operations: [] });
    const { td, input } = cell(e.ctx);
    e.f._tblEdit(td, 7, 'stock');
    const prefill = input.value;
    input.value = typed;
    await input.onblur();
    return { e, td, prefill, item: e.tables.items[0], ops: e.tables.kitchen_operations };
  };
  let r = await B(null, '');
  ok('B1/B2 재고 모름 + blank → write 0, still 모름 (null), cell "+입력"', r.e.writes.length === 0 && r.item.current_qty === null && r.td.textContent === '+입력' && r.prefill === '');
  r = await B(4, '');
  ok('B2b known 4 + cleared to blank → write 0, stays 4 (blank is not 0)', r.e.writes.length === 0 && r.item.current_qty === 4 && r.td.textContent === '4');
  r = await B(2.5, '2.5');
  ok('B2c opening a 2.5 cell and leaving → prefill "2.5", write 0 (no truncation to 2, no duplicate record)', r.prefill === '2.5' && r.e.writes.length === 0 && r.item.current_qty === 2.5);
  r = await B(null, '0');
  ok('B3 explicit "0" on 재고 모름 → current 0, record qty_before null (모름) → qty_after 0', r.item.current_qty === 0 && r.ops.length === 1 && r.ops[0].qty_before === null && r.ops[0].qty_after === 0 && /확인 불가→0/.test(r.ops[0].raw_text));
  r = await B(3, '1.5');
  ok('B3b known 3 → "1.5" keeps the decimal; qty_before 3', r.item.current_qty === 1.5 && r.ops[0].qty_before === 3 && r.ops[0].qty_after === 1.5);
  r = await B(3, '-1');
  ok('B3c invalid "-1" → write 0, toast asks for a number', r.e.writes.length === 0 && r.item.current_qty === 3 && /숫자/.test(r.e.toasts[0] || ''));
  ok('B4 "없어/없음" stays an explicit zero in the rule engine (normalised to "0 개")', /\(\?:없어요\?\|없고\|없음\)\(\?=\\s\|\$\)\/g, '0 개'/.test(HTML));

  // ── C: UNDO ≠ DELETE HISTORY ────────────────────────────────────────────────
  const op = (id, item_id, b, a, extra = {}) => ({ operation_id: id, store_id: 1, item_id, item_name: '치즈', unit: '개', action_type: 'stock_check', qty_before: b, qty_after: a, ...extra });
  const c1 = env({ items: [{ item_id: 10, item_name: '치즈', current_qty: 8 }], kitchen_operations: [op(500, 10, 10, 8)] });
  const card = { style: {}, querySelector: () => ({ disabled: false, textContent: '되돌리기' }) };
  await c1.f.undoOperations([500], card);
  const ko = c1.tables.kitchen_operations;
  ok('C1–C3 10 → 8, undo → current 10 again', c1.tables.items[0].current_qty === 10);
  ok('C4 history keeps 10→8 AND adds 8→10 (undo row pointing at 기록 #500)', ko.length === 2 && ko[0].operation_id === 500 && ko[0].qty_after === 8 && ko[1].action_type === 'undo' && ko[1].qty_before === 8 && ko[1].qty_after === 10 && /기록 #500/.test(ko[1].raw_text));
  ok('C5 hard delete 0 (no delete call at all)', !c1.writes.some(w => w.op === 'delete'));
  ok('C6 undo evidence: input_method "undo", message "이전 값으로 되돌렸습니다 (이력은 그대로)"', ko[1].input_method === 'undo' && /이전 값으로 되돌렸습니다/.test(c1.toasts[0] || ''));
  await c1.f.undoOperations([500], card);
  ok('C7 second undo → "이미 되돌렸어요", no new write', c1.writes.length === 2 && /이미 되돌렸어요/.test((c1.results[0] || {}).msg || '') && c1.tables.items[0].current_qty === 10);
  const c2 = env({ items: [{ item_id: 10, item_name: '치즈', current_qty: 7 }], kitchen_operations: [op(501, 10, 10, 8)] });
  await c2.f.undoOperations([501], card);
  ok('C7b stale: stock changed since (now 7) → guarded update hits 0 rows, not overwritten, no undo row', c2.tables.items[0].current_qty === 7 && !c2.writes.some(w => w.op === 'insert' || (w.op === 'update' && w.n > 0)) && c2.tables.kitchen_operations.length === 1 && /그 뒤에 재고가 바뀌어/.test((c2.results[0] || {}).msg || ''));
  const c3 = env({ items: [{ item_id: 11, item_name: '새 품목', current_qty: 3 }], kitchen_operations: [op(502, 11, null, 3, { item_name: '새 품목' })] });
  await c3.f.undoOperations([502], card);
  ok('C7c undo of 모름 → 3 returns to 모름 (null), never 0', c3.tables.items[0].current_qty === null && c3.tables.kitchen_operations[1].qty_after === null && /재고 모름로|재고 모름/.test(c3.tables.kitchen_operations[1].raw_text));
  const c4 = env({ items: [{ item_id: 10, item_name: '치즈', current_qty: 6 }], kitchen_operations: [op(503, 10, 10, 8), op(504, 10, 8, 6)] });
  await c4.f.undoOperations([503, 504], card);
  ok('C7d one input with two lines (10→8, 8→6) → undone newest first → 10; both originals kept + 2 undo rows', c4.tables.items[0].current_qty === 10 && c4.tables.kitchen_operations.length === 4 && !c4.writes.some(w => w.op === 'delete'));
  const c5 = env({ items: [{ item_id: 10, item_name: '치즈', current_qty: 8 }], kitchen_operations: [op(505, 10, 8, 8, { action_type: 'order' }), { operation_id: 9, item_id: 10, action_type: 'inbound', qty_before: 2, qty_after: 8 }] });
  await c5.f.undoOperations([505], card);
  ok('C8 order line (stock unchanged) → nothing restored; other history (inbound #9) untouched', c5.writes.length === 0 && c5.tables.kitchen_operations.length === 2 && c5.tables.items[0].current_qty === 8);

  console.log(`\nRESULT: ${pass} PASS / ${fail} FAIL (of ${pass + fail})`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
