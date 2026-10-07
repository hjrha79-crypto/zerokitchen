/*
 * test_purchase_request.js — 매장 발주요청 라우터 (STORE_PURCHASE_REQUEST): REQ-ROUTE-01..08, PARSE-SAFETY, UX-01..03, NC-DAE-01
 *
 * REAL from index.html: handleNaturalInput, the existing router (_inputIntentOf / detectCommand / _splitMixedQuery / the physical-count
 * classifier), ruleEngine, and the WHOLE purchase-request block (_purchaseParse, _purchaseIntentOf, _purchaseRoute, _purchasePost,
 * _purchaseShowResult, _purchaseSummaryText, _purchaseReviewCollect …). SPIES: processRequest, db writes, the LLM / complex flow,
 * fetch (a fake purchase-request server that records every envelope). No network.
 */
const fs = require('fs');
const path = require('path');
const HTML0 = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { if (ok) pass++; else fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? '  — ' + String(detail).slice(0, 600) : ''}`); };
const J = x => JSON.stringify(x, (k, v) => (['card', 'parentElement', 'children'].includes(k) ? undefined : v));
const FIXTURE = ['안녕하시지요', '치즈 3박스', '피클 6캔', '파인애플 6캔', '휘핑크림 1박스', '칵테일새우 51-70 10봉지', '칵테일새우 26-30 3봉지', '불고기 5kg',
  '피자소스 3캔', '그라나빠다노 2봉지', '할라페뇨 2캔', '파프리카 분말 1통', '발주부탁합니다'].join('\n');

function build(HTML) {
  function extractFn(name) {
    let start = HTML.indexOf('async function ' + name + '(');
    if (start < 0) start = HTML.indexOf('function ' + name + '(');
    if (start < 0) throw new Error('function not found: ' + name);
    let depth = 0, i = HTML.indexOf('{', start);
    for (; i < HTML.length; i++) { const c = HTML[i]; if (c === '{') depth++; else if (c === '}') { depth--; if (depth === 0) { i++; break; } } }
    return HTML.slice(start, i);
  }
  const constLine = n => { const m = new RegExp(`const ${n} = [^\\n]+`).exec(HTML); if (!m) throw new Error('const not found: ' + n); return m[0]; };
  const RULE_BLOCK = HTML.slice(HTML.indexOf('const _NUM_WORDS = {'), HTML.indexOf('function ruleEngine(') + extractFn('ruleEngine').length);
  const ROUTER = ['_ZERO_HALF_RE', '_HAS_ACTION_RE', '_INTERROGATIVE_RE', '_QUESTION_END_RE', '_READ_ONLY_CMDS', '_trailingQryRe', '_MIX_ACTION_TOKEN_RE'].map(constLine).join('\n')
    + '\nlet _numUnitRe = null;\n' + ['_hasExplicitQty', 'detectCommand', '_inputIntentOf', '_splitMixedQuery', '_isComplexInput'].map(extractFn).join('\n');
  const PC_BLOCK = HTML.slice(HTML.indexOf('const _PC_ORDER'), HTML.indexOf('// 확정 OrderNeed'));
  const a = HTML.indexOf('const _PR_UNITS = '), b = HTML.lastIndexOf('/* ═', HTML.indexOf('   Pending → Confirmed 10초 구조'));
  if (a < 0 || b < a) throw new Error('purchase block not found');
  const PURCHASE = HTML.slice(a, b);
  return { extractFn, RULE_BLOCK, ROUTER, PC_BLOCK, PURCHASE };
}

// a fake purchase-request server: records envelopes; answers like the real one would for the shape the Web reads
function fakeServer({ stores }) {
  const S = { posts: [], gets: [] };
  const summary = { line_count: 11, confirmed: 0, candidate_found: 8, needs_check: 3, unresolved: 11 };
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    if ((init.method || 'GET') === 'GET') {
      S.gets.push(u.search);
      return { ok: true, status: 200, json: async () => ({ api_version: 'pr-v1', ready: true, stores, requests: [
        { request_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', received_at: '2026-10-07T01:00:00Z', status: 'MAPPING_REQUIRED', line_count: 11, unresolved: 11, first_lines: '치즈 3박스, 피클 6캔, 파인애플 6캔' }], request: null }) };
    }
    const env = JSON.parse(init.body);
    S.posts.push(env);
    const body = env.action === 'SUBMIT_REQUEST'
      ? { code: 'RECEIVED', request_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', request: { request_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', store_id: env.store_id, display_name: '신세계 대전점', status: 'MAPPING_REQUIRED', summary, unparsed_lines: [], lines: [] } }
      : { code: 'CANCELLED' };
    return { ok: true, status: 200, json: async () => body };
  };
  return { S, fetch };
}
const DAEJEON = { store_id: 3, display_name: '신세계 대전점', purchasing_enabled: true, authority: ['PURCHASE_APPROVER', 'PURCHASE_REQUESTER'], delivery_profile: { status: 'CANDIDATE', version: 1, branch_location: '신세계백화점 대전점 지하 1층 로사안젤라' } };
const ITEMS = [{ item_id: 11, item_name: '스파게티니', unit: '개', current_qty: 15 }, { item_id: 10, item_name: '치즈', unit: '봉', current_qty: 3 }];

function makeEnv({ html = HTML0, sid = 3, stores = [DAEJEON], ready = true } = {}) {
  const B = build(html);
  const srv = fakeServer({ stores });
  const S = { requests: [], results: [], dbWrites: [], llm: [], complex: [], rule: [], toasts: [], ls: {} };
  const els = {};
  const mkEl = id => ({ id, value: '', innerHTML: '', placeholder: '', disabled: false, children: [], style: {},
    classList: { contains: c => (id === 'tab-input' && c === 'active') }, appendChild(ch) { this.children.push(ch); ch.parentElement = this; return ch; },
    get lastChild() { return this.children[this.children.length - 1] || null; }, focus() {}, remove() {}, querySelector: () => null });
  const document = { getElementById: id => (id === 'parseLoading' ? null : (els[id] = els[id] || mkEl(id))), createElement: () => mkEl('_'), querySelectorAll: () => [], querySelector: () => null };
  const tbl = table => { const b = { select: () => b, eq: () => b, in: () => b, order: () => b, limit: () => b, then: r => Promise.resolve({ data: [], error: null }).then(r) };
    for (const w of ['insert', 'update', 'delete', 'upsert']) b[w] = () => { S.dbWrites.push({ table, op: w }); return b; };
    return b; };
  let n = 0;
  const env = {
    document, db: { from: tbl, rpc: async () => ({ data: [], error: null }) },
    _items: ITEMS.map(x => ({ ...x })), _vendors: [], _storeAliases: [], _claudeApiKey: 'k',
    console: { log() {}, warn() {}, error() {} },
    showToast: t => S.toasts.push(t), _saveLastInput() {}, refreshItems: async () => {}, renderInventory() {}, renderOrder() {}, _patchOrderTable() {},
    _handleComplexQtyAnswer() {}, _startComplexQtyFlow: () => { S.complex.push('flow'); }, _parseComplexInput: async t => { S.llm.push(t); return []; }, _applyAlias: x => x,
    addResult: (raw, msg, type) => { const card = mkEl('card'); card.msg = msg; card.type = type; S.results.push({ raw, msg, type, card }); document.getElementById('resList').appendChild(card); },
    formatResult: r => JSON.stringify(r), askClaudeQuestion: async q => `답:${q}`, _showConfigConfirm: async () => false, _showConfigCard: async () => {},
    processRequest: async req => { S.requests.push(JSON.parse(JSON.stringify(req))); return { status: 'success', response_type: 'x', operation_ids: [] }; },
    parseWithClaude: async t => { S.llm.push(t); return []; },
    draftToRequest: items => ({ request_type: 'inventory_update', items: items.map(it => ({ name: it.item_name, quantity: it.quantity, unit: it.unit, action_type: it.action })) }),
    SID: sid, _writerReady: ready, TRUSTED_STOCK_CHECK: 'trusted_stock_check', _loadInventoryTrust: async () => {},
    SUPABASE_URL: 'https://local.example', SUPABASE_KEY: 'pk', _writerToken: async () => 'tok', _newActionId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
    fetch: srv.fetch, localStorage: { getItem: k => S.ls[k] ?? null, setItem: (k, v) => { S.ls[k] = String(v); }, removeItem: k => { delete S.ls[k]; } },
    _fmtKst: () => '10월 7일 10:00', _storeEpoch: 0, _storeChanged: () => false, _switchStore: async () => {}, confirm: () => true,
  };
  const names = Object.keys(env);
  const body = `let _nlProcessing = false, _draftItems = [], _parseMeta = {}, _sessionInputs = [], _complexQtyState = null, _pendingComplexItems = null;
    ${B.RULE_BLOCK}
    ${B.ROUTER}
    ${B.PC_BLOCK}
    ${B.PURCHASE}
    ${B.extractFn('handleNaturalInput')}
    return { handleNaturalInput, _purchaseParse, _purchaseIntentOf, _purchaseSummaryText, _purchaseReviewCollect, _purchaseReviewHtml, _purchaseHomeHtml, get purchase() { return _purchase; } };`;
  const f = new Function(...names, body)(...names.map(k => env[k]));
  const run = async raw => { document.getElementById('nlInput').value = raw; let err = null; try { await f.handleNaturalInput(); } catch (e) { err = e; } return err; };
  const stockWrites = () => S.requests.filter(r => r.request_type === 'inventory_update');
  const orderWrites = () => S.requests.filter(r => /order/.test(r.request_type || '') && r.request_type !== 'order_generate').length + S.dbWrites.filter(w => /order/.test(w.table)).length + S.complex.length;
  return { S, srv, f, run, stockWrites, orderWrites };
}

async function scenario(raw, opts) { const e = makeEnv(opts); const err = await e.run(raw); return { e, err, posts: e.srv.S.posts, msg: e.S.results.at(-1)?.msg || '' }; }

(async () => {
  const fx = await scenario(FIXTURE);
  check('REQ-ROUTE-01 the 11-line manager message (Daejeon store) → STORE_PURCHASE_REQUEST: exactly one SUBMIT_REQUEST with the raw text byte-for-byte; first screen "신세계 대전점 발주요청 11개를 읽었습니다."',
    !fx.err && fx.posts.length === 1 && fx.posts[0].action === 'SUBMIT_REQUEST' && fx.posts[0].raw_text === FIXTURE && fx.posts[0].store_id === 3 && /^신세계 대전점 발주요청 11개를 읽었습니다\./.test(fx.msg), J({ err: fx.err && String(fx.err), posts: fx.posts.length, msg: fx.msg }));
  check('REQ-ROUTE-02 stock writes = 0: no inventory_update, no db write, the rule engine / LLM / count path never ran',
    fx.e.stockWrites().length === 0 && fx.e.S.dbWrites.length === 0 && fx.e.S.llm.length === 0 && fx.e.S.requests.length === 0, J(fx.e.S));
  check('REQ-ROUTE-03 order writes = 0: no order request, no complex order flow, no draft', fx.e.orderWrites() === 0, J(fx.e.S));
  const p = fx.e.f._purchaseParse(FIXTURE);
  check('REQ-ROUTE-04 "51-70" / "26-30" stay specifications (10 / 3 봉지), never quantities',
    p.lines[4].specification_text === '51-70' && p.lines[4].requested_qty === 10 && p.lines[5].specification_text === '26-30' && p.lines[5].requested_qty === 3, J(p.lines.slice(4, 6)));
  check('REQ-ROUTE-05 greeting "안녕하시지요" / ending "발주부탁합니다" excluded from the 11 lines (kept as skipped, not items)',
    p.lines.length === 11 && J(p.skipped.map(x => x.kind)) === J(['GREETING', 'CLOSING']) && !p.lines.some(l => /안녕|발주/.test(l.raw_item_text)), J(p));

  const s1 = await scenario('스파게티니 5개', { sid: 1 });
  const sD = await scenario('스파게티니 5개', { sid: 3 });
  check('REQ-ROUTE-06 single stock input "스파게티니 5개" → the existing physical-count path unchanged (one trusted stock_check), no purchase request — in store 1 and in the Daejeon store',
    s1.posts.length === 0 && s1.e.S.requests.length === 1 && s1.e.S.requests[0]._source === 'trusted_stock_check' && sD.posts.length === 0 && sD.e.S.requests.length === 1, J({ s1: s1.e.S.requests, sD: sD.e.S.requests }));
  const q1 = await scenario('치즈 3박스였나?');
  const q2 = await scenario('스파게티니 몇 개 남았어?');
  check('REQ-ROUTE-07 questions stay questions: "치즈 3박스였나?" / "스파게티니 몇 개 남았어?" → no purchase request, no write (read only)',
    q1.posts.length === 0 && q1.e.stockWrites().length === 0 && q1.e.S.dbWrites.length === 0 && q2.posts.length === 0 && q2.e.stockWrites().length === 0
    && q2.e.S.requests.every(r => r.request_type === 'inventory_read'), J({ q1: q1.e.S, q2: q2.e.S.requests }));
  const c1 = await scenario('스파게티니 기록만 5개로 수정');
  check('REQ-ROUTE-08 correction "스파게티니 기록만 5개로 수정" → the existing record correction (not a count, not a purchase request)',
    c1.posts.length === 0 && c1.e.S.requests.length === 1 && c1.e.S.requests[0]._source === 'record_correction', J(c1.e.S.requests));

  // PARSE-SAFETY (spec §8): stock mutation 0 for every phrase; clear requests vs quotes / questions / cancels
  const safety = {};
  for (const t of ['치즈 3박스 발주 부탁합니다', '피클 6캔 주문해주세요', '어제 보낸 발주 문자 다시 보여줘', '발주 취소할게', '치즈 3박스였나?']) {
    const r = await scenario(t);
    safety[t] = { posts: r.posts.map(x => x.action), gets: r.e.srv.S.gets.length, stock: r.e.stockWrites().length, db: r.e.S.dbWrites.length, orders: r.e.orderWrites(), msg: r.msg };
  }
  const zero = Object.values(safety).every(x => x.stock === 0 && x.db === 0 && x.orders === 0);
  check('PARSE-SAFETY-01 stock / order mutation 0 for all five phrases; "치즈 3박스 발주 부탁합니다" / "피클 6캔 주문해주세요" → one SUBMIT_REQUEST each',
    zero && J(safety['치즈 3박스 발주 부탁합니다'].posts) === J(['SUBMIT_REQUEST']) && J(safety['피클 6캔 주문해주세요'].posts) === J(['SUBMIT_REQUEST']), J(safety));
  check('PARSE-SAFETY-02 "어제 보낸 발주 문자 다시 보여줘" → read only (recent requests listed, nothing sent); "발주 취소할게" → a preview asking which request (nothing cancelled); "치즈 3박스였나?" → nothing',
    safety['어제 보낸 발주 문자 다시 보여줘'].posts.length === 0 && /최근 발주요청/.test(safety['어제 보낸 발주 문자 다시 보여줘'].msg)
    && safety['발주 취소할게'].posts.length === 0 && /어떤 발주요청을 취소할까요\? — 아직 아무것도 취소하지 않았습니다/.test(safety['발주 취소할게'].msg)
    && safety['치즈 3박스였나?'].posts.length === 0, J(safety));
  const other = await scenario(FIXTURE, { sid: 1 });
  const none = await scenario(FIXTURE, { sid: 1, stores: [] });
  check('PARSE-SAFETY-03 the message pasted on another store\'s tab → still a purchase request (never stock / orders): nothing sent until a person picks "신세계 대전점"; with no purchase store at all → explained, nothing written',
    other.posts.length === 0 && other.e.stockWrites().length === 0 && other.e.orderWrites() === 0 && /어느 매장의 요청인가요/.test(other.msg)
    && /신세계 대전점/.test(other.e.S.results.at(-1).card.children.at(-1)?.innerHTML || '') && none.posts.length === 0 && /발주요청을 받을 매장이 없어요/.test(none.msg) && none.e.stockWrites().length === 0, J({ other: other.msg, none: none.msg }));
  const single1 = await scenario('치즈 3박스 발주 부탁합니다', { sid: 1 });
  check('PARSE-SAFETY-04 a single-line order phrase in a store that does not take purchase requests → the existing flow (no purchase request; no stock write)',
    single1.posts.length === 0 && single1.e.stockWrites().length === 0, J(single1.e.S));

  const flat = await scenario(FIXTURE.replace(/\n/g, ''));
  check('INPUT-ML-01 the chat input keeps pasted line breaks: #nlInput is a <textarea> (not <input type=text>, which drops them); Enter sends without inserting a line break, Shift+Enter keeps one',
    /<textarea class="nl-input" id="nlInput"/.test(HTML0) && !/<input class="nl-input" id="nlInput"/.test(HTML0)
    && /e\.key==='Enter' && !e\.shiftKey && document\.activeElement===document\.getElementById\('nlInput'\)\) \{ e\.preventDefault\(\); handleNaturalInput\(\); \}/.test(HTML0), '');
  check('INPUT-ML-02 if the line breaks are lost anyway (one glued line with many "qty+unit" + 발주) → still a purchase request (the server keeps the raw text as unread), never the stock parser',
    flat.posts.length === 1 && flat.posts[0].action === 'SUBMIT_REQUEST' && flat.e.stockWrites().length === 0 && flat.e.S.llm.length === 0 && flat.e.orderWrites() === 0, J(flat.e.S));
  const f = fx.e.f;
  const txt = f._purchaseSummaryText({ display_name: '신세계 대전점', status: 'MAPPING_REQUIRED', summary: { line_count: 11, confirmed: 0, candidate_found: 8, needs_check: 3 }, unparsed_lines: [] });
  const ready = f._purchaseSummaryText({ display_name: '신세계 대전점', status: 'READY_FOR_RESEARCH', summary: { line_count: 11, confirmed: 11 }, unparsed_lines: [] });
  check('UX-01 first screen = "신세계 대전점 발주요청 11개를 읽었습니다. / 8개는 품목 후보를 찾았고, 3개는 확인이 필요합니다. / 구매 전에 제품/포장만 한 번 확인해주세요."; after review = "11개 매핑 완료 / 식봄·쿠팡 가격/배송을 확인할 준비가 됐습니다."',
    txt === '신세계 대전점 발주요청 11개를 읽었습니다.\n8개는 품목 후보를 찾았고, 3개는 확인이 필요합니다.\n구매 전에 제품/포장만 한 번 확인해주세요.'
    && ready === '신세계 대전점 발주요청 11개 매핑 완료\n식봄·쿠팡 가격/배송을 확인할 준비가 됐습니다.', J({ txt, ready }));
  const req = { request_id: 'r', request_version: 1, display_name: '신세계 대전점', summary: { line_count: 3 }, lines: [
    { line_no: 1, raw_item_text: '치즈', requested_qty: 3, requested_unit: '박스', mapping_status: 'CANDIDATE', mapping_confidence: 'LOW', candidates: [{ evidence_id: 7, scope: 'STORE_ORDER_HISTORY', product_name: '도노쉐프 2.5kg', supplier: 'SIKBOM' }], references: [{ product_name: '테스트매장 품목 치즈 (item 100)' }] },
    { line_no: 2, raw_item_text: '파인애플', requested_qty: 6, requested_unit: '캔', mapping_status: 'CANDIDATE', mapping_confidence: 'LOW', candidates: [{ evidence_id: 8, scope: 'STRATEGY_CENSUS', product_name: 'A' }, { evidence_id: 9, scope: 'STRATEGY_CENSUS', product_name: 'B' }], references: [] },
    { line_no: 3, raw_item_text: '파프리카 분말', requested_qty: 1, requested_unit: '통', mapping_status: 'UNMAPPED', mapping_confidence: 'NONE', candidates: [], references: [] }] };
  const html = f._purchaseReviewHtml(req);
  const vals = { 'pr-pick-1': 'ev:7', 'pr-conv-1': 'SAME_UNIT', 'pr-pick-2': '', 'pr-conv-2': '', 'pr-pick-3': 'new', 'pr-conv-3': 'FACTOR', 'pr-factor-3': '0', 'pr-sunit-3': '' };
  const part = f._purchaseReviewCollect(req, k => vals[k]);
  const full = f._purchaseReviewCollect(req, k => ({ ...vals, 'pr-pick-2': 'ev:9', 'pr-conv-2': 'UNKNOWN', 'pr-factor-3': '4', 'pr-sunit-3': '개' })[k]);
  check('UX-02 one grouped review screen (all lines, one "N개 품목 확인 완료" button): the single candidate pre-selected, two candidates NOT pre-selected, no-candidate → "새 품목으로 등록"; parse confidence ≠ product confidence shown; other-store items only as "참고(다른 매장)"',
    (html.match(/data-pr-line=/g) || []).length === 3 && /3개 품목 확인 완료/.test(html) && /value="ev:7" checked/.test(html) && !/value="ev:8" checked/.test(html) && !/value="ev:9" checked/.test(html)
    && /value="new" checked> 새 품목으로 등록/.test(html) && /읽기 확실 · 제품 확신도 낮음/.test(html) && /참고\(다른 매장\): 테스트매장 품목 치즈 \(item 100\) — 이 매장 제품으로 쓰지 않음/.test(html), html.slice(0, 400));
  check('UX-03 nothing is guessed: an unpicked product / package or an invalid "1통 = ?" blocks sending (listed by name); a complete screen → exactly one decision per line (CANDIDATE evidence / NEW_PRODUCT, SAME_UNIT / UNKNOWN / FACTOR 4 개)',
    part.missing.length === 2 && /파인애플 \(제품\)/.test(part.missing.join()) && /파프리카 분말 \(포장 수량·단위\)/.test(part.missing.join())
    && J(full.lines) === J([{ line_no: 1, choice: 'CANDIDATE', evidence_id: 7, conversion: 'SAME_UNIT' }, { line_no: 2, choice: 'CANDIDATE', evidence_id: 9, conversion: 'UNKNOWN' },
      { line_no: 3, choice: 'NEW_PRODUCT', conversion: 'FACTOR', conversion_factor: 4, supplier_unit: '개' }]) && full.missing.length === 0, J({ part, full }));
  const home = f._purchaseHomeHtml(DAEJEON, [{ request_id: 'x', received_at: 't', status: 'MAPPING_REQUIRED', line_count: 11, unresolved: 3 }]);
  check('UX-04 Home card in the purchase store: "신세계 대전점 발주요청" · "11개 · 품목 확인 필요 3개" [품목 확인하기]; delivery profile shown as not yet confirmed',
    /신세계 대전점 발주요청/.test(home) && /11개 · 품목 확인 필요 3개/.test(home) && /품목 확인하기/.test(home) && /주소 확인 전/.test(home), home);

  // NC-DAE-01: the router hook removed → the manager message reaches the stock / order parsers → REQ-ROUTE-02 fails by assertion
  const hook = "if (typeof _purchaseRoute === 'function' && await _purchaseRoute(raw)) return;";
  if (HTML0.split(hook).length !== 2) throw new Error('NC anchor not found');
  const mutated = makeEnv({ html: HTML0.replace(hook, '') });
  await mutated.run(FIXTURE);
  const routed02 = mutated.stockWrites().length === 0 && mutated.S.dbWrites.length === 0 && mutated.S.llm.length === 0 && mutated.S.requests.length === 0;
  check('NC-DAE-01 purchase request routed to the stock / order parsers (router hook removed) → REQ-ROUTE-02 fails by assertion (the LLM / complex or stock path ran); index.html untouched',
    !routed02 && mutated.srv.S.posts.length === 0 && fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8') === HTML0, J(mutated.S));

  console.log(`\nRESULT: ${pass} PASS / ${fail} FAIL (of ${pass + fail})`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FAIL harness ' + (e.stack || e)); process.exit(1); });
