-- ════════════════════════════════════════════════════════
--  ZeroKitchen: kitchen_logs 테이블
--  자연어 입력 → 파싱 → 실행까지의 전 과정을 기록
-- ════════════════════════════════════════════════════════

create table if not exists kitchen_logs (
  id          bigint generated always as identity primary key,
  store_id    bigint not null,
  raw_input   text not null,                              -- 사용자가 입력한 원문
  parsed_items jsonb,                                     -- 파싱된 품목 배열 [{item_name, quantity, unit, action}, ...]
  final_action text check (final_action in ('inbound','consume','order','stock_check','mixed')),
  success     boolean not null default true,
  error_reason text,                                      -- 실패 시 이유
  confidence  real,                                       -- Rule Engine 최저 신뢰도 (0~1)
  used_llm    boolean not null default false,             -- LLM fallback 사용 여부
  created_at  timestamptz not null default now()
);

-- 인덱스: store_id + 시간순 조회
create index if not exists idx_kitchen_logs_store_created
  on kitchen_logs (store_id, created_at desc);

-- 인덱스: 실패 로그 필터링
create index if not exists idx_kitchen_logs_failure
  on kitchen_logs (store_id, success) where success = false;

-- 인덱스: LLM fallback 빈도 분석
create index if not exists idx_kitchen_logs_llm
  on kitchen_logs (store_id, used_llm) where used_llm = true;

-- RLS 정책 (Supabase 기본)
alter table kitchen_logs enable row level security;

create policy "Users can insert own store logs"
  on kitchen_logs for insert
  with check (true);

create policy "Users can read own store logs"
  on kitchen_logs for select
  using (true);

-- ════════════════════════════════════════════════════════
--  분석용 뷰: 자주 실패하는 입력 패턴
-- ════════════════════════════════════════════════════════

create or replace view kitchen_logs_failure_summary as
select
  store_id,
  raw_input,
  error_reason,
  count(*) as fail_count,
  max(created_at) as last_failed_at
from kitchen_logs
where success = false
group by store_id, raw_input, error_reason
order by fail_count desc;

-- ════════════════════════════════════════════════════════
--  분석용 뷰: LLM fallback 빈도
-- ════════════════════════════════════════════════════════

create or replace view kitchen_logs_llm_usage as
select
  store_id,
  date_trunc('day', created_at) as log_date,
  count(*) as total_inputs,
  count(*) filter (where used_llm = true) as llm_count,
  round(100.0 * count(*) filter (where used_llm = true) / count(*), 1) as llm_pct,
  avg(confidence) filter (where confidence is not null) as avg_confidence
from kitchen_logs
group by store_id, date_trunc('day', created_at)
order by log_date desc;

-- ════════════════════════════════════════════════════════
--  분석용 뷰: alias 추가 후보 (LLM fallback된 입력 원문)
-- ════════════════════════════════════════════════════════

create or replace view kitchen_logs_alias_candidates as
select
  store_id,
  raw_input,
  parsed_items,
  confidence,
  count(*) as occurrence,
  max(created_at) as last_seen
from kitchen_logs
where used_llm = true and success = true
group by store_id, raw_input, parsed_items, confidence
order by occurrence desc;
