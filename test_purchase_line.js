/*
 * test_purchase_line.js — 대표 화면 한 흐름 (purchase-vertical-slice-line-fix-001): 발주요청 → [공급처 조사 시작] → 구매안 → … → 실제 수령.
 *   WEBLINE-01..06 (research dispatch / idempotency / basket forward / mapping / failure / reload) and RCVWEB-01..06 (Store-3 receipt),
 *   on the REAL purchase block of index.html. NC-LINE-05 (toast-only research), NC-LINE-06 (Store-1 receipt path), NC-LINE-07 (UNKNOWN shown as stock)
 *   are mutated copies that must FAIL the suite. SPIES: fetch (fake purchase-request + purchase-execution), _writerAct / db.rpc (the Store-1 path). No network.
 */
const fs = require('fs');
const path = require('path');
const HTML0 = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const ID = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'migration-packages', 'purchase-address-kind-001', 'BUILD_IDENTITY.json'), 'utf8'));
const READY = { code: 'READINESS', service: 'purchase-execution', api_version: 'pe-v2', package_version: ID.package_version, build_hash: ID.build_hash, capabilities: ID.capabilities, db_build_match: true };
function block(HTML) {
  const a = HTML.indexOf('const _PR_UNITS = '), b = HTML.lastIndexOf('/* ═', HTML.indexOf('   Pending → Confirmed 10초 구조'));
  if (a < 0 || b < a) throw new Error('purchase block not found');
  return HTML.slice(a, b);
}
const RID = '33333333-3333-4333-8333-333333333333';
const DAEJEON = { store_id: 3, display_name: '신세계 대전점', purchasing_enabled: true, authority: ['PURCHASE_APPROVER', 'PURCHASE_REQUESTER'], delivery_profile: { status: 'ACTIVE', version: 2 } };
const REQ = { request_id: RID, received_at: '2026-10-09T10:00:00Z', status: 'READY_FOR_RESEARCH', parse_status: 'COMPLETE', request_version: 2, line_count: 3, unresolved: 0, first_lines: '피클 3캔, 새우 5봉지, 그라나 1봉지' };
const VIEW = { code: 'OK', api_version: 'pe-v2', edge_build_hash: ID.build_hash, windows: [{ supplier: 'SIKBOM', kind: 'PAYMENT_PILOT' }], store_id: 3, display_name: '신세계 대전점', approver: true, purchase_enabled: true,
  delivery: { recipient: '정길수', branch_location: '신세계백화점 대전점 지하 1층 로사안젤라' }, baskets: [], attempts: [] };
const BASKET = { basket_id: 'RS-1', basket_hash: 'a'.repeat(64), groups: [{ supplier: 'SIKBOM', supplier_label: '식봄', total_krw: 72320, shipping_krw: 0, line_count: 3, account_confirmed: true,
  lines: [{ name: '피클', qty: '3' }], presubmit_text: '결제 준비 승인 — 식봄 3품목' }] };
const ORDERS = [{ order_id: 1001, name: '피클', ordered_qty: 6, unit: '캔', received_qty: 0, remaining: 6, delivery_status: 'DELIVERED' },
  { order_id: 1002, name: '칵테일새우 51-70', ordered_qty: 10, unit: '봉지', received_qty: 4, remaining: 6, delivery_status: 'DELIVERED' }];
const RECEIPT = (o = {}) => ({ type: 'RECEIPT', message: '배송완료로 확인됐어요. 실제로 받았나요?', delivered: true, orders: ORDERS, stock_note: '현재 재고는 아직 확인되지 않았습니다.', order_completed: true, receipt_completed: false, ...o });

