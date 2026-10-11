// test_chat_dock.js — Home Focus V0.1 (H1–H6) + 접힘 동작 (Chat Workspace Collapse V0.1)
// 실제 브라우저(headless Edge/Chrome)에서 index.html 을 연다. 네트워크 차단 → DB Write 0.
// 홈 상단 = 현재 action 한 줄 (+ 기타 정보 한 줄). 진행 중인 발주가 있으면 그 발주가 첫 줄, "할 일 없음" 줄과 동시에 보이지 않는다.
const fs = require('fs'), path = require('path');
const { launch, oldHtml, checker } = require('./browser_harness.js');
const { check, done } = checker();
const NEW = fs.readFileSync(path.join(__dirname, 'index.html')), OLD = oldHtml(__dirname);

// fixtures: 실제 렌더 함수와 실제 상태 변수로 그린다 (발주 = _purchase / _pe, 오늘 할 일 / 재고 확인 / 발주표 / 재고·목표)
const FX = `
  const R = '5ce5171f-76d0-4608-a5a0-ce8baa464aee';
  const store = { store_id: 3, display_name: '신세계 대전점', purchasing_enabled: true, authority: ['PURCHASE_APPROVER'], delivery_profile: { status: 'ACTIVE', version: 1 } };
  window.__store = store; window.__R = R;
  window.__fill = (o) => {
    SID = o.sid || 3;
    _purchase = { loaded: true, ready: true, stores: o.purchaseStore === false ? [] : [store], requests: o.requests || [], sid: SID, reason: 'READY' };
    _pe = { view: o.view || null, notReady: null, current: o.cur ? { code: 'CURRENT_ACTION', action: o.cur } : null };
    const ph = document.getElementById('purchaseHome');
    ph.innerHTML = o.purchaseStore === false ? '' : _purchaseHomeHtml(store, _purchase.requests) + (o.cur ? _peCurrentHtml(_pe.view || {}, _pe.current) : '') + (o.attemptHtml || '');
    const ah = document.getElementById('agentHome');
    ah.innerHTML = o.today ? '<div class="agent-home"><div class="agent-sum">오늘 할 일 ' + o.today + '개</div>' + Array.from({ length: o.today }, (_, i) => '<div class="agent-card" data-agent-type="ORDER_NOW"><button class="agent-btn" onclick="void 0">주문 준비</button> 품목' + i + '</div>').join('') + '</div>'
      : '<div class="agent-home"><div class="agent-sum agent-none">오늘은 바로 처리할 일이 없습니다.</div></div>';
    ah.dataset.today = String(o.today || 0);
    document.getElementById('agentChecks').innerHTML = o.checks ? '<div class="agent-home" data-agent-checks="' + o.checks + '">' + Array.from({ length: o.checks }, (_, i) => '<div class="agent-card" data-agent-type="CHECK_STOCK">확인' + i + '</div>').join('') + '</div>' : '';
    document.getElementById('orderList').innerHTML = o.sheet ? '<table><tbody id="otBody">' + Array.from({ length: o.sheet }, (_, i) => '<tr data-iid="' + (i + 1) + '"><td>품목' + i + '</td><td><button onclick="void 0">수정</button></td></tr>').join('') + '</tbody></table>' : '<div class="v4-empty-hint home-sheet-empty">발주표가 비어 있어요</div>';
    document.getElementById('orderNeedCard').innerHTML = '<div class="card">재고·목표 표</div>';
  };
  // 지금 대전점 화면: 새 발주요청(제로콜라만 확인 필요) + 지난 실행의 "결제 전 중단" 카드 + 할 일 없음
  window.__daejeon = { requests: [{ request_id: R, status: 'MAPPING_REQUIRED', unresolved: 1, line_count: 6, received_at: '2026-10-11T02:11:13Z', request_version: 1 }],
    attemptHtml: '<div class="card" data-pe-attempt="a1" data-pe-state="ABORTED"><div style="font-weight:700" data-pe-head>결제 전 중단 — 결제되지 않았습니다</div></div>', today: 0, checks: 0, sheet: 0 };
  return 1;`;
const STATE = `
  return [...document.querySelectorAll('#homeDock .dock-sec')].map(s => ({ k: s.dataset.dock, shown: !s.hidden, open: s.querySelector('.dock-hdr').getAttribute('aria-expanded') === 'true',
    title: s.querySelector('[data-dock-title]').textContent, action: s.classList.contains('dock-action'), empty: s.classList.contains('dock-empty') }));`;
