// test_home_resilience.js — ZEROKITCHEN_HOME_PERFORMANCE_AND_RESILIENCE_V0_1 (Web P1–P12 + 시간 예산 + 이전/이후 비교).
// 실제 브라우저 + 실제 index.html. 서버(Supabase REST / RPC / Edge)는 이 파일의 route 가 답한다: 지연·멈춤(hang)·504 재현.
// Production 모양 = 대전점(store 3) 실제 상태 (요청 5ce5171f · 대표 직접 주문 완료 · RECEIPT 수령 대기). 그 밖의 네트워크는 차단 → DB Write 0.
// node test_home_resilience.js            — 전체
// ZK_HTML=<file> node test_home_resilience.js  — 다른 HTML 로 (기본: 이 폴더 index.html)
const fs = require('fs'), path = require('path');
const { execFileSync } = require('child_process');
const { launch, checker, sleep } = require('./browser_harness.js');
const { check, done } = checker();
const ONLY = process.env.ZK_ONLY || '';   // 예: ZK_ONLY=P6 (시간 예산·타이머 검사는 건너뜀)
const NEW = fs.readFileSync(process.env.ZK_HTML || path.join(__dirname, 'index.html'));
const S = NEW.toString('utf8');
let OLD = null; try { OLD = execFileSync('git', ['show', 'c1fc0fa:index.html'], { cwd: __dirname, maxBuffer: 64 << 20 }); } catch { OLD = null; }   // 이 작업 직전 Production

