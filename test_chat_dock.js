// test_chat_dock.js — Chat Workspace Collapse V0.1 (U1–U12)
// 실제 브라우저(headless Edge/Chrome, CDP)에서 index.html 을 연다. 네트워크는 supabase-js CDN 만 허용, 나머지(Supabase 등)는 전부 차단 → DB Write 0.
// 상단 블록(발주 진행 / 오늘 할 일 / 재고 확인 / 발주표 / 자세히)은 접힌 요약 줄, 지금 해야 할 발주 행동 하나만 자동으로 펼친다.
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn, execFileSync } = require('child_process');

const BROWSERS = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'];
const NEW_HTML = fs.readFileSync(path.join(__dirname, 'index.html'));
// before/after 비교용: dock 이 들어오기 직전 버전 (없으면 비교만 생략)
let OLD_HTML = null;
try {
  const git = (...a) => execFileSync('git', a, { cwd: __dirname, maxBuffer: 64 << 20 });
  const intro = git('log', '-1', '--format=%H', '-S', 'id="homeDock"', '--', 'index.html').toString().trim();
  OLD_HTML = git('show', `${intro || 'HEAD'}${intro ? '~1' : ''}:index.html`);
  if (OLD_HTML.includes('id="homeDock"')) OLD_HTML = null;
} catch { OLD_HTML = null; }

let pass = 0, fail = 0; const blocked = new Set();
const check = (name, ok, info) => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  — ' + info}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function launch() {
  const exe = BROWSERS.find(p => fs.existsSync(p)); if (!exe) throw new Error('no Edge/Chrome');
  const port = 9300 + Math.floor(Math.random() * 500);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zk-dock-'));
  const proc = spawn(exe, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', 'about:blank'], { stdio: 'ignore' });
  let list;
  for (let i = 0; i < 100 && !list; i++) { try { list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); } catch { await sleep(100); } }
  const page = list.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const waits = new Map(), handlers = [];
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && waits.has(m.id)) { const w = waits.get(m.id); waits.delete(m.id); m.error ? w.rej(new Error(m.error.message)) : w.res(m.result); } else handlers.forEach(h => h(m)); };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; waits.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  handlers.push(m => {
    if (m.method !== 'Fetch.requestPaused') return;
    const u = m.params.request.url, rid = m.params.requestId;
    if (u.startsWith('http://zk.test/')) {
      const body = (u.includes('/old') ? OLD_HTML : NEW_HTML).toString('base64');
      send('Fetch.fulfillRequest', { requestId: rid, responseCode: 200, responseHeaders: [{ name: 'content-type', value: 'text/html; charset=utf-8' }], body }).catch(() => {});
    } else if (/^https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2/.test(u)) send('Fetch.continueRequest', { requestId: rid }).catch(() => {});
    else { blocked.add(new URL(u).host); send('Fetch.failRequest', { requestId: rid, errorReason: 'BlockedByClient' }).catch(() => {}); }
  });
  await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  await send('Runtime.enable'); await send('Page.enable');
  const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: `(async()=>{${expr}})()`, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
  const open = async (url, w, h, mobile) => {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: !!mobile });
    await send('Page.navigate', { url });
    for (let i = 0; i < 100; i++) { await sleep(100); try { if (await ev(`return document.readyState === 'complete' && typeof _renderAgentHome === 'function'`)) break; } catch {} }
    await sleep(300);
    // 로그인/오버레이 없이 홈 탭만 측정 (fixture 는 실제 렌더 함수가 그리는 그대로)
    await ev(`document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.id === 'tab-input')); ['loginOverlay','authOverlay','authGate'].forEach(i => { const e = document.getElementById(i); if (e) e.style.display = 'none'; }); return 1`);
  };
  const key = async (sel, k) => {
    await ev(`document.querySelector(${JSON.stringify(sel)}).focus(); return 1`);
    const code = k === ' ' ? 'Space' : k, vk = k === ' ' ? 32 : 13, text = k === ' ' ? ' ' : '\r';
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, text });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk });
    await sleep(50);
  };
  const close = () => { try { ws.close(); } catch {} try { proc.kill(); } catch {} setTimeout(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} }, 1500); };
  return { ev, open, key, close, send };
}

