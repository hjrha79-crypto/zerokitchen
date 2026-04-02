# ZeroKitchen Claude.md v2

## 0. 시스템 목적

ZeroKitchen은 재고 관리 앱이 아니라  
"현장에서 가장 빠르게 발주를 끝내는 시스템"이다.

모든 판단 기준은 아래 한 줄이다:

→ 종이 메모보다 쉬운가?

YES 아니면 구현하지 않는다.

---

## 1. 절대 원칙 (Non-Negotiable)

- 종이보다 복잡해지면 실패다
- 입력은 생각 없이 가능해야 한다
- 사용자가 멈추면 UX 실패다
- 설명보다 실행이 우선이다

---

## 2. 입력 처리 규칙

- 기본 입력은 덮어쓰기
- 추가는 명시적 키워드 있을 때만 허용 (추가, 더, plus)

수량 규칙:
- 없음 = 0
- 거의없음 = 0.2 (고정값)
- 반 = 0.5
- 분수 허용 (1/2, 1/3 등)

예외 발생 시:
→ 추측하지 말고 안전한 기본값으로 처리 후 사용자에게 표시

---

## 3. 발주 로직 규칙

- 추천은 기본값이지만 항상 사용자가 수정 가능해야 한다
- 사용자의 수정은 항상 기록한다

추천 기준:
1순위: 소비량 데이터 (3회 이상)
2순위: 목표 재고

금지:
- 과잉 발주
- 근거 없는 추천

---

## 4. UX 원칙

- 클릭 수 최소화
- 화면 이동 최소화
- 사용자가 생각하는 순간 실패

출력은 항상:
→ 바로 실행 가능한 형태

예:
[발주]
치즈 5봉
양파 3개

---

## 5. 오류 처리 시스템

- 모든 오류는 기록한다
- 동일 오류 반복 시 규칙으로 승격한다

오류 유형:
- 수량 파싱 실패
- 품목 매칭 실패
- 표현 다양성 미지원

절대 금지:
→ 오류 무시

---

## 6. 의사결정 프로세스 (중요)

모든 기능 개발은 아래 순서를 따른다:

1. 아이디어 정의
2. 전략 검토 (Strategic Review)
3. 승인 여부 판단
4. 승인된 경우에만 구현

### 예외
- 단순 UI 수정
- 명확한 버그 수정

이 경우 즉시 실행 가능

---

## 7. 개발 원칙

- 단순한 구조 우선
- 과도한 자동화 금지
- ERP처럼 확장 금지

ZeroKitchen의 경쟁 상대는 ERP가 아니라 종이다.

---

## 8. 데이터 원칙

- 모든 행동은 로그로 남는다
- 로그는 KPI로 연결된다
- 데이터 없는 기능은 금지

핵심 구조:
입력 → 실행 → 저장 → 분석

---

## 9. 추천 시스템 규칙

추천은 아래 기준으로 평가한다:

- 수정 없이 확정되었는가?
- 실제 사용과 맞는가?
- 과잉/부족이 없는가?

source 정의:
- target_based
- consumption_based
- manual

---

## 10. 금지 사항

- 검토 없이 기능 추가 금지
- 복잡한 UI 추가 금지
- 다단계 입력 요구 금지
- 자동화 과신 금지

---

## 11. 시스템 방향

ZeroKitchen은 기능 앱이 아니라 데이터 시스템이다.

목표:
- Zero Waste Time
- Zero Waste Food
- Zero Stress

---

## 12. 실행 기준

항상 이 질문으로 판단한다:

→ 이게 종이보다 빠른가?

NO → 하지 않는다

---

## 13. 기술 스택

- **프론트엔드**: Vanilla JS, 단일 `index.html` (모놀리식 SPA, ~209KB)
- **DB**: Supabase (PostgreSQL) — 클라이언트 직접 호출
- **음성인식**: MediaRecorder + OpenAI gpt-4o-mini-transcribe
- **NLP 파싱**: Rule Engine (정규식, 비용 0) → Claude LLM 폴백 (~5-20%)
- **배포**: Vercel (Edge Functions)
- **API 프록시**: `api/transcribe.js` (OpenAI 키 서버사이드 관리)

---

## 14. 파일 구조

```
index.html            — 전체 앱 (HTML + CSS + JS 올인원)
api/transcribe.js     — Vercel Edge Function (음성→텍스트 프록시)
sql_kitchen_logs.sql  — DB 스키마
fix_voice_*.txt       — 수정 가이드 문서
```

---

## 15. 코드 컨벤션

- private 함수/변수: `_` 접두사 (`_micActive`, `_transcribeAudio`)
- 변수명: camelCase
- HTML id: camelCase (`nlInput`, `micBtn`)
- CSS class: kebab-case (`.mic-wave-bar`, `.inv-card`)
- 요청 타입: snake_case (`stock_check`, `inventory_update`)
- UI 텍스트: 한국어 / 코드 주석: 한국어 또는 영어

---

## 16. 커밋 메시지

```
[카테고리]-[번호]: 한국어 설명
```
카테고리: `UI`, `Order`, `Voice`, `Feature`, `fix`

---

## 17. 핵심 아키텍처

- **진입점**: `processRequest(json)` — 모든 요청의 단일 처리 함수
- **상태**: 전역 변수 (`_items`, `_vendors`, `_orderRequests`, `SID`)
- **DB**: 액션 즉시 Supabase write-through
- **로깅**: 모든 작업 `kitchen_operations` 테이블에 기록
- **발주 추천**: 소비량 기반 (중앙값, 3회 이상) → 목표 재고 기반 폴백

---

## 18. 개발 주의사항

- `index.html` 줄 번호 자주 변동 → 수정 시 검색으로 위치 확인
- API 키 코드에 하드코딩 금지 (GitHub Push Protection 활성화됨)
- Supabase 키는 publishable (클라이언트용), OpenAI 키는 서버사이드만
- 음성 설정 함수(`toggleMicSettings`, `_renderMicTimeoutOpts`, `_setMicTimeout`)는 별도 유지