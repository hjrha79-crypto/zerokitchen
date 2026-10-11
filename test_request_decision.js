// test_request_decision.js — REQUEST_DECISION_PERSISTENCE_FIX V0.1 (D1–D15, Web side). 실제 브라우저 + 실제 품목 확인 화면 / 현재 할 일 카드.
// fixture = Production 대전 요청 5ce5171f 의 request view (fixtures_daejeon_review.json) 를 이번 요청의 결정·조사 결과로 바꾼 것:
//   AFTER  = 대표가 고른 뒤 (치즈·우유·콜라·스프라이트 KEEP, 휘핑크림 ROUTE 쿠팡 올덴버거, 제로콜라 새 상품 + 식봄) + 공급처 조사 결과
//            (치즈 QUOTE_UNREADABLE, 휘핑크림 COUPANG_PRODUCT_UNKNOWN, 제로콜라 SIKBOM_PRODUCT_UNKNOWN) — Production 의 실제 조사 결과와 같다
//   LEGACY = 지금 Production (이 수정 전에 확인됨 → 서버에 결정 기록 없음, 줄 연결만 있음)
// 서버 쪽 (결정 저장·조사 입력·다음 요청 기본값) 은 migration-packages/request-decision-persist-001/tests/run_decision.cjs (staging).
const fs = require('fs'), path = require('path');
const { launch, checker } = require('./browser_harness.js');
const { check, done } = checker();
const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures_daejeon_review.json'), 'utf8'));
const clone = o => JSON.parse(JSON.stringify(o));

function legacy() {   // 지금 Production: 휘핑크림 → 쿠팡 올덴버거(5), 제로콜라 → 새 상품 매핑 22 (구매처·상품번호 없음), 결정 기록 없음
  const r = clone(FIX); r.request_version = 2; r.status = 'READY_FOR_RESEARCH';
  const w = r.lines.find(l => l.line_no === 3), alt = w.supplier_mappings.find(x => x.mapping_id === 5);
  w.mapping = { ...alt, evidence_id: null, seller: null, version: alt.version };
  const z = r.lines.find(l => l.line_no === 5);
  z.mapping_status = 'ACTIVE'; z.mapping = { mapping_id: 22, version: 1, status: 'ACTIVE', product_name: '제로콜라', supplier: null, seller: null, supplier_sku: null, package_spec: null,
    supplier_unit: '박스', conversion_factor: 1, evidence_id: null, brand: null, product_precision: null, supplier_scope: '', selection_basis: 'HUMAN_CONFIRMED', conversion_kind: 'EQUIVALENT' };
  z.supplier_mappings = [{ ...z.mapping, requested_unit: '박스', line_default: false }];
  const need = { 1: 'QUOTE_UNREADABLE', 3: 'COUPANG_PRODUCT_UNKNOWN', 5: 'SIKBOM_PRODUCT_UNKNOWN' };
  r.lines.forEach(l => { l.decision = null; l.research_need = need[l.line_no] || null; });
  return r;
}
function after() {
  const r = legacy(); r.request_version = 3;
  const kind = { 1: 'KEEP', 2: 'KEEP', 3: 'ROUTE', 4: 'KEEP', 5: 'NEW_PRODUCT', 6: 'KEEP' };
  r.lines.forEach(l => { l.decision = { kind: kind[l.line_no], mapping_id: l.mapping.mapping_id, mapping_version: l.mapping.version, supplier: l.mapping.supplier,
    sourcing_scope: l.line_no === 5 ? 'SIKBOM' : null, scope: 'THIS_REQUEST', confirmed_at: '2026-10-11T12:00:00Z', request_version: 3 }; });
  return r;
}

