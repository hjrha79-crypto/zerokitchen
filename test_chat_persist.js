// test_chat_persist.js — Chat Persistence V0.1 (Web 쪽 P1–P12). 서버 쪽(권한·append-only·RLS)은
// migration-packages/chat-thread-persistence-001/tests/run_chat_api.cjs (staging) 가 검사한다.
// 실제 브라우저 + 실제 입력 경로(handleNaturalInput) + 실제 홈 갱신(_refreshPurchaseHome). 채팅 RPC 는 메모리 mock, 나머지 네트워크 차단 → DB Write 0.
const fs = require('fs'), path = require('path');
const { launch, chatMock, checker, sleep } = require('./browser_harness.js');
const { check, done } = checker();
const mock = chatMock();
const R = '5ce5171f-76d0-4608-a5a0-ce8baa464aee';
const RAW = '안녕하시지요\n치즈 3박스\n우유 1박스\n휘핑크림 1박스\n콜라 2박스\n제로콜라 2박스\n스프라이트 1박스';

// 페이지 준비: 로그인 토큰 / 발주 canonical 상태(서버 응답 대신) / 품목 — 네트워크로 가지 않게 바꿔 둔다
const SETUP = (o) => `
  window.__tok = 'test-token';
  _writerToken = async () => window.__tok;
  const store = { store_id: 3, display_name: '신세계 대전점', purchasing_enabled: true, authority: ['PURCHASE_APPROVER'], delivery_profile: { status: 'ACTIVE', version: 1 } };
  const o = ${JSON.stringify(o)};
  window.__state = o;
  SID = o.sid;
  _refreshPurchase = async () => { _purchase = { loaded: true, ready: true, stores: o.sid === 3 ? [store] : [], requests: o.requests || [], sid: SID, reason: 'READY' }; return _purchase; };
  _refreshPurchaseExec = async () => { _pe.notReady = null; _pe.view = { code: 'OK', approver: true, baskets: [], attempts: [] }; _pe.current = o.cur ? { code: 'CURRENT_ACTION', action: o.cur } : null; return _pe.view; };
  _purchaseRequestOf = async (id) => id === '${R}' ? { request_id: id, store_id: 3, display_name: '신세계 대전점', raw_text: ${JSON.stringify(RAW)}, status: 'MAPPING_REQUIRED', request_version: 1,
    received_at: '2026-10-11T02:11:13Z', summary: { line_count: 6, confirmed: 5, candidate_found: 5, needs_check: 1, unresolved: 1 }, unparsed_lines: [] } : null;
  _items = [{ item_id: 1, item_name: '우유', current_qty: 1, target_qty: 3, unit: '박스', store_id: SID }];
  _chat.restored = false; _chat.restoring = null; _chat.restoringEp = -1;
  await _refreshPurchaseHome(_storeEpoch);
  await (_chat.restoring || Promise.resolve());
  await new Promise(r => setTimeout(r, 300));
  return 1;`;
const ACTIVE = { sid: 3, requests: [{ request_id: R, status: 'MAPPING_REQUIRED', unresolved: 1, line_count: 6, received_at: '2026-10-11T02:11:13Z', request_version: 1 }] };
const SAY = t => `document.getElementById('nlInput').value = ${JSON.stringify(t)}; await handleNaturalInput(); return 1`;
const SCREEN = `const l = document.getElementById('resList'); return { restored: [...l.querySelectorAll('[data-chat-restored] .v4-bubble')].map(b => (b.classList.contains('user') ? 'H:' : 'A:') + b.firstChild.textContent),
  sep: !!l.querySelector('.chat-restored-sep'), buttonsInRestored: l.querySelectorAll('[data-chat-restored] button').length, text: l.textContent, fail: !!l.querySelector('.chat-save-fail') }`;
const appends = () => mock.calls.filter(c => c.fn === 'zk_chat_append');
const store3 = () => mock.msgs.filter(m => m.store_id === 3);

