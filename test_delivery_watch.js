// test_delivery_watch.js — STORE3_DELIVERY_WATCH V0.1 (Web side: DW8 / DW9 / DW12 / DW15 display, the 5-minute home re-check, chat notes without reload).
// 실제 브라우저 + 실제 index.html. 서버 응답 모양 = store3-delivery-watch-001 의 zk_vl_current_action / zk_dw_chat (staging 에서 실제 3개 주문으로 확인).
// 채팅 RPC 는 browser_harness 의 메모리 mock (서버와 같은 규칙). 그 밖의 네트워크는 차단 → DB Write 0.
const fs = require('fs'), path = require('path');
const { launch, checker, chatMock } = require('./browser_harness.js');
const { check, done } = checker();
const RID = '5ce5171f-76d0-4608-a5a0-ce8baa464aee', T = '7a4a5b0e-1111-4222-8333-944455556666';
const REQS = [{ request_id: RID, status: 'READY_FOR_RESEARCH', received_at: '2026-10-11T02:11:13Z', line_count: 6, unresolved: 0, request_version: 3 }];
const STORE = { store_id: 3, display_name: '신세계 대전점', delivery_profile: { status: 'ACTIVE', version: 2 } };
const ORDERS = [{ order_id: 130, name: '치즈', ordered_qty: 3, unit: '박스', received_qty: 0, remaining: 3, delivery_status: 'DELIVERED', supplier: 'SIKBOM', product_name: '도노쉐프 피자치즈', purchased_qty: 12, purchased_unit: '봉' }];
const PURCHASE = { status: 'PURCHASE_COMPLETED', source: 'OWNER_DIRECT_ORDER', lines: 6, paid_total_krw: 426059, orders: [{ supplier: 'SIKBOM' }, { supplier: 'COUPANG' }, { supplier: 'COUPANG' }] };
const cur = (type, extra) => ({ code: 'CURRENT_ACTION', purchase: PURCHASE, action: { type, request_ref: { request_id: RID, request_version: 3 }, ...extra } });
const PARTIAL = cur('RECEIPT', { message: '일부 주문이 배송완료됐어요 · 나머지 배송 대기', delivered: false, orders: ORDERS, delivery: { total: 3, delivered: 2, in_transit: 0, preparing: 1, attention: 0 } });
const ALL = cur('RECEIPT', { message: '배송완료로 확인됐어요. 실제로 받았나요?', delivered: true, orders: ORDERS, delivery: { total: 3, delivered: 3, in_transit: 0, preparing: 0, attention: 0 } });
const ATTN = cur('DELIVERY_ACTION_REQUIRED', { title: '주문 상태 확인이 필요합니다.', message: '쿠팡 주문 1103541349740: 취소·환불로 보여요', context: '공급처 화면에서 직접 확인해 주세요. 자동으로 받음 처리하지 않습니다.',
  delivery: { total: 3, delivered: 2, attention: 1 } });

