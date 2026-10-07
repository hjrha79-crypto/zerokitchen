/*
 * test_purchase_approval.js — 대표용 구매 승인 화면: [결제 준비 승인](Approval B) / [○○원 결제 승인](Approval C) 분리, 결과 확인 중, 배송지 원복 표시.
 *   WEB-PE-01..07 on the REAL purchase block of index.html (_purchaseHomeHtml … _peApproveB / _peApproveC / _peResolveRestore),
 *   NC-SAFE-07: a mutated copy where the B button also sends the payment approval (one button for B + C) must FAIL the suite.
 *   readiness-003: WEB-PE-08..12 — exact server version gate (pe-v2 / package / build / capabilities) and the field-certification gate on the C button.
 * SPIES: fetch (a fake purchase-request + purchase-execution server that records every envelope). No network.
 */
const fs = require('fs');
const path = require('path');
const HTML0 = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const IDF = path.join(__dirname, '..', 'migration-packages', 'store-purchase-production-readiness-003', 'BUILD_IDENTITY.json');
const BUILD = (/const _PE_BUILD = '([0-9a-f]{64})'/.exec(HTML0) || [])[1];
const CAPS = ['APPROVAL_B', 'APPROVAL_C', 'PAYMENT_APPROVAL_REQUIRED', 'ADDRESS_LIFECYCLE', 'FIELD_CERTIFICATION', 'SIKBOM_DRIVER_V1', 'SAFE_DEFAULT_KILL_SWITCH', 'PURCHASE_EXECUTION_ORDER_INGEST', 'EXPLICIT_OPEN_CHECKOUT', 'EDGE_BUILD_BINDING'];
const READY = { code: 'READINESS', service: 'purchase-execution', api_version: 'pe-v2', package_version: 'store-purchase-production-readiness-003', build_hash: BUILD, capabilities: CAPS, db_build_match: true };

function block(HTML) {
  const a = HTML.indexOf('const _PR_UNITS = '), b = HTML.lastIndexOf('/* ═', HTML.indexOf('   Pending → Confirmed 10초 구조'));
  if (a < 0 || b < a) throw new Error('purchase block not found');
  return HTML.slice(a, b);
}
const DAEJEON = { store_id: 3, display_name: '신세계 대전점', purchasing_enabled: true, authority: ['PURCHASE_APPROVER', 'PURCHASE_REQUESTER'], delivery_profile: { status: 'ACTIVE', version: 2 } };
const BASE = { code: 'OK', api_version: 'pe-v2', edge_build_hash: BUILD, windows: [{ supplier: 'SIKBOM', kind: 'PRESUBMIT_FIELD' }], store_id: 3, display_name: '신세계 대전점', approver: true, purchase_enabled: true,
  delivery: { recipient: '정길수', address_line: '대전 유성구 엑스포로 1 (도룡동) 신세계백화점 대전점', branch_location: '신세계백화점 대전점 지하 1층 로사안젤라', version: 2 } };
const BASKET = { basket_id: 'STG-basket-1', basket_hash: 'a'.repeat(64), groups: [{ supplier: 'SIKBOM', supplier_label: '식봄', total_krw: 144800, shipping_krw: 0, line_count: 3, account_confirmed: true,
  lines: [{ name: '새찬 프레시오이피클(3Kg/EA)', qty: '6' }, { name: 'PRIDE 냉동새우살 51~70', qty: '10' }, { name: '기데티 그라나파다노 1Kg', qty: '2' }],
  presubmit_text: '결제 준비 승인 — 식봄 3품목 총 144,800원, 신세계 대전점 배송 (결제는 따로 승인)' }] };
const SNAP = { snapshot_hash: 'b'.repeat(64), payment_text: '144,800원 결제 승인 — 식봄 3품목, 신세계 대전점 배송', total_krw: 144800, shipping_krw: 0, eta_text: '10.9 (금) 도착',
  address: { postal_code: '34126', address_text: '대전 유성구 엑스포로 1 (도룡동) 신세계백화점 대전점 지하 1층 로사안젤라', recipient_name: '정길수' },
  lines: [{ name: '새찬 프레시오이피클(3Kg/EA)', qty: '6', line_total_krw: 40740 }, { name: 'PRIDE 냉동새우살 51~70', qty: '10', line_total_krw: 39400 }, { name: '기데티 그라나파다노 1Kg', qty: '2', line_total_krw: 64660 }] };
const ORIG = { label: '경기광주점', address_text: '경기 광주시 …', recipient_name: '김점장' };
const att = (o) => ({ attempt_id: '11111111-1111-4111-8111-111111111111', state: 'EXECUTING', supplier: 'SIKBOM', supplier_label: '식봄', submitted: false, address_switched: true, original_address: ORIG,
  address: { state: 'PRE_SUBMIT_READY' }, snapshot: SNAP, payment_approval: null, payment_allowed: true, payment_block: null, ...o });

