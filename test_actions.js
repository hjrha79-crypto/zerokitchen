// Test script: rule engine + per-item confidence scoring + LLM fallback trigger

// ── Constants (synced with index.html) ──
const _NUM_WORDS = {
  '하나':1,'한':1,'둘':2,'두':2,'셋':3,'세':3,'넷':4,'네':4,
  '다섯':5,'여섯':6,'일곱':7,'여덟':8,'아홉':9,'열':10,
  '열하나':11,'열한':11,'열둘':12,'열두':12,
  '열셋':13,'열세':13,'열넷':14,'열네':14,'열다섯':15,'스물':20,
};
const _UNITS = ['봉지','봉','박스','케이스','팩','캔','통','병','킬로','kg','g','그램','인분','장','묶음','롤','판','다발','개'];
const _UNIT_MAP = {'봉':'봉지','봉지':'봉지','박스':'박스','케이스':'박스','팩':'팩','캔':'캔','통':'통','병':'병','kg':'kg','킬로':'kg','g':'g','그램':'g','인분':'인분','장':'장','묶음':'묶음','롤':'롤','판':'판','다발':'다발','개':'개'};
const _ACTION_WORDS = ['추가','입고','넣어','넣기','넣었어','빼기','빼','차감','사용','발주','주문','받았어','받았','들어왔어','썼어','뺐어','버렸','꺼냈'];
const _ACTION_MAP = {
  '추가':'inbound','입고':'inbound','넣어':'inbound','넣기':'inbound','넣었어':'inbound','받았어':'inbound','받았':'inbound','들어왔어':'inbound',
  '빼기':'consume','빼':'consume','차감':'consume','사용':'consume','썼어':'consume','뺐어':'consume','버렸':'consume','꺼냈':'consume',
  '발주':'order','주문':'order',
};
const _COMPOUND_ACTIONS = [
  ['가져다\\s*놨','inbound'],['가져다\\s*놔','inbound'],
  ['들여\\s*놨','inbound'],['들여\\s*놔','inbound'],
  ['넣어\\s*뒀','inbound'],['넣어\\s*놨','inbound'],
  ['꺼내\\s*썼','consume'],['꺼내\\s*쓰','consume'],
  ['채워\\s*뒀','inbound'],['채워\\s*놨','inbound'],
  ['다\\s*썼','consume'],['다\\s*쓰','consume'],
];
const _NAME_JUNK = /좀|는데|인데|그리고|이랑/;
const _ALIAS = {
  '개깐마늘':'깐마늘','개깐 마늘':'깐마늘','까마늘':'깐마늘',
  '파마산 치즈':'파마산치즈','고르곤 졸라':'고르곤졸라','고르곤':'고르곤졸라',
  '위생적 장갑':'위생장갑','위생적장갑':'위생장갑',
  '그라나 바다도':'그라나 파다노','파슬리 후레이크':'파슬리 플레이크',
  '피프 소스':'비프 소스','피프소스':'비프 소스',
};

// ── Functions (synced with index.html) ──
function _ruleNormalize(text) {
  let s = text.trim();
  const up = _UNITS.join('|');

  const nk = Object.keys(_NUM_WORDS).sort((a,b)=>b.length-a.length);
  for (const nw of nk) {
    s = s.replace(new RegExp('([가-힣])' + nw + '(' + up + '|\\s|$)', 'g'),
      function(m,p,t){ return p + ' ' + nw + t; });
  }

  // 1b. 한글숫자+단위 붙여쓰기 분리 (띄어쓰기 후: "두병" → "두 병")
  for (const nw of nk) {
    s = s.replace(new RegExp('(^|\\s)' + nw + '(' + up + ')', 'g'),
      '$1' + nw + ' $2');
  }

  const numEntries = Object.entries(_NUM_WORDS).sort((a,b)=>b[0].length-a[0].length);
  for (const entry of numEntries) {
    var k = entry[0], v = entry[1];
    s = s.replace(new RegExp('(^|\\s)' + k + '(\\s|$)', 'g'),
      function(m, pre, post){ return pre + String(v) + post; });
  }

  s = s.replace(new RegExp('(\\d+)(' + up + ')', 'g'), '$1 $2');

  s = s.replace(/([가-힣]{2,})(을|를|은|는|이|가)(\s|,|$)/g,
    function(m,w,j,t){ return _UNITS.includes(w) ? m : w+t; });

  const _SUFFIX = '(?:하고|해줘|고|어|서|해|줘)?';
  for (const [pat, act] of _COMPOUND_ACTIONS) {
    s = s.replace(new RegExp(pat + _SUFFIX + '(?=\\s|,|$)', 'g'),
      '\x01' + act + '\x01');
  }

  const awSorted = _ACTION_WORDS.slice().sort((a,b)=>b.length-a.length);
  for (const aw of awSorted) {
    s = s.replace(new RegExp('(\\d+\\s*(?:' + up + ')?)\\s*' + aw + _SUFFIX + '(?=\\s|,|$)', 'g'),
      function(m, qty){ return qty + ' \x01' + (_ACTION_MAP[aw]||'stock_check') + '\x01'; });
  }
  for (const aw of awSorted) {
    s = s.replace(new RegExp('(^|\\s)' + aw + _SUFFIX + '(?=\\s|,|$)', 'g'),
      function(m, pre){ return pre + '\x01' + (_ACTION_MAP[aw]||'stock_check') + '\x01'; });
  }

  return s.replace(/\s{2,}/g,' ').trim();
}