function makeEnv(html, o = {}) {
  const S = { posts: [], toasts: [], current: o.current || null, view: o.view || VIEW, gets: 0, startCode: o.startCode || 'RESEARCH_REQUESTED', prompts: [...(o.prompts || [])], confirm: o.confirm ?? true, timers: 0, writerActs: [], rpcs: [], reviews: [] };
  const els = {};
  const mkEl = id => ({ id, innerHTML: '', style: {}, children: [], appendChild(c) { this.children.push(c); return c; }, querySelector: () => null, get lastChild() { return null; } });
  const document = { getElementById: id => (els[id] = els[id] || mkEl(id)), createElement: () => mkEl('_'), querySelectorAll: () => [], querySelector: () => null };
  const fetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    if (url.includes('/purchase-request/')) return { ok: true, status: 200, json: async () => ({ api_version: 'pr-v1', ready: true, stores: [DAEJEON], requests: [REQ] }) };
    if (url.includes('/purchase-execution/readiness')) return { ok: true, status: 200, json: async () => READY };
    if (method === 'GET') { S.gets++; return { ok: true, status: 200, json: async () => S.view }; }
    const env = JSON.parse(init.body);
    S.posts.push(env);
    await new Promise(r => setTimeout(r, 3));
    if (env.action === 'GET_CURRENT_PURCHASE_ACTION') return { ok: true, status: 200, json: async () => ({ code: 'CURRENT_ACTION', action: typeof S.current === 'function' ? S.current(S) : S.current, purchase: {}, api_version: 'pe-v2' }) };
    if (env.action === 'START_PURCHASE_RESEARCH') { if (S.afterStart) S.current = S.afterStart; return { ok: true, status: 200, json: async () => ({ code: S.startCode, research: { run_id: 'r1' }, api_version: 'pe-v2' }) }; }
    if (env.action === 'RECORD_PURCHASE_RECEIPT') return { ok: true, status: 200, json: async () => ({ code: 'RECEIPT_RECORDED', api_version: 'pe-v2' }) };
    if (env.action === 'APPROVE_PURCHASE_BASKET') return { ok: true, status: 200, json: async () => ({ code: 'PRESUBMIT_APPROVED', api_version: 'pe-v2' }) };
    return { ok: true, status: 200, json: async () => ({ code: 'INVALID_ACTION', api_version: 'pe-v2' }) };
  };
  let n = 0;
  const env = { document, fetch, SID: 3, SUPABASE_URL: 'https://local.example', SUPABASE_KEY: 'pk', _writerToken: async () => 'tok', _newActionId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
    showToast: t => S.toasts.push(t), localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, addResult() {}, _fmtKst: () => '10월 9일', _storeEpoch: 0, _storeChanged: () => false,
    _switchStore: async () => {}, confirm: () => S.confirm, prompt: () => (S.prompts.length ? S.prompts.shift() : null), console: { log() {}, warn() {}, error() {} }, handleNaturalInput: async () => {},
    setTimeout: () => { S.timers++; return 1; }, _writerAct: async (...a) => { S.writerActs.push(a); return null; }, db: { rpc: async (...a) => { S.rpcs.push(a); return { data: null, error: null }; } } };
  const names = Object.keys(env);
  const f = new Function(...names, `${block(html)}\nreturn { _refreshPurchaseHome, _purchaseResearchStart, _peReceiveAll, _peReceivePartial, _peApproveB };`)(...names.map(k => env[k]));
  const render = async (cur, view) => { if (cur !== undefined) S.current = cur; if (view) S.view = view; await f._refreshPurchaseHome(0); return document.getElementById('purchaseHome').innerHTML; };
  return { S, f, render };
}
const buttons = h => [...h.matchAll(/<button[^>]*data-pe-btn="([^"]+)"[^>]*>([^<]*)<\/button>/g)].map(m => ({ kind: m[1], label: m[2].trim() }));
const peCards = h => (h.match(/<div class="card" data-pe-/g) || []).length;
const posts = (e, a) => e.S.posts.filter(p => p.action === a);

