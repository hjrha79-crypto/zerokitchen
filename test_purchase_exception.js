/*
 * test_purchase_exception.js — 구매 예외 루프의 대표 화면 (purchase-exception-resume-001): ONE current action.
 *   WEB-PX-01..08 on the REAL purchase block of index.html (_refreshPurchaseHome → GET_CURRENT_PURCHASE_ACTION → _peCurrentHtml / _peDecide),
 *   NC-WEB-PX-01: a mutated copy that renders a disabled option (무통장입금) as a button / sends it must FAIL the suite.
 * SPIES: fetch (a fake purchase-request + purchase-execution server that records every envelope). No network.
 */
const fs = require('fs');
const path = require('path');
const HTML0 = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const IDF = path.join(__dirname, '..', 'migration-packages', 'purchase-vertical-slice-line-fix-001', 'BUILD_IDENTITY.json');   // the current pin
const ID = JSON.parse(fs.readFileSync(IDF, 'utf8'));
const READY = { code: 'READINESS', service: 'purchase-execution', api_version: 'pe-v2', package_version: ID.package_version, build_hash: ID.build_hash, capabilities: ID.capabilities, db_build_match: true };

function block(HTML) {
  const a = HTML.indexOf('const _PR_UNITS = '), b = HTML.lastIndexOf('/* ═', HTML.indexOf('   Pending → Confirmed 10초 구조'));
  if (a < 0 || b < a) throw new Error('purchase block not found');
  return HTML.slice(a, b);
}
const DAEJEON = { store_id: 3, display_name: '신세계 대전점', purchasing_enabled: true, authority: ['PURCHASE_APPROVER', 'PURCHASE_REQUESTER'], delivery_profile: { status: 'ACTIVE', version: 2 } };
const VIEW = { code: 'OK', api_version: 'pe-v2', edge_build_hash: ID.build_hash, windows: [], store_id: 3, display_name: '신세계 대전점', approver: true, purchase_enabled: true, delivery: {}, baskets: [],
  attempts: [{ attempt_id: '11111111-1111-4111-8111-111111111111', state: 'OUTCOME_UNKNOWN', supplier: 'SIKBOM', supplier_label: '식봄', submitted: true, address_switched: false, address: { state: 'PRE_SUBMIT_READY' } }] };
const REF = { exception_id: '22222222-2222-4222-8222-222222222222', exception_version: 1, expected_revision: 2, options_hash: 'c'.repeat(64) };
const DECISION = { type: 'PAYMENT_EXCEPTION_DECISION', title: '결제를 완료하지 못했습니다.', message: '현재 결제수단으로 결제를 완료하지 못했습니다.', supplier: '식봄', decision_ref: REF,
  options: [{ option_id: 'opt_aaaaaaaaaaaaaaaa', label: '다른 저장 결제수단: 저장 카드 2', enabled: true, info: null },
    { option_id: 'opt_bbbbbbbbbbbbbbbb', label: '무통장입금', enabled: false, info: '현재 자동 진행 정책에서는 사용할 수 없습니다.' },
    { option_id: 'opt_cccccccccccccccc', label: '주문 중단', enabled: true, info: null }] };

function makeEnv(html, current, o = {}) {
  const S = { posts: [], toasts: [], current, gets: 0, decide: o.decide || 'DECISION_RECORDED', confirm: o.confirm ?? true };
  const els = {};
  const mkEl = id => ({ id, innerHTML: '', style: {}, children: [], appendChild(c) { this.children.push(c); return c; }, querySelector: () => null, get lastChild() { return null; } });
  const document = { getElementById: id => (els[id] = els[id] || mkEl(id)), createElement: () => mkEl('_'), querySelectorAll: () => [], querySelector: () => null };
  const fetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    if (url.includes('/purchase-request/')) return { ok: true, status: 200, json: async () => ({ api_version: 'pr-v1', ready: true, stores: [DAEJEON], requests: [] }) };
    if (url.includes('/purchase-execution/readiness')) return { ok: true, status: 200, json: async () => READY };
    if (method === 'GET') { S.gets++; return { ok: true, status: 200, json: async () => S.view || VIEW }; }
    const env = JSON.parse(init.body);
    S.posts.push(env);
    await new Promise(r => setTimeout(r, 5));
    if (env.action === 'GET_CURRENT_PURCHASE_ACTION') return { ok: true, status: 200, json: async () => ({ code: 'CURRENT_ACTION', action: S.current, purchase: {}, api_version: 'pe-v2' }) };
    if (env.action === 'DECIDE_EXCEPTION') return { ok: true, status: S.decide === 'STALE_EXCEPTION' ? 409 : 200, json: async () => ({ code: S.decide, api_version: 'pe-v2' }) };
    return { ok: true, status: 200, json: async () => ({ code: 'INVALID_ACTION', api_version: 'pe-v2' }) };
  };
  let n = 0;
  const env = { document, fetch, SID: 3, SUPABASE_URL: 'https://local.example', SUPABASE_KEY: 'pk', _writerToken: async () => 'tok', _newActionId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
    showToast: t => S.toasts.push(t), localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, addResult() {}, _fmtKst: () => '10월 9일', _storeEpoch: 0, _storeChanged: () => false,
    _switchStore: async () => {}, confirm: () => S.confirm, console: { log() {}, warn() {}, error() {} }, handleNaturalInput: async () => {} };
  const names = Object.keys(env);
  const f = new Function(...names, `${block(html)}\nreturn { _refreshPurchaseHome, _peDecide };`)(...names.map(k => env[k]));
  const render = async (cur, view) => { if (cur !== undefined) S.current = cur; if (view) S.view = view; await f._refreshPurchaseHome(0); return document.getElementById('purchaseHome').innerHTML; };
  return { S, f, render };
}
const buttons = h => [...h.matchAll(/<button[^>]*data-pe-btn="([^"]+)"[^>]*>([^<]*)<\/button>/g)].map(m => ({ kind: m[1], label: m[2].trim() }));
const visibleText = h => h.replace(/<[^>]*>/g, ' ');
const cards = h => (h.match(/<div class="card" data-pe-/g) || []).length;   // purchase-execution cards (the request home card is separate)

