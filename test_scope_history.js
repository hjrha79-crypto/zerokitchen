// test_scope_history.js — CURRENT_PURCHASE_FILTER_AND_CHAT_LAZY_HISTORY V0.1 (Web: F1–F6, L1–L14)
// 실제 브라우저 + 실제 홈 갱신(_refreshPurchaseHome → 실제 _refreshPurchaseExec / _peScope / 렌더) + 실제 스크롤.
// 구매 실행 서버 응답(readiness / view / 현재 행동)은 Production 대전 상태를 본뜬 fixture, 채팅·scope RPC 는 메모리 mock, 나머지 네트워크 차단 → DB Write 0.
// 서버 쪽 paging·권한·binding 은 migration-packages/current-purchase-scope-chat-page-001/tests/run_page_api.cjs (staging).
const fs = require('fs'), path = require('path');
const { execFileSync } = require('child_process');
const { launch, chatMock, checker, sleep } = require('./browser_harness.js');
const { check, done } = checker();
const mock = chatMock();
const R = '5ce5171f-76d0-4608-a5a0-ce8baa464aee', C1 = '49e03d8e-dc51-49c4-a320-90bf80db3dd4', C2 = 'dd1d59e1-a8cf-4f82-bcdf-a3309245d141';
const OLD = '0ld00000-0000-4000-8000-000000000001', R2 = '0ld00000-0000-4000-8000-000000000002';
const A1 = 'bf98bf8c-bffb-4a75-9652-e64ab480651b', A2 = '866df020-8ff6-4732-9d5b-c5bb3f94f8f4';
const REQ = (id, status, at, extra = {}) => ({ request_id: id, status, unresolved: status === 'MAPPING_REQUIRED' ? 1 : 0, line_count: 6, received_at: at, request_version: 1, ...extra });
// Production 그대로: 현재 대전 요청(품목 확인 1) + 취소된 인증 요청 2 + 그 인증 FIELD attempt 2 (PRESUBMIT_ABANDONED:FIELD_COMPLETE) + 서버 현재 행동 = 취소된 쿠팡 인증 basket 의 "확인이 필요합니다."
const PROD = {
  requests: [REQ(R, 'MAPPING_REQUIRED', '2026-10-11T02:11:13Z'), REQ(C1, 'CANCELLED', '2026-10-10T14:54:33Z'), REQ(C2, 'CANCELLED', '2026-10-09T15:42:05Z')],
  attempts: [
    { attempt_id: A1, created_at: '2026-10-10T14:56:49Z', state: 'ACTION_REQUIRED', reason: 'PRESUBMIT_ABANDONED:FIELD_COMPLETE', supplier: 'COUPANG', supplier_label: '쿠팡', submitted: false, address_switched: true, address: { state: 'ADDRESS_RESTORED' }, original_address: { label: '본점' } },
    { attempt_id: A2, created_at: '2026-10-09T15:44:58Z', state: 'ACTION_REQUIRED', reason: 'PRESUBMIT_ABANDONED:FIELD_COMPLETE', supplier: 'SIKBOM', supplier_label: '식봄', submitted: false, address_switched: true, address: { state: 'ADDRESS_RESTORED' }, original_address: { label: '본점' } }],
  baskets: [],
  cur: { code: 'CURRENT_ACTION', action: { type: 'ACTION_REQUIRED', message: '확인이 필요합니다.' }, purchase: { status: 'PURCHASE_ACTION_REQUIRED', basket_id: 'PROD-CPCERT-mv2imyla' } },
  refs: { code: 'OK', store_id: 3, action_request_id: C1, baskets: { 'PROD-CERT-mv14z2i6': C2, 'PROD-CPCERT-mv2imyla': C1 }, attempts: { [A1]: C1, [A2]: C2 } },
};
const RAW = '안녕하시지요\n치즈 3박스\n우유 1박스\n휘핑크림 1박스\n콜라 2박스\n제로콜라 2박스\n스프라이트 1박스\n발주부탁합니다';
// 실제 _refreshPurchaseExec 를 쓰고, 그 안의 서버 호출(readiness / view / 현재 행동)만 fixture 로 답한다. scope RPC 는 CDP mock(mock.refs).
const SETUP = (o) => `
  window.__tok = 'test-token';
  _writerToken = async () => window.__tok;
  const o = ${JSON.stringify(o)};
  const store = { store_id: 3, display_name: '신세계 대전점', purchasing_enabled: true, authority: ['PURCHASE_APPROVER'], delivery_profile: { status: 'ACTIVE', version: 1 } };
  SID = o.sid || 3;
  _refreshPurchase = async () => { _purchase = { loaded: true, ready: true, stores: SID === 3 ? [store] : [], requests: SID === 3 ? o.requests : [], sid: SID, reason: 'READY' }; return _purchase; };
  if (!window.__realFetch) window.__realFetch = window.fetch.bind(window);
  const J = b => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
  window.fetch = async (url, init) => {
    const u = String(url);
    if (u.startsWith(_PE_READY_URL)) return J({ api_version: _PE_API, package_version: _PE_PACKAGE, build_hash: _PE_BUILD, capabilities: _PE_REQUIRED_CAPS, db_build_match: true });
    if (u.startsWith(_PE_URL) && (!init || init.method === 'GET')) return J({ code: 'OK', api_version: _PE_API, edge_build_hash: _PE_BUILD, approver: true, display_name: '신세계 대전점', store_id: 3, delivery: null, windows: [], baskets: o.baskets, attempts: o.attempts });
    if (u.startsWith(_PE_URL)) { const b = JSON.parse(init.body); return J(b.action === 'GET_CURRENT_PURCHASE_ACTION' ? (o.cur || { code: 'CURRENT_ACTION', action: null }) : { code: 'UNEXPECTED_IN_TEST' }); }
    return window.__realFetch(url, init);
  };
  _purchaseRequestOf = async (id) => id === '${R}' ? { request_id: id, store_id: 3, display_name: '신세계 대전점', raw_text: ${JSON.stringify(RAW)}, status: 'MAPPING_REQUIRED', request_version: 1,
    received_at: '2026-10-11T02:11:13Z', summary: { line_count: 6, confirmed: 5, candidate_found: 5, needs_check: 1, unresolved: 1 }, unparsed_lines: [] } : null;
  _items = [{ item_id: 1, item_name: '우유', current_qty: 1, target_qty: 3, unit: '박스', store_id: SID }];
  await _refreshPurchaseHome(_storeEpoch);
  await (_chat.restoring || Promise.resolve());
  await new Promise(r => setTimeout(r, 400));
  return 1;`;