const settle = `await new Promise(r => setTimeout(r, 30)); `;
const visible = s => s.filter(x => x.shown);
const openK = s => s.filter(x => x.open).map(x => x.k).join();

(async () => {
  const b = await launch({ newHtml: NEW, old: OLD });
  try {
    await b.open('http://zk.test/');
    let s = await b.ev(STATE);
    check('U1 fresh load / reload: every row collapsed (aria-expanded=false)', s.length === 3 && s.every(x => !x.open), JSON.stringify(s));
    await b.ev(FX);
    // ── H1 진행 중인 발주 → 첫 줄 = 그 발주 한 줄 (지난 실행 카드 제목이 아니라 canonical 상태로)
    await b.ev(`_dockReset(); __fill(__daejeon); ${settle} return 1`);
    s = await b.ev(STATE);
    const vis = visible(s);
    check('H1 active purchase → first row = "신세계 대전점 발주 · 품목 확인 필요 1개" (not the stale "결제 전 중단" card head); persistent rows ≤ 2',
      vis[0] && vis[0].k === 'purchase' && vis[0].title === '신세계 대전점 발주 · 품목 확인 필요 1개' && vis.length <= 2, JSON.stringify(s));
    // ── H2 현재 action 이 있으면 "오늘은 바로 처리할 일이 없습니다" 는 어디에도 보이지 않는다
    const h2 = await b.ev(`document.querySelector('[data-dock="other"] .dock-hdr').click(); ${settle}
      const txt = [...document.querySelectorAll('#homeDock *')].filter(e => e.offsetParent !== null && e.children.length === 0).map(e => e.textContent).join('|');
      return { hasNone: txt.includes('바로 처리할 일이 없습니다'), todayRow: !document.querySelector('[data-dock="today"]').hidden }`);
    check('H2 active action → "오늘은 바로 처리할 일이 없습니다" hidden (no row, not inside 기타 정보 either)', !h2.hasNone && !h2.todayRow, JSON.stringify(h2));
    // ── H3 재고·목표는 상시 줄이 아니라 기타 정보 안
    const h3 = await b.ev(`const sec = document.getElementById('orderNeedCard').closest('.dock-sec'); return { in: sec && sec.dataset.dock, rows: [...document.querySelectorAll('#homeDock .dock-sec:not([hidden]) [data-dock-title]')].map(t => t.textContent) }`);
    check('H3 재고·목표 is not a persistent row — it lives inside "기타 정보"', h3.in === 'other' && !h3.rows.some(t => t.includes('재고·목표')), JSON.stringify(h3));
    // ── H4 진행 중인 발주가 없으면: 빈 상태 한 줄 (펼칠 것 없음) + 기타 정보
    await b.ev(`_dockReset(); __fill({ sid: 1, purchaseStore: false, today: 0, checks: 0, sheet: 0 }); ${settle} return 1`);
    s = await b.ev(STATE);
    await b.ev(`document.querySelector('[data-dock="today"] .dock-hdr').click(); ${settle} return 1`);
    const s4 = await b.ev(STATE);
    check('H4 no active action → empty state "오늘은 바로 처리할 일이 없습니다" (not expandable) + 기타 정보; nothing open', visible(s).map(x => x.k).join() === 'today,other'
      && s[1].title === '오늘은 바로 처리할 일이 없습니다' && s[1].empty && openK(s4) === '', JSON.stringify(s4));
    await b.ev(`_dockReset(); __fill({ sid: 1, purchaseStore: false, today: 3, checks: 10, sheet: 2 }); ${settle} return 1`);
    s = await b.ev(STATE);
    check('H4b no purchase, 3 tasks → "오늘 할 일 3개" first row + 기타 정보 (재고 확인 / 발주표 / 재고·목표 inside); 2 rows', visible(s).map(x => x.k + ':' + x.title).join() === 'today:오늘 할 일 3개,other:기타 정보'
      && await b.ev(`return [...document.querySelectorAll('[data-dock-sub]:not([hidden])')].map(d => d.textContent).join()`) === '재고 확인 필요 10개,발주표 2건,재고·목표', JSON.stringify(s));
    // ── H5 ONE CURRENT ACTION: 사람 행동이 있는 발주 줄 하나만 자동으로 펼침, 사람이 접으면 그대로, 새 행동이면 다시
    await b.ev(`_dockReset(); __fill({ ...__daejeon, today: 3, checks: 10, sheet: 2 }); ${settle} return 1`);
    const h5a = openK(await b.ev(STATE));
    await b.ev(`document.querySelector('[data-dock="purchase"] .dock-hdr').click(); __fill({ ...__daejeon, today: 3, checks: 10, sheet: 2 }); ${settle} return 1`);
    const h5b = openK(await b.ev(STATE));
    await b.ev(`__fill({ requests: [{ ...__daejeon.requests[0], status: 'READY_FOR_RESEARCH' }], cur: { type: 'PAYMENT_EXCEPTION_DECISION', title: '결제수단을 선택해 주세요', decision_ref: { exception_id: 'e1' }, options: [{ option_id: 'o1', label: '주문 중단', enabled: true }] }, view: { approver: true }, today: 3 }); ${settle} return 1`);
    s = await b.ev(STATE);
    check('H5 one current action auto-expands (purchase only); owner-collapsed stays collapsed; a new action re-opens only it', h5a === 'purchase' && h5b === '' && openK(s) === 'purchase'
      && s[0].title === '신세계 대전점 발주 · 결제수단을 선택해 주세요' && s[0].action, JSON.stringify({ h5a, h5b, s }));
    // 상태 문장: 기술 enum 노출 금지
    const phr = [];
    for (const cur of ["{ type: 'RESEARCHING', message: 'x' }", "{ type: 'RECEIPT', message: 'x', orders: [] }", "{ type: 'OUTCOME_CHECK' }", "{ type: 'SOMETHING_NEW_FROM_SERVER' }"]) {
      await b.ev(`_dockReset(); __fill({ requests: [], cur: ${cur}, view: {} }); ${settle} return 1`);
      phr.push((await b.ev(STATE))[0].title);
    }
    check('H5b state phrases are Korean, no enum: 조사 중 / 받은 수량 / 결과 확인 / unknown → 확인할 일 1개', phr.join('|') === '신세계 대전점 발주 · 공급처 조사 중|신세계 대전점 발주 · 받은 수량 확인 필요|신세계 대전점 발주 · 주문 결과 확인 중|신세계 대전점 발주 · 확인할 일 1개'
      && !phr.some(t => /[A-Z]{3,}_[A-Z]/.test(t)), phr.join('|'));
    // 조사 중: 요청 줄에 남은 [공급처 조사 시작] 버튼보다 서버의 현재 상태가 먼저, 사람 할 일이 아니므로 자동으로 펼치지 않는다
    await b.ev(`_dockReset(); __fill({ requests: [{ ...__daejeon.requests[0], status: 'READY_FOR_RESEARCH' }], cur: { type: 'RESEARCHING', message: '공급처를 조사하고 있어요', items: [] }, view: {} }); ${settle} return 1`);
    s = await b.ev(STATE);
    check('H5c research running (row still has [공급처 조사 시작]) → "공급처 조사 중" from the server state, not auto-opened, not highlighted', s[0].title === '신세계 대전점 발주 · 공급처 조사 중' && openK(s) === '' && !s[0].action, JSON.stringify(s));
    // ── 접힘 동작 (V0.1 회귀): 클릭 / 아코디언 / 키보드 / 다른 곳에서 이동 / 매장 전환
    await b.ev(`_dockReset(); __fill({ sid: 1, purchaseStore: false, today: 3, checks: 10, sheet: 2 }); ${settle} document.querySelector('[data-dock="today"] .dock-hdr').click(); return 1`);
    const c1 = openK(await b.ev(STATE));
    await b.ev(`document.querySelector('[data-dock="other"] .dock-hdr').click(); return 1`);
    const c2 = openK(await b.ev(STATE));
    await b.ev(`_dockOpen(null); return 1`); await b.key('[data-dock="other"] .dock-hdr', 'Enter'); const k1 = openK(await b.ev(STATE)); await b.key('[data-dock="other"] .dock-hdr', ' '); const k2 = openK(await b.ev(STATE));
    const aria = await b.ev(`return [...document.querySelectorAll('#homeDock .dock-hdr')].every(h => h.tagName === 'BUTTON' && document.getElementById(h.getAttribute('aria-controls')) === h.parentElement.querySelector('.dock-panel'))`);
    check('U4-U6 click expands, accordion keeps one open, Enter/Space toggle, aria-controls → panel', c1 === 'today' && c2 === 'other' && k1 === 'other' && k2 === '' && aria, JSON.stringify({ c1, c2, k1, k2, aria }));
    await b.ev(`_dockOpen(null); _agentShowOrderSheet(2); return 1`);
    const r1 = openK(await b.ev(STATE));
    await b.ev(`_dockOpen(null); _agentFocus(document.querySelector('#agentHome .agent-card')); return 1`);
    const r2 = openK(await b.ev(STATE));
    check('U11 jumping to an item inside a collapsed row opens that row (발주표 → 기타 정보, 오늘 할 일 card → 오늘 할 일)', r1 === 'other' && r2 === 'today', `${r1} / ${r2}`);
    await b.ev(`try { _clearStoreContext(); } catch (e) {} ${settle} return 1`);
    s = await b.ev(STATE);
    check('U10 store switch / logout → all collapsed, previous store rows cleared', s.every(x => !x.open) && !s.find(x => x.k === 'purchase').shown, JSON.stringify(s));
    // ── H6 채팅 영역 (접힌 상태, 같은 내용) — 이전 버전 대비 유지/증가, 입력창 하단 고정, 가로 스크롤 없음
    const LAYOUT = `const ca = document.getElementById('chatArea').getBoundingClientRect(), iz = document.querySelector('.v4-input-zone').getBoundingClientRect();
      return { chat: Math.round(ca.height), top: Math.round(ca.top), visible: Math.round(Math.min(ca.bottom, iz.top) - ca.top), inputBottom: Math.round(iz.bottom), vh: innerHeight, hscroll: document.documentElement.scrollWidth > innerWidth };`;
    const lay = {};
    for (const [w, h, m, label] of [[390, 844, true, 'mobile'], [1280, 900, false, 'desktop']]) {
      await b.open('http://zk.test/', w, h, m); await b.ev(FX);
      lay[label] = { after: await b.ev(`__fill({ ...__daejeon, today: 3, checks: 10, sheet: 6 }); ${settle} _dockOpen(null); ${settle} ${LAYOUT}`) };
      if (OLD) {
        await b.open('http://zk.test/old', w, h, m);
        await b.ev(FX.replace("document.getElementById('agentChecks').innerHTML =", "(document.getElementById('agentChecks') || {}).innerHTML ="));
        lay[label].before = await b.ev(`__fill({ ...__daejeon, today: 3, checks: 10, sheet: 6 }); ${settle} ${LAYOUT}`);
      }
    }
    console.log('       layout ' + JSON.stringify(lay));
    if (process.env.ZK_DOCK_SHOT) {
      await b.open('http://zk.test/'); await b.ev(FX);
      await b.ev(`_dockReset(); __fill({ ...__daejeon, today: 3, checks: 10, sheet: 6 }); ${settle} _dockOpen(null); return 1`); await b.shot(path.join(process.env.ZK_DOCK_SHOT, 'home_collapsed.png'));
      await b.ev(`_dockReset(); __fill({ ...__daejeon, today: 3, checks: 10, sheet: 6 }); ${settle} return 1`); await b.shot(path.join(process.env.ZK_DOCK_SHOT, 'home_action.png'));
    }
    await b.open('http://zk.test/');
    const intact = await b.ev(`const q = s => document.querySelector(s); return [q('#nlInput'), q('#micBtn'), q('#chatArea')].every(e => e && !q('#homeDock').contains(e))
      && ['purchaseHome','agentHome','agentChecks','homeOrderSection','writerPendingBar','orderList','orderNeedCard','resList'].every(i => !!document.getElementById(i))`);
    const m = lay.mobile.after, d = lay.desktop.after;
    check('H6 chat workspace: ≥ 45% of the viewport (mobile + desktop), not smaller than before, input fixed at the bottom outside the rows, no horizontal scroll, ids intact',
      m.chat >= 0.45 * m.vh && d.chat >= 0.45 * d.vh && (!lay.mobile.before || m.visible >= lay.mobile.before.visible) && (!lay.desktop.before || d.visible >= lay.desktop.before.visible)
      && m.inputBottom <= m.vh && !m.hscroll && !d.hscroll && intact, JSON.stringify({ lay, intact }));
  } catch (e) { check('harness', false, e && e.stack || e); }
  finally { b.close(); }
  done(b.blocked);
})();
