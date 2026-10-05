/*
 * test_agent_home.js — Agent Home V0.1 "오늘 할 일" (CASE-01..07, CONTRA-01..05, flows, copy)
 *
 * REAL from index.html: deriveAgentActions, _renderAgentHome, _agentCardHtml, _agentPrepareOrder, _agentShowOrderSheet,
 * _agentShowOrder, _agentCountItem, _agentGoLogin, _agentFocus, _loadAgentCycle, _clearStoreContext, _insertOrderIfNotDup,
 * and the trust gate (_orderNeedOf, _admittedNeedOf). MOCK: db (records writes), DOM, renderOrder, switchTab,
 * _startCountMode, checkOrderNotifications. No network.
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
const constLine = n => { const m = new RegExp(`const ${n} = [^\\n]+`).exec(HTML); if (!m) throw new Error('const not found: ' + n); return m[0]; };

let pass = 0, fail = 0;
function check(name, ok, detail = '') { if (ok) pass++; else fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? '  — ' + String(detail).slice(0, 400) : ''}`); }

const FNS = ['_orderNeedOf', '_admittedNeedOf', 'deriveAgentActions', '_agentContext', '_agentCardHtml', '_renderAgentHome', '_loadAgentCycle',
  '_agentPrepareOrder', '_agentShowOrderSheet', '_agentShowOrder', '_agentCountItem', '_agentGoLogin', '_agentFocus', '_insertOrderIfNotDup', '_clearStoreContext', '_storeChanged'];
const CODE = ['AGENT_PRIORITY', 'AGENT_MAX_CHECKS', '_AGENT_SOURCE_LABEL', '_agentEsc', '_agentNum'].map(constLine).join('\n') + '\n' + FNS.map(extractFn).join('\n');

// item helpers: trusted = an explicit stock check stands behind the number (see _admittedNeedOf)
const I = (id, name, cur, target, unit = '개', extra = {}) => ({ item_id: id, item_name: name, current_qty: cur, target_qty: target, unit, ...extra });

function makeEnv(o = {}) {
  const writes = [], calls = { renderOrder: 0, switchTab: [], countMode: 0, cycle: [], toasts: [] };
  const els = {};
  const mkEl = id => ({ id, innerHTML: '', value: '', style: {}, focused: 0, scrolled: 0,
    classList: { s: new Set(), add(c) { this.s.add(c); }, remove(c) { this.s.delete(c); }, contains(c) { return this.s.has(c); }, toggle(c, f) { if (f ?? !this.s.has(c)) this.s.add(c); else this.s.delete(c); } },
    scrollIntoView() { this.scrolled++; }, querySelector: () => null });
  const navs = ['홈', '재고', '설정'].map(t => ({ textContent: t }));
  const document = { getElementById: id => (els[id] = els[id] || mkEl(id)), querySelector: () => null, querySelectorAll: s => (s === '.nav' ? navs : []) };
  const q = table => { const f = {}; const b = {
    select: () => b, eq: (c, v) => { f[c] = v; return b; }, in: () => b, limit: () => b, order: () => b,
    insert: row => { writes.push({ table, op: 'insert', row }); return { select: async () => ({ data: [{ id: 999, ...row }], error: null }) }; },
    update: row => { writes.push({ table, op: 'update', row }); return b; }, delete: () => { writes.push({ table, op: 'delete' }); return b; },
    then: r => Promise.resolve({ data: table === 'order_requests' ? (o.existingOrders || []).filter(x => x.store_id === f.store_id && x.item_id === f.item_id) : [], error: null }).then(r) };
    return b; };
  const env = {
    document, db: { from: q }, console: { log() {}, warn() {}, error() {} }, setTimeout: () => 0, window: {},
    showToast: t => calls.toasts.push(t),
    renderOrder: async () => { calls.renderOrder++; },
    switchTab: async (n) => { calls.switchTab.push(n); },
    _startCountMode: () => { calls.countMode++; S._countMode = true; },
    renderInventory: () => {},
    checkOrderNotifications: async sid => { calls.cycle.push(sid); if (o.cycleGate) await o.cycleGate; return (o.cycle || {})[sid] || []; },
    _closeDupCleanup() {}, _closeComplexCard() {}, cancelReview() {},
  };
  // mutable app state, shared by reference with the evaluated functions
  const S = { SID: o.sid || 1, _storeEpoch: 0, _items: o.items || [], _itemTrust: new Map(), _orderRequests: o.orders || [], _orderSupply: new Map(), _openSupply: new Map(),
    _supplyAvailable: o.supplyAvailable !== false, _writerReady: !!o.writerReady, _vendors: o.vendors || [], _countMode: false, _homeTableCollapsed: false };
  for (const it of S._items) if ((o.trusted || []).includes(it.item_id)) S._itemTrust.set(it.item_id, { trusted: true, lastQty: Number(it.current_qty) });
  for (const [k, v] of Object.entries(o.orderSupply || {})) S._orderSupply.set(Number(k), v);
  for (const [k, v] of Object.entries(o.openSupply || {})) S._openSupply.set(Number(k), v);
  const names = Object.keys(env);
  const body = `let SID = __S.SID, _storeEpoch = 0, _items = __S._items, _itemTrust = __S._itemTrust, _orderRequests = __S._orderRequests,
      _orderSupply = __S._orderSupply, _openSupply = __S._openSupply, _supplyAvailable = __S._supplyAvailable, _writerReady = __S._writerReady,
      _vendors = __S._vendors, _countMode = false, _countedIds = new Set(), _homeTableCollapsed = false, _agentCycle = new Map(),
      _dismissedItemIds = new Set(), _orderedItemIds = new Set(), _storeAliases = [], _draftItems = [], _pendingComplexItems = null;
    ${CODE}
    return { ${FNS.join(', ')},
      set(k, v) { eval(k + ' = v'); }, get(k) { return eval(k); } };`;
  const f = new Function(...names, '__S', body)(...names.map(n => env[n]), S);
  const derive = () => f.deriveAgentActions(f._agentContext());
  const render = () => { f._renderAgentHome(); return document.getElementById('agentHome').innerHTML; };
  const text = html => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return { f, S, env, els, writes, calls, derive, render, text, document };
}
const titles = acts => acts.map(a => a.title);
const ofItem = (r, id) => [...r.primary, ...r.moreChecks, ...r.waiting].filter(a => a.item_id === id);

(async () => {
  // ── CASE-01  우유 current 1 / desired 3 / no open supply (confirmed) → "우유 2박스 주문하세요"
  {
    const e = makeEnv({ items: [I(1, '우유', 1, 3, '박스')], trusted: [1], openSupply: { 1: { open_supply_state: 'NONE_CONFIRMED' } } });
    const r = e.derive(), a = r.primary[0];
    check('CASE-01 우유 1/3, no open order → "우유 2박스 주문하세요" [주문 준비]', r.primary.length === 1 && a.type === 'ORDER_NOW' && a.title === '우유 2박스 주문하세요'
      && a.primary_action.label === '주문 준비' && a.required_qty === 2 && /현재 1박스 · 목표 3박스 · 주문 중 없음/.test(a.reason), JSON.stringify(a));
    const u = makeEnv({ items: [I(1, '우유', 1, 3, '박스')], trusted: [1], openSupply: { 1: { open_supply_state: 'UNKNOWN', known_healthy_open_qty: 0 } } }).derive().primary[0];
    check('CASE-01b other orders not confirmed → conservative wording (필요해요 + 이미 시켰다면 추가 주문하지 마세요)', u.type === 'ORDER_NOW' && u.title === '우유 2박스 주문이 필요해요'
      && u.reason.includes('이미 시켰다면 추가 주문하지 마세요'), JSON.stringify(u));
  }
  // ── CASE-02 / CONTRA-03  verified open remaining 2 covers the need → no ORDER_NOW, "추가 주문하지 마세요"
  const OPEN2 = { items: [I(1, '우유', 1, 3, '박스')], trusted: [1], orders: [{ id: 11, store_id: 1, item_id: 1, item_name: '우유', qty: 2, unit: '박스', status: 'ordered', vendor_id: 7 }],
    vendors: [{ vendor_id: 7, vendor_name: '쿠팡' }], orderSupply: { 11: { order_state: 'OPEN', ordered_qty: 2, accepted_qty: 0, remaining_qty: 2, health: 'HEALTHY', supply_source: 'COUPANG' } },
    openSupply: { 1: { open_supply_state: 'VERIFIED_OPEN', known_healthy_open_qty: 2 } } };
  {
    const e = makeEnv(OPEN2); const r = e.derive(); const mine = ofItem(r, 1); const html = e.render();
    check('CASE-02 open 2 covers need 2 → one card, not ORDER_NOW, says 추가 주문하지 마세요 + 쿠팡 · 남은 2박스', mine.length === 1 && mine[0].type === 'WAIT_EXISTING_ORDER'
      && mine[0].title === '우유 2박스 입고 대기' && mine[0].reason.includes('추가 주문하지 마세요') && mine[0].reason.includes('쿠팡') && !r.primary.some(a => a.type === 'ORDER_NOW'), JSON.stringify(mine));
    const txt = e.text(html);
    check('CONTRA-03 covered by open supply → no "주문하세요/주문 준비" anywhere; "추가 주문" only as "추가 주문하지 마세요"',
      !/주문하세요|주문이 필요해요|주문 준비/.test(txt) && (txt.match(/추가 주문/g) || []).length === (txt.match(/추가 주문하지/g) || []).length, txt);
    const short = makeEnv({ ...OPEN2, orderSupply: { 11: { ...OPEN2.orderSupply[11], remaining_qty: 1, ordered_qty: 1 } } }).derive().primary;
    check('CASE-02b open 1 < need 2 → ORDER_NOW only for the rest: "우유 1박스 더 주문하세요" (주문 중 1박스 반영)', short.length === 1 && short[0].type === 'ORDER_NOW'
      && short[0].title === '우유 1박스 더 주문하세요' && short[0].reason.includes('이미 1박스 주문 중'), JSON.stringify(short));
  }
  // ── CASE-03 / CONTRA-02  하드롤 current not trusted (+ cycle reminder + zero) → only "재고를 확인하세요"
  {
    const e = makeEnv({ items: [I(5, '하드롤', 0, 10)], cycle: { 1: [{ item_id: 5, item_name: '하드롤' }] },
      orders: [{ id: 21, store_id: 1, item_id: 5, item_name: '하드롤', qty: 1, unit: '개', status: 'pending' }] });
    await e.f._loadAgentCycle();
    const r = e.derive(); const mine = ofItem(r, 5); const html = e.document.getElementById('agentHome').innerHTML;
    check('CASE-03 untrusted 하드롤 with cycle reminder + draft → single CHECK_STOCK card with both reasons', mine.length === 1 && mine[0].type === 'CHECK_STOCK'
      && mine[0].title === '하드롤 현재 수량을 확인하세요' && mine[0].reason.includes('평소 주문 주기가 됐어요') && mine[0].reason.includes('발주표에 1개 담겨 있어요'), JSON.stringify(mine));
    check('CONTRA-02 same item never "재고 확인" + order advice: 1 card, no 주문하세요 / 주문 준비 / 추천', (html.match(/data-agent-iid="5"/g) || []).length === 1
      && !/주문하세요|주문 준비|주문이 필요해요|추천/.test(e.text(html)) && html.includes('_agentCountItem(5)'), html);
  }
  // ── CASE-04  partial receipt: ordered 5 / received 3 / remaining 2 → "2개 입고 대기"
  {
    const e = makeEnv({ items: [I(3, '토마토', 4, 6)], trusted: [3], orders: [{ id: 31, store_id: 1, item_id: 3, item_name: '토마토', qty: 5, unit: '개', status: 'ordered' }],
      orderSupply: { 31: { order_state: 'PARTIAL', ordered_qty: 5, accepted_qty: 3, remaining_qty: 2, health: 'HEALTHY' } }, openSupply: { 3: { open_supply_state: 'VERIFIED_OPEN' } } });
    const a = ofItem(e.derive(), 3);
    check('CASE-04 partial 5/3 → "토마토 2개 입고 대기", 주문 5개 중 3개 받음', a.length === 1 && a[0].title === '토마토 2개 입고 대기' && a[0].reason.includes('주문 5개 중 3개 받음'), JSON.stringify(a));
  }
  // ── CASE-05  nothing to do
  {
    const e = makeEnv({ items: [I(1, '우유', 5, 3, '박스'), I(2, '치즈', 4, 4)], trusted: [1, 2] });
    const html = e.render();
    check('CASE-05 0 actions → "오늘은 바로 처리할 일이 없습니다."', e.derive().primary.length === 0 && html.includes('오늘은 바로 처리할 일이 없습니다.') && !html.includes('agent-card'), html);
  }
  // ── CASE-06  13 items need a stock check → 3 on Home, "10개 더 있음" folded
  {
    const items = Array.from({ length: 13 }, (_, k) => I(100 + k, `품목${String(k).padStart(2, '0')}`, k, 10));
    const e = makeEnv({ items }); const r = e.derive(); const html = e.render();
    const top = (html.split('<details')[0].match(/data-agent-type="CHECK_STOCK"/g) || []).length;
    check('CASE-06 13 checks → primary 3, "재고 확인이 필요한 품목 10개 더 있음" folded, summary 오늘 할 일 3개', r.primary.length === 3 && r.moreChecks.length === 10 && top === 3
      && html.includes('<details class="agent-more"><summary>재고 확인이 필요한 품목 10개 더 있음</summary>') && html.includes('오늘 할 일 3개'), `primary=${r.primary.length} more=${r.moreChecks.length} top=${top}`);
    check('CASE-06b the 3 shown are the most urgent (empty first: 품목00 0개, 품목01 1개, 품목02 2개)', titles(r.primary).join('|') === '품목00 현재 수량을 확인하세요|품목01 현재 수량을 확인하세요|품목02 현재 수량을 확인하세요', titles(r.primary).join('|'));
  }
  // ── CASE-07 / CONTRA-04  Store1 → Store2: Store1 actions gone at once, only Store2 actions, late Store1 reminder ignored
  {
    let release; const gate = new Promise(r => { release = r; });
    const e = makeEnv({ items: [I(1, '하드롤', 0, 10), I(2, '핫소스', 1, 6)], cycle: { 1: [{ item_id: 1 }], 2: [] }, cycleGate: gate });
    e.render();
    const before = e.document.getElementById('agentHome').innerHTML;
    const late = e.f._loadAgentCycle();                 // Store1 reminder read in flight
    // switch (same steps as _switchStore: epoch++, SID, clear)
    e.f.set('_storeEpoch', e.f.get('_storeEpoch') + 1); e.f.set('SID', 2); e.f._clearStoreContext();
    const cleared = e.document.getElementById('agentHome').innerHTML;
    const cycleCleared = e.f.get('_agentCycle').size === 0 && e.f.get('_items').length === 0;
    e.f.set('_items', [I(9, '양파', 0, 5)]);           // Store2 data arrives
    release(); await late;
    const html = e.render(); const r = e.f.deriveAgentActions(e.f._agentContext());
    check('CASE-07 switch clears Store1 actions immediately (empty Home card, cycle signals dropped)', before.includes('하드롤') && cleared === '' && cycleCleared, `before=${before.length} cleared=${JSON.stringify(cleared)}`);
    check('CONTRA-04 Store2 shows only Store2 actions; late Store1 reminder does not land', !/하드롤|핫소스/.test(html) && html.includes('양파') && r.storeId === 2
      && r.primary.every(a => a.store_id === 2) && e.f.get('_agentCycle').size === 0, html);
  }
  // ── CONTRA-01  발주표 has rows → Home never says "nothing to order"; drafts are counted as today's work
  {
    const orders = Array.from({ length: 10 }, (_, k) => ({ id: 40 + k, store_id: 1, item_id: 50 + k, item_name: `담은품목${k}`, qty: 1, unit: '개', status: 'pending' }));
    const items = orders.map(r => I(r.item_id, r.item_name, 9, 3));
    const e = makeEnv({ items, trusted: items.map(i => i.item_id), orders }); const html = e.render(); const r = e.derive();
    check('CONTRA-01 발주표 10건 → 오늘 할 일 10개 (주문하세요 · 발주표 보기), never "할 일 없음 / 발주 필요한 품목 없음"', r.primary.length === 10 && r.primary.every(a => a.type === 'ORDER_NOW' && a.primary_action.label === '발주표 보기')
      && html.includes('오늘 할 일 10개') && !/처리할 일이 없습니다|발주 필요한 품목 없음/.test(html), `primary=${r.primary.length}`);
  }
  // ── CONTRA-05  current unknown → never a confirmed ORDER_NOW
  {
    const e = makeEnv({ items: [I(1, '우유', null, 3, '박스')], trusted: [], openSupply: { 1: { open_supply_state: 'NONE_CONFIRMED' } } });
    const a = ofItem(e.derive(), 1);
    check('CONTRA-05 unknown current → CHECK_STOCK only, no ORDER_NOW', a.length === 1 && a[0].type === 'CHECK_STOCK' && a[0].reason.includes('현재 수량을 몰라'), JSON.stringify(a));
    const rec = makeEnv({ items: [I(1, '우유', 1, 3, '박스')], trusted: [] }).derive().primary;   // number present but not trusted
    check('CONTRA-05b recorded number without a trusted count → CHECK_STOCK, no order quantity', rec.length === 1 && rec[0].type === 'CHECK_STOCK' && rec[0].required_qty === null, JSON.stringify(rec));
  }
  // ── ONE ITEM ONE DECISION across a mixed store + priority order
  {
    const e = makeEnv({
      items: [I(1, '우유', 1, 3, '박스'), I(2, '치즈', 2, 5), I(3, '토마토', 4, 6), I(4, '하드롤', 0, 10), I(6, '스파게티니', 1, 6, 'kg'), I(8, '버터', 1, 2)],
      trusted: [1, 2, 3, 6, 8], writerReady: true,
      orders: [{ id: 31, store_id: 1, item_id: 3, item_name: '토마토', qty: 5, unit: '개', status: 'ordered' }, { id: 61, store_id: 1, item_id: 6, item_name: '스파게티니', qty: 6, unit: 'kg', status: 'ordered' },
        { id: 81, store_id: 1, item_id: 8, item_name: '버터', qty: 2, unit: '개', status: 'ordered' }],
      orderSupply: { 31: { order_state: 'PARTIAL', ordered_qty: 5, accepted_qty: 3, remaining_qty: 2, health: 'HEALTHY' }, 61: { order_state: 'OPEN', ordered_qty: 6, accepted_qty: 0, remaining_qty: 6, health: 'AT_RISK' },
        81: { order_state: 'CONFLICT', conflict_reason: 'OVER_RECEIPT' } },
      openSupply: { 1: { open_supply_state: 'NONE_CONFIRMED' }, 2: { open_supply_state: 'NONE_CONFIRMED' }, 3: { open_supply_state: 'VERIFIED_OPEN' }, 6: { open_supply_state: 'AT_RISK' }, 8: { open_supply_state: 'CONFLICT' } } });
    const r = e.derive(); const html = e.render();
    const ids = [...html.matchAll(/data-agent-iid="(\d+)"/g)].map(m => m[1]);
    check('ONE-DECISION every item at most one card on Home', ids.length === new Set(ids).size && ids.length === 6, ids.join(','));
    // critical first (late order, conflicting records; among them the base order), then 입고 → 주문 (bigger shortage ratio first) → 재고 확인
    check('PRIORITY critical (늦어지고 있어요, 주문 기록 다름) → 입고 → 주문 → 재고 확인', r.primary.map(a => `${a.item_id}:${a.type}`).join(' ') ===
      '6:RECEIVE_PENDING 8:WAIT_EXISTING_ORDER 3:RECEIVE_PENDING 1:ORDER_NOW 2:ORDER_NOW 4:CHECK_STOCK', r.primary.map(a => `${a.item_id}:${a.type}:${a.critical}`).join(' '));
    const at = r.primary.find(a => a.item_id === 6), cf = r.primary.find(a => a.item_id === 8);
    check('AT_RISK / CONFLICT in owner words (늦어지고 있어요 / 기록이 서로 달라 확인이 필요해요), no order advice', at.reason.includes('늦어지고 있어요') && cf.title === '버터 주문 기록을 확인해 주세요'
      && cf.reason.includes('기록이 서로 달라 확인이 필요해요') && !r.primary.some(a => a.type === 'ORDER_NOW' && [6, 8].includes(a.item_id)), JSON.stringify({ at, cf }));
    const vis = e.text(html);
    const leaked = ['VERIFIED_OPEN', 'AT_RISK', 'CONFLICT', 'UNKNOWN', 'NEEDS_VERIFICATION', 'NONE_CONFIRMED', 'Trusted', 'trusted', 'Operational', 'ORDER_NOW', 'CHECK_STOCK', 'RECEIVE_PENDING', '기록 재고', 'intent', 'mutation'].filter(w => vis.includes(w));
    check('COPY no internal terms in visible text', leaked.length === 0, leaked.join(','));
    check('RENDER derive + render write nothing', e.writes.length === 0, JSON.stringify(e.writes));
  }
  // ── ORDER FLOW  [주문 준비] → existing draft path (_insertOrderIfNotDup → order_requests pending), then the 발주표 row
  {
    const e = makeEnv({ items: [I(1, '우유', 1, 3, '박스')], trusted: [1], openSupply: { 1: { open_supply_state: 'NONE_CONFIRMED' } } });
    await e.f._agentPrepareOrder(1);
    const w = e.writes;
    check('ORDER-FLOW [주문 준비] → one pending order_requests row (qty 2 박스, store 1) via the dedup path, 발주표 re-rendered + shown', w.length === 1 && w[0].table === 'order_requests' && w[0].op === 'insert'
      && w[0].row.status === 'pending' && w[0].row.qty === 2 && w[0].row.unit === '박스' && w[0].row.store_id === 1 && e.calls.renderOrder === 1 && e.document.getElementById('homeOrderSection').scrolled === 1, JSON.stringify(w));
    const dup = makeEnv({ items: [I(1, '우유', 1, 3, '박스')], trusted: [1], existingOrders: [{ id: 5, store_id: 1, item_id: 1, status: 'pending', qty: 2 }] });
    await dup.f._agentPrepareOrder(1);
    check('ORDER-FLOW existing pending/ordered → no second order (dedup path), user told', dup.writes.length === 0 && dup.calls.toasts.some(t => t.includes('이미 발주표·주문에 있어요')), JSON.stringify(dup.writes));
    const no = makeEnv({ items: [I(1, '우유', 1, 3, '박스')], trusted: [] });
    await no.f._agentPrepareOrder(1);
    check('ORDER-FLOW not an ORDER_NOW decision (untrusted) → refuses, writes nothing', no.writes.length === 0, JSON.stringify(no.writes));
    const src = extractFn('_agentPrepareOrder');
    check('ORDER-FLOW uses the existing draft entry only (no direct order/stock/receipt write)', src.includes('_insertOrderIfNotDup(') && !/db\.from|\.rpc\(|processRequest|markOrdered|_writerAct/.test(src));
  }
  // ── COUNT FLOW  [재고 확인] → existing Count Mode, item shown; nothing written
  {
    const e = makeEnv({ items: [I(4, '하드롤', 0, 10)] });
    await e.f._agentCountItem(4);
    check('COUNT-FLOW [재고 확인] → 재고 tab + existing Count Mode (_startCountMode) + item card focused, 0 writes', e.calls.switchTab.join() === 'inventory' && e.calls.countMode === 1
      && e.document.getElementById('ic_4').scrolled === 1 && e.writes.length === 0, JSON.stringify(e.calls));
    check('COUNT-FLOW no new count path (agent code never writes stock / stock checks)', !/items'\)\.update|kitchen_operations|TRUSTED_STOCK_CHECK|_trustedStockCheck/.test(extractFn('_agentCountItem') + extractFn('deriveAgentActions') + extractFn('_renderAgentHome')));
  }
  // ── RECEIVE FLOW  writer ready → existing Trusted Writer calls only; not logged in → no write button, login hint
  {
    const ready = makeEnv({ ...OPEN2, writerReady: true }); const a = ofItem(ready.derive(), 1)[0]; const html = ready.render();
    check('RECEIVE-FLOW logged in → RECEIVE_PENDING [받았어요]=_writerFullReceipt(11), [일부만 받았어요]=_writerPartialReceipt(11)', a.type === 'RECEIVE_PENDING'
      && a.primary_action.call === '_writerFullReceipt(11)' && a.secondary_action.call === '_writerPartialReceipt(11)' && html.includes('onclick="_writerFullReceipt(11)"'), JSON.stringify(a));
    const out = makeEnv(OPEN2); const b = ofItem(out.derive(), 1)[0]; const h2 = out.render();
    check('RECEIVE-FLOW not logged in → no receipt button (only 주문 상태 보기), "입고 기록을 하려면 로그인해 주세요"', b.type === 'WAIT_EXISTING_ORDER' && b.primary_action.call === '_agentShowOrder(11)'
      && !/_writer\w+Receipt|_tblReceive|markReceived/.test(h2) && h2.includes('입고 기록을 하려면 로그인해 주세요'), h2);
    const agentSrc = ['deriveAgentActions', '_renderAgentHome', '_agentCardHtml', '_agentShowOrder', '_agentGoLogin'].map(extractFn).join('\n');
    check('RECEIVE-FLOW no unsafe fallback: agent never calls the old receive / direct writes', !/_tblReceive|markReceived|complete_order_receiving|db\.from/.test(agentSrc));
  }
  // ── HOME LAYOUT  top = 오늘 할 일; removed duplicate surfaces; owner-facing header
  {
    const home = HTML.slice(HTML.indexOf('<div id="tab-input"'), HTML.indexOf('<!-- 재고탭 -->'));
    const hdr = HTML.slice(HTML.indexOf('<div class="hdr">'), HTML.indexOf('<div class="api-key-popup"'));
    check('LAYOUT Home starts with 오늘 할 일; reminder & recommendation cards not on Home; need table folded', home.indexOf('id="agentHome"') < home.indexOf('id="homeOrderSection"')
      && !home.includes('v3NotifContainer') && !home.includes('suggestBar') && /<details class="home-details" id="homeDetails">[\s\S]*id="orderNeedCard"/.test(home), '');
    check('LAYOUT header has no API-key control (moved to 설정)', !hdr.includes('apiKeyBtn') && !hdr.includes('apiKeyDot') && HTML.slice(HTML.indexOf('<div id="tab-settings"')).includes('id="apiKeyBtn"'), '');
  }

  console.log(`\n${pass} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})();