(async () => {
  const mock = chatMock();
  // the request's existing thread: the owner's message + an earlier agent reply (already on screen after restore)
  const seed = (role, body, ref) => mock.handle('zk_chat_append', { p_message_id: require('crypto').randomUUID(), p_store_id: 3, p_thread_id: T, p_role: role, p_body: body, p_purchase_request_id: RID, p_ref: ref || null });
  seed('HUMAN', '발주 부탁합니다'); seed('AGENT', '신세계 대전점 발주요청 6개 매핑 완료');
  const b = await launch({ newHtml: fs.readFileSync(path.join(__dirname, 'index.html')), mock });
  try {
    await b.open('http://zk.test/');
    await b.ev(`SID = 3; _writerToken = async () => 'test-token'; _purchase.sid = 3; _purchase.requests = ${JSON.stringify(REQS)};
      _refreshPurchaseHome = async () => { window.__home = (window.__home || 0) + 1; };
      const r = await _chatRpc('zk_chat_thread_page', { p_store_id: 3, p_purchase_request_id: '${RID}', p_turns: 5 }); _chatRenderRestored(r.messages || []); return (r.messages || []).length`);
    // DW8 / DW9: the receipt card shows the 3-order delivery summary
    const card = async c => b.ev(`const d = document.createElement('div'); d.innerHTML = _peCurrentHtml({ approver: true, attempts: [] }, ${JSON.stringify(c)});
      return { head: (d.querySelector('[data-pe-head]') || {}).textContent, dv: (d.querySelector('[data-pe-delivery]') || {}).textContent || '', buttons: [...d.querySelectorAll('button')].map(x => x.textContent.trim()), text: d.textContent.replace(/\\s+/g, ' ') }`);
    const p = await card(PARTIAL), a = await card(ALL);
    check('DW8 2 of 3 delivered: "일부 주문이 배송완료됐어요 · 나머지 배송 대기" + "배송 확인: 3건 중 2건 배송완료"', p.head === '일부 주문이 배송완료됐어요 · 나머지 배송 대기' && p.dv === '배송 확인: 3건 중 2건 배송완료', p);
    check('DW9 3 of 3: "배송완료로 확인됐어요. 실제로 받았나요?" + 3건 중 3건 + the EXISTING [전부 받았어요] / [일부만 받았어요]', a.head === '배송완료로 확인됐어요. 실제로 받았나요?' && a.dv === '배송 확인: 3건 중 3건 배송완료'
      && a.buttons.join('|') === '전부 받았어요|일부만 받았어요', a);
    // DW12: the attention card (one current action), the request row keeps NO research button
    const at = await b.ev(`_pe.current = ${JSON.stringify(ATTN)}; _pe.notReady = null; const d = document.createElement('div'); d.innerHTML = _purchaseExecHtml({ approver: true, baskets: [], attempts: [] });
      const h = document.createElement('div'); h.innerHTML = _purchaseHomeHtml(${JSON.stringify(STORE)}, ${JSON.stringify(REQS)});
      return { head: (d.querySelector('[data-pe-head]') || {}).textContent, text: d.textContent.replace(/\\s+/g, ' '), buttons: [...d.querySelectorAll('button')].length,
        row: (h.querySelector('[data-pr-row]') || {}).textContent.replace(/\\s+/g, ' ').trim(), rowButtons: [...h.querySelectorAll('button')].map(x => x.textContent.trim()) }`);
    check('DW12 cancellation / unclear → one card "주문 상태 확인이 필요합니다." + "쿠팡 주문 1103541349740: 취소·환불로 보여요" + "…자동으로 받음 처리하지 않습니다." (no receipt buttons)',
      at.head === '주문 상태 확인이 필요합니다.' && /1103541349740: 취소·환불로 보여요/.test(at.text) && /자동으로 받음 처리하지 않습니다/.test(at.text) && at.buttons === 0, at);
    check('DW12 the request row stays "주문 완료 · 배송/입고 대기" with NO [공급처 조사 시작] (a delivery problem never reopens buying)', /주문 완료 · 배송\/입고 대기/.test(at.row) && !at.rowButtons.some(t => /공급처 조사|품목 확인/.test(t)), at);
    // DW15 + no reload: a server watch note appears in the open page exactly once
    const before = await b.ev(`return document.querySelectorAll('#resList [data-chat-msg]').length`);
    seed('AGENT', '3건 중 2건이 배송완료됐어요.\n나머지 1건을 기다리고 있습니다.', { kind: 'DELIVERY_WATCH', summary: { total: 3, delivered: 2 } });
    seed('AGENT', '다른 기기에서 보낸 일반 답변', null);   // not a watch note → left to the normal restore
    const n1 = await b.ev(`return await _chatPollNew()`), n2 = await b.ev(`return await _chatPollNew()`);
    const rows = await b.ev(`return [...document.querySelectorAll('#resList [data-chat-msg]')].map(e => e.textContent.replace(/\\s+/g, ' ').trim())`);
    check('DW15 / no reload: the watch note of THIS request appears once ("3건 중 2건이 배송완료됐어요. …"); a second check adds nothing; a non-watch message is not injected',
      n1 === 1 && n2 === 0 && rows.length === before + 1 && rows.some(t => t.includes('3건 중 2건이 배송완료됐어요.')) && !rows.some(t => t.includes('다른 기기에서')), JSON.stringify({ n1, n2, before, rows }));
    // the 5-minute re-check: scheduled only while waiting for delivery / receipt; a hidden tab does no network
    const sched = await b.ev(`const calls = []; const st = window.setTimeout; window.setTimeout = (fn, ms) => { calls.push({ fn, ms }); return 1; };
      _pe.poll = null; window.__home = 0; mock_polls = 0; const cp = _chatPollNew; _chatPollNew = async () => { mock_polls++; return 0; };
      _peWatchPoll(); const first = calls.length && calls[0].ms;
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); _pe.poll = null; await calls[0].fn();
      const hiddenHome = window.__home, hiddenPolls = mock_polls, rescheduled = calls.length;
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); _pe.poll = null; await calls[calls.length - 1].fn();
      window.setTimeout = st; _chatPollNew = cp; return { first, hiddenHome, hiddenPolls, rescheduled, visibleHome: window.__home, visiblePolls: mock_polls }`);
    check('POLL every 5 min (300000 ms) while waiting: a hidden tab → no network, just the next tick; a visible tab → home refresh + chat note check', sched.first === 300000 && sched.hiddenHome === 0
      && sched.hiddenPolls === 0 && sched.rescheduled === 2 && sched.visibleHome === 1 && sched.visiblePolls === 1, sched);
    const where = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
    check('POLL only for RECEIPT / DELIVERY_ACTION_REQUIRED (no new realtime subsystem: no WebSocket / EventSource / supabase channel added)', /const _PE_WATCH_POLL = \['RECEIPT', 'DELIVERY_ACTION_REQUIRED'\];/.test(where)
      && !/new WebSocket|new EventSource|\.channel\(/.test(where), '');
  } catch (e) { check('harness', false, e && e.stack || e); }
  finally { b.close(); }
  done(b.blocked);
})();