function makeEnv(html, view, ready = READY) {
  const S = { posts: [], toasts: [], view, gets: [], ready };
  const els = {};
  const mkEl = id => ({ id, innerHTML: '', style: {}, children: [], appendChild(c) { this.children.push(c); return c; }, querySelector: () => null, get lastChild() { return null; } });
  const document = { getElementById: id => (els[id] = els[id] || mkEl(id)), createElement: () => mkEl('_'), querySelectorAll: () => [], querySelector: () => null };
  const fetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    if (url.includes('/purchase-request/')) return { ok: true, status: 200, json: async () => ({ api_version: 'pr-v1', ready: true, stores: [DAEJEON], requests: [] }) };
    if (url.includes('/purchase-execution/readiness')) { S.gets.push('readiness'); return S.ready ? { ok: true, status: 200, json: async () => S.ready } : { ok: false, status: 404, json: async () => ({ code: 'UNKNOWN_ROUTE' }) }; }
    if (method === 'GET') { S.gets.push('view'); return { ok: true, status: 200, json: async () => S.view }; }
    const env = JSON.parse(init.body);
    S.posts.push(env);
    await new Promise(r => setTimeout(r, 5));
    const code = { APPROVE_PURCHASE_BASKET: 'PRESUBMIT_APPROVED', APPROVE_PAYMENT: 'PAYMENT_APPROVED', RESOLVE_ADDRESS_RESTORE: 'ADDRESS_RESTORED' }[env.action] || 'INVALID_ACTION';
    return { ok: true, status: 200, json: async () => ({ code, api_version: 'pe-v2' }) };
  };
  let n = 0;
  const env = { document, fetch, SID: 3, SUPABASE_URL: 'https://local.example', SUPABASE_KEY: 'pk', _writerToken: async () => 'tok', _newActionId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
    showToast: t => S.toasts.push(t), localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, addResult() {}, _fmtKst: () => '10월 8일', _storeEpoch: 0, _storeChanged: () => false,
    _switchStore: async () => {}, confirm: () => true, console: { log() {}, warn() {}, error() {} }, handleNaturalInput: async () => {} };
  const names = Object.keys(env);
  const f = new Function(...names, `${block(html)}\nreturn { _refreshPurchaseHome, _peApproveB, _peApproveC, _peResolveRestore };`)(...names.map(k => env[k]));
  const render = async (v, r) => { S.view = v; if (r !== undefined) S.ready = r; await f._refreshPurchaseHome(0); return document.getElementById('purchaseHome').innerHTML; };
  return { S, f, render };
}
const buttons = h => [...h.matchAll(/<button[^>]*data-pe-btn="([^"]+)"[^>]*>([^<]*)<\/button>/g)].map(m => ({ kind: m[1], label: m[2].trim() }));
const cardOf = (h, attr) => { const i = h.indexOf(attr); if (i < 0) return ''; const j = h.indexOf('<div class="card"', i + 1); return h.slice(i, j < 0 ? undefined : j); };