function _extractAction(text) {
  let action = null;
  const cleaned = text.replace(/\x01([a-z_]+)\x01/g, function(m, a) { action = a; return ''; }).trim();
  return { text: cleaned, action: action };
}

function _ruleTokenize(s) {
  const up = _UNITS.join('|');
  const qp = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(${up})`, 'g');
  const segs=[]; let li=0, m;
  while ((m=qp.exec(s))!==null) {
    const raw=s.slice(li,m.index).trim();
    const after = s.slice(m.index+m[0].length);
    const am = after.match(/^\s*\x01([a-z_]+)\x01/);
    let segAction = null;
    if (am) { segAction = am[1]; qp.lastIndex += am[0].length; }
    const { text: before, action: preAction } = _extractAction(raw);
    if (before) segs.push({rawName:before, qty:parseFloat(m[1]), unit:m[2], action: segAction || preAction, qtyParsed:true});
    li=qp.lastIndex;
  }
  const tail=s.slice(li).trim();
  if (tail) {
    const { text: cleanTail, action: tailAction } = _extractAction(tail);
    const nm=cleanTail.match(/^(\d+)$/);
    if (nm&&segs.length) segs[segs.length-1].qty=parseFloat(nm[1]);
    else if (cleanTail) segs.push({rawName:cleanTail,qty:1,unit:'개', action: tailAction, qtyParsed:false});
  }
  return segs;
}

function _ruleMapItem(raw) {
  const name=raw.trim(); if(!name) return null;
  if (_ALIAS[name]) return _ALIAS[name];
  for (const [a,s] of Object.entries(_ALIAS)) { if (name.includes(a)) return s; }
  return name;
}

function _itemConfidence(name, seg) {
  let score = 0;
  if (!_NAME_JUNK.test(name)) score += 0.3;
  if (seg.qtyParsed) score += 0.3;
  if (seg.action && seg.action !== 'stock_check') score += 0.4;
  return Math.round(score * 100) / 100;
}

function ruleEngine(text) {
  const norm = _ruleNormalize(text);
  const segs = _ruleTokenize(norm);
  if (!segs.length) return { results:[], needsFallback:true, confidence:0 };
  const allActions = segs.map(s=>s.action).filter(Boolean);
  const fallbackAction = allActions.length ? allActions[0] : 'stock_check';
  const results=[], fails=[];
  let minConf = 1;
  for (const seg of segs) {
    const name=_ruleMapItem(seg.rawName);
    if (!name||!name.trim()) { fails.push(seg); continue; }
    const action = seg.action || fallbackAction;
    const confSeg = { ...seg, action: action };
    const conf = _itemConfidence(name, confSeg);
    if (conf < minConf) minConf = conf;
    results.push({ item_name:name, quantity:seg.qty, unit:_UNIT_MAP[seg.unit]||seg.unit||'개', action:action, confidence:conf >= 0.8 ? 'high' : 'low', _score:conf });
  }
  const needsFallback = !results.length || minConf < 0.8;
  return { results, needsFallback, confidence: minConf };
}

// ══════════════════════════════════════
//  Test Suite
// ══════════════════════════════════════
const ACTION_LABEL = { inbound: '입고', consume: '차감', order: '발주', stock_check: '재고설정' };
const ACTION_PREFIX = { inbound: '+', consume: '-', order: '', stock_check: '' };

let allPassed = true;

// ── Part A: 기존 5개 액션 파싱 테스트 (전부 Rule Engine 처리) ──
console.log('\n╔══════════════════════════════════════╗');
console.log('║  Part A: 액션 파싱 테스트 (8개)       ║');
console.log('╚══════════════════════════════════════╝');

const actionTests = [
  {
    input: "치즈 두 봉 추가하고 양파 세 개 빼고 마늘빵 한 박스 주문",
    expected: [
      { item: "치즈", qty: 2, unit: "봉지", action: "inbound" },
      { item: "양파", qty: 3, unit: "개", action: "consume" },
      { item: "마늘빵", qty: 1, unit: "박스", action: "order" },
    ]
  },
  {
    input: "깐마늘 다섯 개 받았고 핫소스 두 병 뺐어",
    expected: [
      { item: "깐마늘", qty: 5, unit: "개", action: "inbound" },
      { item: "핫소스", qty: 2, unit: "병", action: "consume" },
    ]
  },
  {
    input: "수세미 다섯 개 가져다 놨고 핫소스 세 병 다 썼어",
    expected: [
      { item: "수세미", qty: 5, unit: "개", action: "inbound" },
      { item: "핫소스", qty: 3, unit: "병", action: "consume" },
    ]
  },
  {
    input: "코카콜라 두 박스 들여놨고 위생장갑 한 개 버렸어",
    expected: [
      { item: "코카콜라", qty: 2, unit: "박스", action: "inbound" },
      { item: "위생장갑", qty: 1, unit: "개", action: "consume" },
    ]
  },
  {
    input: "파마산치즈 두 봉지 꺼내 쓰고 피클 네 캔 채워뒀어",
    expected: [
      { item: "파마산치즈", qty: 2, unit: "봉지", action: "consume" },
      { item: "피클", qty: 4, unit: "캔", action: "inbound" },
    ]
  },
  // ── 붙여쓰기 + 문장 끝 동작어 테스트 ──
  {
    input: "핫소스 두병 발주",
    expected: [
      { item: "핫소스", qty: 2, unit: "병", action: "order" },
    ]
  },
  {
    input: "우유 세박스 주문",
    expected: [
      { item: "우유", qty: 3, unit: "박스", action: "order" },
    ]
  },
  {
    input: "냅킨 한박스 발주해줘",
    expected: [
      { item: "냅킨", qty: 1, unit: "박스", action: "order" },
    ]
  },
];

for (let i = 0; i < actionTests.length; i++) {
  const t = actionTests[i];
  console.log(`\n━━━ Test A${i+1}: "${t.input}"`);
  const { results, needsFallback, confidence } = ruleEngine(t.input);
  console.log(`  confidence: ${confidence} | needsFallback: ${needsFallback}`);
  console.log(`  results: ${JSON.stringify(results.map(r => `${r.item_name} ${ACTION_PREFIX[r.action]}${r.quantity}${r.unit}(${ACTION_LABEL[r.action]}) score=${r._score}`))}`);

  let pass = true;
  if (needsFallback) {
    console.log(`  ✗ FAIL: should NOT trigger fallback but needsFallback=true`);
    pass = false;
  } else if (results.length !== t.expected.length) {
    console.log(`  ✗ FAIL: expected ${t.expected.length} items, got ${results.length}`);
    pass = false;
  } else {
    for (let j = 0; j < t.expected.length; j++) {
      const e = t.expected[j], r = results[j];
      if (r.item_name !== e.item || r.quantity !== e.qty || r.unit !== e.unit || r.action !== e.action) {
        console.log(`  ✗ FAIL item ${j}: expected {${e.item}, ${e.qty}, ${e.unit}, ${e.action}} got {${r.item_name}, ${r.quantity}, ${r.unit}, ${r.action}}`);
        pass = false;
      }
    }
  }
  if (pass) {
    const display = results.map(r => `${r.item_name} ${ACTION_PREFIX[r.action]}${r.quantity}${r.unit}(${ACTION_LABEL[r.action]})`).join(', ');
    console.log(`  ✓ PASS → ${display}`);
  }
  allPassed = allPassed && pass;
}

// ── Part B: Confidence + LLM Fallback 테스트 ──
console.log('\n╔══════════════════════════════════════╗');
console.log('║  Part B: Confidence / Fallback 테스트 ║');
console.log('╚══════════════════════════════════════╝');

const confTests = [
  {
    input: "치즈 두 봉지 넣어뒀어 양파 세 개 꺼냈어",
    expectFallback: false,
    label: "Rule Engine 처리 (명확한 수량+액션)"
  },
  {
    input: "치즈 좀 넣어뒀는데 양파도 좀 꺼냈어",
    expectFallback: true,
    label: "LLM fallback (수량 없음, 연결어 잔재)"
  },
];

for (let i = 0; i < confTests.length; i++) {
  const t = confTests[i];
  console.log(`\n━━━ Test B${i+1}: "${t.input}"`);
  console.log(`  기대: ${t.label}`);

  const norm = _ruleNormalize(t.input);
  console.log(`  normalized: "${norm}"`);

  const { results, needsFallback, confidence } = ruleEngine(t.input);
  console.log(`  confidence: ${confidence} | needsFallback: ${needsFallback}`);
  if (results.length) {
    console.log(`  items: ${results.map(r => `${r.item_name}(score=${r._score})`).join(', ')}`);
  }

  const pass = needsFallback === t.expectFallback;
  if (pass) {
    console.log(`  ✓ PASS → ${t.expectFallback ? 'LLM fallback 트리거됨' : 'Rule Engine 처리 완료'}`);
  } else {
    console.log(`  ✗ FAIL → needsFallback=${needsFallback}, expected ${t.expectFallback}`);
  }
  allPassed = allPassed && pass;
}

// ── Summary ──
console.log(`\n${'═'.repeat(40)}`);
console.log(allPassed ? '✓ ALL 10 TESTS PASSED' : '✗ SOME TESTS FAILED');
process.exit(allPassed ? 0 : 1);
