/*
 * test_dup_order_guard.js — Store1 Duplicate Order Guard P0 (ZEROKITCHEN_STORE1_DUPLICATE_ORDER_GUARD_P0_FIX_V0_1)
 *
 * A purchase sentence on a store that is not onboarded to purchase requests (Store1) must not fall into the
 * inventory parser. Before anything is written it is compared with committed supply (get_open_supply + ordered
 * order_requests); an item that is already ordered asks the human A (기존 주문 포함) / B (추가 주문).
 * An ordered row is never overwritten by ordinary input.
 * REAL functions from index.html, MOCK db/DOM — DB Write 0.
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
function extractObj(decl) {
  const start = HTML.indexOf(decl);
  if (start < 0) throw new Error('decl not found: ' + decl);
  let depth = 0, i = HTML.indexOf('{', start);
  for (; i < HTML.length; i++) { const c = HTML[i]; if (c === '{') depth++; else if (c === '}') { depth--; if (depth === 0) { i++; break; } } }
  return HTML.slice(start, i) + ';';
}
const constLine = name => { const m = new RegExp(`const ${name} = [^\\n]+`).exec(HTML); if (!m) throw new Error('const not found: ' + name); return m[0]; };
const LP_BLOCK = HTML.slice(HTML.indexOf('// ── 발주요청 미등록 매장(Store1 등)의 구매 문장 가드'), HTML.indexOf('function _purchaseIntentOf('));
const SRC = [
  constLine('_PR_UNITS'), constLine('_PR_TAIL_RE'), constLine('_PR_PHRASE_RE'), constLine('_PR_UNCERTAIN_RE'), constLine('_fmtQty'),
  extractObj('const _ALIAS = {'),
  ...['_prAliasKey', '_prSpecKey', '_purchaseParse', '_applyAlias', '_ruleMapItem', '_withTimeout', '_zkTimeoutMs', '_zkTimeoutError',
    '_purchaseIntentOf', '_purchaseStoreOf', '_purchaseRoute', '_purchaseAttach', '_insertOrderIfNotDup', 'processRequest'].map(extractFn),
  LP_BLOCK,
].join('\n');

let pass = 0, fail = 0;
const results = [];
function ok(id, cond, note) { (cond ? pass++ : fail++); results.push(`${cond ? 'PASS' : 'FAIL'} ${id}${note ? ' — ' + note : ''}`); }

// ── Store1 fixture (Production shape, 2026-10-15) ──
const ITEMS = [
  [18, '피자 도우', '박스'], [124, '치킨스톡', '개'], [162, '치킨스탁', '개'], [20, '하드롤', '박스'], [77, '스파게티니', '개'],
  [10, '치즈', '개'], [65, '다진 마늘', '개'], [32, '파마산 치즈', '봉지'], [45, '깐마늘', '봉지'], [21, '마늘빵', '박스'], [44, '핫치킨', '개'],
].map(([item_id, item_name, unit]) => ({ item_id, item_name, unit, current_qty: 2, store_id: 1 }));
const ORDERS = () => [
  { id: 151, store_id: 1, item_id: 18, item_name: '피자 도우', qty: 3, unit: '박스', status: 'ordered', created_at: '2026-10-15T05:37:04Z' },
  { id: 152, store_id: 1, item_id: 124, item_name: '치킨스톡', qty: 1, unit: '개', status: 'ordered', created_at: '2026-10-15T05:37:04Z' },
];
const supplyRow = (item_id, unit, order_id, qty) => ({ item_id, unit, open_supply_state: 'UNKNOWN', known_healthy_open_qty: qty, open_order_count: 1,
  evidence_refs: { orders: [{ health: 'HEALTHY', order_id, ordered_at: '2026-10-15T05:22:17+00:00', order_state: 'OPEN', ordered_qty: qty, accepted_qty: 0, verification: 'SYSTEM_VERIFIED', remaining_qty: qty }], coverage: null } });
const OPEN_SUPPLY = () => [supplyRow(18, '박스', 151, 3), supplyRow(124, '개', 152, 1),
  { item_id: 20, unit: '박스', open_supply_state: 'UNKNOWN', known_healthy_open_qty: 0, open_order_count: 0, evidence_refs: { orders: [], coverage: null } }];

function makeEnv(opt = {}) {
  const tables = { order_requests: opt.orders || ORDERS(), item_vendor_map: [], kitchen_operations: [], order_notifications: [] };
  const writes = [], rpcs = [];
  function builder(table) {
    const f = []; let op = 'select', payload = null;
    const b = {
      select() { return b; }, eq(c, v) { f.push(r => r[c] === v); return b; }, in(c, a) { f.push(r => a.includes(r[c])); return b; },
      is(c, v) { f.push(r => (r[c] ?? null) === v); return b; }, limit() { return b; }, order() { return b; }, gte() { return b; }, single() { return b; }, maybeSingle() { return b; },
      insert(row) { op = 'insert'; payload = row; return b; }, update(p) { op = 'update'; payload = p; return b; }, upsert(p) { op = 'upsert'; payload = p; return b; }, delete() { op = 'delete'; return b; },
      then(resolve) {
        const rows = (tables[table] || []).filter(r => f.every(fn => fn(r)));
        if (op === 'select') return resolve(opt.ordersFail && table === 'order_requests' ? { data: null, error: { message: 'x' } } : { data: rows.map(r => ({ ...r })), error: null });
        writes.push({ table, op, payload, matched: rows.map(r => r.id) });
        if (op === 'insert') { const row = { id: 900 + writes.length, ...payload }; (tables[table] = tables[table] || []).push(row); return resolve({ data: [row], error: null }); }
        if (op === 'update') rows.forEach(r => Object.assign(r, payload));
        return resolve({ data: rows, error: null });
      },
    };
    return b;
  }
  const db = {
    from: t => builder(t),
    rpc: (fn, args) => { rpcs.push({ fn, args });
      if (fn === 'get_order_delivery') return Promise.resolve(opt.delivery === 'fail' ? { data: null, error: { message: 'x' } } : { data: opt.delivery || [], error: null });
      if (fn === 'get_open_supply') return Promise.resolve(opt.supplyFail ? { data: null, error: { message: 'x' } } : { data: OPEN_SUPPLY(), error: null }); return Promise.resolve({ data: null, error: { message: 'unknown rpc ' + fn } }); },
  };
  const cards = [];
  const mkNode = (tag) => { const n = { tag, className: '', innerHTML: '', children: [], dataset: {}, appendChild(c) { n.children.push(c); n.lastChild = c; return c; }, remove() {}, querySelectorAll: () => [] }; return n; };
  const resList = mkNode('div');
  const document = {
    getElementById: id => id === 'resList' ? resList : (id === 'nlInput' ? { value: 'x' } : null),
    createElement: mkNode, querySelector: () => null, querySelectorAll: () => [],
  };
  const confirms = [];
  const ctx = {
    console, db, document, SID: 1, _items: [...ITEMS, ...(opt.extraItems || [])].map(x => ({ ...x, ...((opt.itemPatch || {})[x.item_id] || {}) })), _storeAliases: opt.aliases || [], _stores: [{ store_id: 1, store_name: '로사안젤라 경기광주점' }, { store_id: 3, store_name: '신세계 대전' }],
    _purchase: { loaded: true, ready: true, stores: opt.stores || [{ store_id: 3, display_name: '신세계 대전', purchasing_enabled: true, authority: ['PURCHASE_REQUESTER'] }], requests: [] },
    _refreshPurchase: async () => {}, _purchaseSubmit: async (sid, raw) => { ctx._submitted.push({ sid, raw }); }, _submitted: [],
    _purchaseShowRecent: async () => {}, _purchaseCancelPreview: async () => {}, _prEsc: s => String(s ?? ''),
    addResult: (raw, msg, type) => { cards.push({ raw, msg, type }); const n = mkNode('div'); n.innerHTML = msg; resList.appendChild(n); },
    _fmtChatTime: () => '00:00', _newActionId: () => 'g' + Math.random().toString(36).slice(2), showToast: () => {}, renderOrder: async () => {},
    confirm: m => { confirms.push(m); return opt.confirm !== undefined ? opt.confirm : true; },
    setTimeout: (fn) => { ctx._timers.push(fn); return 0; }, clearTimeout: () => {}, _timers: [],
    _isVerifiedOrder: () => false, _invalidateDepletionCache: () => {}, _renderOrderNeed: () => {},
  };
  vm.createContext(ctx);
  vm.runInContext(SRC + '\nthis.__fns = { _lpIntentOf, _lpIntake, _lpDecide, _lpAddNews, _lpGates, _purchaseRoute, processRequest, _lpResolveItem, _lpSegments };', ctx);
  return { ctx, fns: ctx.__fns, writes, rpcs, cards, resList, confirms, tables };
}
const lastText = env => env.resList.children.map(n => n.innerHTML).join('\n---\n');
const orderMut = env => env.writes.filter(w => w.table === 'order_requests');
const touched = (env, ids) => env.writes.some(w => w.table === 'order_requests' && w.op !== 'insert' && w.matched.some(id => ids.includes(id)));
const gateId = env => Object.keys(env.fns._lpGates).pop();

(async () => {
  const FIELD = '토요일 도착으로 도우3박스, 치킨스톡 1개, 하드롤 3박스(팍스푸드), 스파게티니 12개, 치즈 8봉지, 다진마늘 5개, 파마산 치즈 10봉(네이버)';

  // T1 / T2 — intent
  { const e = makeEnv(); const i = e.fns._lpIntentOf('토요일 도착으로 도우 3박스');
    ok('T1 "토요일 도착으로 도우 3박스" → purchase intent', !!i && i.lines.length === 1 && i.lines[0].raw_item_text === '도우' && i.lines[0].requested_qty === 3 && i.arrival === '토요일 도착'); }
  { const e = makeEnv();
    ok('T2 "도우 3박스 남았어" → inventory (not purchase)', e.fns._lpIntentOf('도우 3박스 남았어') === null && await e.fns._purchaseRoute('도우 3박스 남았어') === false && e.writes.length === 0,
      'router returns false → existing inventory parser');
    ok('T2b bare "도우 3박스" stays inventory input (CLAUDE.md 기본 입력)', e.fns._lpIntentOf('도우 3박스') === null); }

  // T3 — "도우 3박스 주문" through the existing order path (processRequest) + existing 151 → A/B gate, no overwrite
  { const e = makeEnv();
    const r = await e.fns.processRequest({ request_type: 'inventory_update', items: [{ name: '피자 도우', quantity: 3, unit: '박스', action_type: 'order' }] });
    e.ctx._timers.forEach(fn => fn());
    const t = lastText(e);
    ok('T3 "도우 3박스 주문" + order 151 → A/B gate, no "변경할까요"', e.confirms.length === 0 && /이미 주문되어 입고 대기 중/.test(t) && /A\. 기존 주문 포함/.test(t) && /B\. 추가 주문/.test(t) && /#151/.test(t),
      `result=${r.status}`);
    ok('T3b order 151 untouched, no insert', orderMut(e).length === 0 && e.tables.order_requests.find(x => x.id === 151).qty === 3); }

  // T4 / T7 / T8 / T9 — the FIELD sentence
  const field = makeEnv();
  ok('T4 FIELD sentence routed to purchase intake (not inventory)', await field.fns._purchaseRoute(FIELD) === true && field.cards.length === 1);
  const fcard = field.cards[0]?.msg || '';
  ok('T4b 도우 duplicate → A/B question', /피자 도우 3박스/.test(fcard) && /#151/.test(fcard) && /최종 필요량인가요/.test(fcard));
  ok('T7 치킨스톡 1개 + order 152 → in the same A/B question', /치킨스톡 1개/.test(fcard) && /#152/.test(fcard));
  const g = field.fns._lpGates[gateId(field)].c;
  ok('T8 other 5 items preserved as new request lines', g.news.map(n => n.item.item_id).sort((a, b) => a - b).join() === '10,20,32,65,77' && g.unknown.length === 0,
    g.news.map(n => `${n.item.item_name} ${n.qty}${n.unit}${n.unit_ok === false ? '(단위확인)' : ''}`).join(', '));
  ok('T8b supplier hints kept (팍스푸드, 네이버)', g.news.find(n => n.item.item_id === 20)?.hint === '팍스푸드' && g.news.find(n => n.item.item_id === 32)?.hint === '네이버');
  ok('T8c 치즈 8봉지 vs item unit 개 → flagged, not converted', g.news.find(n => n.item.item_id === 10)?.unit_ok === false && /단위 확인 필요/.test(fcard));
  ok('T9 before decision: order/cart/inventory writes 0, reads get_open_supply', field.writes.length === 0 && field.rpcs.some(r => r.fn === 'get_open_supply' && r.args.p_store_id === 1));

  // T5 — "도우 3박스 더 주문" → clear additional, no A/B, 151 untouched
  { const e = makeEnv(); await e.fns._purchaseRoute('도우 3박스 더 주문');
    const c = e.fns._lpGates[gateId(e)].c;
    ok('T5 "더 주문" → additional intent clear (no A/B), 151 mutation 0', c.dups.length === 1 && c.dups[0].additional === true && !/최종 필요량인가요/.test(e.cards[0].msg) && e.writes.length === 0);
    await e.fns._lpDecide(gateId(e), 'MORE', null);
    const ins = orderMut(e).filter(w => w.op === 'insert');
    ok('T5b after "추가분 담기": new pending row only, 151 unchanged', ins.length === 1 && ins[0].payload.status === 'pending' && ins[0].payload.item_id === 18 && !touched(e, [151, 152])); }

  // T6 — ambiguous context ("도우 3박스 (CJ)") + existing order → A/B
  { const e = makeEnv(); await e.fns._purchaseRoute('도우 3박스 (CJ)');
    ok('T6 ambiguous "도우 3박스 (CJ)" + order 151 → A/B question', /A\. 기존 주문 포함/.test(e.cards[0]?.msg || '') && e.writes.length === 0); }

  // T10 — A → additional order 0, 151/152 unchanged
  { const e = makeEnv(); await e.fns._purchaseRoute(FIELD); await e.fns._lpDecide(gateId(e), 'A', null);
    ok('T10 A → additional order 0, 151/152 unchanged', orderMut(e).length === 0 && /추가 주문하지 않습니다/.test(lastText(e)));
    await e.fns._lpDecide(gateId(e), 'B', null);
    ok('T10b second click after A is ignored (decided once)', orderMut(e).length === 0); }
  { const e = makeEnv(); await e.fns._purchaseRoute('토요일 도착으로 도우 5박스'); await e.fns._lpDecide(gateId(e), 'A', null);
    ok('T10c A with request 5 > ordered 3 → reports 2박스 부족, writes 0', /2박스 부족/.test(lastText(e)) && orderMut(e).length === 0); }

  // T11 — B → additional request path, 151/152 unchanged
  { const e = makeEnv(); await e.fns._purchaseRoute(FIELD); await e.fns._lpDecide(gateId(e), 'B', null);
    const ins = orderMut(e).filter(w => w.op === 'insert');
    ok('T11 B → separate pending rows for 도우 3 + 치킨스톡 1, 151/152 unchanged', ins.length === 2 && ins.every(w => w.payload.status === 'pending') && ins.map(w => w.payload.item_id).sort().join() === '124,18' && !touched(e, [151, 152]));
    await e.fns._lpAddNews(gateId(e), null);
    const ins2 = orderMut(e).filter(w => w.op === 'insert');
    ok('T11b "새 요청 담기" → 4 pending rows (치즈 단위 확인 제외), 151/152 unchanged', ins2.length === 6 && !ins2.some(w => w.payload.item_id === 10) && !touched(e, [151, 152])); }

  // T12 — ordinary edit attempt on an ORDERED row → blocked (legacy "변경할까요" path no longer reachable; DB filter = pending only)
  { const e = makeEnv({ confirm: true });
    await e.fns.processRequest({ request_type: 'inventory_update', items: [{ name: '치킨스톡', quantity: 5, unit: '개', action_type: 'order' }] });
    ok('T12 "치킨스톡 5개 주문" with ordered 152 → no confirm, no update of 152', e.confirms.length === 0 && !touched(e, [152]) && e.tables.order_requests.find(x => x.id === 152).qty === 1);
    const p = makeEnv({ orders: [{ id: 300, store_id: 1, item_id: 20, item_name: '하드롤', qty: 1, unit: '박스', status: 'pending' }], confirm: true });
    await p.fns.processRequest({ request_type: 'inventory_update', items: [{ name: '하드롤', quantity: 2, unit: '박스', action_type: 'order' }] });
    ok('T12b pending (발주표) row still editable with confirm (existing UX kept)', p.confirms.length === 1 && p.tables.order_requests.find(x => x.id === 300).qty === 2);
    // 일반 수량 갱신(order_requests.update({ qty ...}))은 전부 pending 행만 — 예외는 "주문됨 수량 편집"(_inlineEditOrderQty: 확인된 주문 잠금 있음)
    const at = [...HTML.matchAll(/order_requests'\)\s*\.update\(\{ qty/g)].map(m => m.index);
    const inline = HTML.indexOf('function _inlineEditOrderQty(');
    const bad = at.filter(i => !HTML.slice(i, i + 260).includes(".eq('status', 'pending')") && !(i > inline && i < inline + 1500));
    ok('T12c every ordinary qty update of order_requests is pending-only', at.length >= 4 && bad.length === 0, `${at.length} update sites, non-pending ${bad.length} (explicit 주문됨 수량 편집 excluded)`); }

  // T13 — 12h duplicate request detection unchanged (Store3, enabled store → SUBMIT_REQUEST as before)
  { const e = makeEnv({ stores: [{ store_id: 1, display_name: 'X', purchasing_enabled: true, authority: ['PURCHASE_REQUESTER'] }] });
    const routed = await e.fns._purchaseRoute('치즈 3박스 발주 부탁합니다');
    ok('T13 enabled store: one-line request → SUBMIT_REQUEST path unchanged (server 12h duplicate check untouched)', routed === true && e.ctx._submitted.length === 1 && e.rpcs.length === 0);
    const e2 = makeEnv({ stores: [{ store_id: 1, display_name: 'X', purchasing_enabled: true, authority: ['PURCHASE_REQUESTER'] }] });
    ok('T13b enabled store: arrival sentence is not taken by the Store1 intake', await e2.fns._purchaseRoute('토요일 도착으로 도우 3박스') === false && e2.rpcs.length === 0); }

  // T14 — fail closed: committed supply unreadable → no judgement, writes 0
  { const e = makeEnv({ supplyFail: true, ordersFail: true });
    await e.fns._purchaseRoute(FIELD);
    ok('T14 get_open_supply + order_requests unreadable → stop, no "no duplicate" claim, writes 0', /확인하지 못해 판단을 멈췄어요/.test(e.cards[0]?.msg || '') && e.writes.length === 0); }

  // T15 — alias collision 124 치킨스톡 / 162 치킨스탁 (current behavior report)
  { const e = makeEnv(); await e.fns._purchaseRoute('토요일 도착으로 치킨스탁 1개');
    const c = e.fns._lpGates[gateId(e)].c;
    const missed = c.dups.length === 0 && c.news[0]?.item.item_id === 162;
    ok('T15 "치킨스탁 1개" without alias evidence → no longer missed: asked as AMBIGUOUS (P1)', !missed && c.dups[0]?.identity === 'AMBIGUOUS'); }

  // ── P1: identity / unit / ETA ──
  const ALIAS20 = { id: 20, store_id: 1, raw_expression: '치킨스탁', corrected_name: '치킨스톡', count: 1 };
  const gateOf = async (env, text) => { await env.fns._purchaseRoute(text); return { c: env.fns._lpGates[gateId(env)]?.c, msg: env.cards.at(-1)?.msg || '' }; };
  const lastButtons = env => { const card = env.resList.children.at(-1); return (card?.children || []).map(n => n.innerHTML).join(' '); };
  { const e = makeEnv({ aliases: [ALIAS20] }); const { c, msg } = await gateOf(e, '토요일 도착으로 치킨스톡 1개');
    ok('I1 "치킨스톡 1개" → existing #152 duplicate', c.dups.length === 1 && c.dups[0].orders.some(o => o.order_id === 152) && /#152/.test(msg)); }
  { const e = makeEnv({ aliases: [ALIAS20] }); const { c, msg } = await gateOf(e, '토요일 도착으로 치킨스탁 1개');
    ok('I2 "치킨스탁 1개" (item 162) → same #152 via store alias + near name', c.dups.length === 1 && c.dups[0].item.item_id === 162 && c.dups[0].identity === 'SAME' && c.dups[0].orders.some(o => o.order_id === 152) && /= 치킨스톡, 매장 별칭/.test(msg)); }
  { const e = makeEnv({ aliases: [ALIAS20, { raw_expression: '딸기', corrected_name: '치즈', count: 1 }], extraItems: [{ item_id: 990, item_name: '딸기', unit: '개' }],
      orders: [...ORDERS(), { id: 160, store_id: 1, item_id: 10, item_name: '치즈', qty: 4, unit: '개', status: 'ordered', created_at: '2026-10-15T05:37:04Z' }] });
    const a = await gateOf(e, '토요일 도착으로 딸기 2개');
    const e2 = makeEnv({ aliases: [ALIAS20], extraItems: [{ item_id: 991, item_name: '치킨스틱', unit: '개' }] });
    const b = await gateOf(e2, '토요일 도착으로 치킨스틱 1개');
    ok('I3 similar/aliased but unproven items → false merge 0 (딸기≠치즈 alias only, 치킨스틱≈치킨스톡 name only → AMBIGUOUS, asked, not merged)',
      a.c.dups[0]?.identity === 'AMBIGUOUS' && b.c.dups[0]?.identity === 'AMBIGUOUS' && /확실하지 않아요/.test(b.msg) && e.writes.length === 0 && e2.writes.length === 0,
      `딸기→${a.c.dups[0]?.identity}, 치킨스틱→${b.c.dups[0]?.identity}`); }
  { const e = makeEnv(); const { c, msg } = await gateOf(e, '토요일 도착으로 치킨스탁 1개');
    ok('I4 no alias evidence (치킨스탁 vs 치킨스톡 name only) → Human ambiguity, not auto merge', c.dups[0]?.identity === 'AMBIGUOUS' && /A\. 기존 주문 포함/.test(msg) && /확실하지 않아요/.test(msg)); }

  const CHEESE_MEM = { itemPatch: { 10: { order_unit_name: '봉', order_unit_qty: 1 } } };
  for (const [id, text] of [['U1', '토요일 도착으로 치즈 8봉'], ['U2', '토요일 도착으로 치즈 8봉지']]) {
    const e = makeEnv(CHEESE_MEM); const { c, msg } = await gateOf(e, text); const n = c.news.find(x => x.item.item_id === 10);
    ok(`${id} "${text.slice(9)}" + item purchase unit 봉(=1개) → purchase qty 8봉 = 8개, addable`, n?.unit_ok === true && n.inv_qty === 8 && n.unit_basis === 'ITEM_PURCHASE_UNIT' && /= 8개 \(구매 단위 봉 1 = 1개\)/.test(msg) && /새 요청 1개 발주표에 담기/.test(lastButtons(e)));
    if (id === 'U1') { await e.fns._lpAddNews(gateId(e), null); const ins = orderMut(e).filter(w => w.op === 'insert');
      ok('U1b "담기" writes 8 in the inventory unit (8개), never "8봉" against a 개 item', ins.length === 1 && ins[0].payload.qty === 8 && ins[0].payload.unit === '개'); } }
  { const e = makeEnv(CHEESE_MEM); const { c } = await gateOf(e, '토요일 도착으로 치즈 8개'); const n = c.news.find(x => x.item.item_id === 10);
    ok('U3 "치즈 8개" → same unit, unchanged semantics', n?.unit_ok === true && n.inv_qty === 8 && n.unit_basis === 'SAME_UNIT'); }
  { const e = makeEnv(CHEESE_MEM); const { c, msg } = await gateOf(e, '토요일 도착으로 치즈 8박스'); const n = c.news.find(x => x.item.item_id === 10);
    ok('U4 "치즈 8박스" → no unsafe 8 EA conversion (박스 ≠ 봉), Human unit check, no add button', n?.unit_ok === false && n.inv_qty === null && /단위 확인 필요/.test(msg) && !/발주표에 담기/.test(lastButtons(e))); }
  { const e = makeEnv(); const { c, msg } = await gateOf(e, '토요일 도착으로 치즈 8봉'); const n = c.news.find(x => x.item.item_id === 10);
    ok('U5 purchase-unit memory missing (current Production item 10) → Human unit confirmation', n?.unit_ok === false && /단위 확인 필요/.test(msg)); }

  const ETA = [{ order_id: 151, item_id: 18, expected_arrival_kind: 'DATE', expected_arrival_date: '2026-10-17', delivery_status: null },
    { order_id: 152, item_id: 124, expected_arrival_kind: 'DATE', expected_arrival_date: '2026-10-17', delivery_status: null }];
  { const e = makeEnv({ delivery: ETA, aliases: [ALIAS20] }); const { c, msg } = await gateOf(e, FIELD);
    const o151 = c.dups.find(d => d.item.item_id === 18)?.orders[0], o152 = c.dups.find(d => d.item.item_id === 124)?.orders[0];
    ok('E1 #151 ETA 2026-10-17 read from delivery observation', o151?.eta === '2026-10-17');
    ok('E2 #152 ETA 2026-10-17', o152?.eta === '2026-10-17');
    ok('E3 gate says "이미 주문되어 10/17(토) 입고 예정입니다"', /이미 주문되어 10\/17\(토\) 입고 예정입니다/.test(msg) && e.writes.length === 0); }
  { const e = makeEnv({ delivery: 'fail' }); const { c, msg } = await gateOf(e, FIELD);
    ok('E4 ETA unreadable → fallback "입고 대기 중", duplicate guard still works', c.dups.length === 2 && /이미 주문되어 입고 대기 중입니다/.test(msg)); }
  { const e = makeEnv({ delivery: [{ ...ETA[0], delivery_status: 'DELIVERED' }, ETA[1]] }); const { c, msg } = await gateOf(e, FIELD);
    const o151 = c.dups.find(d => d.item.item_id === 18)?.orders[0];
    ok('E5 delivered observation is not overwritten by an expected date (151: 배송 완료 관찰, no ETA; head falls back)', o151?.eta === null && o151.delivered === true && /배송 완료로 관찰됨/.test(msg) && /입고 대기 중입니다/.test(msg)); }
  { const e = makeEnv({ ...CHEESE_MEM, delivery: ETA, aliases: [ALIAS20] }); const { c } = await gateOf(e, FIELD);
    ok('R4 151/152 unchanged across P1 paths', e.writes.length === 0 && e.tables.order_requests.find(x => x.id === 151).qty === 3 && e.tables.order_requests.find(x => x.id === 152).qty === 1 && c.news.find(x => x.item.item_id === 10)?.unit_ok === true); }
  { const e = makeEnv({ orders: [...ORDERS(), { id: 153, store_id: 1, item_id: 20, item_name: '하드롤', qty: 3, unit: '박스', status: 'pending', created_at: '2026-10-15T16:16:15Z' }] });
    await gateOf(e, FIELD);
    ok('R5 items already in 발주표 are not counted in the add button (Human FIELD 01:15: 153–156 already added)', /새 요청 3개 발주표에 담기/.test(lastButtons(e))); }
  { const e = makeEnv({ extraItems: [{ item_id: 71, item_name: '죽용기 소', unit: '개' }, { item_id: 72, item_name: '죽용기 중', unit: '개' }],
      orders: [...ORDERS(), { id: 170, store_id: 1, item_id: 72, item_name: '죽용기 중', qty: 2, unit: '개', status: 'ordered', created_at: '2026-10-15T05:37:04Z' }] });
    const { c } = await gateOf(e, '토요일 도착으로 죽용기 소 2개');
    ok('I3b size variants (죽용기 소 vs 죽용기 중 #170) → different items, no identity question', c.dups.length === 0 && c.news[0]?.item.item_id === 71); }

  console.log(results.join('\n'));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
