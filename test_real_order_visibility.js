/*
 * test_real_order_visibility.js — Real Order Visibility V0.1 (ORDER-VIS-01..09, NC-ROV-01..06, E2E, store isolation)
 *
 * "내가 이거 이미 주문했나?"를 사용자가 기억하는 대신 Home이 답한다: 확인된 주문(verified open supply)이 있으면
 * 주문처 · 수량 · 받은 수량 · 남은 수량을 보여 주고 그만큼은 주문 필요에서 뺀다. 증거가 없는 것(발주표에 담아 둔 후보,
 * 주문 기록 없음, 주문 시각, 도착 예정, 주문처)은 만들지 않는다. 입고 기록 전에는 재고가 바뀌지 않는다.
 *
 * REAL from index.html: deriveAgentActions, _agentOrderSupplier, _agentCardHtml, _renderAgentHome, _agentConfirmOrder,
 * _loadOrderSupply, the trust gate, _clearStoreContext and the Trusted Human Writer client (hw-v1).
 * MOCK: DOM, db (records every write), fetch = a FIXTURE writer backend (not the real Core: it only models
 * "confirm → verified open", "receipt → remaining ↓ and stock ↑"), auth, storage. No network, no production.
 * Negative controls re-run the same scenarios against a deliberately broken copy of the real code and require the
 * named scenario to FAIL — so each scenario is shown to detect that defect.
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
function extractConstBlock(name) {
  const start = HTML.indexOf(`const ${name} = {`);
  if (start < 0) throw new Error('const not found: ' + name);
  let depth = 0, i = HTML.indexOf('{', start);
  for (; i < HTML.length; i++) { const c = HTML[i]; if (c === '{') depth++; else if (c === '}') { depth--; if (depth === 0) { i++; break; } } }
  return HTML.slice(start, i) + ';';
}
const constLine = n => { const m = new RegExp(`const ${n} = [^\\n]+`).exec(HTML); if (!m) throw new Error('const not found: ' + n); return m[0]; };

const FNS = ['_asideProposalLine', '_orderNeedOf', '_admittedNeedOf', '_draftAge', '_agentOrderSupplier', '_fmtKst', '_agentDeliveryLine', '_safeOrderUrl', 'deriveAgentActions', '_agentContext', '_agentCardHtml', '_renderAgentHome',
  '_agentConfirmOrder', '_agentShowOrder', '_agentCountItem', '_agentGoLogin', '_agentFocus', '_clearStoreContext', '_storeChanged', '_loadOrderSupply',
  '_orderIdentity', '_openSupplyLabel', '_receiveItemHtml', '_writerActionsHtml',
  '_authClient', '_writerToken', '_refreshWriterReadiness', '_loadPendingAction', '_savePendingAction', '_writerResultMessage', '_newActionId', '_writerAct',
  '_deliverPendingAction', '_renderWriterBar', '_confirmActualOrder', '_supplierOptions', '_writerFields', '_writerConfirmOrder', '_writerPartialReceipt', '_writerFullReceipt', '_writerCancelOrder', '_writerConfirmCoverage'];
const BASE_CODE = ['AGENT_PRIORITY', 'AGENT_MAX_CHECKS', '_AGENT_SOURCE_LABEL', '_DELIVERY_LABEL', '_agentEsc', '_agentNum', '_fmtQty', '_RECEIVE_LOCKED_MSG', '_WRITER_API', '_WRITER_URL', '_WRITER_PENDING_KEY']
  .map(constLine).join('\n') + '\n' + extractConstBlock('_WRITER_MSG') + '\n' + extractConstBlock('_WRITER_FIELDS') + '\n' + FNS.map(extractFn).join('\n');

const I = (id, name, cur, target, unit = '개', extra = {}) => ({ item_id: id, item_name: name, current_qty: cur, target_qty: target, unit, ...extra });
const ORD = (id, itemId, name, qty, unit, extra = {}) => ({ id, store_id: 1, item_id: itemId, item_name: name, qty, unit, status: 'ordered', vendor_id: null, created_at: '2026-10-01T02:00:00Z', ...extra });
const SUP = (o = {}) => ({ verified: true, verification: 'HUMAN_CONFIRMED', order_state: 'OPEN', ordered_qty: 2, accepted_qty: 0, remaining_qty: 2, health: 'HEALTHY', conflict_reason: null, ...o });
const VENDORS = [{ vendor_id: 7, vendor_name: '쿠팡' }, { vendor_id: 8, vendor_name: '식봄' }];

// o.server = the fixture writer backend + reader state (per store). patch = source mutation for a negative control.
function makeEnv(o = {}, patch = null) {
  const code = patch ? patch(BASE_CODE) : BASE_CODE;
  const writes = [], toasts = [], fetchCalls = [], rpcCalls = [], confirms = [], store = new Map(), els = {};
  const mkEl = id => ({ id, innerHTML: '', value: '', style: {}, scrolled: 0, classList: { add() {}, remove() {}, contains: () => false }, scrollIntoView() { this.scrolled++; }, querySelector: () => null });
  const document = { getElementById: id => (els[id] = els[id] || mkEl(id)), querySelector: () => null, querySelectorAll: () => [] };
  const q = table => { const b = { select: () => b, eq: () => b, in: () => b, limit: () => b, order: () => b,
    insert: row => { writes.push({ table, op: 'insert', row }); return b; }, update: row => { writes.push({ table, op: 'update', row }); return b; },
    delete: () => { writes.push({ table, op: 'delete' }); return b; }, then: r => Promise.resolve({ data: [], error: null }).then(r) }; return b; };
  const srv = o.server || null;
  const db = { from: q, rpc: async (name, args) => {
    rpcCalls.push({ name, args });
    if (o.rpcGate) await o.rpcGate;
    if (!srv) return { data: null, error: { message: 'Could not find the function' } };
    if (name === 'get_order_supply') return { data: srv.supply.filter(r => r.store_id === args.p_store_id), error: null };
    if (name === 'get_open_supply') return { data: srv.open.filter(r => r.store_id === args.p_store_id), error: null };
    return { data: null, error: { message: 'unexpected rpc ' + name } };
  } };
  // FIXTURE writer backend: only the action semantics this suite needs. Inventory changes on a receipt and nowhere else.
  const fetch = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : undefined;
    fetchCalls.push({ url, method: init.method, headers: init.headers, body });
    const reply = (status, b) => ({ status, ok: status >= 200 && status < 300, json: async () => b });
    if (init.method === 'GET') return reply(200, { api_version: 'hw-v1', ready: !!o.writerGrant, reason: o.writerGrant ? 'READY' : 'NO_STORE_GRANT' });
    const row = srv.orderRequests.find(r => r.id === body.order_id);
    const sup = srv.supply.find(r => r.order_id === body.order_id);
    const open = row && srv.open.find(r => r.item_id === row.item_id);
    if (body.action === 'CONFIRM_ORDER') {
      if (!row || row.status !== 'ordered' || !sup) return reply(200, { code: 'NOT_FOUND' });   // 발주표에 담기만 한 항목은 주문이 아니다
      if (sup.verified) return reply(200, { code: 'ALREADY_CONFIRMED' });
      Object.assign(sup, SUP({ ordered_qty: row.qty, remaining_qty: row.qty }));
      Object.assign(open, { open_supply_state: 'VERIFIED_OPEN', known_healthy_open_qty: row.qty, total_open_qty: row.qty });
      return reply(200, { code: 'CONFIRMED' });
    }
    if (body.action === 'PARTIAL_RECEIPT' || body.action === 'FULL_RECEIPT') {
      if (!sup || !sup.verified) return reply(200, { code: 'NOT_FOUND' });
      const got = body.action === 'FULL_RECEIPT' ? sup.remaining_qty : body.received_qty;
      sup.accepted_qty += got; sup.remaining_qty -= got; sup.order_state = sup.remaining_qty > 0 ? 'PARTIAL' : 'RECEIVED';
      Object.assign(open, sup.remaining_qty > 0 ? { known_healthy_open_qty: sup.remaining_qty, total_open_qty: sup.remaining_qty } : { open_supply_state: 'NONE_CONFIRMED', known_healthy_open_qty: 0, total_open_qty: 0 });
      if (sup.remaining_qty <= 0) row.status = 'received';
      srv.items.find(i => i.item_id === row.item_id).current_qty += got;   // 재고는 입고 기록에서만 늘어난다
      return reply(200, { code: 'SUCCESS' });
    }
    return reply(200, { code: 'NOT_FOUND' });
  };
  const authApi = { getSession: async () => ({ data: { session: o.session === false ? null : { access_token: 'jwt-op', user: { email: 'op@store1.kr' } } } }) };
  const localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
  let answers = [];
  const env = {
    document, db, fetch, localStorage, console: { log() {}, warn() {}, error() {} }, setTimeout: () => 0, window: {}, crypto: require('crypto').webcrypto,
    createClient: () => ({ auth: authApi }), SUPABASE_URL: 'https://proj.supabase.co', SUPABASE_KEY: 'sb_publishable_test',
    showToast: t => toasts.push(t), confirm: m => { confirms.push(m); return answers.length ? answers.shift() : true; }, prompt: () => (answers.length ? answers.shift() : null),
    switchTab: async () => {}, _startCountMode: () => {}, renderInventory: () => {}, _closeDupCleanup() {}, _closeComplexCard() {}, cancelReview() {},
    // 기록 결과는 서버 projection과 재고를 다시 읽어 그린다 (renderOrder가 하는 일의 이 화면 부분)
    _renderOrderKeepScroll: async () => { await api.reload(); },
  };
  // items are copied: a scenario (or a negative control) can never change another's fixture
  const S = { SID: o.sid || 1, _items: (o.items || []).map(i => ({ ...i })), _itemTrust: new Map(), _orderRequests: o.orders || [], _orderSupply: new Map(), _openSupply: new Map(),
    _supplyAvailable: o.supplyAvailable !== false, _writerReady: !!o.writerReady, _vendors: o.vendors || VENDORS };
  for (const it of S._items) if ((o.trusted || []).includes(it.item_id)) S._itemTrust.set(it.item_id, { trusted: true, lastQty: Number(it.current_qty) });
  for (const [k, v] of Object.entries(o.orderSupply || {})) S._orderSupply.set(Number(k), v);
  for (const [k, v] of Object.entries(o.openSupply || {})) S._openSupply.set(Number(k), v);
  const names = Object.keys(env);
  const body = `let SID = __S.SID, _storeEpoch = 0, _items = __S._items, _itemTrust = __S._itemTrust, _orderRequests = __S._orderRequests,
      _orderSupply = __S._orderSupply, _openSupply = __S._openSupply, _supplyAvailable = __S._supplyAvailable, _writerReady = __S._writerReady,
      _vendors = __S._vendors, _countMode = false, _countedIds = new Set(), _homeTableCollapsed = false, _agentCycle = new Map(),
      _dismissedItemIds = new Set(), _orderedItemIds = new Set(), _storeAliases = [], _draftItems = [], _pendingComplexItems = null,
      _authDb = null, _writerState = { status: 'signed_out', reason: '' }, _orderDelivery = new Map(), _writerCaps = [], _asideWatch = new Map(), _asideEnabled = false;
    ${code}
    return { ${FNS.join(', ')}, set(k, v) { eval(k + ' = v'); }, get(k) { return eval(k); } };`;
  const f = new Function(...names, '__S', body)(...names.map(n => env[n]), S);
  const text = html => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const api = {
    f, writes, toasts, fetchCalls, rpcCalls, confirms, srv, text, document,
    answer: (...a) => { answers = a; },
    derive: (extra = {}) => f.deriveAgentActions({ ...f._agentContext(), ...extra }),
    render: () => { f._renderAgentHome(); return document.getElementById('agentHome').innerHTML; },
    // what the app re-reads after a write: order rows, stock (+ the trust the server-side receipt keeps), supply projection, readiness
    reload: async () => {
      f.set('_orderRequests', srv.orderRequests.filter(r => r.store_id === f.get('SID') && (r.status === 'pending' || r.status === 'ordered')).map(r => ({ ...r })));
      f.set('_items', srv.items.filter(i => i.store_id === f.get('SID')).map(i => ({ ...i })));
      f.set('_itemTrust', new Map(f.get('_items').map(i => [i.item_id, { trusted: true, lastQty: Number(i.current_qty) }])));
      await f._loadOrderSupply(); await f._refreshWriterReadiness(); f._renderAgentHome();
    },
    posts: () => fetchCalls.filter(c => c.method === 'POST'),
  };
  return api;
}
const all = r => [...r.primary, ...r.moreChecks, ...r.waiting];
const ofItem = (r, id) => all(r).filter(a => a.item_id === id);
const cardText = a => [a.title, ...(a.orders || []).map(o => o.line), a.reason].join(' | ');
// words that would be an arrival / delivery / order-time claim (nothing in the contract carries that evidence today)
const FABRICATED = /도착|배송|새벽|내일|오늘|어제|예정|ETA|\d{1,2}:\d{2}|\d+월 \d+일|담음/;

// fixtures
const MILK = I(1, '우유', 1, 3, '박스');
const OPEN2 = { items: [MILK], trusted: [1], orders: [ORD(11, 1, '우유', 2, '박스', { vendor_id: 7 })],
  orderSupply: { 11: SUP({ supply_source: 'COUPANG' }) }, openSupply: { 1: { open_supply_state: 'VERIFIED_OPEN', known_healthy_open_qty: 2, total_open_qty: 2 } } };

// Every scenario builds its own env from the (possibly mutated) real code and returns [ok, detail].
function scenarios(patch) {
  const mk = o => makeEnv(o, patch);
  const S = {};
  const run = (name, fn) => { try { const [ok, detail] = fn(); S[name] = { ok: !!ok, detail }; } catch (e) { S[name] = { ok: false, detail: 'threw: ' + e.message }; } };

  run('ORDER-VIS-01 need 2, no verified order, coverage confirmed none → order 2; "현재 확인된 주문 없음"; never hands the question back', () => {
    const e = mk({ items: [MILK], trusted: [1], openSupply: { 1: { open_supply_state: 'NONE_CONFIRMED', known_healthy_open_qty: 0, total_open_qty: 0 } } });
    const a = e.derive().primary[0], txt = e.text(e.render());
    return [a.type === 'ORDER_NOW' && a.required_qty === 2 && a.title === '우유 2박스 주문하세요' && a.reason.includes('현재 확인된 주문 없음') && a.reason.includes('진행 중인 주문이 없다고 확인됨')
      && a.orders.length === 0 && !/이미 시켰다면/.test(txt), cardText(a)];
  });
  run('ORDER-VIS-02 need 2, verified remaining 2 (쿠팡) → "추가 주문하지 마세요" + "쿠팡 · 2박스 주문 확인됨"; ORDER_NOW 0', () => {
    const e = mk(OPEN2); const r = e.derive(), a = ofItem(r, 1), html = e.render(), txt = e.text(html);
    return [a.length === 1 && a[0].type !== 'ORDER_NOW' && a[0].title === '우유 추가 주문하지 마세요' && a[0].orders.length === 1 && a[0].orders[0].line === '쿠팡 · 2박스 주문 확인됨'
      && a[0].reason.includes('쿠팡에서 2박스 주문 중이라 추가 주문하지 않아도 돼요') && a[0].open_supply_remaining === 2 && !all(r).some(x => x.type === 'ORDER_NOW')
      && html.includes('<div class="agent-order-line" data-agent-order="11">쿠팡 · 2박스 주문 확인됨</div>') && !/주문하세요|주문이 필요해요|주문 준비|이미 시켰다면/.test(txt), cardText(a[0] || {})];
  });
  run('ORDER-VIS-03 need 3, verified remaining 1 → "2박스 더 주문하세요" + "1박스 주문 중" (need 4 / open 1 → 3)', () => {
    const o = { items: [I(1, '우유', 0, 3, '박스')], trusted: [1], orders: [ORD(11, 1, '우유', 1, '박스')], orderSupply: { 11: SUP({ ordered_qty: 1, remaining_qty: 1, supply_source: 'COUPANG' }) },
      openSupply: { 1: { open_supply_state: 'VERIFIED_OPEN', known_healthy_open_qty: 1, total_open_qty: 1 } } };
    const a = ofItem(mk(o).derive(), 1);
    const b = ofItem(mk({ ...o, items: [I(1, '우유', 0, 4, '박스')] }).derive(), 1);
    return [a.length === 1 && a[0].type === 'ORDER_NOW' && a[0].required_qty === 2 && a[0].title === '우유 2박스 더 주문하세요' && a[0].reason.includes('이미 1박스 주문 중')
      && a[0].orders[0].line === '쿠팡 · 1박스 주문 확인됨' && b.length === 1 && b[0].required_qty === 3 && b[0].title === '우유 3박스 더 주문하세요', cardText(a[0] || {}) + ' || ' + cardText(b[0] || {})];
  });
  run('ORDER-VIS-04 ordered 5 / received 3 → "2개 입고 대기", "주문 5개 중 3개 받음 · 2개 남음"', () => {
    const e = mk({ items: [I(3, '토마토', 4, 6)], trusted: [3], orders: [ORD(31, 3, '토마토', 5, '개', { vendor_id: 8 })],
      orderSupply: { 31: SUP({ order_state: 'PARTIAL', ordered_qty: 5, accepted_qty: 3, remaining_qty: 2, supply_source: 'SIKBOM' }) }, openSupply: { 3: { open_supply_state: 'VERIFIED_OPEN', known_healthy_open_qty: 2, total_open_qty: 2 } } });
    const a = ofItem(e.derive(), 3);
    return [a.length === 1 && a[0].title === '토마토 2개 입고 대기' && a[0].orders[0].line === '식봄 · 주문 5개 중 3개 받음 · 2개 남음' && a[0].orders[0].received_qty === 3 && a[0].orders[0].remaining_qty === 2
      && a[0].type !== 'ORDER_NOW', cardText(a[0] || {})];
  });
  run('ORDER-VIS-05 coverage unknown / no supply row → never "no order" as a fact; reader down → "주문 여부를 확인할 수 없어요"', () => {
    const CLAIM = /없다고 확인|주문 중 없음|진행 중인 주문 없음|주문하세요/;
    const norow = mk({ items: [MILK], trusted: [1] }).derive().primary[0];
    const unk = mk({ items: [MILK], trusted: [1], openSupply: { 1: { open_supply_state: 'UNKNOWN', known_healthy_open_qty: 0, total_open_qty: null } } }).derive().primary[0];
    const down = mk({ items: [MILK], trusted: [1], supplyAvailable: false }).derive().primary[0];
    return [[norow, unk].every(a => a.type === 'ORDER_NOW' && a.title === '우유 2박스 주문이 필요해요' && a.reason.includes('현재 확인된 주문 없음') && !CLAIM.test(cardText(a)) && !/이미 시켰다면/.test(a.reason))
      && down.title === '우유 2박스 주문이 필요해요' && down.reason.includes('주문 여부를 확인할 수 없어요') && !/확인된 주문 없음/.test(down.reason) && !CLAIM.test(cardText(down)),
      [norow, unk, down].map(cardText).join(' || ')];
  });
  run('ORDER-VIS-06 draft only → not shown as an actual order, not subtracted; kept apart as the 발주표 notice', () => {
    const draft = { id: 70, store_id: 1, item_id: 1, item_name: '우유', qty: 2, unit: '박스', status: 'pending', vendor_id: 7, created_at: '2026-09-20T01:00:00Z' };
    const e = mk({ items: [MILK], trusted: [1], orders: [draft] }); const a = ofItem(e.derive(), 1), html = e.render();
    const e2 = mk({ items: [I(1, '우유', 5, 3, '박스')], trusted: [1], orders: [draft] }); const r2 = e2.derive(), html2 = e2.render();
    return [a.length === 1 && a[0].type === 'ORDER_NOW' && a[0].required_qty === 2 && a[0].orders.length === 0 && a[0].open_supply_remaining === 0 && a[0].supplier === ''
      && !html.includes('agent-order-line') && !/주문 확인됨|주문 중이라|쿠팡/.test(e.text(html)) && a[0].reason.includes('발주표에 2박스 담겨 있어요')
      && all(r2).length === 0 && r2.drafts.length === 1 && html2.includes('data-agent-drafts="1"') && !html2.includes('agent-order-line') && !/주문 확인됨|쿠팡|입고 대기/.test(e2.text(html2)),
      cardText(a[0] || {}) + ' || ' + e2.text(html2)];
  });
  run('ORDER-VIS-07 supplier unknown → "주문처 미확인"; never the item default vendor, a draft vendor or an unknown source code', () => {
    const o = { items: [I(1, '우유', 1, 3, '박스', { vendor_id: 7 })], trusted: [1],
      orders: [ORD(11, 1, '우유', 2, '박스'), { id: 70, store_id: 1, item_id: 1, item_name: '우유', qty: 2, unit: '박스', status: 'pending', vendor_id: 7 }],
      orderSupply: { 11: SUP({ supply_source: 'SOMEWHERE_NEW' }) }, openSupply: { 1: { open_supply_state: 'VERIFIED_OPEN', known_healthy_open_qty: 2, total_open_qty: 2 } } };
    const e = mk(o); const a = ofItem(e.derive(), 1)[0], txt = e.text(e.render());
    return [a.supplier === '' && a.orders[0].supplier === '' && a.orders[0].line === '주문처 미확인 · 2박스 주문 확인됨' && a.reason.startsWith('2박스 주문 중이라') && !/쿠팡|식봄|SOMEWHERE/.test(txt), txt];
  });
  run('ORDER-VIS-08 no ETA / delivery status / order time is ever produced (covered, partial, short, late)', () => {
    const cards = [
      ofItem(mk(OPEN2).derive(), 1)[0],
      ofItem(mk({ ...OPEN2, writerReady: true }).derive(), 1)[0],
      ofItem(mk({ ...OPEN2, items: [I(1, '우유', 0, 6, '박스')] }).derive(), 1)[0],
      ofItem(mk({ ...OPEN2, orderSupply: { 11: SUP({ order_state: 'PARTIAL', accepted_qty: 1, remaining_qty: 1, supply_source: 'SIKBOM' }) } }).derive(), 1)[0],
      ofItem(mk({ ...OPEN2, orderSupply: { 11: SUP({ health: 'AT_RISK', supply_source: 'SIKBOM' }) } }).derive(), 1)[0],
    ];
    const bad = cards.map(cardText).filter(t => FABRICATED.test(t));
    // AT_RISK is the server's own risk flag = "needs a check" in owner words — not a delay, not a date, not an arrival promise
    return [bad.length === 0 && cardText(cards[4]).includes('이 주문은 확인이 필요해요') && !/늦어|지연/.test(cardText(cards[4])) && cards.every(c => !('eta' in c) && c.orders.every(o => !('eta' in o) && !('ordered_at' in o))), bad.join(' || ')];
  });
  run('ORDER-VIS-09 an order is identifiable by its internal record ref (주문 기록 #id) in the detail; nothing secret reaches the screen', () => {
    const two = { items: [I(1, '우유', 1, 6, '박스')], trusted: [1], orders: [ORD(11, 1, '우유', 2, '박스', { vendor_id: 7 }), ORD(12, 1, '우유', 3, '박스', { vendor_id: 8 })],
      orderSupply: { 11: SUP({ supply_source: 'COUPANG' }), 12: SUP({ ordered_qty: 3, remaining_qty: 3, supply_source: 'SIKBOM' }) }, openSupply: { 1: { open_supply_state: 'VERIFIED_OPEN', known_healthy_open_qty: 5, total_open_qty: 5 } }, writerReady: true };
    const e = mk(two); const a = ofItem(e.derive(), 1)[0], html = e.render();
    const one = mk(OPEN2); const b = ofItem(one.derive(), 1)[0];
    const detail = one.f._receiveItemHtml({ order_id: 11, item_id: 1, name: '우유', orderQty: 2, unit: '박스', created_at: '2026-10-01T02:00:00Z' });
    return [a.orders.map(o => o.line).join('|') === '쿠팡 · 2박스 주문 확인됨 · 주문 기록 #11|식봄 · 3박스 주문 확인됨 · 주문 기록 #12' && a.open_supply_remaining === 5 && a.supplier === ''
      && html.includes('data-agent-order="11"') && html.includes('data-agent-order="12"') && b.primary_action.call === '_agentShowOrder(11)' && b.orders[0].order_id === 11
      && /주문 기록 #11 · \d+\/\d+ \d\d:\d\d 기록 · 확인된 주문 · 입고 0\/2 · 남은 2박스/.test(detail)
      && !/eyJ|Bearer|jwt-op|sb_secret|service_role|password|apikey/i.test(html + detail + JSON.stringify(a) + JSON.stringify(b)), e.text(html) + ' || ' + one.text(detail)];
  });
  run('NEED-UNKNOWN stock not trusted + verified open 2 → no ORDER_NOW, no "추가 주문 불필요" claim; shows the order and asks for a count', () => {
    const e = mk({ ...OPEN2, trusted: [] }); const a = ofItem(e.derive(), 1);
    const u = ofItem(mk({ ...OPEN2, items: [I(1, '우유', null, 3, '박스')], trusted: [] }).derive(), 1);
    return [[a, u].every(x => x.length === 1 && x[0].type === 'WAIT_EXISTING_ORDER' && x[0].title === '우유 2박스 주문 중' && x[0].required_qty === null && x[0].orders[0].line === '쿠팡 · 2박스 주문 확인됨'
      && x[0].reason.includes('현재 수량을 확인하면 더 주문할지 알려 드릴게요') && !/추가 주문하지|더 주문하세요/.test(cardText(x[0])) && x[0].secondary_action.call === '_agentCountItem(1)'), cardText(a[0] || {})];
  });
  run('NO-NEED need 0 + verified open 2 → no ORDER_NOW; secondary "우유 2박스 주문 중"', () => {
    const e = mk({ ...OPEN2, items: [I(1, '우유', 5, 3, '박스')] }); const r = e.derive(), a = ofItem(r, 1);
    return [r.primary.length === 0 && a.length === 1 && a[0].type === 'WAIT_EXISTING_ORDER' && a[0].title === '우유 2박스 주문 중' && a[0].orders[0].line === '쿠팡 · 2박스 주문 확인됨'
      && e.text(e.render()).includes('주문 · 입고 대기'), cardText(a[0] || {})];
  });
  run('COVERAGE partial cover when other orders are not ruled out → "더 주문이 필요해요" + "그 밖에 확인된 주문 없음" (not a flat 주문하세요)', () => {
    const a = ofItem(mk({ ...OPEN2, items: [I(1, '우유', 0, 5, '박스')], openSupply: { 1: { open_supply_state: 'UNKNOWN', known_healthy_open_qty: 2, total_open_qty: null } } }).derive(), 1)[0];
    return [a.type === 'ORDER_NOW' && a.required_qty === 3 && a.title === '우유 3박스 더 주문이 필요해요' && a.reason.includes('이미 2박스 주문 중 · 그 밖에 확인된 주문 없음'), cardText(a)];
  });
  run('INVENTORY ordered / delivered ≠ received: stock and need come from the trusted count only; rendering writes nothing', () => {
    const items = [I(1, '우유', 1, 6, '박스')];
    // a hypothetical "delivered" flag on the server row is not a receipt: still open, still not in stock
    const e = mk({ ...OPEN2, items, writerReady: true, orderSupply: { 11: SUP({ supply_source: 'COUPANG', delivery_status: 'DELIVERED' }) } });
    const a = ofItem(e.derive(), 1)[0]; const html = e.render();
    const w = mk({ ...OPEN2, items: [I(1, '우유', 1, 3, '박스')], writerReady: true, orderSupply: { 11: SUP({ supply_source: 'COUPANG', delivery_status: 'DELIVERED' }) } });
    const b = ofItem(w.derive(), 1)[0]; w.render();
    return [a.type === 'ORDER_NOW' && a.current_qty === 1 && a.required_qty === 3 && a.reason.startsWith('현재 1박스 · 목표 6박스 · 이미 2박스 주문 중') && e.f.get('_items')[0].current_qty === 1 && w.f.get('_items')[0].current_qty === 1
      && b.type === 'RECEIVE_PENDING' && b.primary_action.label === '받았어요' && b.primary_action.call === '_writerFullReceipt(11)' && !/입고 완료|받음/.test(cardText(b))
      && e.writes.length === 0 && w.writes.length === 0 && e.fetchCalls.length === 0 && w.fetchCalls.length === 0 && !/배송 완료|DELIVERED/.test(html), cardText(a) + ' || ' + cardText(b)];
  });
  return S;
}

let pass = 0, fail = 0;
function check(name, ok, detail = '') { if (ok) pass++; else fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? '  — ' + String(detail).slice(0, 500) : ''}`); }

(async () => {
  // ── scenarios on the real code ──
  const base = scenarios(null);
  for (const [name, r] of Object.entries(base)) check(name, r.ok, r.detail);

  // ── negative controls: break the real code one way, the named scenario must fail (and did pass above) ──
  const sub = (a, b) => code => { if (!code.includes(a)) throw new Error('NC patch target not found: ' + a); return code.replace(a, b); };
  const both = (...ps) => code => ps.reduce((c, p) => p(c), code);
  const NCS = [
    ['NC-ROV-01 a draft (pending 발주표 row) treated as a verified order', ['ORDER-VIS-06'], both(
      sub(`const ordered = mine.filter(r => r.status === 'ordered');`, `const ordered = mine;`),
      sub(`const supOf = r => ctx.supplyAvailable ? ctx.orderSupply.get(r.id) : null;`, `const supOf = r => (ctx.supplyAvailable ? ctx.orderSupply.get(r.id) : null) || { order_state: 'OPEN', ordered_qty: r.qty, accepted_qty: 0, remaining_qty: r.qty };`))],
    ['NC-ROV-02 a missing supply row treated as "no order confirmed"', ['ORDER-VIS-05'],
      sub(`const sure = ctx.supplyAvailable && proj?.open_supply_state === 'NONE_CONFIRMED';`, `const sure = !proj || proj.open_supply_state === 'NONE_CONFIRMED' || proj.open_supply_state === 'UNKNOWN';`)],
    ['NC-ROV-03 verified open supply not subtracted from the need', ['ORDER-VIS-02', 'ORDER-VIS-03'],
      sub(`const rem = open.reduce((s, x) => s + Number(x.sup.remaining_qty || 0), 0);`, `const rem = 0;`)],
    ['NC-ROV-04 ordered / delivered quantity counted as stock before a receipt', ['INVENTORY'],
      sub(`const need = it ? ctx.needOf(it) : { state: 'NO_TARGET', qty: 0 };`,
        `if (it && open.length) { it.current_qty = Number(it.current_qty) + open.reduce((s, x) => s + Number(x.sup.remaining_qty || 0), 0); _itemTrust.set(id, { trusted: true, lastQty: it.current_qty }); }
    const need = it ? ctx.needOf(it) : { state: 'NO_TARGET', qty: 0 };`)],
    ['NC-ROV-05 an ETA invented for an order without delivery evidence', ['ORDER-VIS-08'],
      sub('`${_agentNum(oq)}${u} 주문 확인됨`);', '`${_agentNum(oq)}${u} 주문 확인됨 · 내일 새벽 도착 예정`);')],
    ['NC-ROV-06 supplier guessed from the item default vendor / a draft vendor', ['ORDER-VIS-07'],
      sub(`const supplier = _agentOrderSupplier(x.sup);`,
        `const supplier = _agentOrderSupplier(x.sup) || (ctx.vendors || []).find(v => v.vendor_id === (x.r.vendor_id ?? it?.vendor_id ?? pending?.vendor_id))?.vendor_name || '';`)],
  ];
  for (const [name, targets, patch] of NCS) {
    let broken, err = '';
    try { broken = scenarios(patch); } catch (e) { err = e.message; }
    const hit = broken ? Object.entries(broken).filter(([k, r]) => targets.some(t => k.startsWith(t)) && !r.ok && !String(r.detail).startsWith('threw')) : [];
    const baseOk = Object.entries(base).filter(([k]) => targets.some(t => k.startsWith(t))).every(([, r]) => r.ok);
    check(`${name} → ${targets.join(' / ')} fail by assertion`, !err && baseOk && hit.length === targets.length,
      err || (broken ? Object.entries(broken).filter(([k]) => targets.some(t => k.startsWith(t))).map(([k, r]) => `${k.split(' ')[0]}=${r.ok ? 'STILL PASS' : r.detail}`).join(' || ') : ''));
  }

  // ── E2E: a person confirms a real order through the existing trusted writer → Home answers; stock moves only on receipt ──
  {
    const server = () => ({
      items: [{ store_id: 1, ...MILK }],
      orderRequests: [ORD(11, 1, '우유', 2, '박스', { vendor_id: 7 }), { id: 70, store_id: 1, item_id: 1, item_name: '우유', qty: 2, unit: '박스', status: 'pending', vendor_id: 7 }],
      supply: [{ store_id: 1, order_id: 11, item_id: 1, verified: false, order_state: 'UNVERIFIED_LEGACY', ordered_qty: 2, accepted_qty: 0, remaining_qty: 2, health: null }],
      open: [{ store_id: 1, item_id: 1, unit: '박스', open_supply_state: 'UNKNOWN', known_healthy_open_qty: 0, known_at_risk_open_qty: 0, total_open_qty: null }],
    });
    const e = makeEnv({ server: server(), writerGrant: true });
    await e.reload();
    let html = e.document.getElementById('agentHome').innerHTML, a = ofItem(e.derive(), 1);
    check('E2E-1 app-recorded "ordered" row, not yet confirmed → not an actual order: no order line, no ORDER_NOW, [실제로 주문했어요] on Home (operator logged in)',
      a.length === 1 && a[0].type === 'WAIT_EXISTING_ORDER' && a[0].title === '우유 주문 확인이 필요해요' && a[0].orders.length === 0 && a[0].reason.includes('실제 주문은 아직 확인되지 않았어요')
      && a[0].primary_action.label === '실제로 주문했어요' && a[0].primary_action.call === '_agentConfirmOrder(11)' && !html.includes('agent-order-line') && !/주문 확인됨|주문하세요/.test(e.text(html)), e.text(html));

    e.answer(false); await e.f._agentConfirmOrder(11);
    check('E2E-2 the person says no → nothing sent', e.posts().length === 0 && e.confirms.length === 1 && e.confirms[0].includes('주문 기록 #11 · 우유 2박스') && !/쿠팡/.test(e.confirms[0]) && e.confirms[0].includes('발주표에 담기만 한 것은 주문이 아니에요'), e.confirms[0]);
    await e.f._agentConfirmOrder(70);
    check('E2E-3 a draft (pending) cannot be confirmed as an order → refused in the app, nothing sent', e.posts().length === 0 && e.toasts.some(t => t.includes('주문 기록을 찾지 못했습니다')), e.toasts.join(' | '));

    e.answer(true); await e.f._agentConfirmOrder(11);
    const p = e.posts()[0];
    html = e.document.getElementById('agentHome').innerHTML; a = ofItem(e.derive(), 1);
    check('E2E-4 [실제로 주문했어요] → the existing writer only: POST human-supply-writer/web {action: CONFIRM_ORDER, action_id, order_id} with the login session — no actor / store / supplier / stock field',
      e.posts().length === 1 && p.url === 'https://proj.supabase.co/functions/v1/human-supply-writer/web' && p.headers.Authorization === 'Bearer jwt-op'
      && JSON.stringify(Object.keys(p.body).sort()) === JSON.stringify(['action', 'action_id', 'order_id']) && p.body.action === 'CONFIRM_ORDER' && p.body.order_id === 11, JSON.stringify(p));
    check('E2E-5 after the server confirms (no supplier given) → Home answers by itself: "우유 추가 주문하지 마세요" / "주문처 미확인 · 2박스 주문 확인됨" (the draft vendor is not the supplier) / [받았어요]; ORDER_NOW 0',
      a.length === 1 && a[0].type === 'RECEIVE_PENDING' && a[0].title === '우유 추가 주문하지 마세요' && a[0].orders[0].line === '주문처 미확인 · 2박스 주문 확인됨' && a[0].primary_action.call === '_writerFullReceipt(11)'
      && html.includes('주문처 미확인 · 2박스 주문 확인됨') && !html.includes('쿠팡') && !/주문하세요|주문이 필요해요|이미 시켰다면/.test(e.text(html)), e.text(html));
    check('E2E-6 confirming an order changes no stock: item still 1박스 (app and server), app made no table write, no supply writer RPC',
      e.f.get('_items')[0].current_qty === 1 && e.srv.items[0].current_qty === 1 && e.writes.length === 0 && e.rpcCalls.every(c => ['get_order_supply', 'get_open_supply', 'get_order_delivery', 'get_aside_watch', 'get_aside_worker_status'].includes(c.name)), JSON.stringify(e.writes));

    e.answer('1'); await e.f._writerPartialReceipt(11);
    a = ofItem(e.derive(), 1);
    check('E2E-7 partial receipt 1 → stock 2 (only now), "우유 1박스 입고 대기" / "주문처 미확인 · 주문 2박스 중 1박스 받음 · 1박스 남음"; still no extra order',
      e.srv.items[0].current_qty === 2 && e.f.get('_items')[0].current_qty === 2 && a.length === 1 && a[0].title === '우유 1박스 입고 대기'
      && a[0].orders[0].line === '주문처 미확인 · 주문 2박스 중 1박스 받음 · 1박스 남음' && a[0].type === 'RECEIVE_PENDING', cardText(a[0] || {}));
    e.answer(true); await e.f._writerFullReceipt(11);
    html = e.document.getElementById('agentHome').innerHTML;
    check('E2E-8 the rest received → stock 3 = target, the order leaves Home, nothing to do; app table writes still 0',
      e.srv.items[0].current_qty === 3 && ofItem(e.derive(), 1).length === 0 && !html.includes('agent-order-line') && html.includes('오늘은 바로 처리할 일이 없습니다.') && e.writes.length === 0, e.text(html));

    const out = makeEnv({ server: server(), writerGrant: false });
    await out.reload();
    const b = ofItem(out.derive(), 1)[0]; const h2 = out.document.getElementById('agentHome').innerHTML;
    check('E2E-9 no writer grant → no confirm button on Home (주문 상태 보기 + 로그인 안내); a direct call sends nothing',
      b.primary_action.call === '_agentShowOrder(11)' && !h2.includes('_agentConfirmOrder') && h2.includes('주문 확인을 기록하려면 로그인해 주세요'), out.text(h2));
    out.answer(true); await out.f._agentConfirmOrder(11);
    check('E2E-9b not ready → _agentConfirmOrder goes through _writerAct and is refused (0 POST, 0 writes)', out.posts().length === 0 && out.writes.length === 0 && out.toasts.some(t => t.includes('기록 권한이 준비되지 않았습니다')), out.toasts.join(' | '));
    const src = extractFn('_agentConfirmOrder') + extractFn('_confirmActualOrder');
    check('E2E-10 the Home confirmation has no path of its own: only _writerAct(CONFIRM_ORDER, …) — no db / rpc / fetch / stock write, no vendor as supplier',
      src.includes(`_writerAct('CONFIRM_ORDER', { order_id: orderId })`) && (src.match(/_writerAct\('([A-Z_]+)'/g) || []).every(x => x.includes('CONFIRM_ORDER')) && !/db\.|\.rpc\(|fetch\(|current_qty|vendor_id/.test(src), src);
  }

  // ── store isolation ──
  {
    const e = makeEnv(OPEN2); const before = e.render();
    e.f.set('_storeEpoch', e.f.get('_storeEpoch') + 1); e.f.set('SID', 2); e.f._clearStoreContext();
    const cleared = e.document.getElementById('agentHome').innerHTML;
    e.f.set('_items', [I(9, '양파', 0, 5)]); e.f.set('_itemTrust', new Map([[9, { trusted: true, lastQty: 0 }]]));
    const after = e.render();
    check('STORE-1 switching store drops Store1 order truth at once: no 쿠팡 / 우유 order line in Store2, supply maps empty',
      before.includes('쿠팡 · 2박스 주문 확인됨') && cleared === '' && e.f.get('_orderSupply').size === 0 && e.f.get('_openSupply').size === 0 && !/쿠팡|우유|agent-order-line/.test(after) && after.includes('양파'), e.text(after));

    let release; const gate = new Promise(r => { release = r; });
    const srv = { supply: [{ store_id: 1, order_id: 11, item_id: 1, ...SUP() }], open: [{ store_id: 1, item_id: 1, open_supply_state: 'VERIFIED_OPEN' }], items: [], orderRequests: [] };
    const l = makeEnv({ server: srv, rpcGate: gate });
    const late = l.f._loadOrderSupply();
    l.f.set('_storeEpoch', l.f.get('_storeEpoch') + 1); l.f.set('SID', 2);
    release(); await late;
    check('STORE-2 a late Store1 supply answer never lands in Store2; the reader is asked per store (p_store_id)',
      l.f.get('_orderSupply').size === 0 && l.f.get('_openSupply').size === 0 && l.rpcCalls.length >= 2 && l.rpcCalls.every(c => c.args.p_store_id === 1), JSON.stringify(l.rpcCalls));
    await l.f._loadOrderSupply();
    check('STORE-3 Store2 reads only Store2 rows (none) → no Store1 order shown', l.rpcCalls.filter(c => c.args.p_store_id !== 1).length > 0 && l.rpcCalls.slice(l.rpcCalls.findIndex(c => c.args.p_store_id === 2)).every(c => c.args.p_store_id === 2) && l.f.get('_orderSupply').size === 0);
    const x = makeEnv({ ...OPEN2, sid: 2, orders: [] }).derive();   // a stray Store1 supply row without a Store2 order row is never an order card
    check('STORE-4 a supply row without this store\'s own order row is not shown as an order', all(x).every(a => a.orders.length === 0) && x.storeId === 2, JSON.stringify(all(x).map(cardText)));
  }

  // ── static: vocabulary / safety ──
  {
    const src = ['deriveAgentActions', '_agentOrderSupplier', '_agentCardHtml', '_renderAgentHome', '_agentConfirmOrder', '_confirmActualOrder'].map(extractFn).join('\n');
    const code = src.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
    check('STATIC the memory-dependent sentence is gone from the app ("이미 시켰다면 …")', !HTML.includes('이미 시켰다면'));
    check('STATIC delivery words come only from the delivery reader (via _agentDeliveryLine / ctx.delivery); no draft / record time is read as an order time',
      /ctx\.delivery\.get\(x\.r\.id\)/.test(code) && /_agentDeliveryLine\(d\)/.test(code) && !/새벽|도착 예정|배송 중/.test(code) && !/created_at|updated_at/.test(code.replace(/_draftAge\(pending\.created_at, now\)/g, '').replace(/created_at: r\.created_at \|\| null, age: _draftAge\(r\.created_at, now\)/, '')), '');
    check('STATIC order visibility code writes nothing itself (no table / RPC / stock write; the only write is the existing writer call)',
      !/db\.from|db\.rpc|\.update\(|\.insert\(|current_qty\s*=/.test(code) && (code.match(/_writerAct\('([A-Z_]+)'/g) || []).every(x => x.includes('CONFIRM_ORDER')));
    check('STATIC the receive row calls its time a record time, not an order time', extractFn('_orderIdentity').includes('기록`'));
    const inline = [...HTML.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
    let syntax = '';
    try { for (const s of inline) new (require('vm').Script)(s); } catch (e) { syntax = e.message; }
    check(`SYNTAX every inline script in index.html compiles (${inline.length} blocks)`, inline.length >= 2 && !syntax, syntax);
  }

  console.log(`\nDB Write: 0 (mock client only) · network: 0 · production: untouched`);
  console.log(`RESULT: ${pass} PASS / ${fail} FAIL (of ${pass + fail})`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FAIL harness ' + e.stack); process.exit(1); });
