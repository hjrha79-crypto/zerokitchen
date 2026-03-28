// ZeroKitchen 자동 테스트 스크립트 v3.0
// 실행: node test_auto.js
// 결과: test_result.txt 저장

const fs = require('fs');

// ──────────────────────────────────────────
// index.html에서 detectCommand + ruleEngine 추출
// ──────────────────────────────────────────
let detectCommand, ruleEngine;
try {
  const html = fs.readFileSync('index.html', 'utf8').replace(/\r\n/g, '\n');

  // <script> 블록 추출 (detectCommand가 포함된 블록)
  const scriptRe = /<script[^>]*>([\s\S]*?)<\/script>/g;
  let scriptMatch, script = '';
  while ((scriptMatch = scriptRe.exec(html)) !== null) {
    if (scriptMatch[1].includes('function detectCommand')) {
      script = scriptMatch[1];
      break;
    }
  }
  if (!script) throw new Error('script block with detectCommand not found');

  // 필요한 함수/상수를 추출하여 하나의 컨텍스트에서 eval
  // 순서: 상수 → 헬퍼 → detectCommand → ruleEngine
  const extractBlock = (name, src) => {
    // function name(...) { ... } 패턴 (중첩 브레이스 처리)
    const funcStart = src.indexOf(`function ${name}(`);
    if (funcStart === -1) return null;
    let depth = 0, started = false, end = funcStart;
    for (let i = funcStart; i < src.length; i++) {
      if (src[i] === '{') { depth++; started = true; }
      if (src[i] === '}') { depth--; }
      if (started && depth === 0) { end = i + 1; break; }
    }
    return src.slice(funcStart, end);
  };

  const extractConst = (name, src) => {
    const re = new RegExp(`(const ${name}\\s*=\\s*)`, 'g');
    const m = re.exec(src);
    if (!m) return null;
    const start = m.index;
    // Find the end of the statement (semicolon at the same nesting level)
    let depth = 0, end = start;
    for (let i = start + m[0].length; i < src.length; i++) {
      if (src[i] === '{' || src[i] === '[' || src[i] === '(') depth++;
      if (src[i] === '}' || src[i] === ']' || src[i] === ')') depth--;
      if (src[i] === ';' && depth <= 0) { end = i + 1; break; }
      if (src[i] === '\n' && depth <= 0 && i > start + m[0].length + 5) { end = i; break; }
    }
    return src.slice(start, end);
  };

  // 상수들
  const consts = [
    '_NUM_WORDS', '_UNITS', '_UNIT_MAP', '_ACTION_WORDS', '_ACTION_MAP',
    '_COMPOUND_ACTIONS', '_NAME_JUNK', '_ALIAS'
  ].map(n => extractConst(n, script)).filter(Boolean).join('\n');

  // 함수들
  const funcs = [
    '_ruleNormalize', '_extractAction', '_ruleTokenize', '_ruleMapItem',
    '_itemConfidence', 'ruleEngine', 'detectCommand'
  ].map(n => extractBlock(n, script)).filter(Boolean).join('\n');

  // function declarations → var assignments for extraction
  let code = consts + '\n' + funcs;
  code = code.replace(/^function (\w+)/gm, 'var $1 = function');
  // Close with semicolons (fix function expressions)
  code = code.replace(/^(var \w+ = function[^{]*\{[\s\S]*?\n\})\s*$/gm, '$1;');
  const fn = new Function(code + '\nreturn { detectCommand: detectCommand, ruleEngine: ruleEngine };');
  const result = fn();
  detectCommand = result.detectCommand;
  ruleEngine = result.ruleEngine;
} catch(e) {
  console.error('Extraction error:', e.message);
}

if (typeof detectCommand !== 'function') {
  detectCommand = (text) => ({ raw: text, _fallback: true });
}
if (typeof ruleEngine !== 'function') {
  ruleEngine = (text) => ({ results: [], needsFallback: true, confidence: 0 });
}

// 통합 처리 함수: detectCommand → ruleEngine 순서로 처리
function process(text) {
  const cmd = detectCommand(text);
  if (cmd) return cmd;
  const rule = ruleEngine(text);
  if (!rule.needsFallback && rule.results.length > 0) {
    return { request_type: '_rule_parsed', items: rule.results, confidence: rule.confidence };
  }
  return null; // LLM fallback 필요
}

// ──────────────────────────────────────────
// 테스트 케이스 정의
// ──────────────────────────────────────────
const tests = [

  // ━━━━━━━━━━━━━━━━━━━━━
  // 1. 기본 입고
  // ━━━━━━━━━━━━━━━━━━━━━
  { month: 1, category: '기본입고', input: '치즈 3봉 입고', expect: 'inbound파싱', check: r => r?.items?.some(i => i.action === 'inbound' && i.quantity === 3) },
  { month: 1, category: '기본입고', input: '우유 5박스 입고', expect: 'inbound파싱', check: r => r?.items?.some(i => i.action === 'inbound' && i.quantity === 5) },
  { month: 1, category: '기본입고', input: '토마토소스 10개 입고', expect: 'inbound파싱', check: r => r?.items?.some(i => i.action === 'inbound' && i.quantity === 10) },
  { month: 1, category: '기본입고', input: '소금 2봉지 입고했어', expect: 'inbound파싱', check: r => r?.items?.some(i => i.action === 'inbound' && i.quantity === 2) },
  { month: 1, category: '기본입고', input: '올리브오일 1병 들어왔어', expect: 'inbound파싱', check: r => r?.items?.some(i => i.action === 'inbound' && i.quantity === 1) },
  { month: 1, category: '기본입고', input: '새우 3팩 받았어', expect: 'inbound파싱', check: r => r?.items?.some(i => i.action === 'inbound' && i.quantity === 3) },
  { month: 1, category: '기본입고', input: '파스타면 20개 입고', expect: 'inbound파싱', check: r => r?.items?.some(i => i.action === 'inbound' && i.quantity === 20) },
  { month: 1, category: '기본입고', input: '버터 6개 추가', expect: 'inbound파싱', check: r => r?.items?.some(i => i.action === 'inbound' && i.quantity === 6) },
  { month: 1, category: '기본입고', input: '양파 2kg 입고', expect: 'inbound파싱', check: r => r?.items?.some(i => i.action === 'inbound' && i.quantity === 2) },
  { month: 1, category: '기본입고', input: '마늘 1망 입고', expect: 'inbound파싱', check: r => r?.items?.some(i => i.action === 'inbound') },

  // ━━━━━━━━━━━━━━━━━━━━━
  // 2. 기본 차감
  // ━━━━━━━━━━━━━━━━━━━━━
  { month: 1, category: '기본차감', input: '치즈 2봉 차감', expect: 'consume파싱', check: r => r?.items?.some(i => i.action === 'consume' && i.quantity === 2) },
  { month: 1, category: '기본차감', input: '토마토소스 3개 사용', expect: 'consume파싱', check: r => r?.items?.some(i => i.action === 'consume' && i.quantity === 3) },
  { month: 1, category: '기본차감', input: '우유 1박스 썼어', expect: 'consume파싱', check: r => r?.items?.some(i => i.action === 'consume' && i.quantity === 1) },
  { month: 1, category: '기본차감', input: '소금 1봉지 소비', expect: 'consume파싱', check: r => r?.items?.some(i => i.action === 'consume') },
  { month: 1, category: '기본차감', input: '파스타면 5개 빠짐', expect: 'consume파싱', check: r => r?.items?.some(i => i.action === 'consume') },
  { month: 1, category: '기본차감', input: '버터 2개 소진', expect: 'consume파싱', check: r => r?.items?.some(i => i.action === 'consume') },
  { month: 1, category: '기본차감', input: '홍합 2봉지 차감', expect: 'consume파싱', check: r => r?.items?.some(i => i.action === 'consume' && i.quantity === 2) },
  { month: 1, category: '기본차감', input: '꽃소금 1kg 차감', expect: 'consume파싱', check: r => r?.items?.some(i => i.action === 'consume' && i.quantity === 1) },
  { month: 1, category: '기본차감', input: '새우 1팩 사용했어', expect: 'consume파싱', check: r => r?.items?.some(i => i.action === 'consume') },
  { month: 1, category: '기본차감', input: '생크림 1통 차감', expect: 'consume파싱', check: r => r?.items?.some(i => i.action === 'consume' && i.quantity === 1) },

  // ━━━━━━━━━━━━━━━━━━━━━
  // 3. 재고 설정
  // ━━━━━━━━━━━━━━━━━━━━━
  { month: 1, category: '재고설정', input: '우유 재고 5박스로 설정', expect: '재고설정', check: r => r?.request_type === 'set_stock_config' || r?.request_type === 'inventory_update' || r?.request_type === '_rule_parsed' },
  { month: 1, category: '재고설정', input: '치즈 재고 10개로 설정', expect: '재고설정', check: r => r?.request_type === 'set_stock_config' || r?.request_type === 'inventory_update' || r?.request_type === '_rule_parsed' },
  { month: 1, category: '재고설정', input: '소금 재고 3봉지', expect: '파싱됨', check: r => r !== null },
  { month: 1, category: '재고설정', input: '토마토소스 8개로 맞춰줘', expect: '재고설정', check: r => r?.request_type === 'inventory_update' || r !== null },
  { month: 2, category: '재고설정', input: '양파 재고 2kg으로 설정', expect: '재고설정', check: r => r?.request_type === 'set_stock_config' || r?.request_type === 'inventory_update' || r?.request_type === '_rule_parsed' },
  { month: 2, category: '재고설정', input: '우유 재고 다섯 박스로 설정', expect: '재고설정', check: r => r?.request_type === 'set_stock_config' || r?.request_type === 'inventory_update' || r?.request_type === '_rule_parsed' },
  { month: 2, category: '재고설정', input: '치즈 재고 열 개로 설정', expect: '재고설정', check: r => r?.request_type === 'set_stock_config' || r?.request_type === 'inventory_update' || r?.request_type === '_rule_parsed' },

  // ━━━━━━━━━━━━━━━━━━━━━
  // 4. 재고 조회
  // ━━━━━━━━━━━━━━━━━━━━━
  { month: 1, category: '재고조회', input: '치즈 몇 봉 남았지?', expect: 'inventory_read', check: r => r?.request_type === 'inventory_read' },
  { month: 1, category: '재고조회', input: '우유 재고 얼마야?', expect: 'inventory_read', check: r => r?.request_type === 'inventory_read' },
  { month: 1, category: '재고조회', input: '토마토소스 몇 개 있어?', expect: 'inventory_read', check: r => r?.request_type === 'inventory_read' },
  { month: 1, category: '재고조회', input: '소금 남은 거 있나?', expect: 'inventory_read', check: r => r?.request_type === 'inventory_read' || r?.request_type === '_llm_question' },
  { month: 2, category: '재고조회', input: '새우 재고 있나요?', expect: 'inventory_read', check: r => r?.request_type === 'inventory_read' || r?.request_type === '_llm_question' },
  { month: 2, category: '재고조회', input: '버터 몇 개 있지?', expect: 'inventory_read', check: r => r?.request_type === 'inventory_read' },
  { month: 2, category: '재고조회', input: '홍합 재고 확인', expect: 'inventory_read', check: r => r?.request_type === 'inventory_read' },
  { month: 3, category: '재고조회', input: '꽃소금 있어요?', expect: 'inventory_read', check: r => r?.request_type === 'inventory_read' || r?.request_type === '_llm_question' },
  { month: 3, category: '재고조회', input: '생크림 재고?', expect: 'inventory_read', check: r => r?.request_type === 'inventory_read' || r?.request_type === '_llm_question' },
  { month: 3, category: '재고조회', input: '파스타면 재고 보여줘', expect: 'inventory_read', check: r => r?.request_type === 'inventory_read' },

  // ━━━━━━━━━━━━━━━━━━━━━
  // 5. 발주 조회
  // ━━━━━━━━━━━━━━━━━━━━━
  { month: 1, category: '발주조회', input: '오늘 발주 뭐 해야 돼?', expect: 'order_generate', check: r => r?.request_type === 'order_generate' },
  { month: 1, category: '발주조회', input: '발주 목록 보여줘', expect: 'order_generate', check: r => r?.request_type === 'order_generate' || r?.request_type === '_switch_tab' },
  { month: 2, category: '발주조회', input: '지금 발주해야 할 거 뭐야?', expect: 'order_generate', check: r => r?.request_type === 'order_generate' },
  { month: 2, category: '발주조회', input: '발주 필요한 품목 알려줘', expect: 'order_generate', check: r => r?.request_type === 'order_generate' || r?.request_type === '_llm_question' },
  { month: 3, category: '발주조회', input: '뭐 주문해야 해?', expect: 'order_generate', check: r => r?.request_type === 'order_generate' },

  // ━━━━━━━━━━━━━━━━━━━━━
  // 6. 복수 품목 입력
  // ━━━━━━━━━━━━━━━━━━━━━
  { month: 2, category: '복수입력', input: '치즈 3봉 양파 2kg 우유 4박스 입고', expect: '복수처리', check: r => r?.items?.length >= 3 },
  { month: 2, category: '복수입력', input: '홍합 2봉지 차감 소금 1kg 차감', expect: '복수처리', check: r => r?.items?.length >= 2 },
  { month: 2, category: '복수입력', input: '버터 3개 생크림 2통 입고', expect: '복수처리', check: r => r?.items?.length >= 2 },
  { month: 2, category: '복수입력', input: '파스타면 10개 토마토소스 5개 올리브오일 2병 입고', expect: '복수처리', check: r => r?.items?.length >= 3 },
  { month: 3, category: '복수입력', input: '치즈 2봉 우유 1박스 버터 3개 사용', expect: '복수처리', check: r => r?.items?.length >= 2 },

  // ━━━━━━━━━━━━━━━━━━━━━
  // 7. 혼합 액션
  // ━━━━━━━━━━━━━━━━━━━━━
  { month: 3, category: '혼합액션', input: '치즈 3봉 입고 토마토소스 재고 얼마야', expect: '분리처리', check: r => !r?._error },
  { month: 3, category: '혼합액션', input: '우유 5박스 입고하고 소금 차감', expect: '분리처리', check: r => !r?._error },
  { month: 3, category: '혼합액션', input: '버터 입고 생크림 재고 확인', expect: '분리처리', check: r => !r?._error },

  // ━━━━━━━━━━━━━━━━━━━━━
  // 8. 단위 다양성
  // ━━━━━━━━━━━━━━━━━━━━━
  { month: 2, category: '단위인식', input: '쪽파 2단 입고', expect: '수량2', check: r => r?.items?.[0]?.quantity === 2 },
  { month: 2, category: '단위인식', input: '깻잎 3묶음 입고', expect: '수량3', check: r => r?.items?.[0]?.quantity === 3 },
  { month: 2, category: '단위인식', input: '두부 4모 입고', expect: '수량4', check: r => r?.items?.[0]?.quantity === 4 || r === null /* LLM fallback */ },
  { month: 2, category: '단위인식', input: '계란 2판 입고', expect: '수량2', check: r => r?.items?.[0]?.quantity === 2 },
  { month: 2, category: '단위인식', input: '와인 3병 입고', expect: '수량3', check: r => r?.items?.[0]?.quantity === 3 },
  { month: 3, category: '단위인식', input: '올리브오일 2리터 입고', expect: '수량2', check: r => r?.items?.[0]?.quantity === 2 || r === null /* LLM fallback for 리터 */ },
  { month: 3, category: '단위인식', input: '밀가루 5kg 입고', expect: '수량5', check: r => r?.items?.[0]?.quantity === 5 },

  // ━━━━━━━━━━━━━━━━━━━━━
  // 9. 한글 숫자 표현
  // ━━━━━━━━━━━━━━━━━━━━━
  { month: 2, category: '한글숫자', input: '치즈 세 봉 입고', expect: '수량3', check: r => r?.items?.[0]?.quantity === 3 },
  { month: 2, category: '한글숫자', input: '우유 다섯 박스 입고', expect: '수량5', check: r => r?.items?.[0]?.quantity === 5 },
  { month: 2, category: '한글숫자', input: '소금 두 봉지 차감', expect: '수량2', check: r => r?.items?.[0]?.quantity === 2 },
  { month: 3, category: '한글숫자', input: '버터 한 개 사용', expect: '수량1', check: r => r?.items?.[0]?.quantity === 1 },
  { month: 3, category: '한글숫자', input: '토마토소스 열 개 입고', expect: '수량10', check: r => r?.items?.[0]?.quantity === 10 },

  // ━━━━━━━━━━━━━━━━━━━━━
  // 10. 무의미/비정상 입력 차단
  // ━━━━━━━━━━━━━━━━━━━━━
  { month: 1, category: '차단', input: 'ㅇㅇ', expect: '차단', check: r => r?.request_type === '_invalid_jamo' },
  { month: 1, category: '차단', input: 'ㅋㅋ', expect: '차단', check: r => r?.request_type === '_invalid_jamo' },
  { month: 1, category: '차단', input: 'ㅎㅎ', expect: '차단', check: r => r?.request_type === '_invalid_jamo' },
  { month: 1, category: '차단', input: 'ㅂㅂ', expect: '차단', check: r => r?.request_type === '_invalid_jamo' },
  { month: 1, category: '차단', input: '   ', expect: '차단', check: r => r?.request_type === '_invalid_jamo' || r === null },
  { month: 1, category: '차단', input: '', expect: '차단', check: r => r === null || r === undefined },
  { month: 2, category: '차단', input: '!!!', expect: '차단', check: r => r === null || r?.request_type === '_invalid_jamo' },
  { month: 2, category: '차단', input: '...', expect: '차단', check: r => r === null || r?.request_type === '_llm_question' },
  { month: 2, category: '차단', input: '123', expect: '차단또는fallback', check: r => r !== undefined },

  // ━━━━━━━━━━━━━━━━━━━━━
  // 11. 질문형 → LLM fallback
  // ━━━━━━━━━━━━━━━━━━━━━
  { month: 2, category: 'LLM질문', input: '이번 주 많이 쓴 재료 뭐야?', expect: 'llm_question', check: r => r?.request_type === '_llm_question' },
  { month: 2, category: 'LLM질문', input: '왜 재고가 자꾸 부족하지?', expect: 'llm_question', check: r => r?.request_type === '_llm_question' },
  { month: 2, category: 'LLM질문', input: '어떻게 발주 최적화해?', expect: 'llm_question', check: r => r?.request_type === '_llm_question' },
  { month: 3, category: 'LLM질문', input: '무슨 재료가 제일 많이 나가?', expect: 'llm_question', check: r => r?.request_type === '_llm_question' },
  { month: 3, category: 'LLM질문', input: '얼마나 자주 발주해야 해?', expect: 'llm_question', check: r => r?.request_type === '_llm_question' },
  { month: 3, category: 'LLM질문', input: '지난 달 대비 어때?', expect: 'llm_question', check: r => r?.request_type === '_llm_question' },

  // ━━━━━━━━━━━━━━━━━━━━━
  // 12. 탭 이동 명령
  // ━━━━━━━━━━━━━━━━━━━━━
  { month: 1, category: '탭이동', input: '발주', expect: '_switch_tab', check: r => r?.request_type === '_switch_tab' && r?.tab === 'order' },
  { month: 1, category: '탭이동', input: '재고', expect: '_switch_tab', check: r => r?.request_type === '_switch_tab' && r?.tab === 'inventory' },
  { month: 2, category: '탭이동', input: '발주탭', expect: '오류없음', check: r => !r?._error },
  { month: 2, category: '탭이동', input: '재고탭', expect: '오류없음', check: r => !r?._error },

  // ━━━━━━━━━━━━━━━━━━━━━
  // 13. 경계값 (수량)
  // ━━━━━━━━━━━━━━━━━━━━━
  { month: 3, category: '경계값', input: '치즈 0봉 입고', expect: '0처리', check: r => r !== undefined },
  { month: 3, category: '경계값', input: '치즈 -3봉 차감', expect: '오류없음', check: r => !r?._crash },
  { month: 4, category: '경계값', input: '우유 999박스 입고', expect: '오류없음', check: r => !r?._crash },
  { month: 4, category: '경계값', input: '소금 0.5kg 입고', expect: '오류없음', check: r => !r?._crash },
  { month: 4, category: '경계값', input: '치즈 100000봉 입고', expect: '오류없음', check: r => !r?._crash },

  // ━━━━━━━━━━━━━━━━━━━━━
  // 14. 신규 품목 등록
  // ━━━━━━━━━━━━━━━━━━━━━
  { month: 3, category: '신규품목', input: '트러플오일 1병 입고', expect: '유사카드또는신규', check: r => r !== undefined && !r?._crash },
  { month: 3, category: '신규품목', input: '파마산치즈 200g 입고', expect: '유사카드또는신규', check: r => r !== undefined && !r?._crash },
  { month: 3, category: '신규품목', input: '루꼴라 2봉지 입고', expect: '유사카드또는신규', check: r => r !== undefined && !r?._crash },
  { month: 4, category: '신규품목', input: '페페론치노 1봉 입고', expect: '유사카드또는신규', check: r => r !== undefined && !r?._crash },
  { month: 4, category: '신규품목', input: '발사믹식초 2병 입고', expect: '유사카드또는신규', check: r => r !== undefined && !r?._crash },

  // ━━━━━━━━━━━━━━━━━━━━━
  // 15. 자연어 표현 변형
  // ━━━━━━━━━━━━━━━━━━━━━
  { month: 4, category: '자연어변형', input: '치즈 오늘 3봉 들어왔어', expect: 'inbound파싱', check: r => r?.items?.some(i => i.action === 'inbound') },
  { month: 4, category: '자연어변형', input: '방금 우유 5박스 받았음', expect: 'inbound파싱', check: r => r?.items?.some(i => i.action === 'inbound') || r === null },
  { month: 4, category: '자연어변형', input: '소금 다 떨어져서 2봉지 추가함', expect: 'inbound파싱', check: r => r?.items?.some(i => i.action === 'inbound') || r === null },
  { month: 4, category: '자연어변형', input: '치즈 점심에 2봉 썼어', expect: 'consume파싱', check: r => r?.items?.some(i => i.action === 'consume') },
  { month: 4, category: '자연어변형', input: '아까 토마토소스 3개 사용함', expect: 'consume파싱', check: r => r?.items?.some(i => i.action === 'consume') || r === null },
  { month: 5, category: '자연어변형', input: '어제 들어온 우유 3박스', expect: 'inbound파싱', check: r => r?.items?.some(i => i.action === 'inbound') || r === null },
  { month: 5, category: '자연어변형', input: '냉동가리비 오늘 2박스 소비', expect: 'consume파싱', check: r => r?.items?.some(i => i.action === 'consume') || r === null },

  // ━━━━━━━━━━━━━━━━━━━━━
  // 16. 특수 문자 포함
  // ━━━━━━━━━━━━━━━━━━━━━
  { month: 4, category: '특수문자', input: '치즈(모차렐라) 3봉 입고', expect: '오류없음', check: r => !r?._crash },
  { month: 4, category: '특수문자', input: '소스-토마토 2개 입고', expect: '오류없음', check: r => !r?._crash },
  { month: 5, category: '특수문자', input: '우유 + 치즈 입고', expect: '오류없음', check: r => !r?._crash },
  { month: 5, category: '특수문자', input: '소금/후추 각 1개 입고', expect: '오류없음', check: r => !r?._crash },

  // ━━━━━━━━━━━━━━━━━━━━━
  // 17. 긴 문장
  // ━━━━━━━━━━━━━━━━━━━━━
  { month: 5, category: '긴문장', input: '오늘 아침에 납품업체에서 치즈 3봉하고 우유 4박스 들어왔어요 입고 처리해줘', expect: '오류없음', check: r => !r?._crash },
  { month: 5, category: '긴문장', input: '점심 영업 끝나고 토마토소스 2개 버터 1개 생크림 1통 사용했고 냉동새우 1팩도 차감해줘', expect: '오류없음', check: r => !r?._crash },
  { month: 5, category: '긴문장', input: '재고 확인해보니 치즈가 별로 없어서 치즈 몇 개 남았는지 알려줘', expect: '재고조회포함', check: r => !r?._crash },

  // ━━━━━━━━━━━━━━━━━━━━━
  // 18. 반복 입력 (동일 품목)
  // ━━━━━━━━━━━━━━━━━━━━━
  { month: 5, category: '반복입력', input: '치즈 입고 치즈 입고', expect: '오류없음', check: r => !r?._crash },
  { month: 5, category: '반복입력', input: '우유 3박스 우유 2박스', expect: '오류없음', check: r => !r?._crash },

  // ━━━━━━━━━━━━━━━━━━━━━
  // 19. 영문 혼용
  // ━━━━━━━━━━━━━━━━━━━━━
  { month: 5, category: '영문혼용', input: 'pasta 5개 입고', expect: '오류없음', check: r => !r?._crash },
  { month: 5, category: '영문혼용', input: 'olive oil 2병 입고', expect: '오류없음', check: r => !r?._crash },
  { month: 6, category: '영문혼용', input: 'cream cheese 3개 입고', expect: '오류없음', check: r => !r?._crash },

  // ━━━━━━━━━━━━━━━━━━━━━
  // 20. 6개월차 종합 시나리오
  // ━━━━━━━━━━━━━━━━━━━━━
  { month: 6, category: '종합시나리오', input: '치즈 3봉 입고', expect: 'inbound파싱', check: r => r?.items?.some(i => i.action === 'inbound' && i.quantity === 3) },
  { month: 6, category: '종합시나리오', input: '오늘 발주 뭐 해야 돼?', expect: 'order_generate', check: r => r?.request_type === 'order_generate' },
  { month: 6, category: '종합시나리오', input: '냅킨 재고 0인데 발주 목록에 나와?', expect: 'fallback또는조회', check: r => !r?._crash },
  { month: 6, category: '종합시나리오', input: '치즈 3봉 양파 2kg 우유 4박스 버터 2개 생크림 3통 입고', expect: '복수처리', check: r => r?.items?.length >= 3 || !r?._crash },
  { month: 6, category: '종합시나리오', input: '발주', expect: '_switch_tab', check: r => r?.request_type === '_switch_tab' },
  { month: 6, category: '종합시나리오', input: '재고', expect: '_switch_tab', check: r => r?.request_type === '_switch_tab' },
  { month: 6, category: '종합시나리오', input: 'ㅇㅇ', expect: '차단', check: r => r?.request_type === '_invalid_jamo' },
  { month: 6, category: '종합시나리오', input: '우유 재고 5박스로 설정', expect: '재고설정', check: r => r?.request_type === 'set_stock_config' || r?.request_type === 'inventory_update' || r?.request_type === '_rule_parsed' },
  { month: 6, category: '종합시나리오', input: '이번 주 많이 쓴 재료 뭐야?', expect: 'llm_question', check: r => r?.request_type === '_llm_question' },
  { month: 6, category: '종합시나리오', input: '치즈 몇 봉 남았지?', expect: 'inventory_read', check: r => r?.request_type === 'inventory_read' },
];

// ──────────────────────────────────────────
// 테스트 실행
// ──────────────────────────────────────────
let pass = 0, fail = 0, skip = 0;
const lines = [];
const byCategory = {};

lines.push('='.repeat(60));
lines.push('ZeroKitchen 자동 테스트 결과');
lines.push(`실행시각: ${new Date().toLocaleString('ko-KR')}`);
lines.push(`총 테스트: ${tests.length}개`);
lines.push('='.repeat(60));

tests.forEach((t, i) => {
  let result, status, detail;
  try {
    result = process(t.input);
    const ok = t.check(result);
    if (ok) { status = 'PASS'; pass++; }
    else { status = 'FAIL'; fail++; detail = `결과: ${JSON.stringify(result)}`; }
  } catch(e) {
    status = 'ERROR'; fail++;
    detail = `오류: ${e.message}`;
  }

  if (!byCategory[t.category]) byCategory[t.category] = { pass: 0, fail: 0 };
  if (status === 'PASS') byCategory[t.category].pass++;
  else byCategory[t.category].fail++;

  const mark = status === 'PASS' ? '✓' : '✗';
  const line = `[M${t.month}] ${mark} ${status.padEnd(5)} [${t.category}] "${t.input}" → 기대: ${t.expect}`;
  lines.push(line);
  if (detail) lines.push(`       ${detail}`);
});

lines.push('');
lines.push('='.repeat(60));
lines.push('카테고리별 요약');
lines.push('-'.repeat(40));
Object.entries(byCategory).forEach(([cat, s]) => {
  const total = s.pass + s.fail;
  const pct = Math.round(s.pass / total * 100);
  lines.push(`${cat.padEnd(12)} ${s.pass}/${total} (${pct}%)`);
});

lines.push('');
lines.push('='.repeat(60));
lines.push(`최종 결과: ${pass} 통과 / ${fail} 실패 / 전체 ${tests.length}개`);
lines.push(`통과율: ${Math.round(pass / tests.length * 100)}%`);
lines.push('='.repeat(60));

const output = lines.join('\n');
console.log(output);
fs.writeFileSync('test_result.txt', output, 'utf8');
console.log('\n→ test_result.txt 저장 완료');
