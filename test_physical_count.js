/*
 * test_physical_count.js — single-item chat physical count (PHYSICAL_COUNT_ASSERTION): COUNT-CHAT-01..07 + NC-AUTO-06
 *
 * "스파게티니 5개" from a signed-in Store operator = a count just made → the SAME trusted record Count Mode writes
 * (kitchen_operations.input_method = trusted_stock_check). Past ("어제 …였어"), hedged ("아마 …"), order intent ("…주문해")
 * and "기록만 …로 수정" are not physical counts. Old ordinary edits are never promoted retroactively.
 * REAL from index.html: handleNaturalInput, ruleEngine (+ tables), the router, _physicalCountClass / _physicalCountAssertion /
 * _recordCorrectionOf, _inventoryTrustOf, the Count Mode save source. SPIES: processRequest, _loadInventoryTrust. No network.
 */
const fs = require('fs');
const path = require('path');
const HTML0 = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { if (ok) pass++; else fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? '  — ' + String(detail).slice(0, 500) : ''}`); };
const J = x => JSON.stringify(x);

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
  return { extractFn, constLine, RULE_BLOCK, ROUTER, PC_BLOCK };
}

const ITEMS = [{ item_id: 77, item_name: '스파게티니', unit: '개', current_qty: 15 }, { item_id: 1, item_name: '우유', unit: '박스', current_qty: 3 }];

function makeEnv({ html = HTML0, ready = true } = {}) {
  const B = build(html);
  const S = { requests: [], results: [], trustReloads: 0, dbWrites: [] };
  const els = {};
  const mkEl = id => ({ id, value: '', innerHTML: '', placeholder: '', disabled: false, children: [], style: {},
    classList: { contains: c => (id === 'tab-input' && c === 'active') }, appendChild(ch) { this.children.push(ch); return ch; }, get lastChild() { return this.children[this.children.length - 1] || null; }, focus() {}, remove() {} });
  const document = { getElementById: id => (id === 'parseLoading' ? null : (els[id] = els[id] || mkEl(id))), createElement: () => mkEl('_'), querySelectorAll: () => [], querySelector: () => null };
  const tbl = table => { const b = { select: () => b, eq: () => b, in: () => b, order: () => b, limit: () => b, then: r => Promise.resolve({ data: [], error: null }).then(r) };
    for (const w of ['insert', 'update', 'delete', 'upsert']) b[w] = () => { S.dbWrites.push({ table, op: w }); return b; };
    return b; };
  const env = {
    document, db: { from: tbl, rpc: async () => ({ data: [], error: null }) },
    _items: ITEMS.map(x => ({ ...x })), _vendors: [], _storeAliases: [], _claudeApiKey: 'k',
    console: { log() {}, warn() {}, error() {} },
    showToast() {}, _saveLastInput() {}, refreshItems: async () => {}, renderInventory() {}, renderOrder() {}, _patchOrderTable() {},
    _handleComplexQtyAnswer() {}, _startComplexQtyFlow: () => {}, _parseComplexInput: async () => [], _applyAlias: n => n,
    addResult: (raw, msg, type) => S.results.push({ raw, msg, type }),
    formatResult: r => JSON.stringify(r), askClaudeQuestion: async q => `답:${q}`, _showConfigConfirm: async () => false, _showConfigCard: async () => {},
    processRequest: async req => { S.requests.push(JSON.parse(JSON.stringify(req))); return { status: 'success', response_type: 'inventory_update_result', operation_ids: [] }; },
    parseWithClaude: async () => [],
    draftToRequest: items => ({ request_type: 'inventory_update', items: items.map(it => ({ name: it.item_name, quantity: it.quantity, unit: it.unit, action_type: it.action })) }),
    _stopMicUI() {}, _restoreUI() {},
    SID: 1, _writerReady: ready, TRUSTED_STOCK_CHECK: 'trusted_stock_check', _loadInventoryTrust: async () => { S.trustReloads++; },
  };
  const names = Object.keys(env);
  const body = `let _nlProcessing = false, _draftItems = [], _parseMeta = {}, _sessionInputs = [], _complexQtyState = null, _pendingComplexItems = null;
    ${B.RULE_BLOCK}
    ${B.ROUTER}
    ${B.PC_BLOCK}
    ${B.extractFn('handleNaturalInput')}
    return { handleNaturalInput, _physicalCountClass, _physicalCountAssertion };`;
  const f = new Function(...names, body)(...names.map(n => env[n]));
  const run = async raw => { document.getElementById('nlInput').value = raw; let err = null; try { await f.handleNaturalInput(); } catch (e) { err = e; } return err; };
  const stockWrites = () => S.requests.filter(r => r.request_type === 'inventory_update' && (r.items || []).some(i => ['stock_check', 'inbound', 'consume', undefined].includes(i.action_type)));
  return { S, f, run, stockWrites };
}

async function scenarios(opts = {}) {
  const out = {};
  { const e = makeEnv(opts); await e.run('스파게티니 5개'); out.c01 = { reqs: e.S.requests, reload: e.S.trustReloads, msg: e.S.results.at(-1)?.msg || '' }; }
  { const e = makeEnv({ ...opts, ready: false }); await e.run('스파게티니 5개'); out.c01b = { reqs: e.S.requests }; }
  { const e = makeEnv(opts); const err = await e.run('어제 스파게티니 5개였어'); out.c02 = { reqs: e.S.requests, msg: e.S.results.at(-1)?.msg || '', err: err && String(err) }; }
  { const e = makeEnv(opts); const err = await e.run('스파게티니 5개 주문해'); out.c03 = { reqs: e.S.requests, stock: e.stockWrites(), err: err && String(err) }; }
  { const e = makeEnv(opts); const err = await e.run('아마 스파게티니 5개'); out.c04 = { reqs: e.S.requests, msg: e.S.results.at(-1)?.msg || '', err: err && String(err) }; }
  { const e = makeEnv(opts); const err = await e.run('스파게티니 기록만 5개로 수정'); out.c05 = { reqs: e.S.requests, msg: e.S.results.at(-1)?.msg || '', err: err && String(err) }; }
  return out;
}
const trusted = r => r && r._source === 'trusted_stock_check';
const verdicts = o => ({
  '01': o.c01.reqs.length === 1 && trusted(o.c01.reqs[0]) && o.c01.reqs[0].items.length === 1 && o.c01.reqs[0].items[0].name === '스파게티니' && o.c01.reqs[0].items[0].quantity === 5
    && o.c01.reqs[0].items[0].action_type === 'stock_check' && /실사로 기록/.test(o.c01.msg),
  '01b': o.c01b.reqs.length === 1 && o.c01b.reqs[0]._source === 'fast_path',
  '02': o.c02.reqs.length === 0 && /지난 수량은 현재 재고로 기록하지 않았어요/.test(o.c02.msg),
  '03': !o.c03.reqs.some(trusted) && o.c03.stock.length === 0,
  '04': o.c04.reqs.length === 0 && /정확히 센 수량이면/.test(o.c04.msg),
  '05': o.c05.reqs.length === 1 && o.c05.reqs[0]._source === 'record_correction' && o.c05.reqs[0].items[0].quantity === 5 && !trusted(o.c05.reqs[0]) && /실사 아님/.test(o.c05.msg),
});

(async () => {
  const o = await scenarios();
  const v = verdicts(o);
  check('COUNT-CHAT-01 "스파게티니 5개" (signed-in Store operator, one canonical item, 개 = item unit, present tense) → ONE stock record with the trusted source (trusted_stock_check); trust re-read; "실사로 기록"',
    v['01'] && o.c01.reload === 1, J(o.c01));
  check('COUNT-CHAT-01b the same words signed out → recorded as before (fast_path), NOT trusted (an authenticated operator is required)', v['01b'], J(o.c01b));
  check('COUNT-CHAT-02 "어제 스파게티니 5개였어" → no current trusted count, nothing written ("지난 수량은 현재 재고로 기록하지 않았어요")', v['02'], J(o.c02));
  check('COUNT-CHAT-03 "스파게티니 5개 주문해" → no stock mutation, nothing trusted (order intent, not a count)', v['03'], J(o.c03));
  check('COUNT-CHAT-04 "아마 스파게티니 5개" → clarification, no trusted write, nothing written', v['04'], J(o.c04));
  check('COUNT-CHAT-05 "스파게티니 기록만 5개로 수정" → a record correction (source record_correction), not a physical count', v['05'], J(o.c05));

  // COUNT-CHAT-06: one truth system — the chat count, Count Mode and the explicit [재고 확인] write the same trusted row shape,
  // judged by the same _inventoryTrustOf; a correction / an old ordinary edit is never a trust basis.
  const B = build(HTML0);
  const trustOf = new Function(`${B.constLine('TRUSTED_STOCK_CHECK')}\n${B.extractFn('_inventoryTrustOf')}\nreturn _inventoryTrustOf;`)();
  const countModeSrc = B.extractFn('_countModeSave');
  const row = (input_method, raw_text) => [{ action_type: 'stock_check', input_method, raw_text, qty_before: 15, qty_after: 5 }];
  const chat = trustOf(5, row('trusted_stock_check', JSON.stringify({ name: '스파게티니', quantity: 5 })));
  const countMode = trustOf(5, row('trusted_stock_check', '재고 점검: 직접 센 수량'));
  const correction = trustOf(5, row('record_correction', '{}'));
  const oldEdit = trustOf(5, row('fast_path', '{}'));
  check('COUNT-CHAT-06 chat count and Count Mode are the same trusted observation (same input_method, same judge → trusted, lastQty 5); Count Mode still writes TRUSTED_STOCK_CHECK',
    chat.trusted && countMode.trusted && chat.lastQty === 5 && /input_method: TRUSTED_STOCK_CHECK/.test(countModeSrc), J({ chat, countMode }));
  check('COUNT-CHAT-07 an earlier ordinary edit (15 → 5 via fast_path) and a record correction are NOT promoted to trusted (no retroactive trust)',
    !correction.trusted && correction.reason === 'NO_TRUST_BASIS' && !oldEdit.trusted && oldEdit.reason === 'NO_TRUST_BASIS', J({ correction, oldEdit }));

  // TRUST AGING hook: observation trust ≠ current freshness; no arbitrary TTL as domain truth; purchases wait for FRESH
  const fresh = new Function(`let _itemTrust = new Map([[77, { trusted: true, lastQty: 5, lastPhysicalCountAt: '2026-10-06T13:00:00Z' }], [78, { trusted: false, reason: 'NO_TRUST_BASIS' }]]);
    let _stockFreshnessPolicy = null;
    ${B.extractFn('_stockFreshness')}\n${B.extractFn('_purchaseFreshnessGate')}
    return { _stockFreshness, _purchaseFreshnessGate, setPolicy: p => { _stockFreshnessPolicy = p; } };`)();
  const now = Date.parse('2026-10-06T15:00:00Z');
  const f0 = fresh._stockFreshness(77, now), g0 = fresh._purchaseFreshnessGate(77, now), u0 = fresh._stockFreshness(78, now);
  fresh.setPolicy({ max_age_ms: 6 * 3600e3 });
  const f1 = fresh._stockFreshness(77, now), g1 = fresh._purchaseFreshnessGate(77, now);
  fresh.setPolicy({ max_age_ms: 3600e3 });
  const f2 = fresh._stockFreshness(77, now), g2 = fresh._purchaseFreshnessGate(77, now);
  check('TRUST-AGING-01 a trusted count with no freshness policy → observation_trusted true but CURRENT freshness UNKNOWN (FRESHNESS_POLICY_UNSET); purchase gate closed; untrusted → UNKNOWN',
    f0.observation_trusted && f0.state === 'UNKNOWN' && f0.reason === 'FRESHNESS_POLICY_UNSET' && f0.last_physical_count_at === '2026-10-06T13:00:00Z' && !g0.allowed && u0.state === 'UNKNOWN' && !u0.observation_trusted, J({ f0, u0 }));
  check('TRUST-AGING-02 with an owner policy: a 2 h old count is FRESH under 6 h (gate open), STALE under 1 h (gate closed); the observation itself is never deleted (last_physical_count_at kept)',
    f1.state === 'FRESH' && g1.allowed && f2.state === 'STALE' && !g2.allowed && f2.last_physical_count_at === '2026-10-06T13:00:00Z', J({ f1, f2 }));
  check('TRUST-AGING-03 the delivery watch is not blocked by freshness (Aside missions never read the inventory gate)',
    !/_stockFreshness|_purchaseFreshnessGate/.test(B.extractFn('_asideApply') + B.extractFn('_asideCheckNow') + B.extractFn('_asideProposalLine')), '');

  // NC-AUTO-06: every "item + qty" treated as a physical count (the classifier always says PLAIN)
  const at = HTML0.indexOf('function _physicalCountClass(raw) {');
  let depth = 0, end = HTML0.indexOf('{', at);
  for (; end < HTML0.length; end++) { const c = HTML0[end]; if (c === '{') depth++; else if (c === '}') { depth--; if (depth === 0) { end++; break; } } }
  const mutated = HTML0.slice(0, at) + "function _physicalCountClass(raw) { return 'PLAIN'; }\n" + HTML0.slice(end);
  const om = await scenarios({ html: mutated });
  const vm = verdicts(om);
  const detected = ['02', '03', '04'].filter(k => !vm[k]);
  check(`NC-AUTO-06 classifier mutated to treat every "item + qty" as a count → COUNT-CHAT-02 / 04 fail by assertion (detected: ${detected.join(', ') || 'none'}); package index.html untouched`,
    !vm['02'] && !vm['04'] && fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8') === HTML0, J({ c02: om.c02, c04: om.c04 }));

  console.log(`\nRESULT: ${pass} PASS / ${fail} FAIL (of ${pass + fail})`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FAIL harness ' + (e.stack || e)); process.exit(1); });