const PH = `const ph = document.getElementById('purchaseHome'); return { text: ph.textContent, attempts: ph.querySelectorAll('[data-pe-attempt]').length, attemptIds: [...ph.querySelectorAll('[data-pe-attempt]')].map(x => x.dataset.peAttempt),
  rows: [...ph.querySelectorAll('[data-pr-row]')].map(x => x.textContent.replace(/\\s+/g, ' ').trim()), buttons: [...ph.querySelectorAll('button')].map(b => b.textContent.trim()),
  title: document.querySelector('[data-dock="purchase"] [data-dock-title]')?.textContent || '', current: !!ph.querySelector('[data-pe-current]') }`;
const SCREEN = `const l = document.getElementById('resList'); const top = l.querySelector('[data-chat-top]');
  return { msgs: [...l.querySelectorAll('[data-chat-restored] [data-chat-msg]')].map(x => x.dataset.chatMsg), bodies: [...l.querySelectorAll('[data-chat-restored] .v4-bubble')].map(b => b.firstChild.textContent),
    top: top ? top.dataset.state : null, topText: top ? top.textContent : '', text: l.textContent }`;
const pages = () => mock.calls.filter(c => c.fn === 'zk_chat_thread_page');
const TOP = `const ca = document.getElementById('chatArea'); ca.scrollTop = 0; ca.dispatchEvent(new Event('scroll')); await new Promise(r => setTimeout(r, 600)); return 1`;
const SAY = t => `document.getElementById('nlInput').value = ${JSON.stringify(t)}; await handleNaturalInput(); return 1`;

