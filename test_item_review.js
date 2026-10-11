// test_item_review.js — PURCHASE_ITEM_REVIEW_SIMPLIFY V0.1 (I1–I15). 실제 브라우저 + 실제 품목 확인 화면 (_purchaseOpenReview).
// fixture = Production 대전 요청 5ce5171f 의 실제 request view (fixtures_daejeon_review.json, 읽기 전용으로 받은 것 — 원문·재고 제외).
// 서버로는 아무것도 보내지 않는다: 네트워크 차단 + _purchasePost 는 기록만 하는 stub → DB Write 0.
const fs = require('fs'), path = require('path');
const { launch, checker } = require('./browser_harness.js');
const { check, done } = checker();
const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures_daejeon_review.json'), 'utf8'));
const R = FIX.request_id;

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
const SCREEN = `const root = document.querySelector('#purchaseReview .pr-review'); const vis = e => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length);
  const autos = [...root.querySelectorAll('[data-pr-auto]')].map(r => ({ n: Number(r.dataset.prLine), name: r.querySelector('.pr-auto-name').firstChild.textContent.trim(), sub: r.querySelector('.pr-auto-sub').textContent.trim(),
    supplier: r.querySelector('[data-pr-supplier]').dataset.prSupplier, changed: vis(r.querySelector('[data-pr-changed]')), detail: vis(r.querySelector('[data-pr-detail]')), btn: r.querySelector('[data-pr-change]').textContent }));
  const needs = [...root.querySelectorAll('[data-pr-need]')].map(r => ({ n: Number(r.dataset.prLine), kind: r.dataset.prNeed, name: r.querySelector('.pr-need-name').textContent.trim(), why: r.querySelector('.pr-need-why').textContent.trim(),
    text: r.textContent.replace(/\\s+/g, ' '), srcs: [...r.querySelectorAll('[data-pr-src]')].map(b => b.textContent.trim()), on: [...r.querySelectorAll('[data-pr-src].on')].map(b => b.dataset.prSrc),
    note: (r.querySelector('[data-pr-src-note]') || {}).textContent || '', fontPx: parseFloat(getComputedStyle(r.querySelector('.pr-need-name')).fontSize) }));
  return { autos, needs, secs: [...root.querySelectorAll('[data-pr-sec]')].map(s => s.textContent.trim()), visibleRadios: [...root.querySelectorAll('input[type=radio]')].filter(vis).map(i => i.name + '=' + i.value),
    cta: root.querySelector('[data-pr-submit]').textContent.trim(), text: root.textContent.replace(/\\s+/g, ' '), err: document.getElementById('prReviewError').textContent,
    hscroll: document.documentElement.scrollWidth > window.innerWidth + 1, autoPx: parseFloat(getComputedStyle(root.querySelector('.pr-auto-name') || root).fontSize) }`;
const CLICK = sel => `document.querySelector(${JSON.stringify(sel)}).click(); await new Promise(r => setTimeout(r, 50)); return 1`;

