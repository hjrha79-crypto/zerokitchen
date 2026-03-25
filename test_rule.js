// test_rule.js — ZeroKitchen Rule Engine 자동화 테스트
// node test_rule.js 로 실행

// ── Rule Engine 인라인 복사 ──────────────────────────────────────────────────
const _NUM_WORDS = {
  '하나':1,'한':1,'둘':2,'두':2,'셋':3,'세':3,'넷':4,'네':4,
  '다섯':5,'여섯':6,'일곱':7,'여덟':8,'아홉':9,'열':10,
  '열하나':11,'열한':11,'열둘':12,'열두':12,
  '열셋':13,'열세':13,'열넷':14,'열네':14,'열다섯':15,'스물':20,
};
const _UNITS = ['봉지','봉','박스','케이스','팩','캔','통','병','킬로그램','킬로','키로그램','키로','kg','g','그램','인분','장','묶음','롤','판','다발','개'];
const _UNIT_MAP = {'봉':'봉지','봉지':'봉지','박스':'박스','케이스':'박스','팩':'팩','캔':'캔','통':'통','병':'병','kg':'kg','킬로':'kg','킬로그램':'kg','키로':'kg','키로그램':'kg','g':'g','그램':'g','인분':'인분','장':'장','묶음':'묶음','롤':'롤','판':'판','다발':'다발','개':'개'};
const _ACTION_WORDS = ['추가','입고','넣어','넣기','넣었어','넣','빼기','빼','차감','사용','발주','주문','받았어','받았','들어왔어','가져왔','썼어','써서','뺐어','버렸','꺼냈'];
const _ACTION_MAP = {
  '추가':'inbound','입고':'inbound','넣어':'inbound','넣기':'inbound','넣었어':'inbound','넣':'inbound','받았어':'inbound','받았':'inbound','들어왔어':'inbound','가져왔':'inbound',
  '빼기':'consume','빼':'consume','차감':'consume','사용':'consume','썼어':'consume','써서':'consume','뺐어':'consume','버렸':'consume','꺼냈':'consume',
  '발주':'order','주문':'order',
};
const _COMPOUND_ACTIONS = [
  ['가져다\\s*놨','inbound'],['가져다\\s*놔','inbound'],
  ['가져\\s*왔','inbound'],
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
  '위생적 장갑':'위생장갑','위생적장갑':'위생장갑','위생 장갑':'위생장갑',
  '깐 마늘':'깐마늘',
  '그라나 바다도':'그라나 파다노','파슬리 후레이크':'파슬리 플레이크',
  '피프 소스':'비프 소스','피프소스':'비프 소스',
  '롤백중':'롤백 중','롤백소':'롤백 소','롤백대':'롤백 대',
  '알리오 올리오 소스':'알리오올리오소스','토마토 비프 소스':'토마토비프소스',
  '냉동 가리비':'냉동가리비',
};

