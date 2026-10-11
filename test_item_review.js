// test_item_review.js — PURCHASE_ITEM_REVIEW_REWORK V0.2 (R1–R16). 실제 브라우저 + 실제 품목 확인 화면 (_purchaseOpenReview).
// fixture = Production 대전 요청 5ce5171f 의 실제 request view (fixtures_daejeon_review.json, 읽기 전용으로 받은 것 — 원문·재고 제외).
// 서버로는 아무것도 보내지 않는다: 네트워크 기록 + _purchasePost 는 기록만 하는 stub → DB Write 0.
// (서버 ROUTE 계약 — 매핑 무변경, 다음 요청은 기본 경로 — 은 migration-packages/purchase-item-route-select-001/tests/run_route.cjs, staging)
const fs = require('fs'), path = require('path');
const { launch, checker } = require('./browser_harness.js');
const { check, done } = checker();
const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures_daejeon_review.json'), 'utf8'));

const OPEN = (req) => `
  window.__posts = []; window.__net = [];
  const rf = window.fetch.bind(window); window.fetch = (u, i) => { if (!String(u).includes('/rpc/zk_chat_') && (/purchase|rpc/.test(String(u)) || (i && i.method && i.method !== 'GET'))) window.__net.push([String(u), (i && i.method) || 'GET']); return rf(u, i); };
  _writerToken = async () => 'test-token';
  const req = ${JSON.stringify(req)};
  _purchaseRequestOf = async id => id === req.request_id ? JSON.parse(JSON.stringify(req)) : null;
  _purchasePost = async (action, fields) => { window.__posts.push({ action, ...fields }); return { code: 'MAPPINGS_CONFIRMED', request: { ...req, request_version: req.request_version + 1, status: 'READY_FOR_RESEARCH', summary: { ...req.summary } } }; };
  _refreshPurchaseHome = async () => {};
  await _purchaseOpenReview(req.request_id);
  return 1;`;
// 보이는 것만 (hidden / display:none 제외)
const SCREEN = `const root = document.querySelector('#purchaseReview .pr-review'); const vis = e => !!e && !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length);
  const t = e => e ? e.textContent.replace(/\\s+/g, ' ').trim() : '';
  const autos = [...root.querySelectorAll('[data-pr-auto]')].map(r => ({ n: Number(r.dataset.prLine), name: r.querySelector('.pr-auto-name').firstChild.textContent.trim(), sub: t(r.querySelector('.pr-auto-sub')),
    supplier: r.querySelector('[data-pr-supplier]').dataset.prSupplier, changed: vis(r.querySelector('[data-pr-changed]')), detail: vis(r.querySelector('[data-pr-detail]')), btn: r.querySelector('[data-pr-change]').textContent }));
  const needs = [...root.querySelectorAll('[data-pr-need]')].map(r => ({ n: Number(r.dataset.prLine), kind: r.dataset.prNeed, name: t(r.querySelector('.pr-need-name')), text: r.innerText.split('\\n').map(s => s.replace(/\\s+/g, ' ').trim()).filter(Boolean).slice(1).join(' / '),
    buttons: [...r.querySelectorAll('button')].filter(vis).map(t), routes: [...r.querySelectorAll('[data-pr-route]')].filter(vis).map(x => ({ id: Number(x.dataset.prRoute), name: t(x.querySelector('.pr-route-name')), sub: t(x.querySelector('.pr-route-sub')), checked: x.querySelector('input').checked })),
    done: r.classList.contains('done'), folded: vis(r.querySelector('[data-pr-done]')) && !vis(r.querySelector('[data-pr-body]')), summary: t(r.querySelector('[data-pr-summary]')),
    histNote: t(r.querySelector('[data-pr-hist-note]')), note: t(r.querySelector('[data-pr-src-note]')), fontPx: parseFloat(getComputedStyle(r.querySelector('.pr-need-name')).fontSize) }));
  const btn = root.querySelector('[data-pr-submit]');
  return { autos, needs, secs: [...root.querySelectorAll('[data-pr-sec]')].map(s => s.textContent.trim()), visibleRadios: [...root.querySelectorAll('input[type=radio]')].filter(vis).map(i => i.name + '=' + i.value),
    packInputs: [...root.querySelectorAll('select[name^="pr-conv-"], input[name^="pr-factor-"], input[name^="pr-sunit-"]')].filter(vis).map(i => i.name),
    cta: btn.textContent.trim(), ctaDisabled: btn.disabled, text: root.textContent.replace(/\\s+/g, ' '), err: document.getElementById('prReviewError').textContent,
    hscroll: document.documentElement.scrollWidth > window.innerWidth + 1, autoPx: parseFloat(getComputedStyle(root.querySelector('.pr-auto-name') || root).fontSize) }`;
