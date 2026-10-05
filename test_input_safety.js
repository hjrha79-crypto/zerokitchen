/*
 * test_input_safety.js — 질문·불분명한 입력은 재고를 바꾸지 않는다 (INPUT-01..10 + corpus)
 *
 * REAL handleNaturalInput / _inputIntentOf / _hasExplicitQty / detectCommand / _clarifyAs* from index.html.
 * Parsers and writers are SPIES: ruleEngine, parseWithClaude, _isComplexInput, processRequest, db writes.
 * "write" = processRequest with a non-read request, any db insert/update/delete/upsert, or a review draft.
 */
const fs = require('fs');
const path = require('path');
const HTML = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
function extractFn(name) {
  let start = HTML.indexOf('async function ' + name + '(');
  if (start < 0) start = HTML.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('function not found: ' + name);
  let depth = 0, i = HTML.indexOf('{', start);
  for (; i < HTML.length; i++) { const c = HTML[i]; if (c === '{') depth++; else if (c === '}') { depth--; if (depth === 0) { i++; break; } } }
  return HTML.slice(start, i);
}
const constLine = n => { const m = new RegExp(`const ${n} = [^\\n]+`).exec(HTML); if (!m) throw new Error('const not found: ' + n); return m[0]; };

let pass = 0, fail = 0;
function check(name, ok, detail = '') { if (ok) pass++; else fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? '  — ' + String(detail).slice(0, 300) : ''}`); }

const READ_REQ = new Set(['inventory_read', 'order_generate', 'stock_check_read']);
const CLASSIFIER = ['_ZERO_HALF_RE', '_HAS_ACTION_RE', '_INTERROGATIVE_RE', '_QUESTION_END_RE', '_READ_ONLY_CMDS', '_trailingQryRe', '_MIX_ACTION_TOKEN_RE'].map(constLine).join('\n')
  + '\nlet _numUnitRe = null;\n' + /const _NUM_WORDS = \{[\s\S]*?\};/.exec(HTML)[0] + '\n' + constLine('_UNITS') + '\n'
  + ['_hasExplicitQty', 'detectCommand', '_inputIntentOf', '_splitMixedQuery'].map(extractFn).join('\n');

function makeEnv() {
  const S = { ruleEngine: [], parseWithClaude: [], complex: [], requests: [], dbWrites: [], results: [], toasts: [], focus: 0 };
  const els = {};
  const mkEl = id => ({
    id, value: '', innerHTML: '', placeholder: '', disabled: false, children: [], style: {},
    classList: { contains: c => (id === 'tab-input' && c === 'active') },
    appendChild(ch) { this.children.push(ch); ch.parentElement = this; return ch; },
    get lastChild() { return this.children[this.children.length - 1] || null; },
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(x => x !== this); },
    focus() { S.focus++; },
  });
  const document = {
    getElementById: id => (id === 'parseLoading' ? null : (els[id] = els[id] || mkEl(id))),
    createElement: () => mkEl('_'), querySelectorAll: () => [],
  };
  const tbl = table => { const b = { select: () => b, eq: () => b, in: () => b, order: () => b, limit: () => b, then: r => Promise.resolve({ data: [], error: null }).then(r) };
    for (const w of ['insert', 'update', 'delete', 'upsert']) b[w] = () => { S.dbWrites.push({ table, op: w }); return b; };
    return b; };
  const env = {
    S, els, document,
    db: { from: tbl, rpc: async () => ({ data: [], error: null }) },
    _items: [{ item_id: 1, item_name: '우유', unit: '박스', current_qty: 3 }, { item_id: 2, item_name: '치즈', unit: '개', current_qty: 5 }, { item_id: 3, item_name: '양파', unit: '개', current_qty: 4 }],
    _vendors: [],
    _claudeApiKey: 'k',
    console: { log() {}, warn() {}, error() {} },
    showToast: t => S.toasts.push(t),
    _saveLastInput() {}, refreshItems: async () => {}, renderInventory() {}, renderOrder() {}, _patchOrderTable() {},
    _handleComplexQtyAnswer() {}, _startComplexQtyFlow() { S.complex.push('flow'); },
    _isComplexInput: raw => { S.complex.push(raw); return false; },
    _parseComplexInput: async () => [],
    addResult: (raw, msg, type) => { const card = mkEl('card'); card.msg = msg; card.type = type; S.results.push({ raw, msg, type, card }); document.getElementById('resList').appendChild(card); },
    formatResult: r => JSON.stringify(r),
    askClaudeQuestion: async q => `답:${q}`,
    _showConfigConfirm: async () => false, _showConfigCard: async () => {},
    processRequest: async req => { S.requests.push(req); return { status: 'success', response_type: 'x', operation_ids: [] }; },
    // 명시 입력이면 실제 룰엔진처럼 "기존 품목 + 수량 파싱됨"을 돌려준다 (빠른 처리 경로)
    ruleEngine: raw => { S.ruleEngine.push(raw); const it = env._items.find(x => raw.includes(x.item_name));
      return it ? { results: [{ item_name: it.item_name, quantity: 2, unit: it.unit, action: 'inbound', qtyParsed: true }], needsFallback: false, confidence: 0.95 } : { results: [], needsFallback: true, confidence: 0 }; },
    parseWithClaude: async raw => { S.parseWithClaude.push(raw); return []; },
    draftToRequest: items => ({ request_type: 'inventory_update', items }),
  };
  const names = Object.keys(env).filter(k => !['S', 'els'].includes(k));
  const body = `let _nlProcessing = false, _draftItems = [], _parseMeta = {}, _sessionInputs = [], _complexQtyState = null, _pendingComplexItems = null;
    ${CLASSIFIER}
    ${['handleNaturalInput', '_clarifyAsStockEntry', '_clarifyAsQuestion'].map(extractFn).join('\n')}
    return { handleNaturalInput, _clarifyAsStockEntry, _clarifyAsQuestion, _inputIntentOf, get draft() { return _draftItems; } };`;
  const f = new Function(...names, body)(...names.map(n => env[n]));
  const run = async raw => { document.getElementById('nlInput').value = raw; let err = null; try { await f.handleNaturalInput(); } catch (e) { err = e; } return err; };
  const writes = () => S.requests.filter(r => !READ_REQ.has(r.request_type)).length + S.dbWrites.length + f.draft.length;
  const parsed = () => S.ruleEngine.length + S.parseWithClaude.length;
  return { env, S, f, run, writes, parsed, document };
}

(async () => {
  // ── INPUT-01..03: 질문(물음표 없이도)은 재고를 바꾸지 않고 파서로도 가지 않는다
  const questions = [['INPUT-01', '오늘 뭐 해야 돼'], ['INPUT-02', '배송 늦는 거 있어'], ['INPUT-03', '우유 주문했어']];
  for (const [id, q] of questions) {
    const e = makeEnv(); const err = await e.run(q);
    const r = e.S.results[0];
    check(`${id} "${q}" → no stock change, not parsed as entry, answer shown`, !err && e.writes() === 0 && e.parsed() === 0 && e.S.complex.length === 0 && r && /바꾸지 않았습니다/.test(r.msg),
      `err=${err} writes=${e.writes()} parsed=${e.parsed()} res=${r && r.msg}`);
  }

  // ── INPUT-04: 품목명만 → 되묻기 (재고 입력인가요, 질문인가요?) + 두 가지 선택, 쓰기 0
  {
    const e = makeEnv(); const err = await e.run('우유');
    const r = e.S.results[0]; const row = r && r.card.children[0];
    check('INPUT-04 "우유" → clarification with [재고 입력]/[질문으로], no change', !err && e.writes() === 0 && e.parsed() === 0 && r && /재고 입력인가요, 질문인가요\?/.test(r.msg)
      && row && /재고 입력/.test(row.innerHTML) && /질문으로/.test(row.innerHTML), `err=${err} writes=${e.writes()} res=${r && r.msg}`);
  }

  // ── INPUT-05: 재고 질문 → 조회만 (inventory_read 등), 쓰기 0
  for (const q of ['우유 있어?', '치즈 몇 개 남았지', '우유 재고 얼마야']) {
    const e = makeEnv(); const err = await e.run(q);
    check(`INPUT-05 "${q}" → read only`, !err && e.writes() === 0 && e.parsed() === 0 && e.S.results.length === 1, `err=${err} writes=${e.writes()} parsed=${e.parsed()} req=${JSON.stringify(e.S.requests)}`);
  }

  // ── INPUT-06: 되묻기 선택 — [재고 입력]은 입력칸만 다시 채움, [질문으로]는 조회만
  {
    const e = makeEnv(); await e.run('우유');
    e.f._clarifyAsStockEntry('우유');
    const v = e.document.getElementById('nlInput').value;
    await e.f._clarifyAsQuestion('우유', null);
    const reqs = e.S.requests.map(r => r.request_type);
    check('INPUT-06 clarification choices never write ([재고 입력] refills input, [질문으로] reads)', v === '우유 ' && e.S.focus === 1 && e.writes() === 0
      && reqs.length === 1 && reqs[0] === 'inventory_read', `value=${JSON.stringify(v)} reqs=${reqs} writes=${e.writes()}`);
  }

  // ── INPUT-07: 음성 = 같은 규칙. 음성 변환 결과는 입력칸에 넣고 같은 handleNaturalInput으로 들어온다
  {
    const src = extractFn('_transcribeAudio');
    const sameEntry = /inp\.value\s*=\s*text;[\s\S]*handleNaturalInput\(\)/.test(src) && !/ruleEngine|parseWithClaude|processRequest/.test(src);
    const e = makeEnv(); const err = await e.run('오늘 뭐 해야 돼');   // 음성 변환 결과와 같은 문자열
    const e2 = makeEnv(); await e2.run('우유');
    check('INPUT-07 voice → same entry point (nlInput → handleNaturalInput), question/ambiguous transcript writes nothing', sameEntry && !err && e.writes() === 0 && e2.writes() === 0 && e.parsed() === 0,
      `sameEntry=${sameEntry} writes=${e.writes()}/${e2.writes()}`);
  }

  // ── INPUT-08..10: 명시적 재고 입력은 그대로 동작 (빠른 처리로 저장)
  const explicit = [['INPUT-08', '우유 2박스'], ['INPUT-09', '치즈 3개'], ['INPUT-10', '우유 추가 1박스'], ['INPUT-10b', '양파 세 개'], ['INPUT-10c', '우유두박스 입고'], ['INPUT-10d', '치즈 다 썼어']];
  for (const [id, q] of explicit) {
    const e = makeEnv(); const err = await e.run(q);
    const wrote = e.S.requests.filter(r => r.request_type === 'inventory_update');
    check(`${id} "${q}" → explicit entry still saved`, !err && e.S.ruleEngine.length === 1 && wrote.length === 1 && wrote[0]._source === 'fast_path', `err=${err} intent=${e.f._inputIntentOf(q)} reqs=${JSON.stringify(e.S.requests)}`);
  }

  // ── CORPUS: 기존 테스트 입력 440여 개 — 수량+동작어가 분명한 입력은 하나도 막히지 않는다
  {
    const e = makeEnv(); const corpus = [];
    for (const f of ['test_rule.js', 'test_auto.js']) for (const m of fs.readFileSync(path.join(__dirname, f), 'utf8').matchAll(/input:\s*(['"`])((?:\\.|(?!\1).)*)\1/g)) corpus.push(m[2]);
    const hasQtyAct = s => /\d|하나|한|둘|두|셋|세|넷|네|다섯|열|스물|다\s*썼|없/.test(s) && /추가|입고|넣|사용|빼|차감|받았|들어왔|썼|버렸|꺼냈/.test(s);
    const blocked = corpus.filter(s => e.f._inputIntentOf(s) && hasQtyAct(s));
    check(`CORPUS ${corpus.length} existing inputs: explicit quantity+action never diverted`, corpus.length > 300 && blocked.length === 0, blocked.join(' | '));
  }

  console.log(`\n${pass} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})();