async function suite(html) {
  const out = [];
  const check = (id, ok, detail) => out.push({ id, ok: !!ok, detail });
  let e = makeEnv(html, DECISION);
  let h = await e.render();
  const b = buttons(h);
  check('WEB-PX-01 ONE current action: the decision card alone — "결제를 완료하지 못했습니다." / "현재 결제수단으로 결제를 완료하지 못했습니다." + [다른 저장 결제수단: 저장 카드 2] [주문 중단]; 무통장입금 shown disabled with "현재 자동 진행 정책에서는 사용할 수 없습니다."; no internal enum / id / hash in the visible text',
    cards(h) === 1 && h.includes('data-pe-current="decision"') && h.includes('결제를 완료하지 못했습니다.') && h.includes('현재 결제수단으로 결제를 완료하지 못했습니다.')
    && b.length === 2 && b[0].label === '다른 저장 결제수단: 저장 카드 2' && b[1].label === '주문 중단' && /data-pe-option-disabled[^>]*>무통장입금 — 현재 자동 진행 정책에서는 사용할 수 없습니다\./.test(h)
    && !/PAYMENT_|EXCEPTION|DECLINED|opt_|2222|cccc/.test(visibleText(h)) && e.S.posts.filter(p => p.action === 'GET_CURRENT_PURCHASE_ACTION').length === 1 && e.S.posts[0].store_id === 3, { h, b });
  await Promise.all([e.f._peDecide('opt_aaaaaaaaaaaaaaaa'), e.f._peDecide('opt_aaaaaaaaaaaaaaaa')]);
  const d = e.S.posts.filter(p => p.action === 'DECIDE_EXCEPTION');
  check('WEB-PX-02 [다른 저장 결제수단] → exactly ONE DECIDE_EXCEPTION carrying the exact exception / version / revision / options hash + the option; a double click sends once; never APPROVE_PAYMENT; "다른 결제수단으로 다시 진행합니다"',
    d.length === 1 && d[0].exception_id === REF.exception_id && d[0].exception_version === 1 && d[0].expected_revision === 2 && d[0].options_hash === REF.options_hash && d[0].option_id === 'opt_aaaaaaaaaaaaaaaa'
    && !e.S.posts.some(p => p.action === 'APPROVE_PAYMENT') && e.S.toasts.includes('다른 결제수단으로 다시 진행합니다'), e.S.posts);
  e = makeEnv(html, DECISION); await e.render();
  await e.f._peDecide('opt_bbbbbbbbbbbbbbbb');
  check('WEB-PX-03 the disabled 무통장입금 option can never be sent (no button; a forced call sends nothing)', !e.S.posts.some(p => p.action === 'DECIDE_EXCEPTION'), e.S.posts);
  e = makeEnv(html, DECISION, { confirm: false }); await e.render();
  await e.f._peDecide('opt_cccccccccccccccc');
  const noCancel = !e.S.posts.some(p => p.action === 'DECIDE_EXCEPTION');
  e.S.confirm = true; await e.f._peDecide('opt_cccccccccccccccc');
  check('WEB-PX-04 [주문 중단] asks first; declined → nothing sent; confirmed → one DECIDE_EXCEPTION (cancel) and "주문을 중단했습니다"',
    noCancel && e.S.posts.filter(p => p.action === 'DECIDE_EXCEPTION').length === 1 && e.S.toasts.includes('주문을 중단했습니다'), e.S);
  e = makeEnv(html, { type: 'RESUMING', message: '다른 결제수단으로 다시 진행하고 있습니다.' });
  const hr = await e.render();
  const hu = await e.render({ type: 'OUTCOME_CHECK', message: '주문 결과를 확인하고 있습니다. 다시 결제하지 않습니다.' });
  check('WEB-PX-05 after the decision: "다른 결제수단으로 다시 진행하고 있습니다." (no button); unknown outcome: "주문 결과를 확인하고 있습니다. 다시 결제하지 않습니다." (no button, no re-approval)',
    cards(hr) === 1 && hr.includes('다른 결제수단으로 다시 진행하고 있습니다.') && buttons(hr).length === 0 && cards(hu) === 1 && hu.includes('주문 결과를 확인하고 있습니다. 다시 결제하지 않습니다.') && buttons(hu).length === 0, { hr, hu });
  const hp = await e.render({ type: 'IN_PROGRESS', message: '주문 중입니다' }, { ...VIEW, attempts: [{ ...VIEW.attempts[0], state: 'EXECUTING', submitted: false, payment_allowed: false }] });
  const hc = await e.render({ type: 'COMPLETED', message: '주문 완료' }, { ...VIEW, attempts: [{ ...VIEW.attempts[0], state: 'SUCCEEDED', order: { paid_total_krw: 144800 } }] });
  check('WEB-PX-06 normal: "주문 중입니다" (one card, no button); completed: the existing "주문 완료" card (with its address line) stays',
    cards(hp) === 1 && hp.includes('주문 중입니다') && buttons(hp).length === 0 && /data-pe-head>주문 완료</.test(hc), { hp, hc });
  e = makeEnv(html, DECISION, { decide: 'STALE_EXCEPTION' }); await e.render(); const g0 = e.S.gets;
  await e.f._peDecide('opt_aaaaaaaaaaaaaaaa');
  check('WEB-PX-07 a stale card (409 STALE_EXCEPTION) → "상황이 바뀌었어요 — 최신 화면을 다시 확인해 주세요" and the screen is refreshed (never retried with the old token)',
    e.S.toasts.includes('상황이 바뀌었어요 — 최신 화면을 다시 확인해 주세요') && e.S.gets > g0 && e.S.posts.filter(p => p.action === 'DECIDE_EXCEPTION').length === 1, e.S);
  e = makeEnv(html, null);
  const hn = await e.render(null, { ...VIEW, attempts: [{ ...VIEW.attempts[0], state: 'OUTCOME_UNKNOWN' }] });
  const hs = await e.render(DECISION, { ...VIEW, approver: false });
  check('WEB-PX-08 no current action → the existing cards unchanged; a non-approver never asks for / gets a decision card',
    hn.includes('주문 결과를 확인하고 있습니다.') && !hn.includes('data-pe-current') && !hs.includes('data-pe-current') && e.S.posts.filter(p => p.action === 'GET_CURRENT_PURCHASE_ACTION').length === 1, { hn, hs });
  return out;
}