const CLICK = sel => `document.querySelector(${JSON.stringify(sel)}).click(); await new Promise(r => setTimeout(r, 50)); return 1`;
const CLICK_TEXT = (scope, text) => `[...document.querySelectorAll(${JSON.stringify(scope + ' button')})].find(x => x.textContent.replace(/\\s+/g, ' ').trim().startsWith(${JSON.stringify(text)})).click(); await new Promise(r => setTimeout(r, 50)); return 1`;
const NET = `return window.__net.concat(window.__posts.map(p => ['POST', p.action]))`;

(async () => {
  const b = await launch({ newHtml: fs.readFileSync(path.join(__dirname, 'index.html')) });
  try {
    await b.open('http://zk.test/');
    await b.ev(OPEN(FIX));
    await b.shot(path.join(require('os').tmpdir(), 'zk_item_review_v02_mobile.png'));
    let sc = await b.ev(SCREEN);
    const A = n => sc.autos.find(a => a.n === n), N = n => sc.needs.find(a => a.n === n);
    // ── 자동 확인됨: 정확한 구매처 + 상품번호 + 포장이 있는 3개 (실제 Production 데이터 그대로)
    check('R1 자동 확인 3개 compact: 우유 / 콜라 / 스프라이트 — one line each, no choice visible', sc.secs[0] === '자동 확인됨 · 3개' && sc.autos.map(a => a.n).join() === '2,4,6'
      && A(2).sub === '쿠팡 · 믈레코비타 3.5% 멸균우유, 1L, 12개 · 1L×12' && A(4).sub.startsWith('식봄 · 코카콜라') && A(6).sub.startsWith('식봄 · 스프라이트')
      && !sc.visibleRadios.some(r => /^pr-pick-(2|4|6)=/.test(r)), JSON.stringify(sc.autos));
    check('SURFACE "확인할 것 · 3개" = 치즈 (simple) · 휘핑크림 (route) · 제로콜라 (new); no "다른 확정 기록", no "지난번 확인 그대로", no "품목 확인 완료" wording',
      sc.secs[1] === '확인할 것 · 3개' && sc.needs.map(x => `${x.n}:${x.kind}`).join() === '1:simple,3:route,5:new'
      && !/다른 확정 기록|지난번 확인 그대로|품목 확인 완료/.test(sc.text), JSON.stringify({ secs: sc.secs, needs: sc.needs.map(x => x.kind) }));
    // ── 치즈: 단순 카드
    check('R3 치즈 3박스 simple card: "식봄 · 도노쉐프 피자치즈 …" + "3박스 = 12봉 주문" + [이대로 주문] [변경]; no radios, no pack input', N(1).name === '치즈 3박스'
      && /^식봄 · 도노쉐프 피자치즈 \(냉장 모짜렐라99%, 2\.5Kg\) \/ 3박스 = 12봉 주문/.test(N(1).text) && N(1).buttons.join('|') === '이대로 주문|변경'
      && !sc.visibleRadios.some(r => r.startsWith('pr-pick-1=')) && !sc.packInputs.includes('pr-conv-1'), JSON.stringify(N(1)));
    // ── 휘핑크림: 확정 경로 2개 = 실제 선택지
    const w = N(3);
    check('R5/R2 휘핑크림 "어느 걸로 주문할까요?" — two real route cards with supplier + product + pack: 식봄 · 데빅 휘핑크림 (1박스 = 12개 · 기본 구매 경로) / 쿠팡 · 올덴버거 휘핑크림 (1박스 = 10개 · 과거 구매); none pre-picked',
      w.text.startsWith('어느 걸로 주문할까요?') && w.routes.length === 2
      && w.routes[0].name === '식봄 · 데빅 휘핑크림' && w.routes[0].sub === '1박스 = 12개 · 기본 구매 경로'
      && w.routes[1].name === '쿠팡 · 올덴버거 휘핑크림 (5개입 × 2 통상 구매)' && w.routes[1].sub === '1박스 = 10개 · 과거 구매'
      && w.routes.every(r => !r.checked) && w.buttons.join('|') === '다른 제품 찾기', JSON.stringify(w));
    // ── 제로콜라: 첫 단계 2개
    const z0 = N(5);
    check('R9 제로콜라 2박스 first screen: "처음 구매하는 품목입니다." + "어떻게 찾을까요?" + exactly 2 choices [예전에 산 제품 찾기 (추천)] [구매처 직접 선택]; supplier list and pack hidden',
      z0.name === '제로콜라 2박스' && z0.text.startsWith('처음 구매하는 품목입니다. / 어떻게 찾을까요?') && z0.buttons.join('|') === '예전에 산 제품 찾기 추천|구매처 직접 선택'
      && !sc.packInputs.includes('pr-conv-5') && z0.fontPx > sc.autoPx, JSON.stringify(z0));
    check('R13 pack known → no pack input anywhere on the first screen (auto rows, 치즈, 휘핑크림 routes)', sc.packInputs.length === 0, JSON.stringify(sc.packInputs));
    check('R15 CTA "확인하고 계속" disabled while decisions are open', sc.cta === '확인하고 계속' && sc.ctaDisabled, '');
    // ── 자동 확인 [변경]: 기존 선택지, 한 품목씩, 포장 칸은 포장을 새로 정할 때만
    await b.ev(CLICK('[data-pr-line="2"] [data-pr-change]'));
    let s2 = await b.ev(SCREEN);
    check('AUTO [변경] 우유 → existing choices (지금 기본 checked / 다른 제품), only that row; pack input still hidden (pack known)', s2.autos.find(a => a.n === 2).detail && s2.autos.find(a => a.n === 2).btn === '닫기'
      && s2.visibleRadios.includes('pr-pick-2=keep') && s2.visibleRadios.includes('pr-pick-2=new') && s2.autos.filter(a => a.detail).length === 1 && !s2.packInputs.includes('pr-conv-2'), JSON.stringify(s2.packInputs));
    await b.ev(CLICK('#purchaseReview input[name="pr-pick-2"][value="new"]'));
    s2 = await b.ev(SCREEN);
    check('R14 우유 → "다른 제품" → only now the pack question appears; the screen is not complete (CTA disabled)', s2.packInputs.includes('pr-conv-2') && s2.ctaDisabled, JSON.stringify(s2.packInputs));
    await b.ev(`[...document.querySelectorAll('[data-pr-line="2"] [data-pr-detail] button')].find(x => x.textContent === '변경 취소').click(); return 1`);
    s2 = await b.ev(SCREEN);
    check('AUTO 변경 취소 → back to 지금 기본, closed, no pack input', !s2.autos.find(a => a.n === 2).detail && !s2.autos.find(a => a.n === 2).changed && s2.packInputs.length === 0
      && await b.ev(`return document.querySelector('#purchaseReview input[name="pr-pick-2"][value="keep"]').checked`), '');
    // ── 치즈 [변경]
    await b.ev(CLICK('[data-pr-line="1"] [data-pr-change]'));
    s2 = await b.ev(SCREEN);
    check('R4 치즈 [변경] → only then: 지금 기록 / 과거 구매 · 식봄 · 도노쉐프 / 다른 제품 (pack only after a non-keep pick)', ['pr-pick-1=keep', 'pr-pick-1=ev:1', 'pr-pick-1=new'].every(r => s2.visibleRadios.includes(r))
      && /지금 기록 그대로: 식봄 · 도노쉐프/.test(s2.needs.find(x => x.n === 1).text) && /과거 구매 · 식봄 · 도노쉐프 피자치즈/.test(s2.needs.find(x => x.n === 1).text) && !s2.packInputs.includes('pr-conv-1'), JSON.stringify(s2.visibleRadios));
    await b.ev(CLICK('#purchaseReview input[name="pr-pick-1"][value="ev:1"]'));
    const pre = await b.ev(`return [document.querySelector('#purchaseReview select[name="pr-conv-1"]').value, document.querySelector('#purchaseReview input[name="pr-factor-1"]').value, document.querySelector('#purchaseReview input[name="pr-sunit-1"]').value]`);
    s2 = await b.ev(SCREEN);
    check('R4b 치즈 [변경] → 과거 구매 → pack shown, pre-filled from the record "1박스 = 4봉" (visible, editable)', pre.join() === 'FACTOR,4,봉' && s2.packInputs.includes('pr-conv-1'), pre.join());
    await b.ev(CLICK_TEXT('[data-pr-line="1"]', '이대로 주문'));
    s2 = await b.ev(SCREEN);
    const c1 = s2.needs.find(x => x.n === 1);
    check('R3b [이대로 주문] → 치즈 folds to "✓ 식봄 · 도노쉐프 … · 3박스 = 12봉" + [변경]; "확인할 것 · 2개"; CTA still disabled', c1.done && c1.folded
      && c1.summary === '식봄 · 도노쉐프 피자치즈 (냉장 모짜렐라99%, 2.5Kg) · 3박스 = 12봉' && s2.secs[1] === '확인할 것 · 2개' && s2.ctaDisabled, JSON.stringify(c1));
    // ── 휘핑크림: [다른 제품 찾기] → 경로 선택
    await b.ev(CLICK_TEXT('[data-pr-line="3"]', '다른 제품 찾기'));
    s2 = await b.ev(SCREEN);
    check('휘핑크림 [다른 제품 찾기] → new product, only now the pack question (pack unknown)', s2.packInputs.includes('pr-conv-3') && await b.ev(`return document.querySelector('#purchaseReview input[name="pr-pick-3"][value="new"]').checked`), JSON.stringify(s2.packInputs));
    await b.ev(CLICK('#purchaseReview input[name="pr-pick-3"][value="keep"]'));
    s2 = await b.ev(SCREEN);
    check('R5 식봄 · 데빅 selectable (= the current default, KEEP) → folds "✓ 식봄 · 데빅 휘핑크림 · 1박스 = 12개"; the 다른 제품 pack box closes', s2.needs.find(x => x.n === 3).folded
      && s2.needs.find(x => x.n === 3).summary === '식봄 · 데빅 휘핑크림 · 1박스 = 12개' && !s2.packInputs.includes('pr-conv-3'), JSON.stringify(s2.needs.find(x => x.n === 3)));
    await b.ev(CLICK_TEXT('[data-pr-line="3"] [data-pr-done]', '변경'));
    await b.ev(CLICK('#purchaseReview input[name="pr-pick-3"][value="route:5"]'));
    s2 = await b.ev(SCREEN);
    const w2 = s2.needs.find(x => x.n === 3);
    check('R6 쿠팡 · 올덴버거 selectable in one tap (the past route, not the default) → "✓ 쿠팡 · 올덴버거 휘핑크림 (5개입 × 2 통상 구매) · 1박스 = 10개 · 이번 발주만"; "확인할 것 · 1개"', w2.folded
      && w2.summary === '쿠팡 · 올덴버거 휘핑크림 (5개입 × 2 통상 구매) · 1박스 = 10개 · 이번 발주만' && s2.secs[1] === '확인할 것 · 1개' && s2.ctaDisabled, JSON.stringify(w2));
    // ── 제로콜라: 한 단계씩
    await b.ev(CLICK_TEXT('[data-pr-line="5"]', '예전에 산 제품 찾기'));
    let z = (await b.ev(SCREEN)).needs.find(x => x.n === 5);
    check('R12-history 예전에 산 제품 찾기 → this store\'s order history has no 제로콜라 → "과거 구매 기록이 없습니다. 구매처를 직접 골라 주세요." (supplier list still hidden until asked)',
      z.histNote === '과거 구매 기록이 없습니다. 구매처를 직접 골라 주세요.' && z.buttons.join('|') === '예전에 산 제품 찾기 추천|구매처 직접 선택', JSON.stringify(z));
    await b.ev(CLICK_TEXT('[data-pr-line="5"]', '구매처 직접 선택'));
    z = (await b.ev(SCREEN)).needs.find(x => x.n === 5);
    check('R10 [구매처 직접 선택] → only now: 식봄 / 쿠팡 / 네이버 / 전체 찾아보기', z.buttons.join('|') === '예전에 산 제품 찾기 추천|구매처 직접 선택|식봄|쿠팡|네이버|전체 찾아보기', z.buttons.join('|'));
    await b.ev(CLICK('[data-pr-line="5"] [data-pr-src="NAVER"]'));
    s2 = await b.ev(SCREEN); z = s2.needs.find(x => x.n === 5);
    check('R12 네이버 → "네이버에서 새 상품 찾기는 아직 직접 확인이 필요합니다." + next human step; no automation', z.note.startsWith('네이버에서 새 상품 찾기는 아직 직접 확인이 필요합니다.') && /상품은 직접 확인해서 정합니다/.test(z.note), z.note);
    check('R14 제로콜라 pack unknown → the pack question appears only after the source is chosen', s2.packInputs.includes('pr-conv-5') && s2.ctaDisabled, JSON.stringify(s2.packInputs));
    await b.ev(CLICK('[data-pr-line="5"] [data-pr-src="COUPANG"]'));
    z = (await b.ev(SCREEN)).needs.find(x => x.n === 5);
    check('R11 쿠팡 → "쿠팡에서 새 상품 찾기는 아직 직접 확인이 필요합니다." (the 쿠팡 light check reads remembered products only — no new-product search)', z.note.startsWith('쿠팡에서 새 상품 찾기는 아직 직접 확인이 필요합니다.'), z.note);
    const net0 = await b.ev(NET);
    check('R11/R12/R16 0 network calls, 0 server actions from opening / choosing / searching buttons (no research, no mapping write, no request change)', net0.length === 0, JSON.stringify(net0));
    await b.ev(`const s = document.querySelector('#purchaseReview select[name="pr-conv-5"]'); s.value = 'SAME_UNIT'; s.dispatchEvent(new Event('change')); return 1`);
    s2 = await b.ev(SCREEN); z = s2.needs.find(x => x.n === 5);
    check('R15 all decided → "확인할 것 · 0개", CTA enabled; 제로콜라 folds "쿠팡에서 직접 확인 · 새 상품 (상품은 직접 확인)"', s2.secs[1] === '확인할 것 · 0개' && !s2.ctaDisabled && z.folded
      && z.summary === '쿠팡에서 직접 확인 · 새 상품 (상품은 직접 확인)' && !/품목 확인 완료/.test(s2.text), JSON.stringify({ secs: s2.secs, z }));
    await b.ev(CLICK('[data-pr-submit]')); await b.ev(`await new Promise(r => setTimeout(r, 200)); return 1`);
    const posts = await b.ev(`return window.__posts`);
    const want = [{ line_no: 1, choice: 'KEEP' }, { line_no: 2, choice: 'KEEP' }, { line_no: 3, choice: 'ROUTE', mapping_id: 5 }, { line_no: 4, choice: 'KEEP' },
      { line_no: 5, choice: 'NEW_PRODUCT', conversion: 'SAME_UNIT' }, { line_no: 6, choice: 'KEEP' }];
    check('R7/R8 one CONFIRM_MAPPINGS: 휘핑크림 = ROUTE mapping 5 (request-scoped — no CANDIDATE / NEW_PRODUCT revision of the 휘핑크림 mapping), 치즈 = KEEP (no mapping write), 제로콜라 = NEW_PRODUCT; the source is not sent',
      posts.length === 1 && posts[0].action === 'CONFIRM_MAPPINGS' && JSON.stringify(posts[0].lines) === JSON.stringify(want) && !JSON.stringify(posts[0]).includes('COUPANG'), JSON.stringify(posts));
    const msg = await b.ev(`const rows = [...document.querySelectorAll('#resList .v4-bubble.system')]; return rows.length ? rows[rows.length - 1].textContent : ''`);
    check('the conversation says what was chosen, honestly: 휘핑크림 쿠팡 · 이번 발주만 (기본 구매 경로는 그대로) + 제로콜라 쿠팡 직접 확인', msg.includes('휘핑크림 1박스: 쿠팡 · 올덴버거 휘핑크림 (5개입 × 2 통상 구매) · 1박스 = 10개 · 이번 발주만 (기본 구매 경로는 그대로)')
      && msg.includes('제로콜라 2박스: 쿠팡 — 쿠팡에서 새 상품 찾기는 아직 직접 확인이 필요합니다.'), msg.slice(0, 400));
    check('MOBILE 390px: no horizontal scroll; the review modal scrolls', !sc.hscroll && !s2.hscroll && await b.ev(`const el = document.getElementById('purchaseReview'); return !el || getComputedStyle(el).overflowY === 'auto' || el.style.display === 'none'`), '');
    // ── 규칙 확인: 치즈 기록에 구매처가 있으면 자동 확인 한 줄 / 휘핑크림 경로가 하나뿐이면 경로 카드 없음
    const full = JSON.parse(JSON.stringify(FIX));
    const ch = full.lines.find(l => l.line_no === 1); ch.mapping.supplier = 'SIKBOM'; ch.mapping.evidence_id = 1; ch.supplier_mappings[0].supplier = 'SIKBOM';
    const wh = full.lines.find(l => l.line_no === 3); wh.supplier_mappings = wh.supplier_mappings.filter(x => x.mapping_id === 4);
    await b.ev(OPEN(full));
    const sc4 = await b.ev(SCREEN);
    check('RULE 치즈 with its supplier recorded → auto row "식봄 · 도노쉐프 … · 2.5kg/봉 · 1박스 = 4봉"; 휘핑크림 with one route → no route cards (simple 식봄 · 데빅)',
      (sc4.autos.find(a => a.n === 1) || {}).sub === '식봄 · 도노쉐프 피자치즈 (냉장 모짜렐라99%, 2.5Kg) · 2.5kg/봉 · 1박스 = 4봉' && (sc4.needs.find(x => x.n === 3) || {}).kind === 'simple'
      && /^식봄 · 데빅 휘핑크림 \/ 1박스 = 12개 주문/.test(sc4.needs.find(x => x.n === 3).text), JSON.stringify(sc4.needs.map(x => [x.n, x.kind, x.text.slice(0, 60)])));
    check('R16 current request state unchanged by this screen: 0 network calls overall (the only write is the owner\'s own [확인하고 계속], stubbed here)', (await b.ev(`return window.__net.length`)) === 0, '');
  } catch (e) { check('harness', false, e && e.stack || e); }
  finally { b.close(); }
  done(b.blocked);
})();
