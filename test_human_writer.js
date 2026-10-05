/*
 * test_human_writer.js — Trusted Human Writer, Web client (hw-v1)
 *
 * The app writes supply truth ONLY through the human-supply-writer Edge Function, ONLY when the server says
 * TRUSTED_WRITER_READY (login + Store1 grant + writer schema + core), sends only an explicit action envelope
 * (no actor / store / verification / role), keeps ONE pending action (same action_id until the server decides),
 * never guesses success after a lost response, and never falls back to anon / a Core RPC. The legacy data
 * client (db, publishable key) is unchanged; the login session lives in a separate client.
 * REAL functions from index.html, MOCK fetch / auth / storage — no network.
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
const asExpr = (src, name) => '(' + src.replace(new RegExp('^(async )?function ' + name), '$1function') + ')';
const constLine = name => (new RegExp(`const ${name} = [^\\n]+`).exec(HTML) || [''])[0];
const FNS = ['_authClient', '_writerToken', '_refreshWriterReadiness', '_writerActionsHtml', '_loadPendingAction', '_savePendingAction', '_writerResultMessage',
  '_newActionId', '_writerAct', '_deliverPendingAction', '_renderWriterBar', '_writerConfirmOrder', '_writerPartialReceipt', '_writerFullReceipt', '_writerCancelOrder',
  '_writerConfirmCoverage', '_receiveItemHtml', '_openSupplyLabel', '_orderIdentity', '_renderWriterAuthCard', '_writerSignOut', '_confirmActualOrder', '_writerFields'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

let pass = 0, fail = 0;
function check(name, ok, detail = '') { if (ok) pass++; else fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? '  — ' + String(detail).slice(0, 400) : ''}`); }

function makeEnv({ session = 'jwt-op', supply = true, readiness = { status: 200, body: { api_version: 'hw-v1', ready: true, reason: 'READY' } }, post = [] } = {}) {
  const fetchCalls = [], rpcCalls = [], toasts = [], store = new Map(), renders = { n: 0 };
  const posts = [...post];
  const fetch = async (url, init = {}) => {
    fetchCalls.push({ url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined });
    if (init.method === 'GET') {
      if (readiness === 'network') throw new TypeError('Failed to fetch');
      return { status: readiness.status, ok: readiness.status >= 200 && readiness.status < 300, json: async () => readiness.body };
    }
    const next = posts.length ? posts.shift() : { status: 500, body: null };
    if (next === 'network') throw new TypeError('Failed to fetch');
    return { status: next.status, ok: next.status >= 200 && next.status < 300, json: async () => { if (next.body === null) throw new Error('no body'); return next.body; } };
  };
  let sess = session;
  const authApi = { getSession: async () => ({ data: { session: sess ? { access_token: sess, user: { email: 'op@store1.kr' } } : null } }), signOut: async () => { sess = null; return { error: null }; } };
  const createClient = (url, key, opts) => { createClient.calls.push({ url, key, opts }); return { auth: authApi }; };
  createClient.calls = [];
  const db = { rpc: async (name, args) => { rpcCalls.push({ name, args }); return { data: null, error: { message: 'should not be called' } }; } };
  const localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
  const bar = { style: {}, innerHTML: '' }, authBody = { innerHTML: '' };
  const document = { getElementById: id => (id === 'writerPendingBar' ? bar : id === 'writerAuthBody' ? authBody : null) };
  const showToast = m => toasts.push(m);
  let answers = [];
  const confirm = () => (answers.length ? answers.shift() : true);
  const prompt = () => (answers.length ? answers.shift() : null);
  const _renderOrderKeepScroll = async () => { renders.n++; };
  const SUPABASE_URL = 'https://proj.supabase.co', SUPABASE_KEY = 'sb_publishable_test';
  let _supplyAvailable = supply;
  const _orderSupply = new Map(), _openSupply = new Map();
  for (const c of ['_RECEIVE_LOCKED_MSG', '_fmtQty', '_WRITER_API', '_WRITER_URL', '_WRITER_PENDING_KEY']) eval(constLine(c).replace('const ', 'var '));
  eval(extractConstBlock('_WRITER_MSG').replace('const ', 'var '));
  // eslint-disable-next-line no-unused-vars
  var _authDb = null, _writerReady = false, _writerState = { status: 'signed_out', reason: '' }, _writerCaps = [];
  eval(extractConstBlock('_WRITER_FIELDS').replace('const ', 'var '));
  const f = {};
  for (let k = 0; k < 2; k++) {
    for (const n of FNS) f[n] = eval(asExpr(extractFn(n), n));
    // eslint-disable-next-line no-unused-vars
    var _authClient = f._authClient, _writerToken = f._writerToken, _refreshWriterReadiness = f._refreshWriterReadiness, _writerActionsHtml = f._writerActionsHtml,
      _loadPendingAction = f._loadPendingAction, _savePendingAction = f._savePendingAction, _writerResultMessage = f._writerResultMessage, _newActionId = f._newActionId,
      _writerAct = f._writerAct, _deliverPendingAction = f._deliverPendingAction, _renderWriterBar = f._renderWriterBar, _openSupplyLabel = f._openSupplyLabel,
      _orderIdentity = f._orderIdentity, _renderWriterAuthCard = f._renderWriterAuthCard, _confirmActualOrder = f._confirmActualOrder, _writerFields = f._writerFields;
  }
  void fetch; void db; void localStorage; void document; void showToast; void confirm; void prompt; void _renderOrderKeepScroll; void SUPABASE_KEY; void createClient;
  return { f, fetchCalls, rpcCalls, toasts, store, renders, bar, authBody, createClient,
    answer: (...a) => { answers = a; }, setSession: s => { sess = s; }, ready: () => _writerReady, state: () => _writerState,
    setSupply: (oid, row) => _orderSupply.set(oid, row), setOpen: (iid, row) => _openSupply.set(iid, row),
    pending: () => { const v = store.get('zk_writer_pending_v1'); return v ? JSON.parse(v) : null; } };
}
const ROW = { order_id: 7, item_id: 10, name: '우유', orderQty: 10, unit: '개', created_at: null };
const OPEN = { order_id: 7, item_id: 10, verified: true, order_state: 'PARTIAL', ordered_qty: 10, accepted_qty: 4, remaining_qty: 6, health: 'HEALTHY' };
const posts = e => e.fetchCalls.filter(c => c.method === 'POST');

(async () => {
  // ── READY-H ──
  {
    const e = makeEnv({ readiness: { status: 404, body: { code: 'NOT_FOUND' } } });
    e.setSupply(7, OPEN);
    const r = await e.f._refreshWriterReadiness();
    const html = e.f._receiveItemHtml(ROW);
    check('READY-H01 Edge Function absent (404) → not ready; row read-only (no writer buttons, locked note)', r === false && !html.includes('_writer') && html.includes('앱 입고 비활성'), html);
    const e2 = makeEnv({ readiness: 'network' });
    check('READY-H01b backend unreachable → not ready', (await e2.f._refreshWriterReadiness()) === false && e2.state().reason === 'BACKEND_UNREACHABLE');
  }
  {
    const e = makeEnv({ supply: false });
    const r = await e.f._refreshWriterReadiness();
    check('READY-H02 core absent (supply reads unavailable) → not ready, the writer is not even asked', r === false && e.fetchCalls.length === 0 && e.state().reason === 'CORE_ABSENT');
  }
  {
    const e = makeEnv({ session: null });
    const r = await e.f._refreshWriterReadiness();
    check('READY-H03 no login session → not ready (signed_out), no request', r === false && e.fetchCalls.length === 0 && e.state().status === 'signed_out');
    await e.f._renderWriterAuthCard();
    check('READY-H03 login card shows email / password / 로그인 (no account management)', /writerEmail/.test(e.authBody.innerHTML) && /writerPassword/.test(e.authBody.innerHTML) && /로그인/.test(e.authBody.innerHTML) && !/회원가입|sign ?up/i.test(e.authBody.innerHTML));
    const e2 = makeEnv({ readiness: { status: 401, body: { code: 'REAUTH_REQUIRED' } } });
    check('READY-H03b expired session (401) → not ready, state reauth', (await e2.f._refreshWriterReadiness()) === false && e2.state().status === 'reauth');
  }
  {
    const e = makeEnv({ readiness: { status: 200, body: { api_version: 'hw-v1', ready: false, reason: 'NO_STORE_GRANT' } } });
    e.setSupply(7, OPEN);
    const r = await e.f._refreshWriterReadiness();
    check('READY-H04 logged in but no Store1 grant → not ready; row read-only', r === false && !e.f._receiveItemHtml(ROW).includes('_writer'));
    await e.f._renderWriterAuthCard();
    check('READY-H04 login card says 이 매장 권한 없음 + 로그아웃', /이 매장 권한 없음/.test(e.authBody.innerHTML) && /로그아웃/.test(e.authBody.innerHTML), e.authBody.innerHTML);
    const e2 = makeEnv({ readiness: { status: 200, body: { api_version: 'hw-v2', ready: true } } });
    check('READY-H04b another API version → not ready', (await e2.f._refreshWriterReadiness()) === false);
  }
  {
    const e = makeEnv();
    e.setSupply(7, OPEN); e.setSupply(8, { ...OPEN, order_id: 8, verified: false, order_state: 'UNVERIFIED_LEGACY' });
    const r = await e.f._refreshWriterReadiness();
    const get = e.fetchCalls[0];
    const html = e.f._receiveItemHtml(ROW), html8 = e.f._receiveItemHtml({ ...ROW, order_id: 8 });
    check('READY-H05 all ready → GET {SUPABASE_URL}/functions/v1/human-supply-writer/web with Bearer session + apikey', r === true &&
      get.url === 'https://proj.supabase.co/functions/v1/human-supply-writer/web' && get.headers.Authorization === 'Bearer jwt-op' && get.headers.apikey === 'sb_publishable_test');
    check('READY-H05 verified open row → [일부 입고] [남은 전량 입고 (6개)] [주문 취소] [다른 진행 주문 없음]; legacy row → [주문 확인]',
      html.includes('_writerPartialReceipt(7)') && html.includes('남은 전량 입고 (6개)') && html.includes('_writerFullReceipt(7)') && html.includes('_writerCancelOrder(7)') &&
      html.includes('_writerConfirmCoverage(10)') && !html.includes('앱 입고 비활성') && html8.includes('_writerConfirmOrder(8)') && !html8.includes('_writerPartialReceipt'), html + html8);
  }
  {
    const e = makeEnv({ readiness: { status: 200, body: { api_version: 'hw-v1', ready: false, reason: 'CORE_ABSENT' } } });
    await e.f._refreshWriterReadiness();
    await e.f._writerAct('PARTIAL_RECEIPT', { order_id: 7, received_qty: 4 });
    check('READY-H06 readiness false → an action sends nothing (no Edge POST, no db.rpc fallback), no pending, toast', posts(e).length === 0 && e.rpcCalls.length === 0 && !e.pending() &&
      e.toasts.some(t => t.includes('기록 권한이 준비되지 않았습니다')));
  }
  // ── envelope / actions ──
  {
    const e = makeEnv({ post: [{ status: 200, body: { code: 'SUCCESS', status: 'COMPLETED', replayed: false } }] });
    await e.f._refreshWriterReadiness();
    e.answer('4');
    await e.f._writerPartialReceipt(7);
    const p = posts(e)[0];
    check('PARTIAL_RECEIPT → POST /human-supply-writer/web {action, action_id(UUID v4), order_id, received_qty} only — no actor / store / verification / channel / user',
      p && p.url.endsWith('/human-supply-writer/web') && p.headers.Authorization === 'Bearer jwt-op' && JSON.stringify(Object.keys(p.body).sort()) === JSON.stringify(['action', 'action_id', 'order_id', 'received_qty']) &&
      p.body.action === 'PARTIAL_RECEIPT' && UUID.test(p.body.action_id) && p.body.received_qty === 4, JSON.stringify(p));
    check('terminal SUCCESS → pending cleared, toast, projection re-read (renderOrder)', !e.pending() && e.toasts.some(t => t.includes('입고를 기록했습니다')) && e.renders.n === 1 && e.rpcCalls.length === 0);
  }
  {
    const e = makeEnv({ post: Array(5).fill({ status: 200, body: { code: 'CONFIRMED' } }) });
    await e.f._refreshWriterReadiness();
    e.answer(true); await e.f._writerConfirmOrder(8);
    e.answer(true); await e.f._writerFullReceipt(7);
    e.answer('판매자 취소'); await e.f._writerCancelOrder(7);
    e.answer(true); await e.f._writerConfirmCoverage(10);
    const bs = posts(e).map(c => c.body);
    check('CONFIRM_ORDER / FULL_RECEIPT / CANCEL_ORDER / CONFIRM_COVERAGE envelopes: exactly the action fields',
      JSON.stringify(bs.map(b => Object.keys(b).filter(k => k !== 'action_id').sort())) ===
      JSON.stringify([['action', 'order_id'], ['action', 'order_id'], ['action', 'order_id', 'reason'], ['action', 'confirm', 'item_id']]) &&
      bs[3].confirm === true && bs[2].reason === '판매자 취소' && new Set(bs.map(b => b.action_id)).size === 4, JSON.stringify(bs));
    e.answer('0'); await e.f._writerPartialReceipt(7);
    e.answer('   '); await e.f._writerCancelOrder(7);
    check('invalid input (qty 0 / blank cancel reason) → nothing sent', posts(e).length === 4);
  }
  // ── network unknown success / 401 / 403 / terminal codes ──
  {
    const e = makeEnv({ post: ['network', { status: 200, body: { code: 'SUCCESS', replayed: true } }] });
    await e.f._refreshWriterReadiness();
    e.answer('4'); await e.f._writerPartialReceipt(7);
    const p1 = e.pending();
    check('response lost → NOT assumed failed or done: pending kept (state UNKNOWN, same envelope), bar with [다시 확인], no render',
      p1 && p1.state === 'UNKNOWN' && p1.action === 'PARTIAL_RECEIPT' && p1.received_qty === 4 && e.bar.style.display === 'block' && e.bar.innerHTML.includes('다시 확인') && e.renders.n === 0, JSON.stringify(p1));
    e.answer('5'); await e.f._writerPartialReceipt(7);
    check('a new action while one is pending → blocked (nothing sent)', posts(e).length === 1 && e.toasts.some(t => t.includes('확인 중인 기록이 있습니다')));
    await e.f._deliverPendingAction();
    const [a, b] = posts(e);
    check('retry → the SAME action_id and payload (no new id); replayed SUCCESS → pending cleared, "(이미 처리된 요청)", projection re-read',
      a.body.action_id === b.body.action_id && JSON.stringify(a.body) === JSON.stringify(b.body) && !e.pending() && e.toasts.some(t => t.includes('이미 처리된 요청')) && e.renders.n === 1,
      JSON.stringify([a.body, b.body]));
  }
  {
    const e = makeEnv({ post: [{ status: 401, body: { code: 'REAUTH_REQUIRED' } }, { status: 403, body: { code: 'FORBIDDEN' } }, { status: 503, body: { code: 'WRITER_UNAVAILABLE' } }] });
    await e.f._refreshWriterReadiness();
    e.answer(true); await e.f._writerFullReceipt(7);
    check('401 → pending kept (REAUTH), not ready, no anon / Core fallback', e.pending()?.state === 'REAUTH' && !e.ready() && e.rpcCalls.length === 0 && posts(e).length === 1);
    await e.f._deliverPendingAction();
    check('403 → pending kept (FORBIDDEN), not ready, no fallback', e.pending()?.state === 'FORBIDDEN' && !e.ready() && e.rpcCalls.length === 0);
    await e.f._deliverPendingAction();
    check('503 → pending kept (UNKNOWN), same id', e.pending()?.state === 'UNKNOWN' && new Set(posts(e).map(c => c.body.action_id)).size === 1);
    e.setSession(null);
    await e.f._deliverPendingAction();
    check('session gone → nothing sent, pending kept (REAUTH)', posts(e).length === 3 && e.pending()?.state === 'REAUTH');
  }
  {
    const e = makeEnv({ post: [{ status: 409, body: { code: 'IDEMPOTENCY_CONFLICT' } }, { status: 200, body: { code: 'STOCK_UNKNOWN', status: 'REJECTED' } }] });
    await e.f._refreshWriterReadiness();
    e.answer(true); await e.f._writerFullReceipt(7);
    check('409 IDEMPOTENCY_CONFLICT → terminal (pending cleared), message says nothing changed', !e.pending() && e.toasts.some(t => t.includes('아무것도 바뀌지 않았습니다')));
    e.answer(true); await e.f._writerFullReceipt(7);
    check('Core rejection (STOCK_UNKNOWN) → terminal, "모름은 0이 아닙니다"', !e.pending() && e.toasts.some(t => t.includes('모름은 0이 아닙니다')));
  }
  {
    // pending survives a reload (persisted) and is delivered with its id
    const e = makeEnv({ post: [{ status: 200, body: { code: 'CANCELLED', replayed: true } }] });
    e.store.set('zk_writer_pending_v1', JSON.stringify({ action: 'CANCEL_ORDER', action_id: '0f8fad5b-d9cb-469f-a165-70867728950e', order_id: 7, reason: 'x', state: 'UNKNOWN', at: 1 }));
    await e.f._refreshWriterReadiness();
    await e.f._deliverPendingAction();
    const p = posts(e)[0];
    check('pending persisted across reload → delivered with its stored id; state/at never sent', p.body.action_id === '0f8fad5b-d9cb-469f-a165-70867728950e' &&
      !('state' in p.body) && !('at' in p.body) && !e.pending(), JSON.stringify(p.body));
  }
  {
    const e = makeEnv();
    e.f._authClient();
    const opts = e.createClient.calls[0]?.opts?.auth || {};
    check('login session lives in a separate client (own storageKey, persisted, auto-refresh) — the data client db is untouched',
      opts.storageKey === 'zk-writer-auth' && opts.persistSession === true && opts.autoRefreshToken === true &&
      /\nconst db = createClient\(SUPABASE_URL, SUPABASE_KEY\);\r?\n/.test(HTML), JSON.stringify(opts));
    await e.f._refreshWriterReadiness();
    await e.f._writerSignOut();
    check('logout → session cleared, not ready', !e.ready() && e.state().status === 'signed_out' && (await e.f._writerToken()) === null);
    const ids = new Set(Array.from({ length: 50 }, () => e.f._newActionId()));
    check('action ids: UUID v4, unique', ids.size === 50 && [...ids].every(x => UUID.test(x)));
  }
  // ── static: no privileged path in the app ──
  {
    const code = HTML.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
    check('the app never calls a Core writer / the gateway / readiness RPC / the no-actor wrapper as the canonical writer',
      !/db\.rpc\('(confirm_order_supply|receive_order_supply|cancel_order_supply|confirm_supply_coverage|zk_receive_core|human_supply_writer_action|human_writer_readiness)'/.test(code) &&
      !/_authClient\(\)\.(rpc|from)\(/.test(code));
    check('no service_role secret / server key in the app', !/service_role|SERVICE_ROLE|sb_secret_/.test(code));
  }

  console.log(`\nRESULT: ${pass} PASS / ${fail} FAIL (of ${pass + fail})`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FAIL harness ' + e.stack); process.exit(1); });
