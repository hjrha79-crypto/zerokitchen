/*
 * test_order_session.js  — ZEROKITCHEN_AUTO_ORDER_SESSION_HOME_OPEN_BOUNDED_BUILD_V0_1
 *
 * Contract: looking at Home is not starting an order. No Home entry path — first load,
 * reload, tab switch, hash navigation, resetToHome, automatic return to Home — creates an
 * order_sessions row or any other write. A session is created only by an explicit order
 * action, at most once while one is active, and is closed by the order confirmation.
 *
 * The REAL function bodies are extracted from index.html (brace-matched) and run against
 * a MOCK Supabase client and a minimal DOM. No real DB, no network — DB Write 0.
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
const code = s => s.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n'); // without comment-only lines
const SRC = {};
for (const n of ['init', 'switchTab', 'resetToHome', '_startOrderSession', '_endOrderSession', '_confirmAllOrders', '_insertOrderIfNotDup']) SRC[n] = extractFn(n);
// the browser back/forward listener (anonymous): it only routes to switchTab
const HASH_SRC = (/window\.addEventListener\('hashchange', \(\) => \{([\s\S]*?)\n\}\);/.exec(HTML) || [, ''])[1];

// --- MOCK Supabase client: reads answer from `tables`, every write is recorded ---
// `insertModes`: how successive order_sessions inserts answer — 'ok' (default), 'error'
// ({data:null,error}), 'throw' (insert() throws), 'reject' (the request rejects),
// 'nulldata' ({data:null,error:null}) or 'noid' ({data:{},error:null}).
function makeDb(tables, insertModes = []) {
  const writes = [];
  let nextId = 900, sessionInsertNo = 0;
  function builder(table) {
    let single = false, inserted = null, mode = 'ok';
    const b = {
      select() { return b; }, eq() { return b; }, in() { return b; }, is() { return b; }, not() { return b; },
      gte() { return b; }, limit() { return b; }, order() { return b; },
      maybeSingle() { single = true; return b; }, single() { single = true; return b; },
      insert(p) {
        if (table === 'order_sessions') mode = insertModes[sessionInsertNo++] || 'ok';
        writes.push({ table, op: 'insert', payload: p, mode });
        if (mode === 'throw') throw new Error('insert threw');
        inserted = { id: nextId++, ...p };
        return b;
      },
      update(p) { writes.push({ table, op: 'update', payload: p }); return b; },
      upsert(p) { writes.push({ table, op: 'upsert', payload: p }); return b; },
      delete() { writes.push({ table, op: 'delete' }); return b; },
      then(resolve, reject) {
        if (inserted !== null) {
          setTimeout(() => {
            if (mode === 'reject') reject(new Error('request rejected'));
            else if (mode === 'error') resolve({ data: null, error: { message: 'insert failed' } });
            else if (mode === 'nulldata') resolve({ data: null, error: null });
            else if (mode === 'noid') resolve({ data: {}, error: null });
            else resolve({ data: single ? inserted : [inserted], error: null });
          }, 5);
          return;
        }
        const rows = tables[table] || [];
        resolve({ data: single ? (rows[0] || null) : rows, error: null });
      },
    };
    return b;
  }
  return { from: t => builder(t), _writes: writes };
}

// --- environment: the real functions with a minimal DOM; Home renderers are spies ---
function makeEnv(opts = {}) {
  const db = makeDb({ stores: [{ store_id: 1, store_name: 'A' }], order_requests: [], store_aliases: [] }, opts.insertModes);
  let SID = opts.sid === undefined ? 1 : opts.sid;
  let _stores = [], _items = [], _orderedItemIds = new Set(), _storeAliases = [], _lastRawInput = '';
  let _currentSessionId = null, _sessionStartedAt = null;
  const calls = { renderOrder: 0, notif: 0, start: 0, inventory: 0, observation: 0 };
  const el = () => ({ classList: { add() {}, remove() {}, contains: () => false }, style: {}, innerHTML: '', value: '', textContent: '', disabled: false });
  const navs = [el(), el(), el()];
  const inputs = opts.inputs || [];
  const document = {
    querySelectorAll: sel => (sel === '.nav' ? navs : sel.startsWith('.ord-stepper-val') ? inputs : []),
    querySelector: sel => (sel === '.nav' ? navs[0] : null),
    getElementById: () => el(),
  };
  const location = { hash: opts.hash || '' };
  const history = { replaceState: (_s, _t, h) => { location.hash = h; } };
  const localStorage = { getItem: () => null };
  const toasts = [];
  const showToast = m => toasts.push(m);
  const confirm = () => true;
  const renderOrder = async () => { calls.renderOrder++; };
  const _renderOrderKeepScroll = async () => {};
  const renderV3Notifications = async () => { calls.notif++; };
  const renderInventory = () => { calls.inventory++; };
  const refreshItems = async () => {};
  const _loadObservation = () => { calls.observation++; };
  // settings tab also refreshes the human-writer login card (read only; covered by test_human_writer.js)
  const _refreshWriterReadiness = async () => false, _renderWriterAuthCard = async () => {};
  const _renderStoreTabs = () => {}, _updateLastInputChip = () => {}, v3InitLowToggle = () => {}, cancelReview = () => {}, updateJustTalk = () => {};
  const _hashTabMap = { home: 'input', inventory: 'inventory', settings: 'settings' };
  const _tabHashMap = { input: 'home', inventory: 'inventory', settings: 'settings' };
  let _sessionStarting = null;
  // eslint-disable-next-line no-eval
  const _insertOrderIfNotDup = eval(asExpr(SRC._insertOrderIfNotDup, '_insertOrderIfNotDup'));
  // eslint-disable-next-line no-eval
  const realStart = eval(asExpr(SRC._startOrderSession, '_startOrderSession'));
  const _startOrderSession = async () => { calls.start++; return realStart(); };
  // eslint-disable-next-line no-eval
  const _endOrderSession = eval(asExpr(SRC._endOrderSession, '_endOrderSession'));
  // eslint-disable-next-line no-eval
  const switchTab = eval(asExpr(SRC.switchTab, 'switchTab'));
  // eslint-disable-next-line no-eval
  const resetToHome = eval(asExpr(SRC.resetToHome, 'resetToHome'));
  // eslint-disable-next-line no-eval
  const init = eval(asExpr(SRC.init, 'init'));
  // eslint-disable-next-line no-eval
  const onHashChange = eval('(() => {' + HASH_SRC + '\n})');
  // eslint-disable-next-line no-eval
  const _confirmAllOrders = eval(asExpr(SRC._confirmAllOrders, '_confirmAllOrders'));
  void _stores; void _items; void _orderedItemIds; void _storeAliases; void _lastRawInput;
  return {
    db, calls, navs, location, toasts, switchTab, resetToHome, init, onHashChange, _startOrderSession: realStart, _endOrderSession, _confirmAllOrders,
    session: () => ({ id: _currentSessionId, startedAt: _sessionStartedAt, pending: _sessionStarting }),
    sessionInserts: () => db._writes.filter(w => w.table === 'order_sessions' && w.op === 'insert').length,
  };
}

let pass = 0, fail = 0, total = 0;
function check(name, cond, detail) {
  const ok = !!cond; total++;
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}
const brief = env => `start=${env.calls.start} sessionInserts=${env.sessionInserts()} writes=${env.db._writes.length} renderOrder=${env.calls.renderOrder}`;

(async () => {
  // CASE A / B  first Home load and reload run init: Home is drawn, nothing is written
  {
    const env = makeEnv();
    await env.init();
    check('A initial Home (init): no session start, no write, Home still drawn', env.calls.start === 0 && env.db._writes.length === 0 && env.calls.renderOrder === 1 && env.calls.notif === 1, brief(env));
    const again = makeEnv({ hash: '#home' });
    await again.init();
    check('B reload on #home (init again): no session start, no write', again.calls.start === 0 && again.db._writes.length === 0 && again.calls.renderOrder === 1, brief(again));
  }
  // CASE C / D  Inventory -> Home, Settings -> Home
  {
    const env = makeEnv();
    await env.switchTab('inventory', env.navs[1]); await env.switchTab('input', env.navs[0]);
    check('C Inventory -> Home: no session start, no write', env.calls.start === 0 && env.db._writes.length === 0 && env.calls.renderOrder === 1, brief(env));
    const s = makeEnv();
    await s.switchTab('settings', s.navs[2]); await s.switchTab('input', s.navs[0]);
    check('D Settings -> Home: no session start, no write', s.calls.start === 0 && s.db._writes.length === 0 && s.calls.renderOrder === 1, brief(s));
  }
  // CASE E  resetToHome (also the automatic return used when a result is shown)
  {
    const env = makeEnv();
    env.resetToHome(); await new Promise(r => setTimeout(r, 20));
    env.resetToHome(); await new Promise(r => setTimeout(r, 20));
    check('E resetToHome (twice): no session start, no write', env.calls.start === 0 && env.db._writes.length === 0 && env.calls.renderOrder === 2, brief(env));
  }
  // CASE F  hash navigation to #home (browser back/forward)
  {
    const env = makeEnv();
    env.location.hash = '#inventory'; env.onHashChange(); await new Promise(r => setTimeout(r, 20));
    env.location.hash = '#home'; env.onHashChange(); await new Promise(r => setTimeout(r, 20));
    check('F hash -> #home: no session start, no write', env.calls.start === 0 && env.db._writes.length === 0 && env.calls.renderOrder === 1 && HASH_SRC.includes('switchTab('), brief(env));
  }
  // CASE A-F static  no Home path calls _startOrderSession at all
  {
    const callers = HTML.split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => /_startOrderSession\(\)/.test(l) && !/^\s*\/\//.test(l) && !/function _startOrderSession/.test(l));
    check('A-F no call site of _startOrderSession on any Home path', !/_startOrderSession\(/.test(code(SRC.init)) && !/_startOrderSession\(/.test(code(SRC.switchTab)) &&
      !/_startOrderSession\(/.test(code(SRC.resetToHome)) && !/_startOrderSession\(/.test(HASH_SRC) && callers.length === 0,
      callers.length ? 'call sites: ' + callers.map(([n]) => 'L' + n).join(',') : 'call sites: none');
  }
  // CASE G / H  an explicit start creates exactly one session; repeats and overlaps reuse it
  {
    const env = makeEnv();
    await env._startOrderSession();
    const first = env.session().id;
    await env._startOrderSession();
    check('G explicit start -> exactly 1 session', env.sessionInserts() === 1 && first !== null && env.session().startedAt instanceof Date, `inserts=${env.sessionInserts()} id=${first}`);
    const c = makeEnv();
    await Promise.all([c._startOrderSession(), c._startOrderSession(), c._startOrderSession()]);
    check('H repeated / overlapping starts in one workflow -> still 1 session', env.session().id === first && c.sessionInserts() === 1, `sequential=${env.sessionInserts()} concurrent=${c.sessionInserts()}`);
    const none = makeEnv({ sid: null });
    await none._startOrderSession();
    check('H no store -> no session', none.sessionInserts() === 0, '');
  }
  // CASE I  confirmation records the session on daily_orders and closes it
  {
    const inp = { value: '3', defaultValue: '3', dataset: { itemId: '174', name: '파인애플', unit: '캔', vendorId: '', source: 'target_based' } };
    const env = makeEnv({ inputs: [inp] });
    await env._startOrderSession();
    const sid = env.session().id;
    await env._confirmAllOrders();
    const daily = env.db._writes.find(w => w.table === 'daily_orders' && w.op === 'insert');
    const end = env.db._writes.find(w => w.table === 'order_sessions' && w.op === 'update');
    check('I confirmation: daily_orders.session_id = session, session closed (confirmed_at, duration_sec)',
      daily && daily.payload.session_id === sid && end && typeof end.payload.confirmed_at === 'string' && Number.isInteger(end.payload.duration_sec) && env.session().id === null,
      `session=${sid} daily.session_id=${daily && daily.payload.session_id} end=${JSON.stringify(end && end.payload)}`);
    const after = makeEnv();
    await after._startOrderSession(); await after._endOrderSession(); await after._startOrderSession();
    check('I after a closed session the next explicit start creates a new one', after.sessionInserts() === 2, `inserts=${after.sessionInserts()}`);
    const noSess = makeEnv();
    await noSess._endOrderSession();
    check('I closing without a session writes nothing', noSess.db._writes.length === 0, '');
  }
  // ── Start failure leaves no partial session state ──
  // Terminal state after a failed start: id null / startedAt null / pending cleared.
  // After a successful start: a real id / a Date / pending cleared.
  const failed = s => s.id === null && s.startedAt === null && s.pending === null;
  const started = s => s.id !== null && s.id !== undefined && s.startedAt instanceof Date && s.pending === null;
  const show = s => `id=${s.id} startedAt=${s.startedAt instanceof Date ? 'Date' : s.startedAt} pending=${s.pending === null ? 'cleared' : 'SET'}`;
  const run = async (env, n = 1) => { let threw = null; try { for (let i = 0; i < n; i++) await env._startOrderSession(); } catch (e) { threw = e; } return threw; };
  // CASE K  returned error
  {
    const env = makeEnv({ insertModes: ['error'] });
    const threw = await run(env);
    check('K returned error -> null / null / cleared, nothing thrown', failed(env.session()) && threw === null && env.sessionInserts() === 1, show(env.session()));
  }
  // CASE L  thrown and rejected
  {
    const t = makeEnv({ insertModes: ['throw'] }), r = makeEnv({ insertModes: ['reject'] });
    const tThrew = await run(t), rThrew = await run(r);
    check('L insert throws -> null / null / cleared, caller not stuck', failed(t.session()) && tThrew === null, show(t.session()));
    check('L request rejects -> null / null / cleared, caller not stuck', failed(r.session()) && rThrew === null, show(r.session()));
  }
  // CASE M  malformed success
  {
    const n = makeEnv({ insertModes: ['nulldata'] }), i = makeEnv({ insertModes: ['noid'] });
    await run(n); await run(i);
    check('M data null -> not a success: null / null / cleared', failed(n.session()), show(n.session()));
    check('M data without id -> not a success: null / null / cleared', failed(i.session()), show(i.session()));
  }
  // CASE N  failure then retry succeeds
  {
    let all = true; const seen = [];
    for (const mode of ['error', 'throw', 'reject', 'nulldata', 'noid']) {
      const env = makeEnv({ insertModes: [mode, 'ok'] });
      await run(env);
      const after1 = env.session();
      await run(env);
      const after2 = env.session();
      const ok = failed(after1) && started(after2) && env.sessionInserts() === 2;
      all = all && ok; seen.push(`${mode}:${ok ? 'reset->started' : show(after1) + ' / ' + show(after2)}`);
    }
    check('N any failure, then retry -> second start succeeds (valid id, Date, cleared)', all, seen.join(' '));
  }
  // CASE O  concurrent calls share one failing insert, then a retry succeeds
  {
    let all = true; const seen = [];
    for (const mode of ['error', 'throw', 'reject', 'nulldata', 'noid']) {
      const env = makeEnv({ insertModes: [mode, 'ok'] });
      let threw = null;
      try { await Promise.all([env._startOrderSession(), env._startOrderSession(), env._startOrderSession()]); } catch (e) { threw = e; }
      const mid = env.session(), midInserts = env.sessionInserts();
      await run(env);
      const ok = threw === null && midInserts === 1 && failed(mid) && started(env.session()) && env.sessionInserts() === 2;
      all = all && ok; seen.push(`${mode}:${ok ? 'ok' : `threw=${!!threw} inserts=${midInserts} ${show(mid)} -> ${show(env.session())}`}`);
    }
    check('O concurrent start with one failing insert -> 1 insert, all settle, no ghost state, retry works', all, seen.join(' '));
  }
  // CASE P  a successful start keeps the full state
  {
    const env = makeEnv();
    await run(env);
    check('P success -> valid id / Date / cleared, 1 insert', started(env.session()) && env.sessionInserts() === 1, show(env.session()));
  }

  // CASE J  Home render paths themselves contain no write calls
  {
    const writeRe = /\.(insert|update|upsert|delete)\(/;
    const paths = ['renderOrder', '_renderOrderNeed', 'renderV3Notifications', 'checkOrderNotifications', '_loadDepletionAsync', 'switchTab', 'resetToHome'];
    const withWrites = paths.filter(n => writeRe.test(code(extractFn(n))));
    check('J Home render / entry functions contain no insert/update/upsert/delete', withWrites.length === 0, withWrites.length ? 'writes in: ' + withWrites.join(',') : 'none');
  }

  console.log(`\nDB Write: 0 (mock client only, no network/supabase import)`);
  console.log(`RESULT: ${pass} PASS / ${fail} FAIL (of ${total})`);
  process.exit(fail === 0 ? 0 : 1);
})();