(async () => {
  const b = await launch({ newHtml: fs.readFileSync(path.join(__dirname, 'index.html')) });
  try {
    await b.open('http://zk.test/');
    await b.ev(OPEN(FIX));
    await b.shot(path.join(require('os').tmpdir(), 'zk_item_review_mobile.png'));
    let sc = await b.ev(SCREEN);
    const A = n => sc.autos.find(a => a.n === n), N = n => sc.needs.find(a => a.n === n);
    // ── 실제 Production 데이터 그대로: 정확한 구매처 + 상품번호 + 포장이 있는 3개만 자동 확인됨
    check('I2 우유 1박스 compact: "쿠팡 · 믈레코비타 3.5% 멸균우유, 1L, 12개 · 1L×12"', !!A(2) && A(2).supplier === 'COUPANG' && A(2).sub === '쿠팡 · 믈레코비타 3.5% 멸균우유, 1L, 12개 · 1L×12' && A(2).name === '✓ 우유 1박스', JSON.stringify(A(2)));
    check('I3 콜라 2박스 compact: "식봄 · 코카콜라 콜라 (업소용 355ml*24EA/BOX) 뚱캔 · 355ml×24"', !!A(4) && A(4).supplier === 'SIKBOM' && A(4).sub.startsWith('식봄 · 코카콜라') && A(4).sub.endsWith('355ml×24'), JSON.stringify(A(4)));
    check('I4 스프라이트 1박스 compact: 식봄 (the 쿠팡 past-purchase candidate stays inside [변경] only)', !!A(6) && A(6).supplier === 'SIKBOM' && A(6).sub.startsWith('식봄 · 스프라이트') && !A(6).sub.includes('쿠팡'), JSON.stringify(A(6)));
    check('I1 치즈 (real data): the ACTIVE mapping has NO supplier recorded → NOT auto; "확인 필요" with reason + the 식봄 past purchase to pick', !A(1) && !!N(1) && N(1).why === '구매처가 기록되어 있지 않아요.'
      && /과거 구매 · 식봄 · 도노쉐프 피자치즈/.test(N(1).text) && /지금 기록 그대로: 구매처 미정 · 도노쉐프/.test(N(1).text), JSON.stringify(N(1)));
    check('I5 휘핑크림 (real data): "데빅 휘핑크림 (식봄 / 네이버)", no product number, plus an active 쿠팡 올덴버거 mapping → "확인 필요" (never auto-picked 식봄 or 네이버)', !A(3) && !!N(3)
      && N(3).why === '구매처가 하나로 정해지지 않았어요 (쿠팡 / 식봄).' && /다른 확정 기록: 쿠팡 · 올덴버거/.test(N(3).text)
      && !(await b.ev(`return !!document.querySelector('#purchaseReview input[name="pr-pick-3"]:checked')`)), JSON.stringify(N(3)));
    check('SURFACE two areas: "자동 확인됨 · 3개" then "확인이 필요한 품목 · 3개"; every auto row names its supplier; no "지난번 확인 그대로"; 0 radios visible in the auto area',
      sc.secs.join('|') === '자동 확인됨 · 3개|확인이 필요한 품목 · 3개' && sc.autos.every(a => /^(식봄|쿠팡|네이버) · /.test(a.sub)) && !sc.text.includes('지난번 확인 그대로')
      && !sc.visibleRadios.some(r => /^pr-pick-(2|4|6)=/.test(r)), JSON.stringify({ secs: sc.secs, radios: sc.visibleRadios }));
    // ── 제로콜라: 크게, 어디에서 찾을지
    check('I8 제로콜라 2박스 = big new-item card: "처음 구매하는 품목입니다. 정확한 상품과 구매처를 확인할게요." + "어디에서 찾아볼까요?" + 5 choices (과거 구매 먼저 = 추천)', !!N(5) && N(5).kind === 'new' && N(5).name === '제로콜라 2박스'
      && N(5).why === '처음 구매하는 품목입니다. 정확한 상품과 구매처를 확인할게요.' && N(5).text.includes('어디에서 찾아볼까요?') && N(5).srcs.join('|') === '과거 구매 먼저 찾기 추천|식봄|쿠팡|네이버|전체 찾아보기'
      && N(5).fontPx > sc.autoPx, JSON.stringify(N(5)));
    // ── [변경] / 닫기
    await b.ev(CLICK('[data-pr-line="2"] [data-pr-change]'));
    let s2 = await b.ev(SCREEN);
    check('I6 [변경] on 우유 → the existing choices open (지금 기본 checked + 다른 제품 + 포장), only that row', s2.autos.find(a => a.n === 2).detail && s2.autos.find(a => a.n === 2).btn === '닫기'
      && s2.visibleRadios.includes('pr-pick-2=keep') && s2.visibleRadios.includes('pr-pick-2=new') && s2.autos.filter(a => a.detail).length === 1
      && await b.ev(`return document.querySelector('#purchaseReview input[name="pr-pick-2"][value="keep"]').checked`), JSON.stringify(s2.visibleRadios));
    await b.ev(CLICK('[data-pr-line="4"] [data-pr-change]'));
    s2 = await b.ev(SCREEN);
    check('I6b accordion: opening 콜라 closes 우유', s2.autos.find(a => a.n === 4).detail && !s2.autos.find(a => a.n === 2).detail, '');
    await b.ev(CLICK('#purchaseReview input[name="pr-pick-4"][value="new"]'));
    await b.ev(CLICK('[data-pr-line="4"] [data-pr-change]'));
    s2 = await b.ev(SCREEN);
    const c4 = s2.autos.find(a => a.n === 4);
    check('I7 닫기 → compact row back (no radios visible), a changed choice is marked "· 바꿈"', !c4.detail && c4.btn === '변경' && c4.changed && !s2.visibleRadios.some(r => /^pr-pick-(2|4|6)=/.test(r)), JSON.stringify(c4));
    await b.ev(CLICK('[data-pr-line="4"] [data-pr-change]'));
    await b.ev(`[...document.querySelectorAll('[data-pr-line="4"] [data-pr-detail] button')].find(x => x.textContent === '변경 취소').click(); return 1`);
    s2 = await b.ev(SCREEN);
    check('I7b 변경 취소 → back to 지금 기본, mark gone, closed', !s2.autos.find(a => a.n === 4).changed && !s2.autos.find(a => a.n === 4).detail
      && await b.ev(`return document.querySelector('#purchaseReview input[name="pr-pick-4"][value="keep"]').checked`), '');
    // ── 조사 범위: 실제로 되는 것만, 나머지는 사람 확인으로 정직하게
    const pick = k => b.ev(`_purchaseSource(5, '${k}'); return 1`).then(() => b.ev(SCREEN)).then(s => s.needs.find(x => x.n === 5));
    let z = await pick('HISTORY');
    check('I10 과거 구매 먼저 찾기 → this store\'s order history has no 제로콜라 → "과거 구매가 없습니다. 어디에서 찾아볼까요?"', z.on.join() === 'HISTORY' && z.note === '과거 구매가 없습니다. 어디에서 찾아볼까요?', JSON.stringify(z));
    z = await pick('SIKBOM');
    check('I11 식봄 → honest: "식봄에서 새 상품 찾기는 아직 자동으로 하지 않아요 — 식봄에서 직접 확인이 필요합니다." (the research worker has no search)', z.on.join() === 'SIKBOM' && z.note === '식봄에서 새 상품 찾기는 아직 자동으로 하지 않아요 — 식봄에서 직접 확인이 필요합니다.', z.note);
    z = await pick('COUPANG');
    check('I12 쿠팡 → "쿠팡에서 새 상품 찾기는 아직 직접 확인이 필요합니다." (no fake search)', z.note === '쿠팡에서 새 상품 찾기는 아직 직접 확인이 필요합니다.', z.note);
    z = await pick('NAVER');
    check('I13 네이버 → "네이버에서 새 상품 찾기는 아직 직접 확인이 필요합니다." (no fake search)', z.note === '네이버에서 새 상품 찾기는 아직 직접 확인이 필요합니다.', z.note);
    z = await pick('ALL');
    check('I14 전체 찾아보기 → "식봄·쿠팡·네이버 등에서 찾아보기는 아직 자동으로 하지 않아요 — 직접 확인이 필요합니다." (no fake search)', z.note.startsWith('식봄·쿠팡·네이버 등에서 찾아보기는 아직 자동으로 하지 않아요'), z.note);
    const net0 = await b.ev(`return window.__net.concat(window.__posts.map(p => ['POST', p.action]))`);
    check('I11–I14 no automation behind any source button: 0 network calls, 0 server actions (no research start, no mapping write)', net0.length === 0, JSON.stringify(net0));
    // ── 보내기: 고르지 않은 것은 보내지 않는다 → 다 고르면 기존 결정 1건 (KEEP / CANDIDATE / NEW_PRODUCT)
    await b.ev(`window.__src = _prSource[5]; delete _prSource[5]; return 1`);
    await b.ev(CLICK('[data-pr-submit]'));
    let sc3 = await b.ev(SCREEN);
    check('CTA "확인하고 계속": nothing sent while 치즈 / 휘핑크림 / 제로콜라 are undecided — listed by name (incl. 제로콜라 "어디에서 찾을지")', sc3.cta === '확인하고 계속' && (await b.ev(`return window.__posts.length`)) === 0
      && /제로콜라 \(어디에서 찾을지\)/.test(sc3.err) && /치즈 \(제품\)/.test(sc3.err) && /휘핑크림 \(제품\)/.test(sc3.err), sc3.err);
    await b.ev(`_purchaseSource(5, 'SIKBOM'); return 1`);
    await b.ev(CLICK('#purchaseReview input[name="pr-pick-1"][value="ev:1"]'));
    const pre = await b.ev(`return [document.querySelector('#purchaseReview select[name="pr-conv-1"]').value, document.querySelector('#purchaseReview input[name="pr-factor-1"]').value, document.querySelector('#purchaseReview input[name="pr-sunit-1"]').value]`);
    check('I1b 치즈: picking the 식봄 past purchase (same product as the record) pre-fills the recorded pack "1박스 = 4봉" (visible, editable)', pre.join() === 'FACTOR,4,봉', pre.join());
    await b.ev(CLICK('#purchaseReview input[name="pr-pick-3"][value="keep"]'));
    await b.ev(`const s = document.querySelector('#purchaseReview select[name="pr-conv-5"]'); s.value = 'SAME_UNIT'; s.dispatchEvent(new Event('change')); return 1`);
    check('I9 제로콜라 포장 단위: [박스] = "1박스 그대로 구매" selectable', await b.ev(`return document.querySelector('#purchaseReview select[name="pr-conv-5"] option[value="SAME_UNIT"]').textContent === '1박스 그대로 구매'`), '');
    await b.ev(CLICK('[data-pr-submit]')); await b.ev(`await new Promise(r => setTimeout(r, 200)); return 1`);
    const posts = await b.ev(`return window.__posts`);
    const want = [{ line_no: 1, choice: 'CANDIDATE', evidence_id: 1, conversion: 'FACTOR', conversion_factor: 4, supplier_unit: '봉' }, { line_no: 2, choice: 'KEEP' }, { line_no: 3, choice: 'KEEP' }, { line_no: 4, choice: 'KEEP' },
      { line_no: 5, choice: 'NEW_PRODUCT', conversion: 'SAME_UNIT' }, { line_no: 6, choice: 'KEEP' }];
    check('REUSE the existing decision contract: exactly one CONFIRM_MAPPINGS, auto rows = KEEP, 치즈 = the past-purchase evidence, 제로콜라 = NEW_PRODUCT; the source choice is NOT sent (no new backend field)',
      posts.length === 1 && posts[0].action === 'CONFIRM_MAPPINGS' && JSON.stringify(posts[0].lines) === JSON.stringify(want) && !JSON.stringify(posts[0]).includes('SIKBOM'), JSON.stringify(posts));
    const msg = await b.ev(`const rows = [...document.querySelectorAll('#resList .v4-bubble.system')]; return rows.length ? rows[rows.length - 1].textContent : ''`);
    check('the chosen source stays in the conversation, honestly: "제로콜라 2박스: 식봄 — 식봄에서 새 상품 찾기는 아직 자동으로 하지 않아요 …"', msg.includes('제로콜라 2박스: 식봄 — 식봄에서 새 상품 찾기는 아직 자동으로 하지 않아요'), msg.slice(0, 300));
    // ── 규칙 확인: 데이터가 완전하면 치즈도 한 줄 (식봄)
    const full = JSON.parse(JSON.stringify(FIX));
    const ch = full.lines.find(l => l.line_no === 1); ch.mapping.supplier = 'SIKBOM'; ch.mapping.evidence_id = 1; ch.supplier_mappings[0].supplier = 'SIKBOM';
    await b.ev(OPEN(full));
    const sc4 = await b.ev(SCREEN);
    const c1 = sc4.autos.find(a => a.n === 1);
    check('I1c rule check: when the 치즈 record has its supplier (식봄) → compact "✓ 치즈 3박스 / 식봄 · 도노쉐프 … · 2.5kg/봉 · 1박스 = 4봉"', !!c1 && c1.sub === '식봄 · 도노쉐프 피자치즈 (냉장 모짜렐라99%, 2.5Kg) · 2.5kg/봉 · 1박스 = 4봉', JSON.stringify(c1));
    check('MOBILE 390px: no horizontal scroll; the review modal scrolls', !sc.hscroll && await b.ev(`const el = document.getElementById('purchaseReview'); return getComputedStyle(el).overflowY === 'auto'`), '');
    check('I15 current request state unchanged by this screen: 0 network calls from opening / toggling / choosing (the only write is the owner\'s own [확인하고 계속], stubbed here)', (await b.ev(`return window.__net.length`)) === 0, '');
  } catch (e) { check('harness', false, e && e.stack || e); }
  finally { b.close(); }
  done(b.blocked);
})();
