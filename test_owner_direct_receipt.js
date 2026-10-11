// test_owner_direct_receipt.js — OWNER_DIRECT_RECEIPT_CURRENT_ACTION_FIX V0.1 (Web side of C1–C12). 실제 브라우저 + 실제 홈 요청 줄 / 현재 행동 카드.
// 서버 응답 모양 = owner-direct-current-action-001 의 zk_vl_current_action (staging 에서 실제 3개 주문으로 확인한 값과 같은 모양: 주문 130–136).
// 서버로는 아무것도 보내지 않는다 (네트워크 기록 + _pePost stub).
const fs = require('fs'), path = require('path');
const { launch, checker } = require('./browser_harness.js');
const { check, done } = checker();
const RID = '5ce5171f-76d0-4608-a5a0-ce8baa464aee';
const O = (id, name, q, unit, sup, ref, product, pq, pu, kind) => ({ order_id: id, name, ordered_qty: q, unit, received_qty: 0, remaining: q, delivery_status: null,
  supplier: sup, external_order_ref: ref, product_name: product, purchased_qty: pq, purchased_unit: pu, match_kind: kind });
const ORDERS = [O(130, '치즈', 3, '박스', 'SIKBOM', 'MPLC44160731087', '도노쉐프 피자치즈 (냉장 모짜렐라99%, 2.5Kg)', 12, '봉', 'EXACT_SKU'),
  O(131, '우유', 1, '박스', 'COUPANG', '1103541133670', '믈레코비타 3.5% 멸균우유, 1L, 12개', 1, '박스', 'EXACT_SKU'),
  O(132, '휘핑크림', 0.5, '박스', 'COUPANG', '1103541133670', '올덴버거 휘핑크림, 1L, 5개', 5, '개', 'SKU_RESOLVED'),
  O(133, '휘핑크림', 0.5, '박스', 'COUPANG', '1103541349740', '올덴버거 휘핑크림, 1L, 5개', 5, '개', 'SKU_RESOLVED'),
  O(134, '콜라', 2, '박스', 'SIKBOM', 'MPLC44160731087', '코카콜라 콜라 (업소용 355ml*24EA/BOX) 뚱캔', 2, '박스', 'EXACT_SKU'),
  O(135, '제로콜라', 2, '박스', 'SIKBOM', 'MPLC44160731087', '코카콜라 제로콜라 (업소용 355ml*24EA/BOX) 뚱캔', 2, '박스', 'SKU_RESOLVED'),
  O(136, '스프라이트', 1, '박스', 'COUPANG', '1103541133670', '스프라이트 캔, 350ml, 24개', 1, '박스', 'SUBSTITUTION_APPROVED')];
const CUR = { code: 'CURRENT_ACTION',
  purchase: { status: 'PURCHASE_COMPLETED', source: 'OWNER_DIRECT_ORDER', lines: 6, paid_total_krw: 426059,
    orders: [{ supplier: 'SIKBOM', external_order_ref: 'MPLC44160731087', paid_total_krw: 307639 }, { supplier: 'COUPANG', external_order_ref: '1103541133670', paid_total_krw: 76870 },
      { supplier: 'COUPANG', external_order_ref: '1103541349740', paid_total_krw: 41550 }] },
  action: { type: 'RECEIPT', message: '주문 완료 · 배송을 기다리는 중입니다. 받으면 알려 주세요.', delivered: false, orders: ORDERS, stock_note: '현재 재고는 아직 확인되지 않았습니다.',
    order_completed: true, receipt_completed: false, request_ref: { request_id: RID, request_version: 3 } } };
const STORE = { store_id: 3, display_name: '신세계 대전점', delivery_profile: { status: 'ACTIVE', version: 2 } };
const REQS = [{ request_id: RID, status: 'READY_FOR_RESEARCH', received_at: '2026-10-11T02:11:13Z', line_count: 6, unresolved: 0, request_version: 3 }];