async function suite(html) {
  const out = [];
  const check = (id, ok, detail) => out.push({ id, ok: !!ok, detail });
  // WEBLINE-01 the button dispatches the real research action (exact request version) and the screen moves to "공급처를 조사하고 있습니다."
  let e = makeEnv(html, { current: { type: 'RESEARCH_READY', message: '공급처 조사를 시작할 수 있어요.', request_ref: { request_id: RID, request_version: 2 } } });
  e.S.afterStart = { type: 'RESEARCHING', message: '공급처를 조사하고 있습니다.' };
  let h0 = await e.render();
  await e.f._purchaseResearchStart(RID);
  let h = (await e.render());
  check('WEBLINE-01 [공급처 조사 시작] dispatches START_PURCHASE_RESEARCH (request id + exact version) — no toast-only stub; the same screen then shows "공급처를 조사하고 있습니다." and re-checks by itself',
    /공급처 조사 시작/.test(h0) && posts(e, 'START_PURCHASE_RESEARCH').length === 1 && posts(e, 'START_PURCHASE_RESEARCH')[0].request_id === RID && posts(e, 'START_PURCHASE_RESEARCH')[0].request_version === 2
    && e.S.toasts.some(t => /공급처 조사를 시작했어요/.test(t)) && h.includes('data-pe-current="research"') && h.includes('공급처를 조사하고 있습니다.') && e.S.timers >= 1, { posts: e.S.posts, toasts: e.S.toasts });
  // WEBLINE-02 a double click → one request; a server duplicate → the same friendly state
  e = makeEnv(html, { startCode: 'RESEARCH_IN_PROGRESS' });
  await e.render();
  await Promise.all([e.f._purchaseResearchStart(RID), e.f._purchaseResearchStart(RID)]);
  check('WEBLINE-02 double click → ONE START_PURCHASE_RESEARCH; the server\'s "already running" → the same "조사를 시작했어요" state (no second mission)',
    posts(e, 'START_PURCHASE_RESEARCH').length === 1 && e.S.toasts.filter(t => /공급처 조사를 시작했어요/.test(t)).length === 1, e.S);
  // WEBLINE-03 success → "구매안을 준비했습니다." + the basket card (Approval B) with the payment-method policy line; B sends the policy
  e = makeEnv(html, { current: { type: 'BASKET_READY', message: '구매안을 준비했습니다.' }, view: { ...VIEW, baskets: [BASKET] } });
  h = await e.render();
  await e.f._peApproveB('RS-1', 'SIKBOM');
  const bp = posts(e, 'APPROVE_PURCHASE_BASKET')[0];
  check('WEBLINE-03 research done → "구매안을 준비했습니다." right above the basket card [결제 준비 승인] (+ "결제수단: 식봄에 등록된 기본 즉시결제 수단 사용"); B carries payment_method_policy',
    h.indexOf('구매안을 준비했습니다.') >= 0 && h.indexOf('구매안을 준비했습니다.') < h.indexOf('data-pe-basket') && buttons(h).some(b => b.kind === 'B') && /결제수단: 식봄에 등록된 기본 즉시결제 수단 사용/.test(h)
    && bp && bp.payment_method_policy === 'PROVIDER_DEFAULT_STORED_METHOD', { h, bp });
  // WEBLINE-04 mapping required → ONE card naming the products + [품목 확인하기] (the existing review)
  e = makeEnv(html, { current: { type: 'RESEARCH_MAPPING_REQUIRED', message: '2개 제품만 확인해주세요.', items: ['그라나빠다노', '할라페뇨'], request_ref: { request_id: RID, request_version: 2 } } });
  h = await e.render();
  check('WEBLINE-04 products to confirm → "2개 제품만 확인해주세요." + the names + [품목 확인하기] opening the existing review for that request',
    peCards(h) === 1 && h.includes('2개 제품만 확인해주세요.') && h.includes('그라나빠다노 · 할라페뇨') && new RegExp(`data-pe-btn="REVIEW" onclick="_purchaseOpenReview\\('${RID}'\\)"`).test(h), { h });
  // WEBLINE-05 provider failure → actionable: [다시 조사하기] → a new START
  e = makeEnv(html, { current: { type: 'RESEARCH_FAILED', message: '공급처 정보를 확인하지 못했습니다.', request_ref: { request_id: RID, request_version: 2 } } });
  h = await e.render();
  await e.f._purchaseResearchStart(RID);
  check('WEBLINE-05 provider failure → "공급처 정보를 확인하지 못했습니다." + [다시 조사하기] that dispatches a new research (never a dead toast)',
    h.includes('공급처 정보를 확인하지 못했습니다.') && buttons(h).some(b => b.kind === 'RESEARCH_RETRY' && b.label === '다시 조사하기') && posts(e, 'START_PURCHASE_RESEARCH').length === 1, { h, p: e.S.posts });
  // WEBLINE-06 reload → the state comes back from the server
  const e1 = makeEnv(html, { current: { type: 'RESEARCHING', message: '공급처를 조사하고 있습니다.' } }); const e2 = makeEnv(html, { current: { type: 'RESEARCHING', message: '공급처를 조사하고 있습니다.' } });
  const r1 = await e1.render(), r2 = await e2.render();
  check('WEBLINE-06 a reload restores the current state from the server (two fresh pages render the same research card; nothing kept in the browser)', r1 === r2 && r1.includes('공급처를 조사하고 있습니다.'), { r1 });
  // RCVWEB-01 delivered → the physical receipt prompt
  e = makeEnv(html, { current: RECEIPT() });
  h = await e.render();
  check('RCVWEB-01 a delivered Store-3 order → ONE card "배송완료로 확인됐어요. 실제로 받았나요?" with each open order (ordered / received / remaining) + [전부 받았어요] [일부만 받았어요]',
    peCards(h) === 1 && h.includes('배송완료로 확인됐어요. 실제로 받았나요?') && h.includes('피클 6캔 중 0 받음 · 남은 6캔') && h.includes('칵테일새우 51-70 10봉지 중 4 받음 · 남은 6봉지')
    && JSON.stringify(buttons(h).map(b => b.label)) === '["전부 받았어요","일부만 받았어요"]', { h });
  // RCVWEB-02 full receipt → the Store-3 owner per open order (remaining quantity, physical confirmation); double click once
  await Promise.all([e.f._peReceiveAll(), e.f._peReceiveAll()]);
  const rc = posts(e, 'RECORD_PURCHASE_RECEIPT');
  check('RCVWEB-02 [전부 받았어요] → RECORD_PURCHASE_RECEIPT for every open order with its remaining quantity + physical_receipt_confirmed (stable idempotency keys); a double click sends once',
    rc.length === 2 && rc[0].order_id === 1001 && rc[0].received_qty === 6 && rc[1].order_id === 1002 && rc[1].received_qty === 6 && rc.every(p => p.physical_receipt_confirmed === true && /^zkr:/.test(p.idempotency_key))
    && e.S.toasts.includes('받은 수량을 기록했어요'), { rc });
  // RCVWEB-03 partial → only what the owner typed (validated against the remaining quantity)
  e = makeEnv(html, { current: RECEIPT(), prompts: ['2', '9'] });
  await e.render();
  await e.f._peReceivePartial();
  const rp = posts(e, 'RECORD_PURCHASE_RECEIPT');
  check('RCVWEB-03 [일부만 받았어요] → the typed quantity per order: 피클 2 recorded; 새우 9 (> remaining 6) refused before any request',
    rp.length === 1 && rp[0].order_id === 1001 && rp[0].received_qty === 2 && e.S.toasts.some(t => /남은 수량 이하/.test(t)), { rp, t: e.S.toasts });
  // RCVWEB-04 UNKNOWN stays UNKNOWN on screen
  e = makeEnv(html, { current: RECEIPT() });
  h = await e.render();
  check('RCVWEB-04 an UNKNOWN stock: "현재 재고는 아직 확인되지 않았습니다." and no stock number on the card (the received quantity is never shown as the stock)',
    h.includes('현재 재고는 아직 확인되지 않았습니다.') && !/현재 재고\s*[0-9]/.test(h.replace(/<[^>]*>/g, ' ')), { h });
  // RCVWEB-05 the Store-1 path is never used for a Store-3 receipt; the Store-1 receipt code itself is unchanged
  e = makeEnv(html, { current: RECEIPT(), prompts: ['1'] });
  await e.render(); await e.f._peReceiveAll(); await e.f._peReceivePartial();
  check('RCVWEB-05 Store-3 receipts never call the Store-1 path (_writerAct FULL/PARTIAL_RECEIPT, db.rpc complete_order_receiving): 0 calls; the Store-1 receipt functions are still in the page as before',
    e.S.writerActs.length === 0 && e.S.rpcs.length === 0 && posts(e, 'RECORD_PURCHASE_RECEIPT').length >= 2
    && html.includes("await _writerAct('FULL_RECEIPT', { order_id: orderId });") && html.includes("db.rpc('complete_order_receiving', { p_order_id: orderId, p_store_id: SID })"), { w: e.S.writerActs, r: e.S.rpcs });
  // RCVWEB-06 delivery ≠ receipt
  e = makeEnv(html, { current: RECEIPT({ message: '주문 완료 · 배송 중입니다. 받으면 알려 주세요.', delivered: false }) });
  h = await e.render();
  check('RCVWEB-06 delivery ≠ receipt: in transit the card says so; rendering (or a DELIVERED status) records nothing — only the owner\'s button does',
    h.includes('주문 완료 · 배송 중입니다.') && posts(e, 'RECORD_PURCHASE_RECEIPT').length === 0 && buttons(h).length === 2, { h });
  return out;
}