async function suite(html) {
  const out = [];
  const check = (id, ok, detail) => out.push({ id, ok: !!ok, detail });
  // WEB-PE-01 basket card (Approval B only)
  let e = makeEnv(html);
  let h = await e.render({ ...BASE, baskets: [BASKET], attempts: [] });
  const bc = cardOf(h, 'data-pe-basket');
  const b1 = buttons(bc);
  check('WEB-PE-01 basket card: "신세계 대전점 발주 / 식봄 3품목 · 총 144,800원 / 배송: 신세계백화점 대전점 … · 정길수 / 배송지 변경·원복 안내" + exactly ONE button [결제 준비 승인] (no payment button)',
    bc.includes('신세계 대전점 발주') && bc.includes('식봄 3품목 · 총 144,800원') && bc.includes('배송: 신세계백화점 대전점 지하 1층 로사안젤라 · 정길수') && bc.includes('기본 배송지를 신세계 대전점으로 변경합니다')
    && bc.includes('원래 배송지로 다시 되돌립니다') && b1.length === 1 && b1[0].kind === 'B' && b1[0].label === '결제 준비 승인' && !/data-pe-btn="C"/.test(h), { bc, b1 });
  // WEB-PE-02 B click → exactly one APPROVE_PURCHASE_BASKET (address switch allowed), never a payment approval; a double click sends once
  await Promise.all([e.f._peApproveB('STG-basket-1', 'SIKBOM'), e.f._peApproveB('STG-basket-1', 'SIKBOM')]);
  check('WEB-PE-02 [결제 준비 승인] → one APPROVE_PURCHASE_BASKET (basket hash, presubmit text, allow_address_switch=true); never APPROVE_PAYMENT; double click → one request',
    e.S.posts.length === 1 && e.S.posts[0].action === 'APPROVE_PURCHASE_BASKET' && e.S.posts[0].allow_address_switch === true && e.S.posts[0].approval_text === BASKET.groups[0].presubmit_text
    && e.S.posts[0].basket_hash === BASKET.basket_hash && !e.S.posts.some(p => p.action === 'APPROVE_PAYMENT'), e.S.posts);
  // WEB-PE-03 pre-submit card (Approval C only)
  e = makeEnv(html);
  h = await e.render({ ...BASE, baskets: [], attempts: [att()] });
  const pc = cardOf(h, 'data-pe-attempt');
  const b3 = buttons(pc);
  check('WEB-PE-03 "결제 준비 완료": 상품 / 수량 / 배송비 / 총액 / 배송지 / 수령인 / ETA + exactly ONE button [144,800원 결제 승인] (no B button)',
    pc.includes('결제 준비 완료') && pc.includes('새찬 프레시오이피클(3Kg/EA) 6') && pc.includes('배송비 0원 · 총 144,800원') && pc.includes('신세계백화점 대전점 지하 1층 로사안젤라') && pc.includes('수령인 정길수')
    && pc.includes('10.9 (금) 도착') && b3.length === 1 && b3[0].kind === 'C' && b3[0].label === '144,800원 결제 승인' && !/data-pe-btn="B"/.test(h), { pc, b3 });
  await Promise.all([e.f._peApproveC(att().attempt_id), e.f._peApproveC(att().attempt_id)]);
  check('WEB-PE-04 [144,800원 결제 승인] → one APPROVE_PAYMENT bound to the snapshot hash + payment text; double click → one request',
    e.S.posts.length === 1 && e.S.posts[0].action === 'APPROVE_PAYMENT' && e.S.posts[0].snapshot_hash === SNAP.snapshot_hash && e.S.posts[0].payment_text === SNAP.payment_text, e.S.posts);
  // WEB-PE-05 outcome unknown / C already given: no payment button, no re-approval, no address button
  e = makeEnv(html);
  const hu = await e.render({ ...BASE, baskets: [], attempts: [att({ state: 'OUTCOME_UNKNOWN', submitted: true, payment_approval: { state: 'CONSUMED' }, address: { state: 'PRE_SUBMIT_READY' } })] });
  const ha = await e.render({ ...BASE, baskets: [], attempts: [att({ payment_approval: { state: 'ACTIVE' } })] });
  check('WEB-PE-05 "주문 결과를 확인하고 있습니다." with no button at all (no payment / re-approval / address restore); an ACTIVE C shows "결제 승인됨 — 결제 진행 중" without a button',
    hu.includes('주문 결과를 확인하고 있습니다.') && buttons(hu).length === 0 && ha.includes('결제 승인됨 — 결제 진행 중') && buttons(ha).length === 0, { hu, ha });
  // WEB-PE-06 restore: success and failure are separate lines; the order line stays "주문 완료"
  const order = { paid_total_krw: 144800 };
  const hr = await e.render({ ...BASE, baskets: [], attempts: [att({ state: 'SUCCEEDED', submitted: true, order, address: { state: 'ADDRESS_RESTORED' } })] });
  const hf = await e.render({ ...BASE, baskets: [], attempts: [att({ state: 'SUCCEEDED', submitted: true, order, address: { state: 'ADDRESS_RESTORE_REQUIRED' } })] });
  const headR = (/data-pe-head>([^<]*)</.exec(hr) || [])[1], headF = (/data-pe-head>([^<]*)</.exec(hf) || [])[1];
  check('WEB-PE-06 "주문 완료" + a separate line "식봄 기본 배송지를 경기광주점으로 되돌렸습니다." / "⚠ 식봄 기본 배송지 원복 필요" + "주문은 완료됐지만 식봄 기본 배송지를 경기광주점으로 되돌리지 못했습니다."',
    headR === '주문 완료' && /data-pe-addr="restored"[^>]*>식봄 기본 배송지를 경기광주점으로 되돌렸습니다\./.test(hr) && headF === '주문 완료'
    && /data-pe-addr="restore-required"[^>]*>⚠ 식봄 기본 배송지 원복 필요/.test(hf) && hf.includes('주문은 완료됐지만 식봄 기본 배송지를 경기광주점으로 되돌리지 못했습니다.')
    && buttons(hf).length === 1 && buttons(hf)[0].kind === 'resolve' && !/결제 승인/.test(hf), { hr, hf });
  await e.f._peResolveRestore(att().attempt_id);
  check('WEB-PE-07 [직접 되돌렸어요] → RESOLVE_ADDRESS_RESTORE (restored_by_hand) only — never a purchase action', e.S.posts.length === 1 && e.S.posts[0].action === 'RESOLVE_ADDRESS_RESTORE' && e.S.posts[0].restored_by_hand === true, e.S.posts);
  // ── readiness-003: exact server version gate (EDGE3-01 on the Web) + field certification gate on the C button
  const ver = [['WEB-PE-08 old Edge (pe-v1, no readiness route)', null], ['API pe-v1', { ...READY, api_version: 'pe-v1' }], ['WEB-PE-09 wrong build hash', { ...READY, build_hash: 'f'.repeat(64) }],
    ['WEB-PE-10 capability missing', { ...READY, capabilities: CAPS.filter(c => c !== 'FIELD_CERTIFICATION') }], ['DB build mismatch', { ...READY, db_build_match: false }]];
  const vr = [];
  for (const [name, r] of ver) { const ev = makeEnv(html); const hv = await ev.render({ ...BASE, baskets: [BASKET], attempts: [att()] }, r); vr.push({ name, notReady: /PURCHASE_EXECUTION_VERSION_NOT_READY/.test(hv), buttons: buttons(hv).length, view: ev.S.gets.includes('view') }); }
  check('WEB-PE-08 an old Edge (pe-v1 / no readiness) → PURCHASE_EXECUTION_VERSION_NOT_READY: no B / C button, the purchase view is not even fetched',
    vr.slice(0, 2).every(v => v.notReady && v.buttons === 0 && !v.view), vr);
  check('WEB-PE-09 wrong build hash (or a DB contract of another build) → not ready, no buttons', vr[2].notReady && vr[2].buttons === 0 && vr[4].notReady && vr[4].buttons === 0, vr);
  check('WEB-PE-10 a required capability missing → not ready, no buttons', vr[3].notReady && vr[3].buttons === 0, vr);
  e = makeEnv(html);
  const hn = await e.render({ ...BASE, baskets: [], attempts: [att({ payment_allowed: false, payment_block: 'REAL_FIELD_CERTIFICATION_REQUIRED' })] });
  await e.f._peApproveC(att().attempt_id);
  const hw = await e.render({ ...BASE, baskets: [BASKET], windows: [], attempts: [] });
  check('WEB-PE-11 no real no-payment FIELD certification: pre-submit card says "실제 무결제 실행 검증이 아직 완료되지 않았습니다." + "이번 실행은 결제 없이 종료하고 배송지와 장바구니를 복구합니다." — no payment button, no C request; no open window → no B button',
    hn.includes('실제 무결제 실행 검증이 아직 완료되지 않았습니다.') && hn.includes('이번 실행은 결제 없이 종료하고 배송지와 장바구니를 복구합니다.') && buttons(hn).length === 0 && e.S.posts.length === 0
    && buttons(hw).length === 0 && hw.includes('구매 실행 스위치가 꺼져 있어요'), { hn, hw, posts: e.S.posts });
  e = makeEnv(html);
  const hc = await e.render({ ...BASE, baskets: [], attempts: [att()] });
  check('WEB-PE-12 certified + payment pilot open (server payment_allowed) → [144,800원 결제 승인] shown; the server gate stays the final authority',
    buttons(hc).length === 1 && buttons(hc)[0].kind === 'C' && BUILD && (!fs.existsSync(IDF) || JSON.parse(fs.readFileSync(IDF, 'utf8')).build_hash === BUILD), { hc, BUILD });
  return out;
}