const OPEN = (req) => `
  window.__posts = []; window.__net = [];
  const rf = window.fetch.bind(window); window.fetch = (u, i) => { if (!String(u).includes('/rpc/zk_chat_') && (/purchase|rpc/.test(String(u)) || (i && i.method && i.method !== 'GET'))) window.__net.push([String(u), (i && i.method) || 'GET']); return rf(u, i); };
  _writerToken = async () => 'test-token';
  const req = ${JSON.stringify(req)};
  _purchaseRequestOf = async id => id === req.request_id ? JSON.parse(JSON.stringify(req)) : null;
  _purchasePost = async (action, fields) => { window.__posts.push({ action, ...fields }); await new Promise(r => setTimeout(r, 80));
    return { code: 'MAPPINGS_CONFIRMED', request: { ...req, request_version: req.request_version + 1, status: 'READY_FOR_RESEARCH', summary: { ...req.summary } } }; };
  _refreshPurchaseHome = async () => {};
  await _purchaseOpenReview(req.request_id);
  return 1;`;
const SCREEN = `const root = document.querySelector('#purchaseReview .pr-review'); const vis = e => !!e && !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length);
  const t = e => e ? e.textContent.replace(/\\s+/g, ' ').trim() : '';
  const lines = [...root.querySelectorAll('[data-pr-line]')].map(r => ({ n: Number(r.dataset.prLine), kind: r.dataset.prNeed || 'auto', confirmed: 'prConfirmed' in r.dataset || 'prAuto' in r.dataset,
    sec: (() => { let e = r; while (e && !(e.dataset && e.dataset.prSec)) e = e.previousElementSibling; return e ? e.dataset.prSec : ''; })(),
    text: r.innerText.split('\\n').map(s => s.replace(/\\s+/g, ' ').trim()).filter(Boolean).join(' / '), folded: vis(r.querySelector('[data-pr-done]')) && !vis(r.querySelector('[data-pr-body]')),
    summary: t(r.querySelector('[data-pr-summary]')), research: t(r.querySelector('[data-pr-research]')), buttons: [...r.querySelectorAll('button')].filter(vis).map(t) }));
  const btn = root.querySelector('[data-pr-submit]');
  return { lines, secs: [...root.querySelectorAll('[data-pr-sec]')].map(s => s.textContent.trim()), visibleRadios: [...root.querySelectorAll('input[type=radio]')].filter(vis).map(i => i.name + '=' + i.value),
    packInputs: [...root.querySelectorAll('select[name^="pr-conv-"]')].filter(vis).map(i => i.name), ctaDisabled: btn.disabled, text: root.textContent.replace(/\\s+/g, ' ') }`;
const CLICK = sel => `document.querySelector(${JSON.stringify(sel)}).click(); await new Promise(r => setTimeout(r, 50)); return 1`;
const CLICK_TEXT = (scope, text) => `[...document.querySelectorAll(${JSON.stringify(scope + ' button')})].find(x => x.textContent.replace(/\\s+/g, ' ').trim().startsWith(${JSON.stringify(text)})).click(); await new Promise(r => setTimeout(r, 50)); return 1`;