(async () => {
  const b = await launch({ newHtml: fs.readFileSync(path.join(__dirname, 'index.html')) });
  try {
    await b.open('http://zk.test/');
    await b.ev(`window.__net = []; const rf = window.fetch.bind(window); window.fetch = (u, i) => { if (/purchase|rpc/.test(String(u)) && !String(u).includes('/rpc/zk_chat_')) window.__net.push(String(u)); return rf(u, i); };
      window.__posts = []; _pePost = async (action, fields) => { window.__posts.push({ action, ...fields }); return action === 'START_PURCHASE_RESEARCH' ? { code: 'ALREADY_PURCHASED' } : { code: 'RECEIPT_RECORDED' }; };
      _refreshPurchaseHome = async () => {}; window.__toasts = []; showToast = (m) => window.__toasts.push(m); return 1`);
    const home = async cur => b.ev(`_pe.current = ${JSON.stringify(cur)}; const d = document.createElement('div'); d.innerHTML = _purchaseHomeHtml(${JSON.stringify(STORE)}, ${JSON.stringify(REQS)});
      const row = d.querySelector('[data-pr-row]'); return { text: row ? row.textContent.replace(/\\s+/g, ' ').trim() : '', buttons: [...d.querySelectorAll('button')].map(x => x.textContent.trim()) }`);
    // C1 / C4 / C8: 구매가 끝난 요청 → 조사 버튼 없음
    const h1 = await home(CUR);
    check('C4/C8 home row of the bought request: "주문 완료 · 배송/입고 대기", NO [공급처 조사 시작] / [품목 확인하기]', /주문 완료 · 배송\/입고 대기/.test(h1.text) && !h1.buttons.some(t => /공급처 조사|품목 확인/.test(t)), JSON.stringify(h1));
    // C6 regression: 아직 구매 전 (서버가 research-ready) → 기존과 같이 [공급처 조사 시작]
    const h2 = await home({ code: 'CURRENT_ACTION', action: { type: 'RESEARCH_READY', message: '공급처 조사를 시작할 수 있어요.', request_ref: { request_id: RID, request_version: 3 } } });
    check('C6 a request not bought yet keeps [공급처 조사 시작] (unchanged)', h2.buttons.includes('공급처 조사 시작'), JSON.stringify(h2));
    // C7: 다른 요청의 RECEIPT 는 이 요청을 "주문 완료"로 만들지 않는다
    const h3 = await home({ ...CUR, action: { ...CUR.action, request_ref: { request_id: '49e03d8e-dc51-49c4-a320-90bf80db3dd4', request_version: 1 } } });
    check('C7 a RECEIPT of ANOTHER request (e.g. the old certification) does not mark this one bought', h3.buttons.includes('공급처 조사 시작') && !/주문 완료/.test(h3.text), JSON.stringify(h3));
    // C2 / C9: 현재 행동 카드
    const card = await b.ev(`const d = document.createElement('div'); d.innerHTML = _peCurrentHtml({ approver: true, attempts: [] }, ${JSON.stringify(CUR)}); document.body.appendChild(d);
      return { head: d.querySelector('[data-pe-head]').textContent, sum: (d.querySelector('[data-pe-purchase-summary]') || {}).textContent || '', rows: [...d.querySelectorAll('[data-pe-rcv]')].map(e => e.textContent),
        bought: [...d.querySelectorAll('[data-pe-bought-line]')].map(e => e.textContent), detailsOpen: d.querySelector('[data-pe-bought]') && d.querySelector('[data-pe-bought]').open,
        summary: (d.querySelector('[data-pe-bought] summary') || {}).textContent, buttons: [...d.querySelectorAll('button')].map(x => x.textContent.trim()), note: (d.querySelector('[data-pe-stock-note]') || {}).textContent, text: d.textContent }`);
    check('C2 current card: "주문 완료 · 배송을 기다리는 중입니다. 받으면 알려 주세요." + "식봄 주문 1건 · 쿠팡 주문 2건 · 6개 품목 · 총 426,059원" (not delivered → no "받았어요"-done wording)',
      card.head === '주문 완료 · 배송을 기다리는 중입니다. 받으면 알려 주세요.' && card.sum === '식봄 주문 1건 · 쿠팡 주문 2건 · 6개 품목 · 총 426,059원' && !/모두 받았어요/.test(card.text), JSON.stringify({ head: card.head, sum: card.sum }));
    check('C3/C9 7 receipt rows in the order unit, readable (0.5 not 0.50000…, 3 not 3.0000…)', card.rows.length === 7 && card.rows[0] === '치즈 3박스 중 0 받음 · 남은 3박스'
      && card.rows.filter(r => r === '휘핑크림 0.5박스 중 0 받음 · 남은 0.5박스').length === 2 && !card.rows.some(r => /\d\.\d{3,}/.test(r)), JSON.stringify(card.rows));
    check('C9 [주문 내역 보기] (closed) = what was bought: 치즈 · 식봄 · 도노쉐프 … · 12봉 / 휘핑크림 · 쿠팡 · 올덴버거 휘핑크림, 1L, 5개 · 5개 ×2 / 스프라이트 … (대체 승인) / 제로콜라 · 식봄 · 코카콜라 제로콜라 …',
      card.summary === '주문 내역 보기' && card.detailsOpen === false && card.bought.length === 7 && card.bought[0] === '치즈 · 식봄 · 도노쉐프 피자치즈 (냉장 모짜렐라99%, 2.5Kg) · 12봉'
      && card.bought.filter(t => t === '휘핑크림 · 쿠팡 · 올덴버거 휘핑크림, 1L, 5개 · 5개').length === 2 && card.bought.some(t => t === '스프라이트 · 쿠팡 · 스프라이트 캔, 350ml, 24개 · 1박스 (대체 승인)')
      && card.bought.some(t => /^제로콜라 · 식봄 · 코카콜라 제로콜라/.test(t)), JSON.stringify(card.bought));
    check('C10 receipt policy unchanged: [전부 받았어요] / [일부만 받았어요] (physical confirmation asked on click), stock stays "현재 재고는 아직 확인되지 않았습니다."',
      card.buttons.join('|') === '전부 받았어요|일부만 받았어요' && card.note === '현재 재고는 아직 확인되지 않았습니다.', JSON.stringify(card.buttons));
    check('C12 rendering sends nothing (0 network calls, 0 server actions)', (await b.ev(`return window.__net.length + window.__posts.length`)) === 0, '');
    // 일부 수령 입력창: 산 단위도 함께
    const pr = await b.ev(`_pe.current = ${JSON.stringify(CUR)}; window.__prompts = []; window.prompt = m => { window.__prompts.push(m); return ''; };
      await _peReceivePartial(); return window.__prompts`);
    check('C9 partial-receipt prompt shows the bought unit too: "휘핑크림 — 받은 수량 (남은 0.5박스 = 5개)…", 치즈 "(남은 3박스 = 12봉)"; nothing sent when left empty',
      pr.filter(p => p.startsWith('휘핑크림 — 받은 수량 (남은 0.5박스 = 5개)')).length === 2 && pr.some(p => p.startsWith('치즈 — 받은 수량 (남은 3박스 = 12봉)'))
      && (await b.ev(`return window.__posts.length`)) === 0, JSON.stringify(pr));
    // C8: 다른 경로(채팅 버튼 등)로 조사 시작을 눌러도 서버가 거절 → 정직한 안내
    await b.ev(`_purchase.requests = ${JSON.stringify(REQS)}; await _purchaseResearchStart('${RID}'); return 1`);
    const t = await b.ev(`return window.__toasts`);
    check('C8 a research start from any other entry → server ALREADY_PURCHASED → "이미 주문이 끝난 요청이에요 — 다시 조사하지 않습니다 …"', t.some(x => x.startsWith('이미 주문이 끝난 요청이에요 — 다시 조사하지 않습니다')), JSON.stringify(t));
  } catch (e) { check('harness', false, e && e.stack || e); }
  finally { b.close(); }
  done(b.blocked);
})();