// ── fixtures: 실제 렌더 함수로 그린다 (발주/오늘 할 일/재고 확인/발주표/자세히)
const FX = `
  const store = { display_name: '대전점', delivery_profile: { status: 'ACTIVE', version: 1 } };
  window.__req = (status, extra) => _purchaseHomeHtml(store, [Object.assign({ request_id: 'r1', status, line_count: 3, unresolved: 1, received_at: '2026-10-11T01:00:00Z' }, extra || {})]);
  window.__fill = (o) => {
    document.getElementById('purchaseHome').innerHTML = o.purchase || '';
    const ah = document.getElementById('agentHome');
    ah.innerHTML = o.today ? '<div class="agent-home"><div class="agent-sum">오늘 할 일 ' + o.today + '개</div>' + Array.from({ length: o.today }, (_, i) => '<div class="agent-card" data-agent-type="ORDER_NOW"><button class="agent-btn" onclick="void 0">주문 준비</button> 품목' + i + '</div>').join('') + '</div>'
      : '<div class="agent-home"><div class="agent-sum agent-none">오늘은 바로 처리할 일이 없습니다.</div></div>';   // 품목이 있고 할 일이 0 일 때 _renderAgentHome 이 그리는 것
    ah.dataset.today = String(o.today || 0);
    document.getElementById('agentChecks').innerHTML = o.checks ? '<div class="agent-home" data-agent-checks="' + o.checks + '">' + Array.from({ length: o.checks }, (_, i) => '<div class="agent-card" data-agent-type="CHECK_STOCK">확인' + i + '</div>').join('') + '</div>' : '';
    document.getElementById('orderList').innerHTML = o.sheet ? '<table><tbody id="otBody">' + Array.from({ length: o.sheet }, (_, i) => '<tr data-iid="' + (i + 1) + '"><td>품목' + i + '</td><td><button onclick="void 0">수정</button></td></tr>').join('') + '</tbody></table>' : '<div class="v4-empty-hint home-sheet-empty">발주표가 비어 있어요</div>';
    document.getElementById('orderNeedCard').innerHTML = '<div class="card">재고·목표 표</div>';
  };
  return 1;`;
const STATE = `
  const sec = [...document.querySelectorAll('#homeDock .dock-sec')].map(s => ({ k: s.dataset.dock, shown: !s.hidden, open: s.querySelector('.dock-hdr').getAttribute('aria-expanded') === 'true',
    panelHidden: s.querySelector('.dock-panel').hidden, title: s.querySelector('[data-dock-title]').textContent, action: s.classList.contains('dock-action') }));
  return sec;`;
const settle = `await new Promise(r => setTimeout(r, 30)); `;