// ── fixture (Production 대전점 모양) ──
const pin = re => (re.exec(S) || [])[1];
const READY = { code: 'READINESS', api_version: pin(/const _PE_API = '([^']+)'/), package_version: pin(/const _PE_PACKAGE = '([^']+)'/), build_hash: pin(/const _PE_BUILD = '([0-9a-f]{64})'/),
  capabilities: JSON.parse((pin(/const _PE_REQUIRED_CAPS = (\[[^\]]*\]);/) || '[]').replace(/'/g, '"')), db_build_match: true };
const RID = '5ce5171f-76d0-4608-a5a0-ce8baa464aee', T = '7a4a5b0e-1111-4222-8333-944455556666';
const STORES = [{ store_id: 1, store_name: '경기광주점' }, { store_id: 3, store_name: '신세계 대전점' }];
const DAEJEON = { store_id: 3, display_name: '신세계 대전점', purchasing_enabled: true, authority: ['PURCHASE_APPROVER', 'PURCHASE_REQUESTER'], delivery_profile: { status: 'ACTIVE', version: 2 } };
const REQ = { request_id: RID, status: 'READY_FOR_RESEARCH', received_at: '2026-10-11T02:11:13Z', line_count: 6, unresolved: 0, request_version: 3 };
const VIEW = { code: 'OK', api_version: READY.api_version, edge_build_hash: READY.build_hash, approver: true, store_id: 3, display_name: '신세계 대전점', delivery: null, windows: [], baskets: [], attempts: [] };
const ORDERS = [{ order_id: 130, name: '치즈', ordered_qty: 3, unit: '박스', received_qty: 0, remaining: 3, delivery_status: 'IN_TRANSIT', supplier: 'COUPANG', product_name: '피자치즈', purchased_qty: 12, purchased_unit: '봉' }];
const CUR = { code: 'CURRENT_ACTION', purchase: { status: 'PURCHASE_COMPLETED', source: 'OWNER_DIRECT_ORDER', lines: 6, paid_total_krw: 426059, orders: [{ supplier: 'SIKBOM' }, { supplier: 'COUPANG' }, { supplier: 'COUPANG' }] },
  action: { type: 'RECEIPT', message: '주문 완료 · 배송을 기다리는 중입니다.', delivered: false, orders: ORDERS, request_ref: { request_id: RID, request_version: 3 }, delivery: { total: 3, delivered: 0, in_transit: 1, preparing: 2, attention: 0 } } };
const REFS = { code: 'OK', store_id: 3, action_request_id: RID, baskets: {}, attempts: {} };
const MSGS = [
  { seq: 1, message_id: 'e0000000-0000-4000-8000-000000000001', role: 'HUMAN', body: '대전점 발주 부탁합니다', purchase_request_id: RID, ref: null, created_at: '2026-10-11T02:11:13Z' },
  { seq: 2, message_id: 'e0000000-0000-4000-8000-000000000002', role: 'AGENT', body: '신세계 대전점 발주요청 6개를 읽었습니다.', purchase_request_id: RID, ref: null, created_at: '2026-10-11T02:11:20Z' },
  { seq: 3, message_id: 'e0000000-0000-4000-8000-000000000003', role: 'AGENT', body: '쿠팡 주문 1건이 배송 중으로 바뀌었어요.', purchase_request_id: RID, ref: { kind: 'DELIVERY_WATCH' }, created_at: '2026-10-12T03:00:00Z' }];
const b64u = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const JWT = `${b64u({ alg: 'HS256', typ: 'JWT' })}.${b64u({ sub: 'de08659b-61ec-4b8e-82d2-ceceb39e4bcc', role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 86400 })}.c2ln`;
const SESSION = { access_token: JWT, token_type: 'bearer', expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, refresh_token: 'test-refresh',
  user: { id: 'de08659b-61ec-4b8e-82d2-ceceb39e4bcc', aud: 'authenticated', role: 'authenticated', email: 'owner@test.local' } };

// ── 서버: 항목마다 지연(ms) / 'hang' / '504' / 'fail'. o.lat = 기본 지연, o.edge = Edge 기본 지연 ──
function server(o = {}) {
  const lat = o.lat ?? 150, edge = o.edge ?? lat;
  const pick = (k, def, d) => {
    const v = typeof o[k] === 'function' ? o[k]() : o[k];
    if (v === 'hang') return { hang: true };
    if (v === 'fail') return { fail: true };
    if (v === '504') return { status: 504, body: { message: 'upstream request timeout' }, delay: d };
    return { ...def, delay: typeof v === 'number' ? v : d };
  };
  return (u, m, body) => {
    const url = new URL(u), p = url.pathname;
    if (!/supabase\.co$/.test(url.host)) return null;
    let a = {}; try { a = JSON.parse(body || '{}'); } catch {}
    const chat = () => ({ code: 'OK', thread_id: a.p_store_id === 3 ? T : null, messages: a.p_store_id === 3 ? MSGS : [], cursor: a.p_store_id === 3 ? 1 : null, has_more: false, request_has_messages: a.p_store_id === 3 });
    if (o.db === 'hang' || o.db === '504') { const r = pick('db', {}, lat); return r; }   // DB 전체 장애 (REST + Edge)
    if (p === '/rest/v1/stores') return pick('stores', { body: STORES }, lat);
    if (p === '/rest/v1/rpc/zk_chat_thread_page') return pick('chat', { body: chat() }, lat);
    if (p === '/rest/v1/rpc/zk_pe_scope_refs') return pick('refs', { body: REFS }, lat);
    if (p === '/rest/v1/rpc/zk_chat_append') return pick('append', { body: { code: 'APPENDED', seq: 99 } }, lat);
    if (p.startsWith('/rest/v1/rpc/')) return pick('rest', { body: [] }, lat);
    if (p === '/rest/v1/order_requests') return pick('orders', { body: [] }, lat);
    if (p.startsWith('/rest/v1/')) return pick('rest', { body: m === 'GET' ? [] : null }, lat);
    if (p === '/functions/v1/purchase-request/web') return pick('pr', { body: { api_version: 'pr-v1', ready: true, stores: [DAEJEON], requests: [REQ] } }, edge);
    if (p === '/functions/v1/purchase-execution/readiness') return pick('ready', { body: READY }, o.readyLat ?? edge);
    if (p === '/functions/v1/purchase-execution/web' && m === 'GET') return pick('view', { body: VIEW }, edge);
    if (p === '/functions/v1/purchase-execution/web') return pick('cur', { body: Number(url.searchParams.get('store_id') || a.store_id) === 3 ? CUR : { code: 'CURRENT_ACTION', action: null } }, edge);
    if (p === '/functions/v1/human-supply-writer/web') return pick('writer', { body: { api_version: 'hw-v1', ready: true, reason: 'READY', capabilities: [] } }, edge);
    if (p.startsWith('/functions/v1/')) return pick('edge', { body: { code: 'NOT_IN_TEST' } }, edge);
    return null;
  };
}
// 페이지 시작 전에: 매장·로그인 세션(만료 먼 가짜 토큰 → 인증 서버 호출 없음) + 화면 이정표 기록
const PRE = sid => `(() => {
  try { localStorage.setItem('zk_store_id', '${sid}'); localStorage.setItem('zk-writer-auth', ${JSON.stringify(JSON.stringify(SESSION))}); } catch {}
  const M = window.__zkM = {};
  const mark = k => { if (!(k in M)) M[k] = Math.round(performance.now()); };
  const tick = () => {
    try {
      const inp = document.getElementById('nlInput'); if (inp && inp.offsetParent !== null) mark('shell');
      const st = document.getElementById('storeTabs'); if (st && st.querySelector('.store-tab') && !/불러오는 중/.test(st.textContent)) mark('stores');
      if (document.querySelector('#purchaseHome [data-pr-home]')) mark('current');
      if (document.querySelector('#resList [data-chat-restored]')) mark('chat');
      const ol = document.getElementById('orderList');
      let otherDone = true; try { otherDone = !_homeLoad.other; } catch {}
      if (ol && ol.innerHTML && !ol.querySelector('.spin') && !/불러오는 중|로딩 중/.test(ol.textContent) && otherDone && 'stores' in M) mark('full');
    } catch {}
  };
  setInterval(tick, 15);
})();`;

async function open(html, route, { sid = 3, hash = '' } = {}) {
  const log = [];
  const t0 = Date.now();
  const b = await launch({ newHtml: html, route: (u, m, body) => { const r = route(u, m, body); if (r && m !== 'OPTIONS') log.push({ t: Date.now(), u: new URL(u).pathname + new URL(u).search, m, body, r }); return r; } });
  await b.send('Page.addScriptToEvaluateOnNewDocument', { source: PRE(sid) });
  await b.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await b.send('Page.navigate', { url: 'http://zk.test/' + hash });
  b.log = log; b.t0 = t0;
  b.marks = () => b.ev('return window.__zkM || {}');
  b.until = async (expr, ms) => { const end = Date.now() + ms; while (Date.now() < end) { try { if (await b.ev(expr)) return true; } catch {} await sleep(50); } return false; };
  // 시나리오의 시간 검사는 페이지 스크립트가 올라온 뒤부터 잰다 (브라우저 시작·CDN 시간은 위 BUDGET 에서 따로)
  await b.until(`return typeof _homeLoad === 'object' && document.readyState !== 'loading'`, 20000);
  return b;
}
const WRITE = r => (r.m === 'POST' && /\/rest\/v1\/(?!rpc\/(get_|zk_chat_thread_page|zk_pe_scope_refs))/.test(r.u)) || r.m === 'PATCH' || r.m === 'DELETE' || r.m === 'PUT'
  || (r.m === 'POST' && /\/functions\/v1\//.test(r.u) && !/GET_CURRENT_PURCHASE_ACTION/.test(r.body || ''));
const visibleText = `return [...document.querySelectorAll('#storeTabs, #homeLoad, #chatLoad, #homeDock .dock-title, #orderList')].filter(e => e.offsetParent !== null).map(e => e.textContent.replace(/\\s+/g, ' ').trim()).join(' | ')`;
const LOADING = /불러오는 중|확인 중|로딩 중/;
const inputUsable = `const i = document.getElementById('nlInput'); return !!i && i.offsetParent !== null && !i.disabled`;

async function timing(html, prof) {
  const b = await open(html, server(prof));
  try {
    await b.until(`const m = window.__zkM || {}; return 'full' in m && 'current' in m && 'chat' in m`, 25000);
    await sleep(300);
    const m = await b.marks();
    return { shell: m.shell, stores: m.stores, current: m.current, chat: m.chat, primary: Math.max(m.current || 0, m.chat || 0) || undefined, full: m.full, calls: b.log.length, writes: b.log.filter(WRITE).length, log: b.log };
  } finally { b.close(); }
}

(async () => {
  try {
    // ════ 시간 예산 (normal mocked latency 150ms) + 이전/이후 (같은 서버 모양) ════
    const NORMAL = { lat: 150 }, PRODLIKE = { lat: 220, edge: 650, readyLat: 450 };   // PRODLIKE = 2026-10-12 측정 (REST ~0.1–0.4s, Edge 0.3–1s, readiness 0.3–0.7s)
    // 차례로 3회씩 (동시에 띄우면 CPU 경쟁으로 시간이 흔들린다) → 각 이정표의 중앙값
    const med = async (html, prof) => { if (!html) return null; const r = []; for (let i = 0; i < 3; i++) r.push(await timing(html, prof)); const k = ['shell', 'stores', 'current', 'chat', 'primary', 'full', 'calls', 'writes'];
      const o = Object.fromEntries(k.map(x => [x, r.map(y => y[x]).sort((a, b) => a - b)[1]])); o.log = r[0].log; o.runs = r.map(y => y.primary); return o; };
    const n1 = ONLY ? null : await med(NEW, NORMAL), p1 = ONLY ? null : await med(NEW, PRODLIKE), n0 = ONLY ? null : await med(OLD, NORMAL), p0 = ONLY ? null : await med(OLD, PRODLIKE);
    if (!ONLY) {
    const row = (name, x) => x ? `${name.padEnd(22)} shell ${String(x.shell).padStart(5)}  stores ${String(x.stores).padStart(5)}  current ${String(x.current).padStart(5)}  chat ${String(x.chat).padStart(5)}  full ${String(x.full).padStart(5)}  calls ${x.calls}` : `${name}: (no old html)`;
    console.log('\nTIMING (ms from navigation; mocked server)\n' + [row('BEFORE c1fc0fa normal', n0), row('AFTER normal', n1), row('BEFORE c1fc0fa prodlike', p0), row('AFTER prodlike', p1)].join('\n') + '\n');
    check('BUDGET normal latency: shell ≤ 500ms, primary (current action + recent chat) ≤ 3s, full secondary ≤ 5s', n1.shell <= 500 && n1.primary <= 3000 && n1.full <= 5000, JSON.stringify({ shell: n1.shell, primary: n1.primary, full: n1.full }));
    check('BUDGET materially faster than before (same mocked server): primary in at most 60% of the old time in both profiles (measured ~2-3x)', !n0 || (n1.primary <= 0.6 * n0.primary && p1.primary <= 0.6 * p0.primary), JSON.stringify({ before: [n0 && n0.primary, p0 && p0.primary], after: [n1.primary, p1.primary] }));
    check('SAFETY home load writes nothing (no POST/PATCH/DELETE besides read RPCs / GET_CURRENT_PURCHASE_ACTION)', n1.writes === 0 && p1.writes === 0, JSON.stringify(n1.log.filter(WRITE).map(r => r.m + ' ' + r.u)));
    // 병렬: readiness 는 발주요청 확인과 동시에, 현재 행동과 scope 근거는 함께; 같은 데이터 중복 읽기 없음
    const at = (re, l = n1.log) => l.find(r => re.test(r.u + ' ' + (r.body || '')));
    const pr = at(/purchase-request\/web/), rd = at(/purchase-execution\/readiness/), cu = at(/GET_CURRENT_PURCHASE_ACTION/), rf = at(/zk_pe_scope_refs/);
    check('PARALLEL readiness starts with purchase-request (not after it); current action and scope refs start together', rd && pr && Math.abs(rd.t - pr.t) < 100 && cu && rf && Math.abs(cu.t - rf.t) < 100, JSON.stringify({ pr: pr && pr.t, rd: rd && rd.t, cu: cu && cu.t, rf: rf && rf.t }));
    const count = re => n1.log.filter(r => re.test(r.u)).length;
    check('QUERY no duplicate home reads: stores 1, items 1, purchase-request 1, chat first page 1, order_requests(pending) 1', count(/^\/rest\/v1\/stores/) === 1 && count(/^\/rest\/v1\/items/) === 1 && count(/purchase-request\/web/) === 1 && count(/zk_chat_thread_page/) === 1
      && n1.log.filter(r => /^\/rest\/v1\/order_requests/.test(r.u) && /pending/.test(r.u)).length === 1, JSON.stringify(n1.log.map(r => r.u.replace(/\?.*/, '')).reduce((a, u) => (a[u] = (a[u] || 0) + 1, a), {})));
    const chatCalls = n1.log.filter(r => /zk_chat_thread_page/.test(r.u)).map(r => JSON.parse(r.body));
    check('P10 chat restore unchanged: one bounded first page (p_turns 5, current request), no whole-thread fetch', chatCalls.length === 1 && chatCalls[0].p_turns === 5 && chatCalls[0].p_purchase_request_id === RID && !n1.log.some(r => /rpc\/zk_chat_thread$/.test(r.u)), JSON.stringify(chatCalls));

    }
    // ════ 장애 시나리오 (동시에 실행) ════
    let storesOk = false, curOk = false, chatOk = false;
    const scen = {
      P1: async () => { const b = await open(NEW, server({ stores: 'hang' })); try {
        await sleep(300); const t = await b.ev(visibleText), u = await b.ev(inputUsable), m = await b.marks();
        check('P1 shell before DB: stores pending → input box + store area "매장 불러오는 중..." already on screen (the ≤500ms budget is timed above without other browsers running)', u && m.shell > 0 && !('stores' in m) && /매장 불러오는 중/.test(t), JSON.stringify({ t, u, m }));
      } finally { b.close(); } },
      P2P3P7: async () => { const b = await open(NEW, server({ stores: () => storesOk ? 150 : 12000 })); try {
        await sleep(3000); const u = await b.ev(inputUsable), t = await b.ev(visibleText);
        check('P2 stores delayed 12s → after 3s the shell / input are usable (no blank screen)', u && /매장 불러오는 중/.test(t), JSON.stringify({ u, t }));
        const failed = await b.until(`return !!document.querySelector('#storeTabs [data-stores-failed]') && !!document.querySelector('#storeTabs button')`, 9000);
        const t2 = await b.ev(visibleText);
        check('P3 stores timeout (10s) → "서버 응답이 늦습니다. 매장 정보를 불러오지 못했습니다." + [다시 시도]; input still usable', failed && /서버 응답이 늦습니다\. 매장 정보를 불러오지 못했습니다\./.test(t2) && await b.ev(inputUsable), t2);
        const sent = await b.ev(`document.getElementById('nlInput').value = '양파 3개'; await handleNaturalInput(); return document.getElementById('nlInput').value`);
        check('P3 while stores are unknown a message is not processed for an unknown store (input kept, nothing written)', sent === '양파 3개' && !b.log.some(WRITE), JSON.stringify({ sent, writes: b.log.filter(WRITE).map(r => r.u) }));
        await sleep(2500);   // the late 12s stores answer arrives — it must not half-start the app (the user retries)
        storesOk = true;
        await b.ev(`document.querySelector('#storeTabs button').click(); return 1`);
        const ok = await b.until(`return !!document.querySelector('#storeTabs .store-tab.active') && !!document.querySelector('#purchaseHome [data-pr-home]') && !!document.querySelector('#resList [data-chat-restored]')`, 6000);
        check('P7 [다시 시도] succeeds → store tabs (대전점 active), current action and recent chat appear', ok && await b.ev(`return SID === 3 && document.getElementById('homeLoad').hidden`), await b.ev(visibleText));
      } finally { b.close(); } },
      P4: async () => { const b = await open(NEW, server({ cur: () => curOk ? 150 : 'hang' })); try {
        const chat = await b.until(`return !!document.querySelector('#resList [data-chat-restored]')`, 3000);
        const loading = await b.ev(`return document.getElementById('homeLoad').textContent`);
        check('P4 current action pending → recent chat already restored (≤3s) and input usable; the current line says "현재 할 일 확인 중..."', chat && await b.ev(inputUsable) && /현재 할 일 확인 중/.test(loading), loading);
        const failed = await b.until(`return document.getElementById('homeLoad').dataset.state === 'failed'`, 12000);
        const t = await b.ev(`return document.getElementById('homeLoad').textContent`);
        check('P4 current action timeout → "서버 응답이 늦습니다. 현재 상태를 확인하지 못했습니다." + [다시 시도]; chat untouched', failed && /서버 응답이 늦습니다\. 현재 상태를 확인하지 못했습니다\./.test(t) && await b.ev(`return !!document.querySelector('#resList [data-chat-restored]') && !!document.querySelector('#homeLoad button')`), t);
        curOk = true;
        await b.ev(`document.querySelector('#homeLoad button').click(); return 1`);
        const ok = await b.until(`return !!document.querySelector('#purchaseHome [data-pr-home]') && document.getElementById('homeLoad').hidden`, 5000);
        check('P7b current action [다시 시도] → the receipt card appears, the failure line goes away', ok && /주문 완료|배송/.test(await b.ev(`return document.getElementById('purchaseHome').textContent`)), await b.ev(visibleText));
      } finally { b.close(); } },
      P5: async () => { const b = await open(NEW, server({ chat: () => chatOk ? 150 : 'hang' })); try {
        const cur = await b.until(`return !!document.querySelector('#purchaseHome [data-pr-home]')`, 3000);
        const l = await b.ev(`return document.getElementById('chatLoad').textContent`);
        check('P5 chat pending → current action already shown (≤3s); chat line "최근 대화 불러오는 중..."', cur && /최근 대화 불러오는 중/.test(l) && await b.ev(inputUsable), l);
        const failed = await b.until(`return document.getElementById('chatLoad').dataset.state === 'failed'`, 12000);
        const t = await b.ev(`return document.getElementById('chatLoad').textContent`);
        check('P5 chat timeout → "서버 응답이 늦습니다. 최근 대화를 불러오지 못했습니다." + [다시 시도]; current action stays', failed && /최근 대화를 불러오지 못했습니다/.test(t) && await b.ev(`return !!document.querySelector('#purchaseHome [data-pr-home]') && document.getElementById('homeLoad').hidden`), t);
        chatOk = true;
        await b.ev(`document.querySelector('#chatLoad button').click(); return 1`);
        const ok = await b.until(`return !!document.querySelector('#resList [data-chat-restored]') && document.getElementById('chatLoad').hidden`, 5000);
        check('P7c chat [다시 시도] → recent chat restored (incl. the delivery-watch note), failure line gone', ok && /배송 중으로 바뀌었어요/.test(await b.ev(`return document.getElementById('resList').textContent`)), '');
      } finally { b.close(); } },
      P6: async () => { const b = await open(NEW, server({ orders: 'hang' })); try {
        const prim = await b.until(`return !!document.querySelector('#purchaseHome [data-pr-home]') && !!document.querySelector('#resList [data-chat-restored]')`, 3000);
        const title = await b.ev(`return document.querySelector('#homeDock .dock-sec[data-dock="other"] .dock-title').textContent`);
        check('P6 secondary pending → primary (current action + chat) unaffected (≤3s); folded "기타 정보 · 불러오는 중"', prim && /기타 정보 · 불러오는 중/.test(title), title);
        const failed = await b.until(`return !!document.querySelector('#orderList [data-other-failed] button')`, 17000);
        const t = await b.ev(`return document.querySelector('#homeDock .dock-sec[data-dock="other"] .dock-title').textContent + ' / ' + document.getElementById('orderList').textContent`);
        check('P6 secondary timeout → "기타 정보 · 불러오지 못함" + [다시 시도] inside; primary still shown, no other area affected', failed && /불러오지 못함/.test(t) && /다시 시도/.test(t) && await b.ev(`return !!document.querySelector('#purchaseHome [data-pr-home]') && document.getElementById('homeLoad').hidden && document.getElementById('chatLoad').hidden`), t);
      } finally { b.close(); } },
      P6b: async () => { const b = await open(NEW, server({ writer: 'hang' })); try {   // the human-writer readiness (Edge) inside the secondary chain hangs
        const prim = await b.until(`return !!document.querySelector('#purchaseHome [data-pr-home]') && !!document.querySelector('#resList [data-chat-restored]')`, 3000);
        const settled = await b.until(`return !_homeLoad.other`, 14000);
        check('P6b writer readiness Edge hangs inside the secondary chain → primary unaffected (≤3s); the secondary still finishes after the 10s bound (writer shown as not ready), no endless loading', prim && settled, await b.ev(visibleText));
      } finally { b.close(); } },
      P8: async () => { const b = await open(NEW, server({ cur: 3000, chat: () => 3000 })); try {
        await b.until(`return !!document.querySelector('#storeTabs .store-tab.active')`, 3000);
        await sleep(400);
        await b.ev(`_switchStore(1); return 1`);
        await sleep(4500);
        const r = await b.ev(`return { sid: SID, chat: document.getElementById('resList').textContent, ph: document.getElementById('purchaseHome').textContent, pe: _pe.current && _pe.current.action && _pe.current.action.type, poll: !!_pe.poll, load: document.getElementById('homeLoad').textContent }`);
        check('P8 store switched while Store3 current action / chat were in flight → their late answers are ignored (Store1 shows no Store3 chat, card or action)', r.sid === 1 && !/대전점|배송 중으로/.test(r.chat) && !/대전점/.test(r.ph) && !r.pe && !r.poll, JSON.stringify(r));
      } finally { b.close(); } },
      P9a: async () => { const b = await open(NEW, server({ db: 'hang' })); try {
        await sleep(11500);
        const t = await b.ev(visibleText);
        check('P9 DB unavailable (every request hangs) → after the bound: no "불러오는 중/확인 중" left, store [다시 시도], input visible', !LOADING.test(t) && /다시 시도|매장 정보를 불러오지 못했습니다/.test(t) && await b.ev(`return !!document.querySelector('#storeTabs button')`) && await b.ev(inputUsable), t);
      } finally { b.close(); } },
      P9b: async () => { const b = await open(NEW, server({ pr: '504', ready: '504', view: '504', cur: '504', refs: '504', chat: '504', orders: '504', rest: '504', writer: '504', stores: 150 })); try {
        await sleep(4000);
        const t = await b.ev(visibleText);
        check('P9 REST / Edge 504 (stores OK) → each area shows its own failure + [다시 시도] quickly; nothing stays loading', !LOADING.test(t) && /현재 상태를 확인하지 못했습니다/.test(t) && /최근 대화를 불러오지 못했습니다/.test(t) && /기타 정보/.test(t) && await b.ev(inputUsable), t);
      } finally { b.close(); } },
    };
    // 한 번에 3개까지 (브라우저를 한꺼번에 많이 띄우면 시작이 몇 초씩 밀려 시간 검사가 흔들린다)
    const queue = Object.entries(scen).filter(([k]) => !ONLY || ONLY.split(',').includes(k));
    await Promise.all([0, 1, 2].map(async () => { for (let q; (q = queue.shift());) await q[1]().catch(e => check('scenario ' + q[0], false, e && e.stack || e)); }));

    // ════ 화면이 스스로 다시 확인하는 타이머 (P11 / P12) ════
    if (ONLY) return done(new Set());
    const b = await open(NEW, server({}));
    try {
      await b.until(`return !!document.querySelector('#purchaseHome [data-pr-home]')`, 5000);
      const w = await b.ev(`const calls = []; const st = window.setTimeout; window.setTimeout = (fn, ms) => { calls.push({ fn, ms }); return calls.length; };
        const real = _refreshPurchaseHome; let homes = 0;
        _refreshPurchaseHome = async () => { homes++; return { fail: 'TIMEOUT' }; };   // a failed refresh never re-arms by itself
        const cp = _chatPollNew; let polls = 0; _chatPollNew = async () => { polls++; return 0; };
        clearTimeout(_pe.poll); _pe.poll = null; _pe.current = ${JSON.stringify(CUR)};
        _peWatchPoll(); const first = calls[0] && calls[0].ms;
        await calls[0].fn();   // the 5-min tick: refresh fails
        const rearmed = calls.length === 2 && calls[1].ms === 300000;
        _pe.polling = true; _pe.poll = null; const before = homes; await calls[1].fn();   // a previous check still pending → skip, no overlap
        const skipped = homes === before && calls.length === 3;
        _pe.polling = false;
        window.setTimeout = st; _refreshPurchaseHome = real; _chatPollNew = cp; _pe.poll = null;
        return { first, homes, polls, rearmed, skipped }`);
      check('P11 delivery-watch poll unchanged (5 min, home refresh + chat note check); a failed refresh keeps the watch going (re-armed); a still-pending check is skipped, not doubled',
        w.first === 300000 && w.homes === 1 && w.polls === 1 && w.rearmed && w.skipped, JSON.stringify(w));
      const h = await b.ev(`const calls = []; const st = window.setTimeout; window.setTimeout = (fn, ms) => { calls.push({ fn, ms }); return calls.length; };
        const real = _refreshPurchaseHome; let homes = 0; _refreshPurchaseHome = async () => { homes++; };
        _pe.poll = null; _pe.current = { code: 'CURRENT_ACTION', action: { type: 'RESEARCHING' } };
        _peSchedulePoll(); const ms = calls[0] && calls[0].ms;
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
        calls[0].fn(); const hiddenHomes = homes, rearmed = calls.length === 2;
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
        calls[1].fn(); const visibleHomes = homes;
        window.setTimeout = st; _refreshPurchaseHome = real; _pe.poll = null; _pe.current = null;
        return { ms, hiddenHomes, rearmed, visibleHomes }`);
      check('P12 hidden tab: the research re-check (10s) and the delivery re-check do no network while hidden — just the next tick', h.ms === 10000 && h.hiddenHomes === 0 && h.rearmed && h.visibleHomes === 1, JSON.stringify(h));
    } finally { b.close(); }
  } catch (e) { check('harness', false, e && e.stack || e); }
  done(new Set());
})();