(async () => {
  const cur = fs.readFileSync(process.env.ZK_HTML || path.join(__dirname, 'index.html'));
  let old = null; try { old = execFileSync('git', ['show', 'HEAD:index.html'], { cwd: __dirname, maxBuffer: 64 << 20 }); } catch {}
  const b = await launch({ newHtml: cur, old, mock });
  try {
    // ════════ 현재 발주 영역 필터 (F) ════════
    mock.refs = PROD.refs;
    let before = null;
    if (old && !old.includes('_peScope')) { await b.open('http://zk.test/old'); await b.ev(SETUP(PROD)); before = await b.ev(PH); }
    await b.open('http://zk.test/');
    await b.ev(SETUP(PROD));
    let ph = await b.ev(PH);
    check('F1 current request card visible: "신세계 대전점 발주요청" · 10월 11일 11:11 · 6개 · 품목 확인 필요 1개 + [품목 확인하기]', ph.text.includes('신세계 대전점 발주요청') && ph.rows.length === 1
      && /11:11/.test(ph.rows[0]) && ph.rows[0].includes('6개 · 품목 확인 필요 1개') && ph.buttons.includes('품목 확인하기'), JSON.stringify(ph));
    check('F2 unrelated certification attempt cards hidden (before: ' + (before ? before.attempts : '?') + ' cards → after: 0)', ph.attempts === 0 && (!before || before.attempts === 2), JSON.stringify({ before: before && before.attemptIds, after: ph.attemptIds }));
    check('F3 "결제 전 중단 — 결제되지 않았습니다" / PRESUBMIT_ABANDONED:FIELD_COMPLETE never shown; stale cert action "확인이 필요합니다." not shown', !/결제 전 중단|PRESUBMIT_ABANDONED|FIELD_COMPLETE|확인이 필요합니다/.test(ph.text) && !ph.current
      && (!before || /PRESUBMIT_ABANDONED/.test(before.text)), ph.text.slice(0, 400));
    check('F6 current action title unchanged: "신세계 대전점 발주 · 품목 확인 필요 1개"', ph.title === '신세계 대전점 발주 · 품목 확인 필요 1개' && (!before || before.title === ph.title), JSON.stringify({ before: before && before.title, after: ph.title }));
    // F4 / F5: 같은 매장의 다른(이전) 요청과 그 attempt 는 내리고, 현재 요청의 attempt 는 보인다. 돈·배송지가 걸린 진행 중 attempt 는 어느 요청이든 보인다.
    const A3 = 'a3000000-0000-4000-8000-000000000003', A4 = 'a4000000-0000-4000-8000-000000000004', A5 = 'a5000000-0000-4000-8000-000000000005';
    const MIX = { ...PROD, requests: [PROD.requests[0], REQ(OLD, 'READY_FOR_RESEARCH', '2026-10-08T01:00:00Z'), ...PROD.requests.slice(1)],
      attempts: [
        { attempt_id: A3, created_at: '2026-10-11T03:00:00Z', state: 'SUCCEEDED', supplier: 'SIKBOM', supplier_label: '식봄', order: { paid_total_krw: 52000 } },
        { attempt_id: A4, created_at: '2026-10-08T02:00:00Z', state: 'ACTION_REQUIRED', reason: 'PRESUBMIT_ABANDONED:CART', supplier: 'SIKBOM', supplier_label: '식봄', submitted: false },
        { attempt_id: A5, created_at: '2026-10-09T16:00:00Z', state: 'ACTION_REQUIRED', reason: 'PRESUBMIT_ABANDONED:FIELD_COMPLETE', supplier: 'SIKBOM', supplier_label: '식봄', submitted: false, address_switched: true, address: { state: 'ADDRESS_RESTORE_REQUIRED' }, original_address: { label: '본점' } },
        ...PROD.attempts],
      baskets: [{ basket_id: 'B-OLDCANCEL', request_id: C1, basket_hash: 'h', created_at: '2026-10-10T14:54:58Z', groups: [{ supplier: 'COUPANG', supplier_label: '쿠팡', line_count: 1, total_krw: 1000, lines: [] }] }],
      refs: { ...PROD.refs, attempts: { ...PROD.refs.attempts, [A3]: R, [A4]: OLD, [A5]: C2 } } };
    mock.refs = MIX.refs;
    await b.open('http://zk.test/'); await b.ev(SETUP(MIX));
    ph = await b.ev(PH);
    check('F4 same store, other requests hidden: older READY_FOR_RESEARCH request row, its abandoned attempt, a cancelled request\'s basket', ph.rows.length === 1 && !ph.attemptIds.includes(A4) && !ph.text.includes('1,000원')
      && !ph.attemptIds.includes(A1) && !ph.attemptIds.includes(A2), JSON.stringify(ph));
    check('F5 current request execution card visible (주문 완료 · 식봄 결제 52,000원); a live safety card (배송지 원복 필요) is never hidden even for another request', ph.attemptIds.includes(A3) && ph.text.includes('52,000원')
      && ph.attemptIds.includes(A5) && ph.text.includes('원복 필요'), JSON.stringify(ph.attemptIds));
    // fail closed: binding 근거를 못 읽으면 진행 중이 아닌 attempt 는 내린다
    mock.refs = null;
    await b.open('http://zk.test/'); await b.ev(SETUP(PROD));
    ph = await b.ev(PH);
    check('F2b scope refs unavailable → still no certification card / stale action (fail closed), request row + title unchanged', ph.attempts === 0 && !ph.current && ph.title === '신세계 대전점 발주 · 품목 확인 필요 1개', JSON.stringify(ph));
    mock.refs = PROD.refs;

    // ════════ 채팅 lazy history (L) ════════
    // 현재 대전 thread: 원문 + 이해(시드) + 질문/답 8턴 (긴 답) = 9턴. 같은 매장 다른 발주 thread 하나 (섞이면 안 됨)
    const T = 'c0000000-0000-4000-8000-0000000000aa', T2 = 'c0000000-0000-4000-8000-0000000000bb';
    let n = 0; const id = () => `d0000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
    const put = (thread, role, body, req) => mock.handle('zk_chat_append', { p_message_id: id(), p_store_id: 3, p_thread_id: thread, p_role: role, p_body: body, p_purchase_request_id: req });
    put(T2, 'HUMAN', '지난 발주 thread 질문', R2); put(T2, 'AGENT', '지난 발주 thread 답', R2);
    put(T, 'HUMAN', RAW, R); put(T, 'AGENT', '신세계 대전점 발주요청 6개를 읽었습니다.\n5개는 품목 후보를 찾았고, 1개는 확인이 필요합니다.', R);
    for (let t = 1; t <= 8; t++) { put(T, 'HUMAN', `질문 ${t}\n제로콜라 확인`, R); put(T, 'AGENT', `답 ${t}\n제로콜라 1.5L 6개입 후보\n코카콜라 제로 500ml 24개입 후보`, R); }
    const all = mock.msgs.filter(m => m.thread_id === T).map(m => m.message_id);
    mock.calls.length = 0;
    await b.open('http://zk.test/'); await b.ev(SETUP(PROD));
    let sc = await b.ev(SCREEN);
    const first = pages()[0];
    check('L1 initial load = latest 5 turns only (10 of 18 messages), one bounded request (p_turns 5, no whole-thread fetch)', pages().length === 1 && first.args.p_turns === 5 && first.args.p_purchase_request_id === R
      && sc.msgs.join() === all.slice(-10).join() && sc.top === 'more' && !mock.calls.some(c => c.fn === 'zk_chat_thread'), JSON.stringify({ calls: mock.calls.map(c => c.fn), n: sc.msgs.length, top: sc.top }));
    const atBottom = await b.ev(`const ca = document.getElementById('chatArea'); return ca.scrollHeight - ca.scrollTop - ca.clientHeight < 4 && ca.scrollHeight > ca.clientHeight`);
    check('L7a latest messages visible first (scrolled to the newest; history above)', atBottom, '');
    // L2 + L6: 맨 위 근처로 올리면 2턴 추가, 읽던 문장은 같은 자리
    const anchor = `const el = document.querySelector('#resList [data-chat-msg="${all[all.length - 10]}"]'); return Math.round(el.getBoundingClientRect().top)`;
    await b.ev(`const ca = document.getElementById('chatArea'); ca.scrollTop = 40; return 1`);
    await sleep(700);
    const y0 = await b.ev(anchor).catch(() => null);
    sc = await b.ev(SCREEN);
    const p2 = pages()[1];
    const y1 = await b.ev(anchor);
    check('L2 near the top → older page loaded (2 turns: +4 messages) inside the same thread, by cursor', pages().length === 2 && p2.args.p_thread_id === T && p2.args.p_turns === 2 && p2.args.p_before_seq === mock.msgs.find(m => m.message_id === all[all.length - 10]).seq
      && sc.msgs.join() === all.slice(-14).join(), JSON.stringify({ n: sc.msgs.length, args: p2 && p2.args }));
    // 앵커: 스크롤 이벤트 직전 위치 대비 (로딩 줄 / 새 메시지를 위에 넣어도 같은 문장이 같은 자리)
    mock.delay = { zk_chat_thread_page: 500 };   // 느린 서버: "불러오는 중" 줄이 보이는 동안에도 자리 유지
    const jump = await b.ev(`const ca = document.getElementById('chatArea'); const el = document.querySelector('#resList [data-chat-msg="${all[all.length - 10]}"]');
      const before = Math.round(el.getBoundingClientRect().top); const t = ca.scrollTop; ca.scrollTop = 30; await new Promise(r => setTimeout(r, 150));
      const loading = document.querySelector('#resList [data-chat-top]').dataset.state;
      const y = Math.round(el.getBoundingClientRect().top); await new Promise(r => setTimeout(r, 900)); return { before, y, loading, after: Math.round(el.getBoundingClientRect().top), t }`);
    mock.delay = null;
    // 기대 위치 = 스크롤 전 위치 + 사람이 올린 거리 (t - 30). 로딩 줄·새 메시지가 위에 들어가도 그 자리 그대로여야 한다.
    const expectY = jump.before + (jump.t - 30);
    check('L6 scroll anchor preserved: the sentence being read stays where the owner scrolled it, through the loading line and the insert (±2px)', Math.abs(jump.after - expectY) <= 2 && Math.abs(jump.y - expectY) <= 2 && jump.loading === 'loading'
      && (await b.ev(SCREEN)).msgs.length === 18, JSON.stringify({ ...jump, expectY }));
    // L11: 페이지를 불러온 뒤 새 대화 → 아래에 붙고 같은 thread 로 저장
    sc = await b.ev(SCREEN);
    const nBefore = sc.msgs.length;
    await b.ev(SAY('제로콜라 어떤 걸로 해?')); await sleep(1900);
    const saved = mock.msgs.filter(m => m.thread_id === T).slice(-2);
    const lastRow = await b.ev(`const l = document.getElementById('resList'); return l.lastElementChild.previousElementSibling ? l.lastElementChild.textContent.slice(0, 40) : ''`);
    check('L11 new message after paging → appended at the bottom (not into the history block), saved to the same thread', saved[0].role === 'HUMAN' && saved[0].body === '제로콜라 어떤 걸로 해?' && saved[1].role === 'AGENT'
      && (await b.ev(SCREEN)).msgs.length === nBefore, JSON.stringify({ saved: saved.map(s => s.role + ':' + s.body.slice(0, 20)), lastRow }));
    // L3 / L5: 끝까지 → "이 대화의 시작입니다", 더 요청하지 않음
    for (let i = 0; i < 4; i++) await b.ev(TOP);
    sc = await b.ev(SCREEN);
    const nCalls = pages().length;
    await b.ev(TOP); await b.ev(TOP);
    check('L3 further up → next older pages until the thread start (all 18 earlier messages, in order)', sc.msgs.join() === all.join(), JSON.stringify({ n: sc.msgs.length }));
    check('L5 thread start: "이 대화의 시작입니다" and no more fetches (has_more = false)', sc.top === 'start' && sc.topText === '이 대화의 시작입니다' && pages().length === nCalls, JSON.stringify({ top: sc.top, calls: [nCalls, pages().length] }));
    check('L4 no duplicate messages on screen', sc.msgs.length === new Set(sc.msgs).size, '');
    check('L8/L9 current thread only: the other purchase thread of the same store never appears', !sc.text.includes('지난 발주 thread') && pages().every(c => !c.args.p_thread_id || c.args.p_thread_id === T), '');
    // L7: 새로고침 → 최근 5턴 다시 (전체 아님) + 위로 계속 가능
    mock.calls.length = 0;
    await b.open('http://zk.test/'); await b.ev(SETUP(PROD));
    sc = await b.ev(SCREEN);
    const allNow = mock.msgs.filter(m => m.thread_id === T).map(m => m.message_id);
    await b.ev(TOP);
    const sc2 = await b.ev(SCREEN);
    check('L7 refresh → latest 5 turns restored at once (incl. the new question), and upward history still works', pages()[0].args.p_turns === 5 && sc.msgs.join() === allNow.slice(-10).join() && sc2.msgs.length === 14, JSON.stringify({ first: sc.msgs.length, after: sc2.msgs.length }));
    // L10: 실패 → 보이는 안내 + 다시 시도 (스크롤로 반복 요청하지 않음)
    mock.failFn = ['zk_chat_thread_page'];
    const c0 = pages().length;
    await b.ev(TOP);
    const failed = await b.ev(SCREEN);
    await b.ev(TOP);
    const c1 = pages().length;
    mock.failFn = null;
    await b.ev(`document.querySelector('#resList [data-chat-top] button').click(); await new Promise(r => setTimeout(r, 600)); return 1`);
    const healed = await b.ev(SCREEN);
    check('L10 load failure visible ("이전 대화를 불러오지 못했습니다." + 다시 시도), no retry storm on scroll; [다시 시도] loads the page', failed.top === 'failed' && failed.topText.startsWith('이전 대화를 불러오지 못했습니다.')
      && c1 === c0 + 1 && healed.msgs.length === 18 && healed.top !== 'failed', JSON.stringify({ failed: failed.top, calls: [c0, c1], healed: healed.msgs.length }));
    // L12: 매장 전환 → 대전 대화 내려감, Store1 에서 위로 올려도 대전 thread 요청 없음
    await b.ev(`_storeEpoch++; SID = 1; _clearStoreContext(); return 1`);
    await b.ev(SETUP({ ...PROD, sid: 1 }));
    const k0 = pages().length;
    await b.ev(TOP);
    sc = await b.ev(SCREEN);
    check('L12 store switch → Daejeon history removed, Store1 asked for Store1 only, scrolling up never asks for the Daejeon thread', !sc.text.includes('제로콜라') && pages().slice(k0 - 1).every(c => c.args.p_store_id === 1 && c.args.p_thread_id !== T), JSON.stringify(pages().slice(k0 - 1).map(c => c.args)));
    // L13: 로그아웃 → 내려감·요청 없음 / 로그인 → 다시 최근 5턴
    await b.ev(`_storeEpoch++; SID = 3; _clearStoreContext(); return 1`);
    await b.ev(SETUP(PROD));
    await b.ev(`window.__tok = null; await _writerSignOut(); await new Promise(r => setTimeout(r, 300)); return 1`);
    const k1 = pages().length;
    await b.ev(TOP);
    const out = await b.ev(SCREEN);
    await b.ev(`window.__tok = 'test-token'; await _refreshPurchaseHome(_storeEpoch); await (_chat.restoring || Promise.resolve()); await new Promise(r => setTimeout(r, 300)); return 1`);
    const back = await b.ev(SCREEN);
    check('L13 logout → history removed and no page requests; login → latest 5 turns restored again', out.msgs.length === 0 && pages().slice(k1).length === 1 && back.msgs.length === 10, JSON.stringify({ out: out.msgs.length, calls: pages().slice(k1).length, back: back.msgs.length }));
    // L14: 민감정보 가림 그대로
    await b.ev(SAY('010-1234-5678 번호로 제로콜라 주문했어?')); await sleep(1900);
    const ph2 = mock.msgs.filter(m => m.role === 'HUMAN').pop();
    check('L14 sensitive data masking unchanged (phone masked before saving; no token in any body)', ph2.body === '[전화번호 가림] 번호로 제로콜라 주문했어?' && !mock.msgs.some(m => /test-token|eyJ|01[016789]-?\d{3,4}-?\d{4}/.test(m.body)), ph2.body);
    check('SEC the page only calls zk_chat_append / zk_chat_thread_page / zk_pe_scope_refs (no direct table access)', mock.calls.every(c => /^zk_(chat_append|chat_thread_page|pe_scope_refs)$/.test(c.fn)), [...new Set(mock.calls.map(c => c.fn))].join());
  } catch (e) { check('harness', false, e && e.stack || e); }
  finally { b.close(); }
  done(b.blocked);
})();