(async () => {
  const b = await launch();
  try {
    const W = [[390, 844, true, 'mobile 390×844'], [1280, 900, false, 'desktop 1280×900']];
    // ── U1 새로 연 화면(= 새로고침)은 모두 접혀 있다
    await b.open('http://zk.test/', 390, 844, true);
    let s = await b.ev(STATE);
    check('U1 fresh load / reload: every block is a collapsed summary row (aria-expanded=false, panel hidden)', s.length === 5 && s.every(x => !x.open && x.panelHidden), JSON.stringify(s));
    await b.ev(FX);
    // ── U2 요약 줄 제목: 오늘 할 일 N개 / 재고 확인 필요 N개 / 발주 진행 N건 / 발주표 N건
    await b.ev(`__fill({ purchase: __req('RESEARCH_DONE'), today: 3, checks: 10, sheet: 2 }); ${settle} return 1`);
    s = await b.ev(STATE); const T = Object.fromEntries(s.map(x => [x.k, x]));
    check('U2 summary titles: 발주 진행 N건 · 오늘 할 일 N개 · 재고 확인 필요 N개 · 발주표 N건 · 자세히', T.purchase.title === '대전점 발주 진행 1건' && T.today.title === '오늘 할 일 3개' && T.checks.title === '재고 확인 필요 10개'
      && T.sheet.title === '발주표 2건' && T.detail.title === '재고·목표 자세히 보기' && s.every(x => x.shown && !x.open), JSON.stringify(s));
    // ── U3 비어 있는 블록은 줄도 숨긴다 (발주 0 / 재고 확인 0 / 빈 발주표)
    await b.ev(`__fill({ today: 0, checks: 0, sheet: 0 }); ${settle} return 1`);
    s = await b.ev(STATE); const E = Object.fromEntries(s.map(x => [x.k, x]));
    check('U3 empty blocks: purchase / checks / sheet rows hidden; 오늘 할 일 says nothing to do; all collapsed', !E.purchase.shown && !E.checks.shown && !E.sheet.shown && E.today.shown && E.today.title === '오늘은 바로 처리할 일이 없습니다' && s.every(x => !x.open), JSON.stringify(s));
    // ── U4 헤더 클릭 → 펼침 / 다시 클릭 → 접힘
    await b.ev(`_dockReset(); __fill({ purchase: __req('RESEARCH_DONE'), today: 3, checks: 10, sheet: 2 }); ${settle} return 1`);
    await b.ev(`document.querySelector('[data-dock="today"] .dock-hdr').click(); return 1`);
    const u4a = await b.ev(`const s = document.querySelector('[data-dock="today"]'); return [s.querySelector('.dock-hdr').getAttribute('aria-expanded'), s.querySelector('.dock-panel').hidden, s.querySelector('.dock-chev').textContent, document.querySelector('#agentHome').getBoundingClientRect().height > 0]`);
    await b.ev(`document.querySelector('[data-dock="today"] .dock-hdr').click(); return 1`);
    const u4b = await b.ev(`const s = document.querySelector('[data-dock="today"]'); return [s.querySelector('.dock-hdr').getAttribute('aria-expanded'), s.querySelector('.dock-panel').hidden]`);
    check('U4 header click expands (aria-expanded=true, ▾, content visible); second click collapses', JSON.stringify(u4a) === '["true",false,"▾",true]' && JSON.stringify(u4b) === '["false",true]', JSON.stringify([u4a, u4b]));
    // ── U5 아코디언: 하나 펼치면 나머지는 접힌다
    await b.ev(`document.querySelector('[data-dock="checks"] .dock-hdr').click(); document.querySelector('[data-dock="sheet"] .dock-hdr').click(); return 1`);
    s = await b.ev(STATE);
    check('U5 accordion: opening 발주표 closes 재고 확인 — exactly one open', s.filter(x => x.open).map(x => x.k).join() === 'sheet', JSON.stringify(s.map(x => [x.k, x.open])));
    // ── U6 키보드: Enter / Space 로 펼치고 접기, aria-controls 연결
    await b.ev(`_dockOpen(null); return 1`);
    await b.key('[data-dock="checks"] .dock-hdr', 'Enter');
    const u6a = await b.ev(`return document.querySelector('[data-dock="checks"] .dock-hdr').getAttribute('aria-expanded')`);
    await b.key('[data-dock="checks"] .dock-hdr', ' ');
    const u6b = await b.ev(`return document.querySelector('[data-dock="checks"] .dock-hdr').getAttribute('aria-expanded')`);
    const u6c = await b.ev(`return [...document.querySelectorAll('#homeDock .dock-hdr')].every(h => h.tagName === 'BUTTON' && document.getElementById(h.getAttribute('aria-controls')) === h.parentElement.querySelector('.dock-panel'))`);
    check('U6 keyboard: Enter expands, Space collapses; every header is a <button> with aria-controls → its panel', u6a === 'true' && u6b === 'false' && u6c, JSON.stringify([u6a, u6b, u6c]));
    // ── U7 발주 행동이 없으면(조사 중 등) 발주 줄도 접힌 채
    await b.ev(`_dockReset(); __fill({ purchase: _peCurrentHtml({}, { action: { type: 'RESEARCHING', message: '공급처를 조사하고 있어요', items: ['웰치스 2박스'] } }) + __req('RESEARCHING'), today: 3, checks: 10, sheet: 2 }); ${settle} return 1`);
    s = await b.ev(STATE);
    check('U7 no human action (조사 중) → nothing auto-opens; purchase row shows the current status as its title', s.every(x => !x.open) && s[0].title === '공급처를 조사하고 있어요' && !s[0].action, JSON.stringify(s));
    // ── U8 ONE CURRENT ACTION: 사람이 할 발주 행동 하나만 자동으로 펼친다
    await b.ev(`__fill({ purchase: __req('READY_FOR_RESEARCH'), today: 3, checks: 10, sheet: 2 }); ${settle} return 1`);
    s = await b.ev(STATE);
    const u8btn = await b.ev(`const b = [...document.querySelectorAll('#purchaseHome button')].find(x => x.textContent === '공급처 조사 시작'); const r = b && b.getBoundingClientRect(); return !!(r && r.height > 0 && r.bottom <= innerHeight)`);
    check('U8 current action (공급처 조사 시작) → only the purchase block auto-opens, highlighted, its button on screen', s.filter(x => x.open).map(x => x.k).join() === 'purchase' && s[0].action && s[0].title.endsWith('· 확인할 일 있음') && u8btn, JSON.stringify(s) + ' btn=' + u8btn);
    const dec = `_peCurrentHtml({ approver: true }, { action: { type: 'DECISION', title: '결제수단을 선택해 주세요', message: '저장 카드 결제가 실패했어요', decision_ref: { exception_id: 'e1' }, options: [{ option_id: 'o1', label: '다른 저장 결제수단으로 다시 시도', enabled: true }, { option_id: 'o2', label: '주문 중단', enabled: true }] } })`;
    // ── U9 사람이 접은 같은 행동은 다시 자동으로 펼치지 않는다; 새 행동이 오면 다시 그 하나만 펼친다
    await b.ev(`document.querySelector('[data-dock="purchase"] .dock-hdr').click(); __fill({ purchase: __req('READY_FOR_RESEARCH'), today: 3, checks: 10, sheet: 2 }); ${settle} return 1`);
    const u9a = (await b.ev(STATE)).filter(x => x.open).map(x => x.k).join();
    await b.ev(`document.querySelector('[data-dock="today"] .dock-hdr').click(); __fill({ purchase: ${dec} + __req('RESEARCH_DONE'), today: 3, checks: 10, sheet: 2 }); ${settle} return 1`);
    s = await b.ev(STATE);
    check('U9 owner-collapsed action stays collapsed on re-render; a NEW action (결제수단 선택) re-opens only the purchase block', u9a === '' && s.filter(x => x.open).map(x => x.k).join() === 'purchase' && s[0].title === '결제수단을 선택해 주세요 · 확인할 일 있음', `afterCollapse=${u9a} ` + JSON.stringify(s));
    // ── U10 매장 전환/로그아웃(_clearStoreContext) → 모두 접힘, 이전 매장 줄 없음
    await b.ev(`try { _clearStoreContext(); } catch (e) {} ${settle} return 1`);
    s = await b.ev(STATE);
    const u10src = await b.ev(`return String(_clearStoreContext).includes('_dockReset()') && String(_clearStoreContext).includes("'agentChecks'")`);
    check('U10 store switch / logout → all collapsed, previous store\'s 재고 확인 rows cleared', s.every(x => !x.open) && !s.find(x => x.k === 'checks').shown && u10src, JSON.stringify(s));
    // ── U11 다른 곳에서 블록 안 항목으로 이동하면 그 줄이 펼쳐진다 (오늘 할 일 [발주표 보기], 발주표 [수정])
    await b.ev(`__fill({ today: 3, checks: 0, sheet: 2 }); ${settle} _dockOpen(null); _agentShowOrderSheet(2); return 1`);
    s = await b.ev(STATE);
    const u11a = s.filter(x => x.open).map(x => x.k).join();
    await b.ev(`_dockOpen(null); _agentFocus(document.querySelector('#agentHome .agent-card')); return 1`);
    s = await b.ev(STATE);
    check('U11 jumping to an item inside a collapsed block opens that block (발주표 row / 오늘 할 일 card)', u11a === 'sheet' && s.filter(x => x.open).map(x => x.k).join() === 'today', `${u11a} / ${s.filter(x => x.open).map(x => x.k)}`);
    // ── U12 채팅이 주 작업 공간: 접힌 상태에서 채팅 영역 높이 (before/after), 입력창은 하단 고정·dock 밖, 기존 버튼/입력 그대로
    const LAYOUT = `const ca = document.getElementById('chatArea').getBoundingClientRect(), iz = document.querySelector('.v4-input-zone').getBoundingClientRect();
      const tab = document.getElementById('tab-input').getBoundingClientRect();
      return { chat: Math.round(ca.height), chatTop: Math.round(ca.top), input: Math.round(iz.top), inputBottom: Math.round(iz.bottom), vh: innerHeight, tab: Math.round(tab.height), hscroll: document.documentElement.scrollWidth > innerWidth };`;
    const FULL = `__fill({ purchase: __req('RESEARCH_DONE'), today: 3, checks: 10, sheet: 6 }); ${settle}`;
    const lay = {};
    for (const [w, h, m, label] of W) {
      await b.open('http://zk.test/', w, h, m); await b.ev(FX); lay[label] = { after: await b.ev(`${FULL} _dockOpen(null); ${settle} ${LAYOUT}`) };
      if (OLD_HTML) {
        await b.open('http://zk.test/old', w, h, m);
        // 이전 버전에는 #agentChecks 가 없다 (재고 확인 카드는 오늘 할 일 안의 <details> 로 접혀 있었다) → 같은 내용을 그 자리에 넣는다
        await b.ev(FX.replace("document.getElementById('agentChecks').innerHTML =", "(document.getElementById('agentChecks') || { set innerHTML(v) { if (v) document.getElementById('agentHome').insertAdjacentHTML('beforeend', '<details class=\"agent-more\"><summary>재고 확인이 필요한 품목 더 있음</summary>' + v + '</details>'); } }).innerHTML ="));
        lay[label].before = await b.ev(`${FULL} ${LAYOUT}`);
      }
    }
    console.log('       layout ' + JSON.stringify(lay));
    await b.open('http://zk.test/', 390, 844, true); await b.ev(FX); await b.ev(`${FULL} return 1`);
    const intact = await b.ev(`const q = s => document.querySelector(s); return { input: !!q('#nlInput') && !q('#homeDock').contains(q('#nlInput')), mic: !!q('#micBtn') && !q('#homeDock').contains(q('#micBtn')),
      chatOutsideDock: !q('#homeDock').contains(q('#chatArea')), prep: [...document.querySelectorAll('#agentHome .agent-btn')].length === 3, ids: ['purchaseHome','agentHome','agentChecks','homeOrderSection','writerPendingBar','orderList','orderNeedCard','resList'].every(i => !!document.getElementById(i)) }`);
    if (process.env.ZK_DOCK_SHOT) {   // 눈으로 확인용 (선택): 접힌 상태 / 현재 행동 하나 펼친 상태
      const shot = async n => fs.writeFileSync(path.join(process.env.ZK_DOCK_SHOT, n), Buffer.from((await b.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
      await b.ev(`_dockReset(); __fill({ purchase: __req('RESEARCH_DONE'), today: 3, checks: 10, sheet: 6 }); ${settle} return 1`); await shot('dock_collapsed.png');
      await b.ev(`__fill({ purchase: __req('READY_FOR_RESEARCH'), today: 3, checks: 10, sheet: 6 }); ${settle} return 1`); await shot('dock_action.png');
    }
    const m = lay['mobile 390×844'].after, d = lay['desktop 1280×900'].after;
    check('U12 chat is the main workspace: collapsed rows leave ≥ 45% of the viewport to the chat (mobile + desktop), input fixed at the bottom outside the dock, no horizontal scroll, existing ids/buttons intact',
      m.chat >= 0.45 * m.vh && d.chat >= 0.45 * d.vh && m.inputBottom <= m.vh && !m.hscroll && !d.hscroll && Object.values(intact).every(Boolean), JSON.stringify({ lay, intact }));
  } catch (e) { fail++; console.log('FAIL harness ' + (e && e.stack || e)); }
  finally { b.close(); }
  console.log(`\nnetwork blocked (never reached): ${[...blocked].join(', ') || 'none'}`);
  console.log('DB Write: 0 (network blocked)');
  console.log(`RESULT: ${pass} PASS / ${fail} FAIL (of ${pass + fail})`);
  setTimeout(() => process.exit(fail === 0 ? 0 : 1), 300);
})();