function _ruleNormalize(text) {
  let s = text.trim();
  // 0. 전처리: 문장부호·콤마·위치격·시간어 제거
  s = s.replace(/[!?~。！？]/g, '');
  s = s.replace(/\.(?!\d)/g, '');
  s = s.replace(/,/g, ' ');
  s = s.replace(/[가-힣]+에서\s/g, '');
  s = s.replace(/^(오늘|어제|내일|아까|방금|지금)\s/, '');
  const up = _UNITS.join('|');
  // 1. 품목명+한글숫자+단위 붙여쓰기 분리 (단위가 바로 붙은 경우만)
  const nk = Object.keys(_NUM_WORDS).sort((a,b)=>b.length-a.length);
  for (const nw of nk) {
    s = s.replace(new RegExp('([가-힣]+)' + nw + '(' + up + ')', 'g'),
      function(m,p,t){ return p + ' ' + nw + ' ' + t; });
  }
  // 1b. 한글숫자+단위 붙여쓰기 분리
  for (const nw of nk) {
    s = s.replace(new RegExp('(^|\\s)' + nw + '(' + up + ')', 'g'),
      '$1' + nw + ' $2');
  }
  // 2. 한글숫자 → 아라비아
  const numEntries = Object.entries(_NUM_WORDS).sort((a,b)=>b[0].length-a[0].length);
  for (const entry of numEntries) {
    var k = entry[0], v = entry[1];
    s = s.replace(new RegExp('(^|\\s)' + k + '(\\s|$)', 'g'),
      function(m, pre, post){ return pre + String(v) + post; });
  }
  // 3. 숫자+단위 붙여쓰기 분리
  s = s.replace(new RegExp('(\\d+)(' + up + ')', 'g'), '$1 $2');
  // 3b. 단위+조사/연결어 제거 (예: "5개은" → "5개", "3개이랑" → "3개")
  s = s.replace(new RegExp('(' + up + ')(을|를|은|는|이|가|이랑|랑|하고)(\\s|,|$)', 'g'), '$1 $3');
  // 3c. 연결 접속사 제거 (예: "그리고", "또")
  s = s.replace(/(^|\s)(그리고|또한|또)(\s|,|$)/g, '$1$3');
  // 4. 조사 제거
  s = s.replace(/([가-힣]{2,})(을|를|은|는|이|가)(\s|,|$)/g,
    function(m,w,j,t){ return _UNITS.includes(w) ? m : w+t; });
  const _SUFFIX = '(?:하고|해줘|고|어|서|해|줘|자)?';
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
  else if (seg.qtyParsed) score += 0.2;
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

// ── 테스트 헬퍼 ────────────────────────────────────────────────────────────────
function run(input, expects) {
  // expects: Array of { item_name, quantity, unit?, action? }
  const { results, needsFallback } = ruleEngine(input);
  if (needsFallback) return { ok: false, reason: 'needsFallback (low confidence)', results };
  if (results.length !== expects.length) {
    return { ok: false, reason: `품목 수 불일치: got ${results.length}, want ${expects.length}`, results };
  }
  for (let i = 0; i < expects.length; i++) {
    const r = results[i], e = expects[i];
    if (r.item_name !== e.item_name)
      return { ok: false, reason: `[${i}] item_name: got "${r.item_name}", want "${e.item_name}"`, results };
    if (r.quantity !== e.quantity)
      return { ok: false, reason: `[${i}] quantity: got ${r.quantity}, want ${e.quantity}`, results };
    if (e.unit && r.unit !== e.unit)
      return { ok: false, reason: `[${i}] unit: got "${r.unit}", want "${e.unit}"`, results };
    if (e.action && r.action !== e.action)
      return { ok: false, reason: `[${i}] action: got "${r.action}", want "${e.action}"`, results };
  }
  return { ok: true };
}

// ── 테스트 케이스 ───────────────────────────────────────────────────────────────
const TESTS = [

// ════════════ 패턴 1: 단일 품목 × 10 단위 × 한글/아라비아 (20개) ════════════
{ pat:1, input:'양파 3개',            expects:[{item_name:'양파',    quantity:3, unit:'개'}] },
{ pat:1, input:'양파 세개',           expects:[{item_name:'양파',    quantity:3, unit:'개'}] },
{ pat:1, input:'우유 2봉지',          expects:[{item_name:'우유',    quantity:2, unit:'봉지'}] },
{ pat:1, input:'우유 두봉지',         expects:[{item_name:'우유',    quantity:2, unit:'봉지'}] },
{ pat:1, input:'라면 5박스',          expects:[{item_name:'라면',    quantity:5, unit:'박스'}] },
{ pat:1, input:'라면 다섯 박스',      expects:[{item_name:'라면',    quantity:5, unit:'박스'}] },
{ pat:1, input:'참치 4캔',            expects:[{item_name:'참치',    quantity:4, unit:'캔'}] },
{ pat:1, input:'참치 네 캔',          expects:[{item_name:'참치',    quantity:4, unit:'캔'}] },
{ pat:1, input:'고추장 2통',          expects:[{item_name:'고추장',  quantity:2, unit:'통'}] },
{ pat:1, input:'고추장 두 통',        expects:[{item_name:'고추장',  quantity:2, unit:'통'}] },
{ pat:1, input:'소주 6병',            expects:[{item_name:'소주',    quantity:6, unit:'병'}] },
{ pat:1, input:'소주 여섯 병',        expects:[{item_name:'소주',    quantity:6, unit:'병'}] },
{ pat:1, input:'닭가슴살 2kg',        expects:[{item_name:'닭가슴살',quantity:2, unit:'kg'}] },
{ pat:1, input:'닭가슴살 두 kg',      expects:[{item_name:'닭가슴살',quantity:2, unit:'kg'}] },
{ pat:1, input:'설탕 500g',           expects:[{item_name:'설탕',    quantity:500,unit:'g'}] },
{ pat:1, input:'밀가루 3팩',          expects:[{item_name:'밀가루',  quantity:3, unit:'팩'}] },
{ pat:1, input:'밀가루 세 팩',        expects:[{item_name:'밀가루',  quantity:3, unit:'팩'}] },
{ pat:1, input:'호일 2롤',            expects:[{item_name:'호일',    quantity:2, unit:'롤'}] },
{ pat:1, input:'계란 1판',            expects:[{item_name:'계란',    quantity:1, unit:'판'}] },
{ pat:1, input:'쑥갓 3묶음',          expects:[{item_name:'쑥갓',    quantity:3, unit:'묶음'}] },

// ════════════ 패턴 2: 2단어 품목명 × 다양한 수량 표현 (30개) ════════════
{ pat:2, input:'롤백 중 4개',                  expects:[{item_name:'롤백 중',quantity:4,unit:'개'}] },
{ pat:2, input:'롤백 중 네개',                 expects:[{item_name:'롤백 중',quantity:4,unit:'개'}] },
{ pat:2, input:'롤백 소 3개',                  expects:[{item_name:'롤백 소',quantity:3,unit:'개'}] },
{ pat:2, input:'롤백 소 세개',                 expects:[{item_name:'롤백 소',quantity:3,unit:'개'}] },
{ pat:2, input:'롤백 대 2개',                  expects:[{item_name:'롤백 대',quantity:2,unit:'개'}] },
{ pat:2, input:'롤백 중 네개 롤백 소 세개',    expects:[{item_name:'롤백 중',quantity:4},{item_name:'롤백 소',quantity:3}] },
{ pat:2, input:'롤백 대 두개 롤백 중 다섯개',  expects:[{item_name:'롤백 대',quantity:2},{item_name:'롤백 중',quantity:5}] },
{ pat:2, input:'깐 마늘 5개',                  expects:[{item_name:'깐마늘', quantity:5,unit:'개'}] },
{ pat:2, input:'블랙 올리브 3캔',              expects:[{item_name:'블랙 올리브',quantity:3,unit:'캔'}] },
{ pat:2, input:'블랙 올리브 세 캔',            expects:[{item_name:'블랙 올리브',quantity:3,unit:'캔'}] },
{ pat:2, input:'블랙 올리브 다섯 캔 파인애플 슬라이스 여섯 캔', expects:[{item_name:'블랙 올리브',quantity:5,unit:'캔'},{item_name:'파인애플 슬라이스',quantity:6,unit:'캔'}] },
{ pat:2, input:'토마토 소스 2통',              expects:[{item_name:'토마토 소스',quantity:2,unit:'통'}] },
{ pat:2, input:'토마토 소스 두 통',            expects:[{item_name:'토마토 소스',quantity:2,unit:'통'}] },
{ pat:2, input:'비프 소스 4봉지',              expects:[{item_name:'비프 소스',quantity:4,unit:'봉지'}] },
{ pat:2, input:'비프 소스 네 봉지',            expects:[{item_name:'비프 소스',quantity:4,unit:'봉지'}] },
{ pat:2, input:'크림 소스 3봉지',              expects:[{item_name:'크림 소스',quantity:3,unit:'봉지'}] },
{ pat:2, input:'올리브 오일 2병',              expects:[{item_name:'올리브 오일',quantity:2,unit:'병'}] },
{ pat:2, input:'올리브 오일 두 병',            expects:[{item_name:'올리브 오일',quantity:2,unit:'병'}] },
{ pat:2, input:'냉동 새우 2kg',                expects:[{item_name:'냉동 새우',  quantity:2,unit:'kg'}] }, // alias 없으므로 그대로
{ pat:2, input:'냉동 가리비 3kg',              expects:[{item_name:'냉동가리비',quantity:3,unit:'kg'}] },
{ pat:2, input:'생크림 5팩',                   expects:[{item_name:'생크림',   quantity:5,unit:'팩'}] },
{ pat:2, input:'고르곤 졸라 2개',              expects:[{item_name:'고르곤졸라',quantity:2,unit:'개'}] },
{ pat:2, input:'파마산 치즈 3개',              expects:[{item_name:'파마산치즈',quantity:3,unit:'개'}] },
{ pat:2, input:'위생 장갑 4박스',              expects:[{item_name:'위생장갑', quantity:4,unit:'박스'}] },
{ pat:2, input:'깐마늘 5kg',                   expects:[{item_name:'깐마늘',   quantity:5,unit:'kg'}] },
{ pat:2, input:'깐마늘 다섯 kg',               expects:[{item_name:'깐마늘',   quantity:5,unit:'kg'}] },
{ pat:2, input:'롤백 중 10개 롤백 소 8개',     expects:[{item_name:'롤백 중',quantity:10},{item_name:'롤백 소',quantity:8}] },
{ pat:2, input:'비프 소스 두개 크림 소스 세개', expects:[{item_name:'비프 소스',quantity:2},{item_name:'크림 소스',quantity:3}] },
{ pat:2, input:'올리브 오일 한 병 참기름 두 병', expects:[{item_name:'올리브 오일',quantity:1},{item_name:'참기름',quantity:2}] },
{ pat:2, input:'토마토 소스 열두 통',           expects:[{item_name:'토마토 소스',quantity:12,unit:'통'}] },

// ════════════ 패턴 3: 3단어 품목명 (20개) ════════════
{ pat:3, input:'알리오올리오소스 2봉지',              expects:[{item_name:'알리오올리오소스',quantity:2,unit:'봉지'}] },
{ pat:3, input:'알리오 올리오 소스 2봉지',            expects:[{item_name:'알리오올리오소스',quantity:2,unit:'봉지'}] },
{ pat:3, input:'토마토비프소스 3봉지',                expects:[{item_name:'토마토비프소스', quantity:3,unit:'봉지'}] },
{ pat:3, input:'토마토 비프 소스 3봉지',              expects:[{item_name:'토마토비프소스', quantity:3,unit:'봉지'}] },
{ pat:3, input:'그라나 파다노 2개',                   expects:[{item_name:'그라나 파다노',  quantity:2,unit:'개'}] },
{ pat:3, input:'파슬리 플레이크 3통',                 expects:[{item_name:'파슬리 플레이크',quantity:3,unit:'통'}] },
{ pat:3, input:'파슬리 후레이크 3통',                 expects:[{item_name:'파슬리 플레이크',quantity:3,unit:'통'}] },
{ pat:3, input:'알리오올리오소스 두 봉지',            expects:[{item_name:'알리오올리오소스',quantity:2,unit:'봉지'}] },
{ pat:3, input:'토마토비프소스 세 봉지',              expects:[{item_name:'토마토비프소스', quantity:3,unit:'봉지'}] },
{ pat:3, input:'그라나 파다노 두 개',                 expects:[{item_name:'그라나 파다노',  quantity:2,unit:'개'}] },
{ pat:3, input:'알리오 올리오 소스 두 봉지',          expects:[{item_name:'알리오올리오소스',quantity:2,unit:'봉지'}] },
{ pat:3, input:'토마토 비프 소스 네 봉지',            expects:[{item_name:'토마토비프소스', quantity:4,unit:'봉지'}] },
{ pat:3, input:'파슬리 플레이크 2통 그라나 파다노 3개', expects:[{item_name:'파슬리 플레이크',quantity:2,unit:'통'},{item_name:'그라나 파다노',quantity:3,unit:'개'}] },
{ pat:3, input:'알리오올리오소스 5봉지 토마토비프소스 3봉지', expects:[{item_name:'알리오올리오소스',quantity:5,unit:'봉지'},{item_name:'토마토비프소스',quantity:3,unit:'봉지'}] },
{ pat:3, input:'코카 콜라 제로 6캔',                  expects:[{item_name:'코카 콜라 제로', quantity:6,unit:'캔'}] },
{ pat:3, input:'스파게티 면 건면 2봉지',              expects:[{item_name:'스파게티 면 건면',quantity:2,unit:'봉지'}] },
{ pat:3, input:'이탈리아 올리브 오일 3병',            expects:[{item_name:'이탈리아 올리브 오일',quantity:3,unit:'병'}] },
{ pat:3, input:'냉동 모짜렐라 치즈 4개',              expects:[{item_name:'냉동 모짜렐라 치즈',quantity:4,unit:'개'}] },
{ pat:3, input:'알리오 올리오 소스 열 봉지',          expects:[{item_name:'알리오올리오소스',quantity:10,unit:'봉지'}] },
{ pat:3, input:'토마토 비프 소스 열두 봉지',          expects:[{item_name:'토마토비프소스',quantity:12,unit:'봉지'}] },

// ════════════ 패턴 4: 혼합 액션 입고+차감+발주 (30개) ════════════
{ pat:4, input:'양파 5개 입고',      expects:[{item_name:'양파',   quantity:5, action:'inbound'}] },
{ pat:4, input:'양파 5개 추가',      expects:[{item_name:'양파',   quantity:5, action:'inbound'}] },
{ pat:4, input:'양파 3개 차감',      expects:[{item_name:'양파',   quantity:3, action:'consume'}] },
{ pat:4, input:'양파 3개 사용',      expects:[{item_name:'양파',   quantity:3, action:'consume'}] },
{ pat:4, input:'양파 2개 발주',      expects:[{item_name:'양파',   quantity:2, action:'order'}] },
{ pat:4, input:'양파 2개 주문',      expects:[{item_name:'양파',   quantity:2, action:'order'}] },
{ pat:4, input:'라면 5박스 입고',    expects:[{item_name:'라면',   quantity:5, action:'inbound'}] },
{ pat:4, input:'라면 3박스 차감',    expects:[{item_name:'라면',   quantity:3, action:'consume'}] },
{ pat:4, input:'라면 2박스 발주',    expects:[{item_name:'라면',   quantity:2, action:'order'}] },
{ pat:4, input:'깐마늘 5kg 넣었어',  expects:[{item_name:'깐마늘', quantity:5, action:'inbound'}] },
{ pat:4, input:'깐마늘 3kg 썼어',    expects:[{item_name:'깐마늘', quantity:3, action:'consume'}] },
{ pat:4, input:'깐마늘 2kg 받았어',  expects:[{item_name:'깐마늘', quantity:2, action:'inbound'}] },
{ pat:4, input:'양파 5개 입고 라면 3박스 차감',   expects:[{item_name:'양파',quantity:5,action:'inbound'},{item_name:'라면',quantity:3,action:'consume'}] },
{ pat:4, input:'라면 5박스 입고 양파 2개 발주',   expects:[{item_name:'라면',quantity:5,action:'inbound'},{item_name:'양파',quantity:2,action:'order'}] },
{ pat:4, input:'우유 3봉지 차감 계란 1판 발주',   expects:[{item_name:'우유',quantity:3,action:'consume'},{item_name:'계란',quantity:1,action:'order'}] },
{ pat:4, input:'토마토 소스 2통 입고',   expects:[{item_name:'토마토 소스',quantity:2,action:'inbound'}] },
{ pat:4, input:'비프 소스 4봉지 발주',   expects:[{item_name:'비프 소스',quantity:4,action:'order'}] },
{ pat:4, input:'롤백 중 4개 입고',       expects:[{item_name:'롤백 중',quantity:4,action:'inbound'}] },
{ pat:4, input:'롤백 소 3개 차감',       expects:[{item_name:'롤백 소',quantity:3,action:'consume'}] },
{ pat:4, input:'롤백 대 2개 발주',       expects:[{item_name:'롤백 대',quantity:2,action:'order'}] },
{ pat:4, input:'양파 5개 넣어',          expects:[{item_name:'양파',quantity:5,action:'inbound'}] },
{ pat:4, input:'양파 3개 빼',            expects:[{item_name:'양파',quantity:3,action:'consume'}] },
{ pat:4, input:'깐마늘 2kg 발주',        expects:[{item_name:'깐마늘',quantity:2,action:'order'}] },
{ pat:4, input:'올리브 오일 2병 입고',   expects:[{item_name:'올리브 오일',quantity:2,action:'inbound'}] },
{ pat:4, input:'올리브 오일 1병 차감',   expects:[{item_name:'올리브 오일',quantity:1,action:'consume'}] },
{ pat:4, input:'파마산치즈 3개 입고',    expects:[{item_name:'파마산치즈',quantity:3,action:'inbound'}] },
{ pat:4, input:'파마산치즈 2개 발주',    expects:[{item_name:'파마산치즈',quantity:2,action:'order'}] },
{ pat:4, input:'롤백 중 4개 입고 롤백 소 3개 차감', expects:[{item_name:'롤백 중',quantity:4,action:'inbound'},{item_name:'롤백 소',quantity:3,action:'consume'}] },
{ pat:4, input:'알리오올리오소스 5봉지 발주',  expects:[{item_name:'알리오올리오소스',quantity:5,action:'order'}] },
{ pat:4, input:'토마토비프소스 3봉지 입고',    expects:[{item_name:'토마토비프소스',quantity:3,action:'inbound'}] },

// ════════════ 패턴 5: 연결어미 포함 (30개) ════════════
{ pat:5, input:'양파 5개 넣어줘',         expects:[{item_name:'양파',  quantity:5,action:'inbound'}] },
{ pat:5, input:'양파 3개 빼줘',           expects:[{item_name:'양파',  quantity:3,action:'consume'}] },
{ pat:5, input:'라면 5박스 추가해줘',     expects:[{item_name:'라면',  quantity:5,action:'inbound'}] },
{ pat:5, input:'라면 3박스 차감해줘',     expects:[{item_name:'라면',  quantity:3,action:'consume'}] },
{ pat:5, input:'라면 2박스 발주해줘',     expects:[{item_name:'라면',  quantity:2,action:'order'}] },
{ pat:5, input:'깐마늘 5kg 넣어서',       expects:[{item_name:'깐마늘',quantity:5,action:'inbound'}] },
{ pat:5, input:'깐마늘 3kg 써서',         expects:[{item_name:'깐마늘',quantity:3,action:'consume'}] },
{ pat:5, input:'양파 2개 발주하고',       expects:[{item_name:'양파',  quantity:2,action:'order'}] },
{ pat:5, input:'우유 3봉지 입고해',       expects:[{item_name:'우유',  quantity:3,action:'inbound'}] },
{ pat:5, input:'우유 2봉지 차감해',       expects:[{item_name:'우유',  quantity:2,action:'consume'}] },
{ pat:5, input:'양파 5개은 입고',         expects:[{item_name:'양파',  quantity:5,action:'inbound'}] },
{ pat:5, input:'라면을 5박스 입고',       expects:[{item_name:'라면',  quantity:5,action:'inbound'}] },
{ pat:5, input:'깐마늘을 3kg 차감',       expects:[{item_name:'깐마늘',quantity:3,action:'consume'}] },
{ pat:5, input:'양파가 5개 입고',         expects:[{item_name:'양파',  quantity:5,action:'inbound'}] },
{ pat:5, input:'우유가 3봉지 입고',       expects:[{item_name:'우유',  quantity:3,action:'inbound'}] },
{ pat:5, input:'라면이 5박스 입고',       expects:[{item_name:'라면',  quantity:5,action:'inbound'}] },
{ pat:5, input:'롤백 중 4개 넣어줘',      expects:[{item_name:'롤백 중',quantity:4,action:'inbound'}] },
{ pat:5, input:'롤백 소 3개 빼줘',        expects:[{item_name:'롤백 소',quantity:3,action:'consume'}] },
{ pat:5, input:'토마토 소스 2통 추가해줘', expects:[{item_name:'토마토 소스',quantity:2,action:'inbound'}] },
{ pat:5, input:'비프 소스 4봉지 발주해줘', expects:[{item_name:'비프 소스',quantity:4,action:'order'}] },
{ pat:5, input:'올리브 오일 2병 넣어줘',   expects:[{item_name:'올리브 오일',quantity:2,action:'inbound'}] },
{ pat:5, input:'파마산치즈 3개 발주해줘',  expects:[{item_name:'파마산치즈',quantity:3,action:'order'}] },
{ pat:5, input:'깐마늘 5kg 받았어',        expects:[{item_name:'깐마늘',quantity:5,action:'inbound'}] },
{ pat:5, input:'깐마늘 3kg 썼어',          expects:[{item_name:'깐마늘',quantity:3,action:'consume'}] },
{ pat:5, input:'양파 2개 들어왔어',        expects:[{item_name:'양파',  quantity:2,action:'inbound'}] },
{ pat:5, input:'우유 3봉지 뺐어',          expects:[{item_name:'우유',  quantity:3,action:'consume'}] },
{ pat:5, input:'라면 5박스 받았어',        expects:[{item_name:'라면',  quantity:5,action:'inbound'}] },
{ pat:5, input:'올리브 오일 한 병 넣어줘', expects:[{item_name:'올리브 오일',quantity:1,action:'inbound'}] },
{ pat:5, input:'롤백 대 두개 발주해줘',    expects:[{item_name:'롤백 대',quantity:2,action:'order'}] },
{ pat:5, input:'알리오올리오소스 5봉지 발주해줘', expects:[{item_name:'알리오올리오소스',quantity:5,action:'order'}] },

// ════════════ 패턴 6: 붙여쓰기 (20개) ════════════
{ pat:6, input:'양파5개',              expects:[{item_name:'양파',    quantity:5,unit:'개'}] },
{ pat:6, input:'라면5박스',            expects:[{item_name:'라면',    quantity:5,unit:'박스'}] },
{ pat:6, input:'우유3봉지',            expects:[{item_name:'우유',    quantity:3,unit:'봉지'}] },
{ pat:6, input:'참치4캔',              expects:[{item_name:'참치',    quantity:4,unit:'캔'}] },
{ pat:6, input:'깐마늘5kg',            expects:[{item_name:'깐마늘',  quantity:5,unit:'kg'}] },
{ pat:6, input:'소주6병',              expects:[{item_name:'소주',    quantity:6,unit:'병'}] },
{ pat:6, input:'고추장2통',            expects:[{item_name:'고추장',  quantity:2,unit:'통'}] },
{ pat:6, input:'밀가루3팩',            expects:[{item_name:'밀가루',  quantity:3,unit:'팩'}] },
{ pat:6, input:'계란1판',              expects:[{item_name:'계란',    quantity:1,unit:'판'}] },
{ pat:6, input:'쑥갓3묶음',            expects:[{item_name:'쑥갓',    quantity:3,unit:'묶음'}] },
{ pat:6, input:'롤백중네개',           expects:[{item_name:'롤백 중', quantity:4,unit:'개'}] },
{ pat:6, input:'롤백소세개',           expects:[{item_name:'롤백 소', quantity:3,unit:'개'}] },
{ pat:6, input:'파마산치즈3개',        expects:[{item_name:'파마산치즈',quantity:3,unit:'개'}] },
{ pat:6, input:'고르곤졸라2개',        expects:[{item_name:'고르곤졸라',quantity:2,unit:'개'}] },
{ pat:6, input:'위생장갑4박스',        expects:[{item_name:'위생장갑',quantity:4,unit:'박스'}] },
{ pat:6, input:'냉동가리비2kg',        expects:[{item_name:'냉동가리비',quantity:2,unit:'kg'}] },
{ pat:6, input:'양파세개',             expects:[{item_name:'양파',    quantity:3,unit:'개'}] },
{ pat:6, input:'라면다섯박스',         expects:[{item_name:'라면',    quantity:5,unit:'박스'}] },
{ pat:6, input:'우유두봉지',           expects:[{item_name:'우유',    quantity:2,unit:'봉지'}] },
{ pat:6, input:'소주여섯병',           expects:[{item_name:'소주',    quantity:6,unit:'병'}] },

// ════════════ 패턴 7: 실제 매장 품목명 (50개) ════════════
{ pat:7, input:'파마산치즈 3개',             expects:[{item_name:'파마산치즈',    quantity:3}] },
{ pat:7, input:'파마산 치즈 3개',            expects:[{item_name:'파마산치즈',    quantity:3}] },
{ pat:7, input:'롤백 중 4개',                expects:[{item_name:'롤백 중',       quantity:4}] },
{ pat:7, input:'롤백중 4개',                 expects:[{item_name:'롤백 중',       quantity:4}] },
{ pat:7, input:'롤백 소 3개',                expects:[{item_name:'롤백 소',       quantity:3}] },
{ pat:7, input:'롤백소 3개',                 expects:[{item_name:'롤백 소',       quantity:3}] },
{ pat:7, input:'롤백 대 2개',                expects:[{item_name:'롤백 대',       quantity:2}] },
{ pat:7, input:'롤백대 2개',                 expects:[{item_name:'롤백 대',       quantity:2}] },
{ pat:7, input:'알리오올리오소스 5봉지',     expects:[{item_name:'알리오올리오소스',quantity:5}] },
{ pat:7, input:'알리오 올리오 소스 5봉지',   expects:[{item_name:'알리오올리오소스',quantity:5}] },
{ pat:7, input:'토마토비프소스 3봉지',       expects:[{item_name:'토마토비프소스', quantity:3}] },
{ pat:7, input:'토마토 비프 소스 3봉지',     expects:[{item_name:'토마토비프소스', quantity:3}] },
{ pat:7, input:'냉동가리비 2kg',             expects:[{item_name:'냉동가리비',     quantity:2}] },
{ pat:7, input:'냉동 가리비 2kg',            expects:[{item_name:'냉동가리비',     quantity:2}] },
{ pat:7, input:'고르곤졸라 2개',             expects:[{item_name:'고르곤졸라',     quantity:2}] },
{ pat:7, input:'고르곤 졸라 2개',            expects:[{item_name:'고르곤졸라',     quantity:2}] },
{ pat:7, input:'고르곤 2개',                 expects:[{item_name:'고르곤졸라',     quantity:2}] },
{ pat:7, input:'위생장갑 4박스',             expects:[{item_name:'위생장갑',       quantity:4}] },
{ pat:7, input:'위생적 장갑 4박스',          expects:[{item_name:'위생장갑',       quantity:4}] },
{ pat:7, input:'깐마늘 5kg',                 expects:[{item_name:'깐마늘',         quantity:5}] },
{ pat:7, input:'개깐마늘 5kg',               expects:[{item_name:'깐마늘',         quantity:5}] },
{ pat:7, input:'까마늘 5kg',                 expects:[{item_name:'깐마늘',         quantity:5}] },
{ pat:7, input:'그라나 파다노 2개',          expects:[{item_name:'그라나 파다노',  quantity:2}] },
{ pat:7, input:'파슬리 플레이크 3통',        expects:[{item_name:'파슬리 플레이크',quantity:3}] },
{ pat:7, input:'파슬리 후레이크 3통',        expects:[{item_name:'파슬리 플레이크',quantity:3}] },
{ pat:7, input:'비프 소스 4봉지',            expects:[{item_name:'비프 소스',      quantity:4}] },
{ pat:7, input:'피프 소스 4봉지',            expects:[{item_name:'비프 소스',      quantity:4}] },
{ pat:7, input:'까르보나라소스 3봉지',       expects:[{item_name:'까르보나라소스', quantity:3}] },
{ pat:7, input:'모짜렐라치즈 2개',           expects:[{item_name:'모짜렐라치즈',   quantity:2}] },
{ pat:7, input:'올리브오일 2병',             expects:[{item_name:'올리브오일',     quantity:2}] },
{ pat:7, input:'올리브 오일 2병',            expects:[{item_name:'올리브 오일',    quantity:2}] },
{ pat:7, input:'코카콜라 6캔',               expects:[{item_name:'코카콜라',       quantity:6}] },
{ pat:7, input:'스프라이트 6캔',             expects:[{item_name:'스프라이트',     quantity:6}] },
{ pat:7, input:'닭가슴살 3kg',               expects:[{item_name:'닭가슴살',       quantity:3}] },
{ pat:7, input:'삼겹살 2kg',                 expects:[{item_name:'삼겹살',         quantity:2}] },
{ pat:7, input:'소금 1kg',                   expects:[{item_name:'소금',           quantity:1}] },
{ pat:7, input:'후추 500g',                  expects:[{item_name:'후추',           quantity:500}] },
{ pat:7, input:'버터 3개',                   expects:[{item_name:'버터',           quantity:3}] },
{ pat:7, input:'생크림 5팩',                 expects:[{item_name:'생크림',         quantity:5}] },
{ pat:7, input:'파스타면 3봉지',             expects:[{item_name:'파스타면',       quantity:3}] },
{ pat:7, input:'스파게티 2봉지',             expects:[{item_name:'스파게티',       quantity:2}] },
{ pat:7, input:'마스카포네 2개',             expects:[{item_name:'마스카포네',     quantity:2}] },
{ pat:7, input:'토마토 소스 2통',            expects:[{item_name:'토마토 소스',    quantity:2}] },
{ pat:7, input:'크림 소스 3봉지',            expects:[{item_name:'크림 소스',      quantity:3}] },
{ pat:7, input:'롤백 중 네개 롤백 소 세개 롤백 대 두개', expects:[{item_name:'롤백 중',quantity:4},{item_name:'롤백 소',quantity:3},{item_name:'롤백 대',quantity:2}] },
{ pat:7, input:'파마산치즈 세개 고르곤졸라 두개', expects:[{item_name:'파마산치즈',quantity:3},{item_name:'고르곤졸라',quantity:2}] },
{ pat:7, input:'알리오올리오소스 5봉지 토마토비프소스 3봉지', expects:[{item_name:'알리오올리오소스',quantity:5},{item_name:'토마토비프소스',quantity:3}] },
{ pat:7, input:'깐마늘 5kg 비프 소스 4봉지',     expects:[{item_name:'깐마늘',quantity:5},{item_name:'비프 소스',quantity:4}] },
{ pat:7, input:'위생장갑 4박스 파마산치즈 3개',  expects:[{item_name:'위생장갑',quantity:4},{item_name:'파마산치즈',quantity:3}] },
{ pat:7, input:'냉동가리비 2kg 올리브 오일 3병', expects:[{item_name:'냉동가리비',quantity:2},{item_name:'올리브 오일',quantity:3}] },

// ════════════ 패턴 8: 연결어/접속사 (20개) ════════════
{ pat:8, input:'양파 3개 그리고 라면 5박스',                    expects:[{item_name:'양파',quantity:3},{item_name:'라면',quantity:5}] },
{ pat:8, input:'양파 3개이랑 라면 5박스',                       expects:[{item_name:'양파',quantity:3},{item_name:'라면',quantity:5}] },
{ pat:8, input:'양파 3개랑 라면 5박스',                         expects:[{item_name:'양파',quantity:3},{item_name:'라면',quantity:5}] },
{ pat:8, input:'양파 3개하고 라면 5박스',                       expects:[{item_name:'양파',quantity:3},{item_name:'라면',quantity:5}] },
{ pat:8, input:'양파 3개 또 라면 5박스',                        expects:[{item_name:'양파',quantity:3},{item_name:'라면',quantity:5}] },
{ pat:8, input:'양파 3개, 라면 5박스',                          expects:[{item_name:'양파',quantity:3},{item_name:'라면',quantity:5}] },
{ pat:8, input:'양파 3개, 라면 5박스, 우유 2봉지',              expects:[{item_name:'양파',quantity:3},{item_name:'라면',quantity:5},{item_name:'우유',quantity:2}] },
{ pat:8, input:'깐마늘 5kg이랑 비프 소스 3봉지',               expects:[{item_name:'깐마늘',quantity:5},{item_name:'비프 소스',quantity:3}] },
{ pat:8, input:'깐마늘 5kg랑 비프 소스 3봉지',                 expects:[{item_name:'깐마늘',quantity:5},{item_name:'비프 소스',quantity:3}] },
{ pat:8, input:'깐마늘 5kg하고 비프 소스 3봉지',               expects:[{item_name:'깐마늘',quantity:5},{item_name:'비프 소스',quantity:3}] },
{ pat:8, input:'양파 3개이랑 라면 5박스이랑 우유 2봉지',       expects:[{item_name:'양파',quantity:3},{item_name:'라면',quantity:5},{item_name:'우유',quantity:2}] },
{ pat:8, input:'양파 3개랑 라면 5박스랑 우유 2봉지',           expects:[{item_name:'양파',quantity:3},{item_name:'라면',quantity:5},{item_name:'우유',quantity:2}] },
{ pat:8, input:'양파 3개 그리고 라면 5박스 그리고 우유 2봉지', expects:[{item_name:'양파',quantity:3},{item_name:'라면',quantity:5},{item_name:'우유',quantity:2}] },
{ pat:8, input:'파마산치즈 3개이랑 고르곤졸라 2개',            expects:[{item_name:'파마산치즈',quantity:3},{item_name:'고르곤졸라',quantity:2}] },
{ pat:8, input:'롤백 중 4개하고 롤백 소 3개',                  expects:[{item_name:'롤백 중',quantity:4},{item_name:'롤백 소',quantity:3}] },
{ pat:8, input:'양파 3개 입고하고 라면 5박스 차감',            expects:[{item_name:'양파',quantity:3,action:'inbound'},{item_name:'라면',quantity:5,action:'consume'}] },
{ pat:8, input:'양파 3개 넣고 라면 5박스이랑 우유 2봉지 빼고', expects:[{item_name:'양파',quantity:3,action:'inbound'},{item_name:'라면',quantity:5},{item_name:'우유',quantity:2,action:'consume'}] },
{ pat:8, input:'또띠아 3개',                                    expects:[{item_name:'또띠아',quantity:3}] },
{ pat:8, input:'또띠아 3개이랑 양파 5개',                       expects:[{item_name:'또띠아',quantity:3},{item_name:'양파',quantity:5}] },
{ pat:8, input:'양파 3개 또한 라면 5박스',                      expects:[{item_name:'양파',quantity:3},{item_name:'라면',quantity:5}] },

// ════════════ 패턴 9: 문장 부호/특수 (15개) ════════════
{ pat:9, input:'양파 3개 입고.',                expects:[{item_name:'양파',quantity:3,action:'inbound'}] },
{ pat:9, input:'양파 3개 입고!',                expects:[{item_name:'양파',quantity:3,action:'inbound'}] },
{ pat:9, input:'양파 3개 입고?',                expects:[{item_name:'양파',quantity:3,action:'inbound'}] },
{ pat:9, input:'양파 3개 발주해줘!',            expects:[{item_name:'양파',quantity:3,action:'order'}] },
{ pat:9, input:'  양파 3개  ',                  expects:[{item_name:'양파',quantity:3}] },
{ pat:9, input:'양파  3개  입고',               expects:[{item_name:'양파',quantity:3,action:'inbound'}] },
{ pat:9, input:'닭가슴살 1.5kg',                expects:[{item_name:'닭가슴살',quantity:1.5,unit:'kg'}] },
{ pat:9, input:'설탕 0.5kg',                    expects:[{item_name:'설탕',quantity:0.5,unit:'kg'}] },
{ pat:9, input:'닭가슴살 2.5kg 입고',           expects:[{item_name:'닭가슴살',quantity:2.5,unit:'kg',action:'inbound'}] },
{ pat:9, input:'냉장고에서 양파 3개 꺼냈어',    expects:[{item_name:'양파',quantity:3,action:'consume'}] },
{ pat:9, input:'창고에서 라면 5박스 가져왔어',  expects:[{item_name:'라면',quantity:5}] },
{ pat:9, input:'양파 100개',                    expects:[{item_name:'양파',quantity:100}] },
{ pat:9, input:'양파 999개 입고',               expects:[{item_name:'양파',quantity:999,action:'inbound'}] },
{ pat:9, input:'양파 0개',                      expects:[{item_name:'양파',quantity:0}] },
{ pat:9, input:'양파 3개 입고. 라면 5박스 차감', expects:[{item_name:'양파',quantity:3,action:'inbound'},{item_name:'라면',quantity:5,action:'consume'}] },

// ════════════ 패턴 10: 미검증 단위+큰 숫자 (20개) ════════════
{ pat:10, input:'삼겹살 3인분',                  expects:[{item_name:'삼겹살',quantity:3,unit:'인분'}] },
{ pat:10, input:'김 10장',                       expects:[{item_name:'김',quantity:10,unit:'장'}] },
{ pat:10, input:'파 2다발',                      expects:[{item_name:'파',quantity:2,unit:'다발'}] },
{ pat:10, input:'깐마늘 5킬로그램',              expects:[{item_name:'깐마늘',quantity:5,unit:'kg'}] },
{ pat:10, input:'깐마늘 5키로',                  expects:[{item_name:'깐마늘',quantity:5,unit:'kg'}] },
{ pat:10, input:'설탕 500그램',                  expects:[{item_name:'설탕',quantity:500,unit:'g'}] },
{ pat:10, input:'깐마늘 5킬로',                  expects:[{item_name:'깐마늘',quantity:5,unit:'kg'}] },
{ pat:10, input:'닭가슴살 3키로그램',            expects:[{item_name:'닭가슴살',quantity:3,unit:'kg'}] },
{ pat:10, input:'라면 3케이스',                  expects:[{item_name:'라면',quantity:3,unit:'박스'}] },
{ pat:10, input:'치즈 2봉',                      expects:[{item_name:'치즈',quantity:2,unit:'봉지'}] },
{ pat:10, input:'양파 열다섯 개',                expects:[{item_name:'양파',quantity:15}] },
{ pat:10, input:'라면 스물 박스',                expects:[{item_name:'라면',quantity:20}] },
{ pat:10, input:'양파 열한 개',                  expects:[{item_name:'양파',quantity:11}] },
{ pat:10, input:'양파 열세 개',                  expects:[{item_name:'양파',quantity:13}] },
{ pat:10, input:'양파 열네 개',                  expects:[{item_name:'양파',quantity:14}] },
{ pat:10, input:'삼겹살 3인분 입고',             expects:[{item_name:'삼겹살',quantity:3,unit:'인분',action:'inbound'}] },
{ pat:10, input:'김 10장 차감',                  expects:[{item_name:'김',quantity:10,unit:'장',action:'consume'}] },
{ pat:10, input:'파 2다발 발주',                 expects:[{item_name:'파',quantity:2,unit:'다발',action:'order'}] },
{ pat:10, input:'김 열다섯 장',                  expects:[{item_name:'김',quantity:15,unit:'장'}] },
{ pat:10, input:'파 세 다발 입고',               expects:[{item_name:'파',quantity:3,unit:'다발',action:'inbound'}] },

// ════════════ 패턴 11: 아이템명 혼동 방지 (15개) ════════════
{ pat:11, input:'한우 3kg',                      expects:[{item_name:'한우',quantity:3,unit:'kg'}] },
{ pat:11, input:'마스카포네 2개',                expects:[{item_name:'마스카포네',quantity:2}] },
{ pat:11, input:'네추럴치즈 3개',                expects:[{item_name:'네추럴치즈',quantity:3}] },
{ pat:11, input:'세제 2개',                      expects:[{item_name:'세제',quantity:2}] },
{ pat:11, input:'두부 3개',                      expects:[{item_name:'두부',quantity:3}] },
{ pat:11, input:'세트메뉴 2개',                  expects:[{item_name:'세트메뉴',quantity:2}] },
{ pat:11, input:'한우 3kg 입고',                 expects:[{item_name:'한우',quantity:3,unit:'kg',action:'inbound'}] },
{ pat:11, input:'두부 3개 차감',                 expects:[{item_name:'두부',quantity:3,action:'consume'}] },
{ pat:11, input:'세제 2개 발주',                 expects:[{item_name:'세제',quantity:2,action:'order'}] },
{ pat:11, input:'한우 3kg이랑 두부 5개',         expects:[{item_name:'한우',quantity:3},{item_name:'두부',quantity:5}] },
{ pat:11, input:'또띠아 3개 입고',               expects:[{item_name:'또띠아',quantity:3,action:'inbound'}] },
{ pat:11, input:'양파를 3개 입고',               expects:[{item_name:'양파',quantity:3,action:'inbound'}] },
{ pat:11, input:'양파는 3개 입고',               expects:[{item_name:'양파',quantity:3,action:'inbound'}] },
{ pat:11, input:'라면이 5박스 입고',             expects:[{item_name:'라면',quantity:5,action:'inbound'}] },
{ pat:11, input:'우유가 3봉지 입고',             expects:[{item_name:'우유',quantity:3,action:'inbound'}] },

// ════════════ 패턴 12: 복합 동작어 + 써서 (15개) ════════════
{ pat:12, input:'양파 3개 가져다놨어',           expects:[{item_name:'양파',quantity:3,action:'inbound'}] },
{ pat:12, input:'양파 3개 채워놨고',             expects:[{item_name:'양파',quantity:3,action:'inbound'}] },
{ pat:12, input:'양파 3개 꺼내썼고',             expects:[{item_name:'양파',quantity:3,action:'consume'}] },
{ pat:12, input:'양파 3개 다썼고',               expects:[{item_name:'양파',quantity:3,action:'consume'}] },
{ pat:12, input:'양파 3개 채워 뒀어',            expects:[{item_name:'양파',quantity:3,action:'inbound'}] },
{ pat:12, input:'양파 3개 다 쓰고',              expects:[{item_name:'양파',quantity:3,action:'consume'}] },
{ pat:12, input:'깐마늘 3kg 써서',               expects:[{item_name:'깐마늘',quantity:3,unit:'kg',action:'consume'}] },
{ pat:12, input:'양파 3개 들여놨고',             expects:[{item_name:'양파',quantity:3,action:'inbound'}] },
{ pat:12, input:'양파 3개 넣어뒀어',             expects:[{item_name:'양파',quantity:3,action:'inbound'}] },
{ pat:12, input:'양파 3개 넣어놨고',             expects:[{item_name:'양파',quantity:3,action:'inbound'}] },
{ pat:12, input:'양파 3개 꺼내 쓰고',            expects:[{item_name:'양파',quantity:3,action:'consume'}] },
{ pat:12, input:'양파 3개 버렸어',               expects:[{item_name:'양파',quantity:3,action:'consume'}] },
{ pat:12, input:'양파 3개 버렸고',               expects:[{item_name:'양파',quantity:3,action:'consume'}] },
{ pat:12, input:'양파 3개 들어왔어',             expects:[{item_name:'양파',quantity:3,action:'inbound'}] },
{ pat:12, input:'양파 3개 사용해',               expects:[{item_name:'양파',quantity:3,action:'consume'}] },

// ════════════ 패턴 13: 복합 시나리오 (15개) ════════════
{ pat:13, input:'양파 3개 입고 라면 5박스 차감 우유 2봉지 발주 참치 4캔 입고', expects:[{item_name:'양파',quantity:3,action:'inbound'},{item_name:'라면',quantity:5,action:'consume'},{item_name:'우유',quantity:2,action:'order'},{item_name:'참치',quantity:4,action:'inbound'}] },
{ pat:13, input:'파마산치즈 3개 입고 깐마늘 5kg 차감 롤백 중 10개 발주', expects:[{item_name:'파마산치즈',quantity:3,action:'inbound'},{item_name:'깐마늘',quantity:5,action:'consume'},{item_name:'롤백 중',quantity:10,action:'order'}] },
{ pat:13, input:'알리오 올리오 소스 2봉지 넣고 토마토 비프 소스 3봉지 빼고', expects:[{item_name:'알리오올리오소스',quantity:2,action:'inbound'},{item_name:'토마토비프소스',quantity:3,action:'consume'}] },
{ pat:13, input:'양파 3개 라면 5박스 우유 2봉지 참치 4캔 깐마늘 2kg', expects:[{item_name:'양파',quantity:3},{item_name:'라면',quantity:5},{item_name:'우유',quantity:2},{item_name:'참치',quantity:4},{item_name:'깐마늘',quantity:2}] },
{ pat:13, input:'입고 양파 3개',                 expects:[{item_name:'양파',quantity:3,action:'inbound'}] },
{ pat:13, input:'발주 라면 5박스',               expects:[{item_name:'라면',quantity:5,action:'order'}] },
{ pat:13, input:'차감 우유 2봉지',               expects:[{item_name:'우유',quantity:2,action:'consume'}] },
{ pat:13, input:'양파 3개 넣기',                 expects:[{item_name:'양파',quantity:3,action:'inbound'}] },
{ pat:13, input:'양파 3개 빼기',                 expects:[{item_name:'양파',quantity:3,action:'consume'}] },
{ pat:13, input:'파마산치즈 5개 발주해줘',       expects:[{item_name:'파마산치즈',quantity:5,action:'order'}] },
{ pat:13, input:'양파 3개 끝에 라면 5박스',       expects:[{item_name:'양파',quantity:3},{item_name:'끝에 라면',quantity:5}] },
{ pat:13, input:'양파 3개를 넣고 라면 5박스를 빼고', expects:[{item_name:'양파',quantity:3,action:'inbound'},{item_name:'라면',quantity:5,action:'consume'}] },
{ pat:13, input:'양파 5개은 입고',               expects:[{item_name:'양파',quantity:5,action:'inbound'}] },
{ pat:13, input:'양파 세 개 라면 5박스',          expects:[{item_name:'양파',quantity:3},{item_name:'라면',quantity:5}] },
{ pat:13, input:'양파 3개 그리고',               expects:[{item_name:'양파',quantity:3}] },

// ════════════ 패턴 14: 넣고/가져왔/콤마 (20개) ════════════
{ pat:14, input:'양파 3개 넣고 라면 5박스 빼고',                    expects:[{item_name:'양파',quantity:3,action:'inbound'},{item_name:'라면',quantity:5,action:'consume'}] },
{ pat:14, input:'양파 3개 넣자',                                    expects:[{item_name:'양파',quantity:3,action:'inbound'}] },
{ pat:14, input:'라면 5박스 가져왔어',                              expects:[{item_name:'라면',quantity:5,action:'inbound'}] },
{ pat:14, input:'우유 2봉지 가져왔고',                              expects:[{item_name:'우유',quantity:2,action:'inbound'}] },
{ pat:14, input:'양파 3개,라면 5박스',                              expects:[{item_name:'양파',quantity:3},{item_name:'라면',quantity:5}] },
{ pat:14, input:'양파 3개 ,라면 5박스',                             expects:[{item_name:'양파',quantity:3},{item_name:'라면',quantity:5}] },
{ pat:14, input:'양파 3개이랑 라면 5박스이랑 우유 2봉지이랑 참치 4캔', expects:[{item_name:'양파',quantity:3},{item_name:'라면',quantity:5},{item_name:'우유',quantity:2},{item_name:'참치',quantity:4}] },
{ pat:14, input:'양파를 3개 넣고 라면을 5박스 빼고',                expects:[{item_name:'양파',quantity:3,action:'inbound'},{item_name:'라면',quantity:5,action:'consume'}] },
{ pat:14, input:'오늘 깐마늘 5kg 가져왔고 파마산치즈 3개 넣었어',   expects:[{item_name:'깐마늘',quantity:5,action:'inbound'},{item_name:'파마산치즈',quantity:3,action:'inbound'}] },
{ pat:14, input:'비프 소스 4봉지, 크림 소스 3봉지, 토마토 소스 2통 입고', expects:[{item_name:'비프 소스',quantity:4,action:'inbound'},{item_name:'크림 소스',quantity:3,action:'inbound'},{item_name:'토마토 소스',quantity:2,action:'inbound'}] },
{ pat:14, input:'양파 3개 넣고 깐마늘 2kg 넣고 우유 1봉지 넣고',   expects:[{item_name:'양파',quantity:3,action:'inbound'},{item_name:'깐마늘',quantity:2,action:'inbound'},{item_name:'우유',quantity:1,action:'inbound'}] },
{ pat:14, input:'양파 3개랑 라면 5박스랑 우유 2봉지 주문해줘',      expects:[{item_name:'양파',quantity:3,action:'order'},{item_name:'라면',quantity:5,action:'order'},{item_name:'우유',quantity:2,action:'order'}] },
{ pat:14, input:'양파 3개 추가해줘',                                expects:[{item_name:'양파',quantity:3,action:'inbound'}] },
{ pat:14, input:'양파 3개 차감해줘',                                expects:[{item_name:'양파',quantity:3,action:'consume'}] },
{ pat:14, input:'양파 3개 주문해줘',                                expects:[{item_name:'양파',quantity:3,action:'order'}] },
{ pat:14, input:'양파 3개 입고. 라면 5박스 차감.',                  expects:[{item_name:'양파',quantity:3,action:'inbound'},{item_name:'라면',quantity:5,action:'consume'}] },
{ pat:14, input:'롤백 중 4개이랑 롤백 소 3개이랑 롤백 대 2개 발주해줘', expects:[{item_name:'롤백 중',quantity:4,action:'order'},{item_name:'롤백 소',quantity:3,action:'order'},{item_name:'롤백 대',quantity:2,action:'order'}] },
{ pat:14, input:'라면 5박스 가져다놨어',                            expects:[{item_name:'라면',quantity:5,action:'inbound'}] },
{ pat:14, input:'양파 3개 넣어줘',                                  expects:[{item_name:'양파',quantity:3,action:'inbound'}] },
{ pat:14, input:'양파 3개 넣었어',                                  expects:[{item_name:'양파',quantity:3,action:'inbound'}] },

];

// ── 실행 ───────────────────────────────────────────────────────────────────────
const byPat = {};
let pass = 0, fail = 0;
const failures = {};

for (const t of TESTS) {
  const res = run(t.input, t.expects);
  if (res.ok) {
    pass++;
  } else {
    fail++;
    if (!failures[t.pat]) failures[t.pat] = [];
    failures[t.pat].push({ input: t.input, reason: res.reason, got: res.results });
  }
  if (!byPat[t.pat]) byPat[t.pat] = { pass:0, fail:0 };
  if (res.ok) byPat[t.pat].pass++; else byPat[t.pat].fail++;
}

const total = pass + fail;
const pct = (pass/total*100).toFixed(1);
console.log(`\n${'═'.repeat(60)}`);
console.log(`전체 통과율: ${pass}/${total} (${pct}%)`);
console.log(`${'═'.repeat(60)}`);

const PAT_NAMES = {1:'단일품목×단위',2:'2단어품목명',3:'3단어품목명',4:'혼합액션',5:'연결어미',6:'붙여쓰기',7:'실제매장품목명',8:'연결어/접속사',9:'문장부호/특수',10:'미검증단위/큰숫자',11:'아이템명혼동방지',12:'복합동작어/써서',13:'복합시나리오',14:'넣고/가져왔/콤마'};
for (const [p, s] of Object.entries(byPat)) {
  const t2 = s.pass + s.fail;
  console.log(`  패턴 ${p} [${PAT_NAMES[p]}]: ${s.pass}/${t2} (${(s.pass/t2*100).toFixed(0)}%)`);
}

if (Object.keys(failures).length) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log('실패 케이스:');
  for (const [p, fs] of Object.entries(failures)) {
    console.log(`\n  ▶ 패턴 ${p} [${PAT_NAMES[p]}] — ${fs.length}개 실패`);
    for (const f of fs) {
      console.log(`    입력: "${f.input}"`);
      console.log(`    이유: ${f.reason}`);
      if (f.got && f.got.length) {
        console.log(`    결과: ${JSON.stringify(f.got.map(r=>({name:r.item_name,qty:r.quantity,unit:r.unit,action:r.action})))}`);
      }
    }
  }
}

process.exit(pct >= 90 ? 0 : 1);
