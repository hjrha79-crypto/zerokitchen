/*
 * test_store_switch.js — store switch = operational context invalidation (STORE-01..06)
 *
 * A store switch must clear every store-scoped surface at once (발주 필요, 주기 알림, 추천, 발주표, 입고 대기, 공급 상태,
 * 신뢰 판정, 검토 카드), reload only the new store, and a response that started for the previous store and arrives
 * late must not write state or DOM (store epoch). REAL functions from index.html; MOCK db (per-store, controllable
 * delays) and a minimal fake DOM — no network.
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

let pass = 0, fail = 0;
function check(name, ok, detail = '') { if (ok) pass++; else fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? '  — ' + String(detail).slice(0, 300) : ''}`); }
const tick = () => new Promise(r => setTimeout(r, 0));

const DATA = {
  1: { items: [{ item_id: 101, item_name: '하드롤', store_id: 1, current_qty: 0, unit: '개' }, { item_id: 102, item_name: '핫소스', store_id: 1, current_qty: 1, unit: '병' }],
    patterns: [{ item_id: 101, item_name: '하드롤', avg_cycle_days: 3, last_order_date: '2026-09-01', confidence_score: 'HIGH', recommended_qty: 5 }],
    aliases: [{ id: 1, store_id: 1 }] },
  2: { items: [{ item_id: 201, item_name: '양파', store_id: 2, current_qty: 3, unit: '개' }], patterns: [], aliases: [] },
};

function makeEnv() {
  const calls = []; const gates = [];   // gates: pending deferred responses {match, resolve}
  let hold = null;                        // predicate: hold the response of matching queries until released
  const respond = (table, filters) => {
    const sid = filters.store_id;
    const d = DATA[sid] || { items: [], patterns: [], aliases: [] };
    if (table === 'items') return { data: d.items, error: null };
    if (table === 'vendors') return { data: [], error: null };
    if (table === 'store_aliases') return { data: d.aliases, error: null };
    if (table === 'item_usage_pattern') return { data: d.patterns, error: null };
    if (table === 'order_requests') return { data: [], error: null };
    return { data: [], error: null };
  };
  const q = table => {
    const filters = {}; const b = {
      select() { return b; }, order() { return b; }, in() { return b; }, gte() { return b; }, lt() { return b; }, not() { return b; }, limit() { return b; },
      eq(c, v) { filters[c] = v; return b; }, maybeSingle() { b._single = true; return b; },
      then(res, rej) {
        calls.push({ table, store: filters.store_id });
        const out = b._single ? { data: null, error: null } : respond(table, filters);
        if (hold && hold(table, filters)) return new Promise(r => gates.push({ table, store: filters.store_id, release: () => r(out) })).then(res, rej);
        return Promise.resolve(out).then(res, rej);
      },
    }; return b;
  };
  const db = { from: q, rpc: async (name, args) => { calls.push({ rpc: name, store: args.p_store_id }); return { data: [], error: null }; } };
  const el = id => (els[id] = els[id] || { id, innerHTML: '', style: { display: 'block' }, querySelector: () => null, querySelectorAll: () => [], classList: { contains: () => false } });
  const els = {};
  let activeTab = 'tab-input';
  const document = { getElementById: el, querySelector: s => (s === '.tab.active' ? { id: activeTab } : null), querySelectorAll: () => [] };
  const localStorage = { m: {}, getItem(k) { return this.m[k] ?? null; }, setItem(k, v) { this.m[k] = String(v); } };
  const sessionStorage = { removeItem() {}, getItem() { return null; }, setItem() {} };
  const toasts = []; const showToast = t => toasts.push(t);
  const renders = { order: [], inventory: 0, notif: [] };
  // eslint-disable-next-line no-unused-vars
  var SID = 1, _stores = [{ store_id: 1, store_name: '경기광주점' }, { store_id: 2, store_name: '테스트매장' }], _storeEpoch = 0,
    _items = [], _vendors = [], _orderRequests = [], _dismissedItemIds = new Set(), _orderedItemIds = new Set(), _storeAliases = [],
    _itemTrust = new Map(), _orderSupply = new Map(), _openSupply = new Map(), _supplyAvailable = false, _draftItems = [],
    _countMode = false, _countedIds = new Set(), _pendingComplexItems = false, _lastRawInput = '';
  const window = {};
  const console = { log() {}, warn() {}, error() {} };
  const _renderStoreTabs = () => {}, _updateLastInputChip = () => {}, updateJustTalk = () => {}, renderInventory = () => { renders.inventory++; };
  const cancelReview = () => { el('reviewPanel').style.display = 'none'; _draftItems = []; };
  const _closeDupCleanup = cancelReview, _closeComplexCard = cancelReview;
  const _v3NeedLine = () => ({ state: 'NO_TARGET', text: '' }), _v3ReminderQty = v => v;
  const FNS = ['_storeChanged', '_clearStoreContext', '_switchStore', 'refreshItems', 'renderV3Notifications', 'checkOrderNotifications', '_loadOrderSupply', '_loadInventoryTrust'];
  const f = {};
  // renderOrder is replaced by a recorder that captures the store it started for (its own guard is tested separately)
  // eslint-disable-next-line no-unused-vars
  var renderOrder = () => { renders.order.push(SID); };
  for (let k = 0; k < 2; k++) {
    for (const n of FNS) f[n] = eval(asExpr(extractFn(n), n));
    // eslint-disable-next-line no-unused-vars
    var _storeChanged = f._storeChanged, _clearStoreContext = f._clearStoreContext, refreshItems = f.refreshItems, renderV3Notifications = f.renderV3Notifications,
      checkOrderNotifications = f.checkOrderNotifications, _loadOrderSupply = f._loadOrderSupply, _loadInventoryTrust = f._loadInventoryTrust;
  }
  const TRUSTED_STOCK_CHECK = 'trusted_stock_check';
  void db; void localStorage; void sessionStorage; void showToast; void window; void console; void TRUSTED_STOCK_CHECK; void _v3NeedLine; void _v3ReminderQty;
  return { f, calls, gates, els: el, toasts, renders, setHold: p => { hold = p; }, setTab: t => { activeTab = t; },
    state: () => ({ SID, items: _items.map(i => i.item_id), trust: _itemTrust.size, supply: _orderSupply.size, aliases: _storeAliases.length, draft: _draftItems.length, epoch: _storeEpoch, countMode: _countMode }),
    seed: () => { _items = DATA[1].items.slice(); _itemTrust = new Map([[101, { trusted: true }]]); _orderSupply = new Map([[9, {}]]); _draftItems = [{ item_name: '하드롤' }]; _storeAliases = [1]; },
    setCount: () => { _countMode = true; _countedIds = new Set([101]); } };
}

(async () => {
  // STORE-01: Store1 alerts on Home → switch → none of Store1's alerts remain, new store rendered
  {
    const e = makeEnv(); e.seed();
    await e.f.renderV3Notifications();
    const before = e.els('v3NotifContainer').innerHTML;
    e.els('orderNeedCard').innerHTML = '<div>지금 발주 필요 하드롤</div>'; e.els('suggestBar').innerHTML = '<span>하드롤 핫소스</span>';
    const p = e.f._switchStore(2);
    const mid = ['v3NotifContainer', 'orderNeedCard', 'suggestBar'].map(id => e.els(id).innerHTML).join('|');
    await p; await tick();
    const after = e.els('v3NotifContainer').innerHTML + e.els('orderNeedCard').innerHTML + e.els('suggestBar').innerHTML;
    check('STORE-01 Store1 주기 알림(하드롤) shown → switch to Store2 → cleared immediately (before any reload) and Store1 alerts 0 after reload',
      /하드롤/.test(before) && mid === '||' && !/하드롤|핫소스/.test(after) && e.state().SID === 2, JSON.stringify({ before: before.slice(0, 60), mid, after: after.slice(0, 80) }));
    check('STORE-01 on Home the switch re-renders BOTH the order view and the 주기 알림 for the new store', e.renders.order.join() === '2' &&
      e.calls.some(c => c.table === 'item_usage_pattern' && c.store === 2), JSON.stringify(e.renders));
  }
  // STORE-02: store-scoped caches + recommendation surfaces are dropped on switch
  {
    const e = makeEnv(); e.seed(); e.setCount();
    e.els('reviewPanel').style.display = 'block';
    e.f._clearStoreContext();
    const s = e.state();
    check('STORE-02 switch drops Store1 items / trust / supply / aliases / review draft and closes the review card', s.items.length === 0 && s.trust === 0 && s.supply === 0 &&
      s.aliases === 0 && s.draft === 0 && e.els('reviewPanel').style.display === 'none', JSON.stringify(s));
    check('STORE-02 an open count session is closed (counts already saved per item), not carried to the other store', s.countMode === false && e.toasts.some(t => /재고 점검을 마쳤습니다/.test(t)), e.toasts.join('|'));
  }
  // STORE-03: Store1 responses delayed until after the switch must not write Store2's state / screen
  {
    const e = makeEnv(); e.seed();
    e.setHold((table, filters) => filters.store_id === 1);
    const late1 = e.f.renderV3Notifications();           // Store1 notification load, held
    const lateItems = e.f.refreshItems();                // Store1 items load, held
    const lateTrust = e.f._loadInventoryTrust();         // Store1 trust load, held
    await tick();
    const sw = e.f._switchStore(2);                      // Store2 responses are not held
    await sw; await tick();
    const store2Notif = e.els('v3NotifContainer').innerHTML, store2Items = JSON.stringify(e.state().items);
    // Store1 responses arrive late (each released response may issue the next held Store1 query → release until all finish)
    let done = false;
    Promise.allSettled([late1, lateItems, lateTrust]).then(() => { done = true; });
    for (let i = 0; i < 200 && !done; i++) { for (const g of e.gates.splice(0)) g.release(); await tick(); }
    await tick();
    check('STORE-03 late Store1 responses (notifications, items, trust) after the switch → Store2 UI and state unchanged',
      e.els('v3NotifContainer').innerHTML === store2Notif && JSON.stringify(e.state().items) === store2Items && e.state().items.join() === '201' && e.state().trust === 0,
      JSON.stringify({ items: e.state().items, notif: e.els('v3NotifContainer').innerHTML.slice(0, 60) }));
  }
  // STORE-03b: the real renderOrder stops after its first await when the store changed (no state / DOM writes)
  {
    const src = extractFn('renderOrder');
    const calls = []; let release;
    const db = { from: () => { const b = { select: () => b, eq: () => b, in: () => b, order: () => b, then: r => new Promise(res => { release = () => res(r({ data: [{ id: 1, item_id: 101, qty: 2, status: 'pending' }], error: null })); }) }; return b; } };
    const list = { innerHTML: '' };
    const document = { getElementById: id => (id === 'orderList' ? list : null) };
    // eslint-disable-next-line no-unused-vars
    var SID = 1, _storeEpoch = 0, _orderRequests = ['STORE2-STATE'], _orderedItemIds = new Set(['STORE2']);
    const _storeChanged = ep => ep !== _storeEpoch;
    const console = { log() {} };
    const renderOrder = eval(asExpr(src, 'renderOrder'));
    void db; void document; void console; void _storeChanged; void calls;
    const p = renderOrder();
    await tick();                                         // the Store1 request is now in flight
    _storeEpoch++; SID = 2; list.innerHTML = 'STORE2-VIEW';
    release(); await p;
    check('STORE-03b renderOrder started for Store1, store switched mid-flight → returns without touching _orderRequests or the order list',
      JSON.stringify(_orderRequests) === '["STORE2-STATE"]' && list.innerHTML === 'STORE2-VIEW', JSON.stringify({ _orderRequests, list: list.innerHTML }));
  }
  // STORE-04: switch back reloads Store1
  {
    const e = makeEnv(); e.seed();
    await e.f._switchStore(2); await tick();
    await e.f._switchStore(1); await tick(); await tick();
    check('STORE-04 Store2 → Store1 again → Store1 items reloaded, Store1 notifications queried, epoch advanced twice',
      e.state().SID === 1 && e.state().items.join() === '101,102' && e.calls.filter(c => c.table === 'item_usage_pattern' && c.store === 1).length >= 1 && e.state().epoch === 2, JSON.stringify(e.state()));
  }
  // STORE-05: every store-scoped loader filters by store at the query level (no all-store fetch + client mixing)
  {
    const scoped = {
      refreshItems: [/from\('items'\)[^;]*eq\('store_id', sid\)/, /from\('vendors'\)[^;]*eq\('store_id', sid\)/],
      _loadInventoryTrust: [/eq\('store_id', sid\)\.eq\('input_method'/, /\.eq\('store_id', sid\)\.in\('item_id'/],
      _loadOrderSupply: [/get_order_supply', \{ p_store_id: sid/, /get_open_supply', \{ p_store_id: sid/],
      renderV3Notifications: [/checkOrderNotifications\(sid\)/, /daily_notification_quota'\)[\s\S]*?\.eq\('store_id', sid\)/],
      checkOrderNotifications: [/item_usage_pattern'\)[\s\S]*?\.eq\('store_id', storeId\)/, /item_notification_settings'\)[\s\S]*?\.eq\('store_id', storeId\)/, /order_notifications'\)[\s\S]*?\.eq\('store_id', storeId\)/],
      renderOrder: [/from\('order_requests'\)\s*\.select\('\*'\)\.eq\('store_id', SID\)/, /from\('daily_orders'\)\s*\.select\('\*'\)\.eq\('store_id', SID\)/],
    };
    const misses = [];
    for (const [fn, res] of Object.entries(scoped)) { const src = extractFn(fn); for (const r of res) if (!r.test(src)) misses.push(`${fn}: ${r}`); }
    check('STORE-05 order / supply / notification / recommendation / trust loaders filter by the active store in the query itself', misses.length === 0, misses.join(' | '));
    const guarded = ['refreshItems', '_loadInventoryTrust', '_loadOrderSupply', 'renderV3Notifications', 'renderOrder', '_loadDepletionAsync'].filter(fn => !/_storeChanged\(ep\)/.test(extractFn(fn)));
    check('STORE-05 every async store loader has the epoch guard', guarded.length === 0, guarded.join(','));
  }
  // STORE-06: other tabs — inventory re-renders for the new store; Home is redrawn (incl. notifications) on return
  {
    const e = makeEnv(); e.seed(); e.setTab('tab-inventory');
    await e.f._switchStore(2); await tick();
    check('STORE-06 on 재고 tab: switch re-renders inventory for Store2 only (Home not drawn with stale data), Store1 cards already cleared',
      e.renders.inventory === 1 && e.renders.order.length === 0 && e.els('v3NotifContainer').innerHTML === '' && e.state().items.join() === '201');
    const st = extractFn('switchTab');
    check('STORE-06 returning to Home (switchTab input) redraws the order view and the 주기 알림 with the current store',
      /if \(n==='input'\) \{ renderOrder\(\); renderV3Notifications\(\)/.test(st));
  }

  console.log(`\nRESULT: ${pass} PASS / ${fail} FAIL (of ${pass + fail})`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FAIL harness ' + e.stack); process.exit(1); });