(async () => {
  let fail = 0;
  for (const r of await suite(HTML0)) { if (!r.ok) fail++; console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.id}${r.ok ? '' : '  — ' + JSON.stringify(r.detail).slice(0, 700)}`); }
  // NC-WEB-PX-01: disabled options rendered as buttons and sent → the suite must fail
  const from = "const o = a && (a.options || []).find(x => x.option_id === optionId && x.enabled);";
  const from2 = "const opts = decide ? (a.options || []).map(o => o.enabled";
  if (HTML0.split(from).length !== 2 || HTML0.split(from2).length !== 2) { console.log('FAIL  NC-WEB-PX-01 anchor not found'); fail++; }
  else {
    const bad = HTML0.replace(from, "const o = a && (a.options || []).find(x => x.option_id === optionId);").replace(from2, "const opts = decide ? (a.options || []).map(o => true");
    const caught = (await suite(bad)).filter(r => !r.ok).map(r => r.id.split(' ')[0]);
    const ok = caught.includes('WEB-PX-01') && caught.includes('WEB-PX-03');
    if (!ok) fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  NC-WEB-PX-01 disabled 무통장입금 sent → ${ok ? 'DETECTED' : 'NOT DETECTED'} (${caught.join(', ')})`);
  }
  console.log(`\n${fail ? 'FAILED' : 'ALL PASS'} (${fail} failed)`);
  process.exit(fail ? 1 : 0);
})();