(async () => {
  let fail = 0;
  for (const r of await suite(HTML0)) { if (!r.ok) fail++; console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.id}${r.ok ? '' : '  — ' + JSON.stringify(r.detail).slice(0, 700)}`); }
  // NC-SAFE-07: ONE button for B + C (the basket button also sends the payment approval) → the suite must fail
  const from = `    showToast(r && r.code === 'PRESUBMIT_APPROVED'`;
  if (HTML0.split(from).length !== 2) { console.log('FAIL  NC-SAFE-07 anchor not found'); fail++; }
  else {
    const bad = HTML0.replace(from, `    await _pePost('APPROVE_PAYMENT', { attempt_id: 'x', snapshot_hash: 'x', payment_text: 'x' });\n${from}`).replace('>결제 준비 승인</button>', '>결제 승인</button>');
    const res = await suite(bad);
    const caught = res.filter(r => !r.ok).map(r => r.id.split(' ')[0]);
    const ok = caught.includes('WEB-PE-01') && caught.includes('WEB-PE-02');
    if (!ok) fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  NC-SAFE-07 one Web button for B + C → ${ok ? 'DETECTED' : 'NOT DETECTED'} (${caught.join(', ')})`);
  }
  console.log(`\n${fail ? 'FAILED' : 'ALL PASS'} (${fail} failed)`);
  process.exit(fail ? 1 : 0);
})();
