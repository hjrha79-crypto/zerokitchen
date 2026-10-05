/*
 * test_mixed_input.js — 혼합 입력: 앞쪽 기록 + 뒤쪽 재고 질문 (MIXED-01..07, MIXED-V01)
 *
 * "치즈 3봉 입고 우유 재고 얼마야" → 치즈 기록 1회 + 우유 조회 1회, 우유는 절대 기록 후보가 되지 않는다.
 * REAL from index.html: handleNaturalInput, _splitMixedQuery, _inputIntentOf, detectCommand, _isComplexInput,
 * ruleEngine (+ its normalizer/tokenizer/tables), _transcribeAudio (voice entry).
 * SPIES: processRequest, parseWithClaude, _parseComplexInput (Claude) and the ruleEngine call log.
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
function check(name, ok, detail = '') { if (ok) pass++; else fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? '  — ' + String(detail).slice(0, 400) : ''}`); }

// 룰엔진 블록: _NUM_WORDS 정의부터 ruleEngine 끝까지 (테이블·정규화·토큰화·매핑 전부 실제 코드)
const RULE_START = HTML.indexOf('const _NUM_WORDS = {');
const RULE_END = HTML.indexOf('function ruleEngine(') + extractFn('ruleEngine').length;
const RULE_BLOCK = HTML.slice(RULE_START, RULE_END);
if (RULE_START < 0 || !/function ruleEngine\(/.test(RULE_BLOCK)) throw new Error('rule engine block not found');
const ROUTER = ['_ZERO_HALF_RE', '_HAS_ACTION_RE', '_INTERROGATIVE_RE', '_QUESTION_END_RE', '_READ_ONLY_CMDS', '_trailingQryRe', '_MIX_ACTION_TOKEN_RE'].map(constLine).join('\n')
  + '\nlet _numUnitRe = null;\n' + ['_hasExplicitQty', 'detectCommand', '_inputIntentOf', '_splitMixedQuery', '_isComplexInput'].map(extractFn).join('\n');

const ITEMS = [{ item_id: 1, item_name: '우유', unit: '박스', current_qty: 3 }, { item_id: 2, item_name: '치즈', unit: '봉지', current_qty: 5 }, { item_id: 3, item_name: '양파', unit: '개', current_qty: 4 }];

function makeEnv() {
  const S = { rule: [], claude: [], complex: [], requests: [], dbWrites: [], results: [] };
  const els = {};
  const mkEl = id => ({ id, value: '', innerHTML: '', placeholder: '', disabled: false, children: [], style: {},
    classList: { contains: c => (id === 'tab-input' && c === 'active') },
    appendChild(ch) { this.children.push(ch); return ch; }, get lastChild() { return this.children[this.children.length - 1] || null; }, focus() {} });
  const document = { getElementById: id => (id === 'parseLoading' ? null : (els[id] = els[id] || mkEl(id))), createElement: () => mkEl('_'), querySelectorAll: () => [] };
  const tbl = table => { const b = { select: () => b, eq: () => b, in: () => b, order: () => b, limit: () => b, then: r => Promise.resolve({ data: [], error: null }).then(r) };
    for (const w of ['insert', 'update', 'delete', 'upsert']) b[w] = () => { S.dbWrites.push({ table, op: w }); return b; };
    return b; };
  const env = {
    document, db: { from: tbl, rpc: async () => ({ data: [], error: null }) },
    _items: ITEMS.map(x => ({ ...x })), _vendors: [], _storeAliases: [], _claudeApiKey: 'k',
    console: { log() {}, warn() {}, error() {} },
    showToast() {}, _saveLastInput() {}, refreshItems: async () => {}, renderInventory() {}, renderOrder() {}, _patchOrderTable() {},
    _handleComplexQtyAnswer() {}, _startComplexQtyFlow: (raw, items) => S.complex.push({ flow: raw, items }),
    _parseComplexInput: async raw => { S.complex.push({ claude: raw }); return [{ name: '우유', qty: null, action: 'stock_check' }]; },
    _applyAlias: n => n,
    addResult: (raw, msg, type) => S.results.push({ raw, msg, type }),
    formatResult: r => JSON.stringify(r), askClaudeQuestion: async q => `답:${q}`,
    _showConfigConfirm: async () => false, _showConfigCard: async () => {},
    processRequest: async req => { S.requests.push(JSON.parse(JSON.stringify(req))); return { status: 'success', response_type: 'x', operation_ids: [], items: (req.names || []).map(n => ({ item_name: n, current_qty: 3 })) }; },
    parseWithClaude: async raw => { S.claude.push(raw); return []; },
    draftToRequest: items => ({ request_type: 'inventory_update', items: items.map(it => ({ name: it.item_name, quantity: it.quantity, unit: it.unit, action: it.action })) }),
    _stopMicUI() {}, _restoreUI() {},
  };
  const names = Object.keys(env);
  const body = `let _nlProcessing = false, _draftItems = [], _parseMeta = {}, _sessionInputs = [], _complexQtyState = null, _pendingComplexItems = null;
    ${RULE_BLOCK}
    const _ruleEngineReal = ruleEngine;
    ${ROUTER}
    ${extractFn('handleNaturalInput').replace(/\bruleEngine\(/g, '__rule(')}
    ${extractFn('_transcribeAudio')}
    function __rule(t) { __S.rule.push(t); return _ruleEngineReal(t); }
    return { handleNaturalInput, _transcribeAudio, _splitMixedQuery, ruleEngine: _ruleEngineReal, get draft() { return _draftItems; } };`;
  const f = new Function(...names, '__S', '_audioChunks', 'fetch', 'setTimeout', body)(...names.map(n => env[n]), S,
    [new Blob([new Uint8Array(6000)], { type: 'audio/webm' })], async () => ({ ok: true, json: async () => ({ text: env.__voice }) }), fn => { env.__voiceRun = fn(); });
  const run = async raw => { document.getElementById('nlInput').value = raw; let err = null; try { await f.handleNaturalInput(); } catch (e) { err = e; } return err; };
  const voice = async text => { env.__voice = text; let err = null; try { await f._transcribeAudio(); await env.__voiceRun; } catch (e) { err = e; } return err; };
  const writes = () => S.requests.filter(r => r.request_type === 'inventory_update');
  const writtenNames = () => writes().flatMap(r => r.items.map(i => i.name));
  const reads = () => S.requests.filter(r => r.request_type === 'inventory_read');
  // 기록 파서(룰엔진·Claude·복합 Claude)에 들어간 모든 문자열
  const parserInputs = () => [...S.rule, ...S.claude, ...S.complex.map(c => c.claude || c.flow)];
  return { S, f, run, voice, writes, writtenNames, reads, parserInputs, env };
}

function mixedCase(id, input, w, r, qWords) {
  return async (e, err) => {
    const writes = e.writes(), reads = e.reads(), wn = e.writtenNames();
    const leak = e.parserInputs().filter(t => t.includes(r) || qWords.some(q => t.includes(q)));
    const readOk = reads.length === 1 && reads[0].filter === 'specific' && JSON.stringify(reads[0].names) === JSON.stringify([r]);
    const readShown = e.S.results.some(x => x.raw.startsWith(r) && x.msg.includes(r));
    check(`${id} "${input}" → ${w} write 1, ${r} read 1, ${r} never a write candidate`,
      !err && writes.length === 1 && wn.length === 1 && wn[0] === w && readOk && readShown && leak.length === 0 && !wn.includes(r) && e.f.draft.every(d => d.item_name !== r),
      `err=${err} writes=${JSON.stringify(writes)} reads=${JSON.stringify(reads)} leak=${JSON.stringify(leak)} results=${JSON.stringify(e.S.results.map(x => x.raw))}`);
  };
}

(async () => {
  const MIXED = [
    ['MIXED-01', '치즈 3봉 입고 우유 재고 얼마야', '치즈', '우유', ['재고', '얼마']],
    ['MIXED-02', '우유 2박스 입고 치즈 얼마나 남았어', '우유', '치즈', ['얼마', '남았']],
    ['MIXED-03', '양파 세 개 치즈 재고 몇 개야', '양파', '치즈', ['재고', '몇']],
    ['MIXED-04', '치즈 3개 넣고 우유 얼마 남았어', '치즈', '우유', ['얼마', '남았']],
  ];
  for (const [id, input, w, r, q] of MIXED) { const e = makeEnv(); const err = await e.run(input); await mixedCase(id, input, w, r, q)(e, err); }

  // MIXED-01 detail: mutation portion processed exactly once, quantity/action intact
  {
    const e = makeEnv(); await e.run('치즈 3봉 입고 우유 재고 얼마야');
    const it = e.writes()[0]?.items?.[0] || {};
    check('MIXED-01b mutation portion = existing path once (치즈 3 봉지 inbound, fast path, no duplicate)', e.writes().length === 1 && it.quantity === 3 && it.unit === '봉지' && it.action === 'inbound'
      && e.S.rule.length === 1 && e.S.rule[0] === '치즈 3봉 입고' && e.S.complex.length === 0 && e.S.claude.length === 0, JSON.stringify({ it, rule: e.S.rule, complex: e.S.complex }));
  }

  // MIXED-05..07: 단일 의미 입력은 그대로
  {
    const e = makeEnv(); const err = await e.run('우유 2박스');
    check('MIXED-05 "우유 2박스" → write only', !err && e.writes().length === 1 && e.writtenNames()[0] === '우유' && e.reads().length === 0, JSON.stringify(e.S.requests));
  }
  {
    const e = makeEnv(); const err = await e.run('우유 재고 얼마야');
    check('MIXED-06 "우유 재고 얼마야" → read only', !err && e.writes().length === 0 && e.reads().length === 1 && e.parserInputs().length === 0 && e.S.dbWrites.length === 0, JSON.stringify(e.S.requests));
  }
  {
    const e = makeEnv(); const err = await e.run('오늘 뭐 해야 돼');
    check('MIXED-07 "오늘 뭐 해야 돼" → mutation 0', !err && e.writes().length === 0 && e.parserInputs().length === 0 && e.S.dbWrites.length === 0 && e.f.draft.length === 0, JSON.stringify(e.S.requests));
  }

  // MIXED-08: 조회 대상이 등록 품목이 아니면 조회 0·기록 0 (앞쪽 기록만 처리), 추측하지 않는다
  {
    const e = makeEnv(); const err = await e.run('치즈 3봉 입고 버섯 재고 얼마야');
    check('MIXED-08 unknown query item → only 치즈 written, 버섯 neither read nor written', !err && e.writtenNames().join() === '치즈' && e.reads().length === 0
      && !e.parserInputs().some(t => t.includes('버섯')) && e.S.results.some(x => /바꾸지 않았습니다/.test(x.msg)), JSON.stringify({ req: e.S.requests, res: e.S.results }));
  }

  // MIXED-09: 분리 정확도 — 기록 앞부분이 없거나 수량이 없으면 나누지 않는다 (기존 안전 처리 유지)
  {
    const s = t => e0.f._splitMixedQuery(t); const e0 = makeEnv();
    const none = ['우유 재고 얼마야', '치즈 몇 개 남았어', '버터 입고 생크림 재고 확인', '우유 2박스', '치즈 3봉 입고', '우유 추가 1박스', '양파 세 개'].filter(t => s(t) !== null);
    const ok = [['우유 2박스 입고 토마토 소스 재고 얼마야', '우유 2박스 입고', '토마토 소스'], ['치즈 3봉 입고 우유 재고 확인해줘', '치즈 3봉 입고', '우유'], ['우유 2박스 치즈 재고 얼마나 있어', '우유 2박스', '치즈']]
      .filter(([t, a, n]) => { const r = s(t); return !r || r.action !== a || r.name !== n; });
    check('MIXED-09 split only when a quantity-bearing entry precedes "item + stock question"', none.length === 0 && ok.length === 0, JSON.stringify({ none, ok }));
  }

  // MIXED-V01: 음성 — 실제 _transcribeAudio → nlInput → handleNaturalInput, 별도 규칙 없음
  {
    const e = makeEnv(); const err = await e.voice('치즈 3봉 입고 우유 재고 얼마야');
    await mixedCase('MIXED-V01 (voice)', '치즈 3봉 입고 우유 재고 얼마야', '치즈', '우유', ['재고', '얼마'])(e, err);
    check('MIXED-V01b voice has no separate parser/regex', !/ruleEngine|parseWithClaude|_trailingQryRe|_splitMixedQuery|processRequest/.test(extractFn('_transcribeAudio')));
  }

  console.log(`\n${pass} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})();