(async () => {
  let fail = 0;
  for (const r of await suite(HTML0)) { if (!r.ok) fail++; console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.id}${r.ok ? '' : '  — ' + JSON.stringify(r.detail).slice(0, 900)}`); }
  const NCS = [
    ['NC-LINE-05', 'research button stays toast-only', ['WEBLINE-01'], [[`    const r = await _pePost('START_PURCHASE_RESEARCH', { request_id: requestId, request_version: Number(req.request_version) });`, `    const r = null; showToast('공급처 조사는 다음 단계에서 연결됩니다', 3500);`]]],
    ['NC-LINE-06', 'Store-3 receipt through the Store-1 path', ['RCVWEB-02', 'RCVWEB-05'], [[`  for (const [o, q] of list) out.push(await _pePost('RECORD_PURCHASE_RECEIPT', { order_id: o.order_id, received_qty: q, idempotency_key: _peRcvKey(o, q), physical_receipt_confirmed: true }));`,
      `  for (const [o, q] of list) out.push(await _writerAct(q === Number(o.remaining) ? 'FULL_RECEIPT' : 'PARTIAL_RECEIPT', { order_id: o.order_id, received_qty: q }));`]]],
    ['NC-LINE-07', 'UNKNOWN receipt shown as a stock number', ['RCVWEB-04'], [["중 ${_peQty(o.received_qty)} 받음 · 남은 ${_peQty(o.remaining)}${_prEsc(o.unit)}</div>`).join('');", "중 ${_peQty(o.received_qty)} 받음 · 남은 ${_peQty(o.remaining)}${_prEsc(o.unit)} · 현재 재고 ${_peQty(o.received_qty)}</div>`).join('');"]]],
  ];
  for (const [id, what, want, muts] of NCS) {
    let bad = HTML0, miss = null;
    for (const [a, b] of muts) { if (bad.split(a).length !== 2) { miss = a.slice(0, 80); break; } bad = bad.replace(a, () => b); }
    if (miss) { console.log(`FAIL  ${id} anchor not found: ${miss}`); fail++; continue; }
    const caught = (await suite(bad)).filter(r => !r.ok).map(r => r.id.split(' ')[0]);
    const ok = want.every(w => caught.includes(w));
    if (!ok) fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${id} ${what} → ${ok ? 'DETECTED' : 'NOT DETECTED'} (${caught.join(', ')})`);
  }
  console.log(`\n${fail ? 'FAILED' : 'ALL PASS'} (${fail} failed)`);
  process.exit(fail ? 1 : 0);
})();