(async () => {
  const b = await launch({ newHtml: fs.readFileSync(path.join(__dirname, 'index.html')), mock });
  try {
    // ── 현재 실제 대전 발주 (이 기능 전에 받은 요청 — 저장된 대화 없음) → 원문과 현재 이해로 thread 1회 시드
    await b.open('http://zk.test/');
    await b.ev(SETUP(ACTIVE));
    let sc = await b.ev(SCREEN);
    const seed = store3();
    check('P4 current Daejeon request (no saved chat yet) → thread opened once from the canonical request: original text + ZeroKitchen\'s understanding, bound to the request',
      seed.length === 2 && seed[0].role === 'HUMAN' && seed[0].body === RAW && seed[1].role === 'AGENT' && seed[1].body.startsWith('신세계 대전점 발주요청 6개를 읽었습니다.\n5개는 품목 후보를 찾았고, 1개는 확인이 필요합니다.')
      && seed.every(m => m.purchase_request_id === R && m.ref && m.ref.kind === 'RESTORED_FROM_REQUEST') && sc.restored.length === 2 && sc.sep, JSON.stringify({ seed, sc: sc.restored }));
    // ── P1 / P2 / P12 사람 입력 → 저장, 기존 해석 경로 그대로 응답 → 응답 저장 (같은 thread, 사람 먼저)
    const n0 = appends().length;
    await b.ev(SAY('배송 늦는 거 있어?')); await sleep(1900);
    const q = store3().slice(2);
    const shown = await b.ev(`const rows = [...document.querySelectorAll('#resList > .v4-chat-row:not(.user)')]; const last = rows[rows.length - 1]; return last ? _chatTextOf(last) : ''`);
    check('P1 human input saved (raw text, HUMAN, same thread, tagged with the active request)', q[0] && q[0].role === 'HUMAN' && q[0].body === '배송 늦는 거 있어?' && q[0].thread_id === seed[0].thread_id && q[0].purchase_request_id === R, JSON.stringify(q));
    check('P2 ZeroKitchen response saved once, after the human input, as the text the owner saw (no buttons / time / "표에 반영됨")', q.length === 2 && q[1].role === 'AGENT' && !!shown && q[1].body === shown
      && !/\d{1,2}:\d{2}|표에 반영됨/.test(q[1].body) && appends().length === n0 + 2, JSON.stringify({ q, shown }));
    check('P12 existing input path unchanged: the question went through handleNaturalInput and got its usual reply on screen (no inventory write path)', !!shown && !mock.calls.some(c => !/^zk_chat_/.test(c.fn)), shown);
    await b.ev(SAY('010-1234-5678 번호로 온 배송 늦는 거 있어?')); await sleep(1900);
    const ph = store3().filter(m => m.role === 'HUMAN').pop();
    check('P11 sensitive data: phone number masked before it leaves the browser; no token in any saved body', ph && ph.body === '[전화번호 가림] 번호로 온 배송 늦는 거 있어?' && !mock.msgs.some(m => /test-token|eyJ|sb_secret|01[016789]-?\d{3,4}-?\d{4}/.test(m.body)), JSON.stringify(ph));
    // 과거에 보였던 (이제는 지난) 행동 문장 하나를 같은 thread 에 넣어 둔다
    mock.handle('zk_chat_append', { p_message_id: 'aaaaaaaa-0000-4000-8000-000000000001', p_store_id: 3, p_thread_id: seed[0].thread_id, p_role: 'AGENT', p_body: '신세계 대전점 발주요청 6개 매핑 완료\n식봄·쿠팡 가격/배송을 확인할 준비가 됐습니다.', p_purchase_request_id: R });
    // ── P3 / P8 / P9 새로고침 → 같은 thread 시간순 복원; 지금 할 일은 canonical 상태(조사 중)로, 지난 문장은 기록으로만
    const before = mock.msgs.length, nApp = appends().length;
    await b.open('http://zk.test/');
    await b.ev(SETUP({ ...ACTIVE, cur: { type: 'RESEARCHING', message: '공급처를 조사하고 있어요', items: [] } }));
    sc = await b.ev(SCREEN);
    const title = await b.ev(`return document.querySelector('[data-dock="purchase"] [data-dock-title]').textContent`);
    const want = store3().map(m => (m.role === 'HUMAN' ? 'H:' : 'A:') + m.body);
    check('P3 refresh → the whole thread restored in order (original text, understanding, both questions + answers), above a "지난 대화" divider', JSON.stringify(sc.restored) === JSON.stringify(want) && sc.sep, JSON.stringify({ got: sc.restored, want }));
    check('P7 restore does not save anything again (no duplicate rows; seed not re-sent)', mock.msgs.length === before + 1 - 1 + 0 && appends().length === nApp, `msgs ${before}→${mock.msgs.length}, appends ${nApp}→${appends().length}`);
    check('P8 canonical purchase state wins: the action row says "공급처 조사 중" (server state), not the restored history', title === '신세계 대전점 발주 · 공급처 조사 중', title);
    check('P9 stale history kept but not actionable: the old "준비가 됐습니다" message is shown as history, restored bubbles have 0 buttons', sc.text.includes('식봄·쿠팡 가격/배송을 확인할 준비가 됐습니다.') && sc.buttonsInRestored === 0, `buttons=${sc.buttonsInRestored}`);
    // P7 같은 메시지 id 로 두 번 보내도 1건
    const dup = await b.ev(`const a = { p_message_id: 'bbbbbbbb-0000-4000-8000-000000000002', p_store_id: 3, p_thread_id: _chat.thread, p_role: 'HUMAN', p_body: '중복 확인', p_purchase_request_id: null, p_ref: null };
      const r1 = await _chatSend({ args: a }), r2 = await _chatSend({ args: a }); return [r1.code, r2.code]`);
    check('P7 same message id twice (retry / double tap) → saved once (APPENDED, then DUPLICATE)', dup.join() === 'APPENDED,DUPLICATE' && mock.msgs.filter(m => m.body === '중복 확인').length === 1, dup.join());
    // ── P5 매장 전환 → 그 매장의 thread (대전 대화는 화면에서 내려가고 섞이지 않는다)
    await b.ev(`_storeEpoch++; SID = 1; _clearStoreContext(); return 1`);
    await b.ev(SETUP({ sid: 1, requests: [] }));
    sc = await b.ev(SCREEN);
    const threadCall = mock.calls.filter(c => c.fn === 'zk_chat_thread_page').pop();
    await b.ev(SAY('배송 늦는 거 있어?')); await sleep(1900);
    const s1 = mock.msgs.filter(m => m.store_id === 1);
    check('P5 store switch → Store1 thread asked for Store1; no Daejeon messages on screen; Store1 input saved to its own thread', threadCall.args.p_store_id === 1 && !sc.text.includes('치즈 3박스')
      && s1.length === 2 && s1.every(m => m.thread_id !== store3()[0].thread_id && !m.purchase_request_id), JSON.stringify({ threadCall: threadCall.args, s1 }));
    // ── P6 로그아웃 → 화면에서 내림, 저장 안 함 / 다시 로그인 → 복원
    await b.ev(`await _storeEpoch; _storeEpoch++; SID = 3; _clearStoreContext(); return 1`);
    await b.ev(SETUP(ACTIVE));
    await b.ev(`window.__tok = null; await _writerSignOut(); await new Promise(r => setTimeout(r, 300)); return 1`);
    const out = await b.ev(SCREEN);
    await b.ev(`window.__tok = 'test-token'; await _refreshPurchaseHome(_storeEpoch); await (_chat.restoring || Promise.resolve()); await new Promise(r => setTimeout(r, 200)); return 1`);
    const back = await b.ev(SCREEN);
    check('P6 logout → restored chat removed from the screen; login again → the same thread restored', out.restored.length === 0 && !out.text.includes('치즈 3박스') && back.restored.length === store3().length, JSON.stringify({ out: out.restored.length, back: back.restored.length, want: store3().length }));
    // ── P10 저장 실패는 보인다: [다시 시도] → 같은 id 로 저장, 실패 안내는 대화로 저장하지 않는다
    mock.fail = true;
    const nf = mock.msgs.length;
    await b.ev(SAY('배송 늦는 거 있어?')); await sleep(5200);
    const fail = await b.ev(SCREEN);
    const failText = await b.ev(`return document.querySelector('#resList .chat-save-fail')?.textContent || ''`);
    mock.fail = false;
    await b.ev(`document.querySelector('#resList .chat-save-fail button').click(); await _chat.chain; await new Promise(r => setTimeout(r, 400)); return 1`);
    const healed = await b.ev(SCREEN);
    const after = mock.msgs.slice(nf);
    check('P10 save failure is visible ("대화를 저장하지 못했습니다. 다시 시도해주세요." + 다시 시도) → retry saves human + response once; the notice itself is never saved',
      fail.fail && failText.startsWith('대화를 저장하지 못했습니다. 다시 시도해주세요.') && !healed.fail && after.length === 2 && after[0].role === 'HUMAN' && after[1].role === 'AGENT'
      && !mock.msgs.some(m => m.body.includes('저장하지 못했습니다')), JSON.stringify({ fail: fail.fail, failText, healed: healed.fail, after }));
    // 서버 함수만 부른다 (테이블 직접 접근 없음)
    check('SEC the page only calls zk_chat_append / zk_chat_thread_page (no direct table access), always with the signed-in token', mock.calls.every(c => /^zk_chat_(append|thread_page)$/.test(c.fn)), [...new Set(mock.calls.map(c => c.fn))].join());
  } catch (e) { check('harness', false, e && e.stack || e); }
  finally { b.close(); }
  done(b.blocked);
})();
