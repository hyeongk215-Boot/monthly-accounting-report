-- =====================================================================
-- 2024-01 ~ 2024-11 월 마감 (추가 입력 방지)
--   작성 2026-09-30
--
-- 【효과】 acct_closed_months 에 들어간 월은 submit_statement / submit_pl_kr_extra 가
--          'month_closed' 예외로 막습니다. system_admin 포함 전 역할이 입력 불가입니다.
--          조회·집계·삭제는 영향 없습니다(delete_statement_line 은 마감을 보지 않음).
--
-- ⚠⚠ 2024-12 는 절대 넣지 마십시오 ⚠⚠
--     2024-12 는 期初 BS 앵커로, 17개 지점이 앞으로 새로 입력해야 하는 달입니다.
--     여기를 닫으면 앵커 입력 자체가 막히고, 2025년 전체가 진행 불가가 됩니다.
--     그래서 아래는 BETWEEN 범위가 아니라 11개 값을 하나씩 나열했습니다.
-- =====================================================================


-- --- 1) 실행 전 확인: 지금 닫혀 있는 월 ---
select yearmonth as "마감월", closed_at as "마감시각", closed_by as "마감자"
  from acct_closed_months
 order by yearmonth;


-- --- 2) 마감 실행 ---
insert into acct_closed_months (yearmonth, closed_by) values
  ('2024-01', 'system_admin'),
  ('2024-02', 'system_admin'),
  ('2024-03', 'system_admin'),
  ('2024-04', 'system_admin'),
  ('2024-05', 'system_admin'),
  ('2024-06', 'system_admin'),
  ('2024-07', 'system_admin'),
  ('2024-08', 'system_admin'),
  ('2024-09', 'system_admin'),
  ('2024-10', 'system_admin'),
  ('2024-11', 'system_admin')
on conflict (yearmonth) do nothing;


-- --- 3) 실행 후 검증 ---
--     기대: 마감월 11개(2024-01 ~ 2024-11), 2024-12 없음, 2025/2026 없음
select yearmonth as "마감월", closed_at as "마감시각"
  from acct_closed_months
 order by yearmonth;

--     한 줄 요약 검증 — "2024-12마감여부" 가 반드시 false 여야 합니다
select count(*) filter (where yearmonth like '2024-%')                 as "2024년_마감수",
       bool_or(yearmonth = '2024-12')                                  as "2024-12마감여부",
       count(*) filter (where yearmonth >= '2025-01')                  as "2025년이후_마감수"
  from acct_closed_months;


-- =====================================================================
-- 되돌리기 (마감 해제)
-- =====================================================================
-- 전체 해제:
-- delete from acct_closed_months where yearmonth between '2024-01' and '2024-11';
--
-- 한 달만 해제:
-- delete from acct_closed_months where yearmonth = '2024-03';
--
-- ※ 화면(관리자)에서도 해당 월을 선택해 "마감 해제" 버튼으로 가능합니다.
