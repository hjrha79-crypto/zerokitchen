const fs = require('fs');

const defaultUnitMap = {
  "양파": "개",
  "브로콜리": "개",
  "우유": "박스",
  "치즈": "봉"
};

function normalizeAction(text) {
  if (text.includes("입고했어") || text.includes("입고")) return "입고";
  if (text.includes("사용했어") || text.includes("사용") || text.includes("써")) return "사용";
  if (text.includes("발주해줘") || text.includes("발주")) return "발주";
  return "없음";
}

function preprocessText(text) {
  return text.replace(/([A-Za-z가-힣])(\d+)/g, '$1 $2');
}

function extractStatusQty(text) {
  if (
    text.includes("거의없음") ||
    text.includes("거의 없음") ||
    text.includes("없음") ||
    text.includes("바닥")
  ) {
    return 0;
  }

  return null;
}

// 파일 읽기
const data = JSON.parse(fs.readFileSync('test_input.json', 'utf-8'));

// 아주 단순한 파서
function extractKoreanQty(text) {
  if (text.includes("반박스") || text.includes("반봉") || text.includes("반개") || text.includes("반포")) {
    return 0.5;
  }

  if (text.includes("하나")) return 1;
  if (text.includes("한개")) return 1;
  if (text.includes("한 박스")) return 1;
  if (text.includes("한박스")) return 1;
  if (text.includes("한봉")) return 1;
  if (text.includes("한캔")) return 1;
  if (text.includes("한병")) return 1;
  if (text.includes("한통")) return 1;
  if (text.includes("한포")) return 1;
  if (text.includes("한판")) return 1;

  if (text.includes("두개")) return 2;
  if (text.includes("두 박스")) return 2;
  if (text.includes("두박스")) return 2;
  if (text.includes("두봉")) return 2;
  if (text.includes("두캔")) return 2;
  if (text.includes("두병")) return 2;
  if (text.includes("두통")) return 2;
  if (text.includes("두포")) return 2;
  if (text.includes("두단")) return 2;
  if (text.includes("두판")) return 2;

  if (text.includes("세개")) return 3;
  if (text.includes("세봉")) return 3;
  if (text.includes("세캔")) return 3;
  if (text.includes("세병")) return 3;
  if (text.includes("세통")) return 3;
  if (text.includes("세포")) return 3;
  if (text.includes("세단")) return 3;
  if (text.includes("세판")) return 3;

  if (text.includes("네개")) return 4;
  if (text.includes("네봉")) return 4;
  if (text.includes("네캔")) return 4;
  if (text.includes("네병")) return 4;
  if (text.includes("네통")) return 4;

  if (text.includes("다섯개")) return 5;
  if (text.includes("다섯캔")) return 5;

  if (text.includes("여섯개")) return 6;
  if (text.includes("여섯캔")) return 6;

  return null;
}

function parse(text) {
  text = preprocessText(text);

  let item = "";
  let qty = null;
  let unit = "";
  let action = "없음";

  // 행동 감지
  action = normalizeAction(text);

  // 수량 추출 (숫자만)
  const numberMatch = text.match(/\d+/);
  if (numberMatch) {
    qty = Number(numberMatch[0]);
  } else {
    qty = extractKoreanQty(text);
    if (qty === null) {
      qty = extractStatusQty(text);
    }
  }

  // 단위 추출
  if (text.includes("봉")) unit = "봉";
  else if (text.includes("개")) unit = "개";
  else if (text.includes("박스")) unit = "박스";
  else if (text.includes("캔")) unit = "캔";
  else if (text.includes("병")) unit = "병";
  else if (text.includes("통")) unit = "통";
  else if (text.includes("포")) unit = "포";
  else if (text.includes("단")) unit = "단";
  else if (text.includes("판")) unit = "판";

  // 품목 (맨 앞 단어 기준)
  item = text.split(" ")[0];

  // 기본 단위 보정
  if (unit === "" && defaultUnitMap[item]) {
    unit = defaultUnitMap[item];
  }

  return { item, qty, unit, action };
}

// 전체 실행
const result = data.map(text => ({
  input: text,
  parsed: parse(text)
}));

function getFailReason(input, parsed) {
  const isStatusExpression =
    input.includes("거의없음") ||
    input.includes("거의 없음") ||
    input.includes("없음") ||
    input.includes("바닥");
  const normalizedInput = preprocessText(input);

  // 1. 상태 표현
  if (isStatusExpression && parsed.qty === null) {
    return "상태 표현 처리 실패";
  }

  if (input.includes("조금")) {
    return null;
  }

  // 2. 수량 한글 표현
  if (
    (
      input.includes("하나") ||
      input.includes("두개") ||
      input.includes("두박스") ||
      input.includes("반박스")
    ) &&
    parsed.qty === null
  ) {
    return "한글/반단위 수량 처리 실패";
  }

  // 3. 붙여쓰기
  if (!normalizedInput.includes(" ") && /\d/.test(input)) {
    return "붙여쓰기 파싱 실패";
  }

  // 4. 행동은 있는데 동사 변형
  if (
    (input.includes("입고했어") || input.includes("써") || input.includes("사용했어")) &&
    parsed.action === "없음"
  ) {
    return "행동 동사 변형 처리 실패";
  }

  // 5. 발주는 수량 없이도 정상 허용
  if (parsed.action === "발주" && parsed.qty === null) {
    return null;
  }

  // 6. 숫자는 있는데 단위 없음
  if (parsed.qty !== null && parsed.unit === "" && !(isStatusExpression && parsed.qty === 0)) {
    return "단위 추출 실패";
  }

  // 7. 수량 자체 누락
  if (parsed.qty === null) {
    return "수량 추출 실패";
  }

  // 8. 품목 이상
  if (/\d/.test(parsed.item)) {
    return "품목 추출 실패";
  }

  return null;
}

// 실패 케이스만 추출
const failed = result
  .map(r => {
    const reason = getFailReason(r.input, r.parsed);
    if (!reason) return null;
    return {
      input: r.input,
      parsed: r.parsed,
      reason
    };
  })
  .filter(Boolean);

// 출력
console.log("=== 실패 케이스 ===");
console.log(JSON.stringify(failed, null, 2));

const summary = {};

for (const f of failed) {
  if (!summary[f.reason]) {
    summary[f.reason] = 0;
  }
  summary[f.reason] += 1;
}

console.log("=== 실패 유형별 개수 ===");
console.log(JSON.stringify(summary, null, 2));