(async () => {
  const b = await launch({ newHtml: fs.readFileSync(path.join(__dirname, 'index.html')) });
  try {
    await b.open('http://zk.test/');
    // ── 대표가 정한 뒤, 공급처 조사 결과가 나온 다음 다시 열기
    await b.ev(OPEN(after()));
    await b.shot(path.join(require('os').tmpdir(), 'zk_request_decision_reopen.png'));
    let sc = await b.ev(SCREEN);
    const L = n => sc.lines.find(x => x.n === n);
    check('D8 reopen after research: "확인됨 · 5개" / "확인할 것 · 1개" — only 제로콜라 left; nothing re-asked (0 visible choices, 0 pack inputs); CTA enabled',
      sc.secs.join('|') === '확인됨 · 5개|확인할 것 · 1개' && [1, 2, 3, 4, 6].every(n => L(n).sec === 'auto' && L(n).confirmed) && L(5).sec === 'review'
      && sc.visibleRadios.length === 0 && sc.packInputs.length === 0 && !sc.ctaDisabled, JSON.stringify({ secs: sc.secs, lines: sc.lines.map(x => [x.n, x.sec, x.kind]), radios: sc.visibleRadios }));
    check('D1 치즈 persists: "✓ 식봄 · 도노쉐프 피자치즈 … · 3박스 = 12봉" (folded, not asked again) + research fact "지난 조사: 식봄 가격을 읽지 못했어요 (결정은 그대로)."', L(1).folded
      && L(1).summary === '식봄 · 도노쉐프 피자치즈 (냉장 모짜렐라99%, 2.5Kg) · 3박스 = 12봉' && L(1).research === '지난 조사: 식봄 가격을 읽지 못했어요 (결정은 그대로).', JSON.stringify(L(1)));
    check('D2/D3/D4 우유 쿠팡 · 콜라 식봄 · 스프라이트 식봄 compact (no research note — they were readable)', /^✓ 우유 1박스 \/ 쿠팡 · 믈레코비타/.test(L(2).text) && /^✓ 콜라 2박스 \/ 식봄 · 코카콜라/.test(L(4).text)
      && /^✓ 스프라이트 1박스 \/ 식봄 · 스프라이트/.test(L(6).text) && !L(2).research && !L(4).research && !L(6).research, JSON.stringify([L(2).text, L(4).text, L(6).text]));
    check('D5/D11 휘핑크림 survives research: "✓ 쿠팡 · 올덴버거 휘핑크림 (5개입 × 2 통상 구매) · 1박스 = 10개 · 이번 발주만" + "지난 조사: 쿠팡 상품번호가 없어 …" (a research fact, not a question)', L(3).folded
      && L(3).summary === '쿠팡 · 올덴버거 휘핑크림 (5개입 × 2 통상 구매) · 1박스 = 10개 · 이번 발주만' && L(3).research.startsWith('지난 조사: 쿠팡 상품번호가 없어 가격을 확인하지 못했어요'), JSON.stringify(L(3)));
    check('D7/D12 제로콜라 = the only open item: "구매처 ✓ 식봄 / 상품 · 아직 확인 필요" + honest "식봄에서 직접 확인이 필요합니다"; [구매처 변경] secondary; the 2-step / supplier buttons are NOT re-shown',
      L(5).text.startsWith('제로콜라 2박스 / 구매처 ✓ 식봄 / 상품 · 아직 확인 필요 / 식봄에서 새 상품 찾기는 아직 자동으로 하지 않아요 — 식봄에서 직접 확인이 필요합니다.') && L(5).buttons.join('|') === '구매처 변경', JSON.stringify(L(5)));
    // 구매처 변경: 누를 때만 4개
    await b.ev(CLICK_TEXT('[data-pr-line="5"]', '구매처 변경'));
    sc = await b.ev(SCREEN);
    check('§15 [구매처 변경] → only then 식봄 (current) / 쿠팡 / 네이버 / 전체 찾아보기', sc.lines.find(x => x.n === 5).buttons.join('|') === '구매처 변경|식봄|쿠팡|네이버|전체 찾아보기', JSON.stringify(sc.lines.find(x => x.n === 5).buttons));
    await b.ev(CLICK('[data-pr-line="5"] [data-pr-src="NAVER"]'));
    sc = await b.ev(SCREEN);
    check('§15 picking 네이버 → "구매처 ✓ 네이버 / 상품 · 아직 확인 필요"; list closes again', sc.lines.find(x => x.n === 5).text.startsWith('제로콜라 2박스 / 구매처 ✓ 네이버 / 상품 · 아직 확인 필요')
      && sc.lines.find(x => x.n === 5).buttons.join('|') === '구매처 변경', JSON.stringify(sc.lines.find(x => x.n === 5)));
    await b.ev(CLICK_TEXT('[data-pr-line="5"]', '구매처 변경')); await b.ev(CLICK('[data-pr-line="5"] [data-pr-src="SIKBOM"]'));
    check('R16-like 0 network calls while reopening / changing (no research, no write)', (await b.ev(`return window.__net.length + window.__posts.length`)) === 0, '');
    // D14: 두 번 눌러도 한 번
    await b.ev(`const x = document.querySelector('#purchaseReview [data-pr-submit]'); x.click(); x.click(); await new Promise(r => setTimeout(r, 300)); return 1`);
    const posts = await b.ev(`return window.__posts`);
    const want = [{ line_no: 1, choice: 'KEEP' }, { line_no: 2, choice: 'KEEP' }, { line_no: 3, choice: 'KEEP' }, { line_no: 4, choice: 'KEEP' }, { line_no: 5, choice: 'KEEP', sourcing_scope: 'SIKBOM' }, { line_no: 6, choice: 'KEEP' }];
    check('D14 a double click sends ONE CONFIRM_MAPPINGS; the remembered decisions go back unchanged (휘핑크림 KEEP = its bound 쿠팡 route, 제로콜라 KEEP + sourcing_scope SIKBOM) — no mapping revision',
      posts.length === 1 && JSON.stringify(posts[0].lines) === JSON.stringify(want), JSON.stringify(posts));
    const msg = await b.ev(`const rows = [...document.querySelectorAll('#resList .v4-bubble.system')]; return rows.length ? rows[rows.length - 1].textContent : ''`);
    check('§17 honest text: "제로콜라 2박스: 식봄에서 찾기로 했습니다. 정확한 상품은 직접 확인이 필요합니다."', msg.includes('제로콜라 2박스: 식봄에서 찾기로 했습니다. 정확한 상품은 직접 확인이 필요합니다.'), msg.slice(0, 300));
    // ── D13 새로고침 = 같은 view 를 다시 받음 → 같은 화면
    await b.ev(OPEN(after()));
    const sc2 = await b.ev(SCREEN);
    check('D13 refresh / reopen restores the same: 5 confirmed, 제로콜라 식봄', sc2.secs.join('|') === '확인됨 · 5개|확인할 것 · 1개' && sc2.lines.find(x => x.n === 5).text.includes('구매처 ✓ 식봄'), JSON.stringify(sc2.secs));
    // ── 오래된 결정 (다른 확인으로 연결이 바뀜) 은 쓰지 않는다
    const stale = after(); stale.lines.find(l => l.line_no === 1).decision.mapping_id = 999;
    await b.ev(OPEN(stale));
    const sc3 = await b.ev(SCREEN);
    check('STALE a decision that no longer matches the line\'s mapping is ignored → 치즈 asked again (simple card), the other 4 stay confirmed', sc3.lines.find(x => x.n === 1).sec === 'review'
      && sc3.lines.find(x => x.n === 1).buttons.join('|') === '이대로 주문|변경' && sc3.secs.join('|') === '확인됨 · 4개|확인할 것 · 2개', JSON.stringify(sc3.secs));
    // ── 지금 Production (이 수정 전 확인 → 결정 기록 없음): 한 번만 다시 고른다 (추측해서 채우지 않음)
    await b.ev(OPEN(legacy()));
    let sl = await b.ev(SCREEN);
    const G = n => sl.lines.find(x => x.n === n);
    check('LEGACY (no stored decision — not guessed by migration): 치즈 [이대로 주문] once, 휘핑크림 route cards (쿠팡 = its current binding, not pre-picked), 제로콜라 "아직 상품이 정해지지 않은 품목" 2 steps, no pack question',
      sl.secs.join('|') === '자동 확인됨 · 3개|확인할 것 · 3개' && G(1).buttons.join('|') === '이대로 주문|변경' && G(3).kind === 'route' && !sl.visibleRadios.some(r => r === 'pr-pick-3=keep' && false)
      && G(5).kind === 'new' && G(5).text.startsWith('제로콜라 2박스 / 아직 상품이 정해지지 않은 품목입니다. / 어떻게 찾을까요?') && sl.packInputs.length === 0 && sl.ctaDisabled, JSON.stringify(sl.lines.map(x => [x.n, x.kind, x.text.slice(0, 50)])));
    await b.ev(CLICK_TEXT('[data-pr-line="1"]', '이대로 주문'));
    await b.ev(CLICK('#purchaseReview input[name="pr-pick-3"][value="keep"]'));
    await b.ev(CLICK_TEXT('[data-pr-line="5"]', '구매처 직접 선택')); await b.ev(CLICK('[data-pr-line="5"] [data-pr-src="SIKBOM"]'));
    sl = await b.ev(SCREEN);
    check('LEGACY after one pass: 휘핑크림 "쿠팡 · 올덴버거 … · 이번 발주만", 제로콜라 "구매처 ✓ 식봄", CTA enabled, "확인할 것 · 1개"', sl.lines.find(x => x.n === 3).summary.endsWith('1박스 = 10개 · 이번 발주만')
      && sl.lines.find(x => x.n === 5).text.includes('구매처 ✓ 식봄') && !sl.ctaDisabled && sl.secs[1] === '확인할 것 · 1개', JSON.stringify(sl.secs));
    await b.ev(CLICK('[data-pr-submit]')); await b.ev(`await new Promise(r => setTimeout(r, 200)); return 1`);
    const lp = await b.ev(`return window.__posts`);
    check('LEGACY submit = the same decisions, now recorded: 3 KEEP (쿠팡 route kept), 5 KEEP + sourcing_scope SIKBOM (no new product version)',
      lp.length === 1 && JSON.stringify(lp[0].lines) === JSON.stringify(want), JSON.stringify(lp));
    // ── 현재 할 일 카드 (공급처 조사 결과): 제로콜라만 할 일, 나머지는 결정 그대로인 조사 메모
    const card = await b.ev(`const a = { type: 'RESEARCH_MAPPING_REQUIRED', message: '3개 제품만 확인해주세요.', items: ['치즈', '휘핑크림', '제로콜라'], request_ref: { request_id: '${FIX.request_id}', request_version: 3 },
        needs: [{ line_no: 1, item: '치즈', reason: 'QUOTE_UNREADABLE', decision: { kind: 'KEEP' } }, { line_no: 3, item: '휘핑크림', reason: 'COUPANG_PRODUCT_UNKNOWN', decision: { kind: 'ROUTE', supplier: 'COUPANG' } },
                { line_no: 5, item: '제로콜라', reason: 'SIKBOM_PRODUCT_UNKNOWN', decision: { kind: 'NEW_PRODUCT', sourcing_scope: 'SIKBOM' } }] };
      const d = document.createElement('div'); d.innerHTML = _peCurrentHtml({ approver: true }, { action: a }); document.body.appendChild(d);
      return { head: d.querySelector('[data-pe-head]').textContent, act: [...d.querySelectorAll('[data-pe-need="act"]')].map(e => e.textContent), memo: [...d.querySelectorAll('[data-pe-need="memo"]')].map(e => e.textContent), btn: !!d.querySelector('[data-pe-btn="REVIEW"]') }`);
    check('D12 current action card: "확인할 것 1개 — 제로콜라 · 식봄에서 상품 확인 필요"; 치즈 / 휘핑크림 only as research memos "(결정은 그대로)" — not "3개 제품만 확인해주세요"',
      card.head === '확인할 것 1개' && card.act.join('|') === '제로콜라 · 식봄에서 상품 확인 필요'
      && card.memo.join('|') === '치즈 · 식봄 가격을 읽지 못함 (결정은 그대로)|휘핑크림 · 쿠팡 상품번호가 없어 가격 확인 못 함 (결정은 그대로)' && card.btn, JSON.stringify(card));
    const old = await b.ev(`const d = document.createElement('div'); d.innerHTML = _peCurrentHtml({ approver: true }, { action: { type: 'RESEARCH_MAPPING_REQUIRED', message: '2개 제품만 확인해주세요.', items: ['A', 'B'], request_ref: { request_id: 'x' } } }); return d.textContent.replace(/\\s+/g, ' ')`);
    check('COMPAT an action without needs (older server) renders as before', old.includes('2개 제품만 확인해주세요.') && old.includes('A · B'), old);
  } catch (e) { check('harness', false, e && e.stack || e); }
  finally { b.close(); }
  done(b.blocked);
})();
