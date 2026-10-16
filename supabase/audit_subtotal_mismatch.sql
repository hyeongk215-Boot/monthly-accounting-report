-- =====================================================================
-- 소계 불일치 점검 (저장된 소계 vs 명세행으로 계산한 값)
--   작성 2026-10-16 / 계기: 흥아물류 천진 2026-05 유입소계 -64.00
--
-- 전부 읽기전용입니다. 아무것도 바꾸지 않습니다.
--
-- 【읽는 법】
--   auto   : 서버가 계산해 저장하므로 차이가 나면 안 됩니다. 나오면 버그입니다.
--   legacy : 지점이 엑셀에서 붙여넣은 값입니다. 차이는 그 지점 엑셀의
--            소계 수식이 명세행 합계와 어긋난다는 뜻 - 보통 입력 누락이나
--            수식 범위 오류입니다.
-- =====================================================================


-- =====================================================================
-- [1] 흥아물류 천진 2026-05 - 소계행 전체
--     어느 소계가 얼마나 어긋났는지. 유입만인지 다른 데도 번졌는지 봅니다.
-- =====================================================================
with src as (
  select jsonb_object_agg(account_code, coalesce(amount_cny, 0)) as vals
    from acct_statement_lines
   where statement_type = 'CF' and corp = '흥아물류'
     and office = '천진' and yearmonth = '2026-05'
), calc as (
  select acct_eval_formulas('CF', vals) as v from src
)
select a.line_no as "행차", l.account_code as "코드", a.name_ko as "계정",
       l.amount_cny as "저장값",
       (c.v ->> l.account_code)::numeric as "명세행으로계산",
       (c.v ->> l.account_code)::numeric - l.amount_cny as "차이",
       a.formula as "공식"
  from acct_statement_lines l
  join acct_accounts a
    on a.statement_type = 'CF' and a.code = l.account_code
  cross join calc c
 where l.statement_type = 'CF' and l.corp = '흥아물류'
   and l.office = '천진' and l.yearmonth = '2026-05'
   and a.formula is not null and a.formula <> ''
 order by a.display_order;


-- =====================================================================
-- [2] 같은 제표의 명세행 (0 아닌 것만)
--     64 가 어느 계정에서 샜는지 눈으로 찾습니다.
-- =====================================================================
select a.line_no as "행차", l.account_code as "코드", a.name_ko as "계정",
       a.category as "분류", l.amount_cny as "금액"
  from acct_statement_lines l
  join acct_accounts a
    on a.statement_type = 'CF' and a.code = l.account_code
 where l.statement_type = 'CF' and l.corp = '흥아물류'
   and l.office = '천진' and l.yearmonth = '2026-05'
   and coalesce(l.amount_cny, 0) <> 0
   and (a.formula is null or a.formula = '')
 order by a.display_order;


-- =====================================================================
-- [3] 흥아 천진이 다른 달에도 같은 증상인지
--     한 달만이면 오타, 여러 달이면 그 지점 엑셀 수식 문제입니다.
-- =====================================================================
with t as (
  select yearmonth, calc_mode,
         jsonb_object_agg(account_code, coalesce(amount_cny, 0)) as vals,
         max(amount_cny) filter (where account_code = 'CF-09') as cf09,
         max(amount_cny) filter (where account_code = 'CF-20') as cf20
    from acct_statement_lines
   where statement_type = 'CF' and corp = '흥아물류' and office = '천진'
   group by yearmonth, calc_mode
)
select yearmonth as "년월", calc_mode as "계산모드",
       cf09 - (acct_eval_formulas('CF', vals) ->> 'CF-09')::numeric as "유입소계차이",
       cf20 - (acct_eval_formulas('CF', vals) ->> 'CF-20')::numeric as "유출소계차이"
  from t
 order by yearmonth;


-- =====================================================================
-- [4] 전 지점·전월 CF 소계 전수 점검
--     천진 건이 혼자인지, 비슷한 게 더 있는지. 조금 느릴 수 있습니다.
--     ※ 내부거래 관행 차이(흥아 상해)는 여기서도 차이로 잡힙니다 -
--       그건 알려진 건이니 제외하고 보십시오.
-- =====================================================================
with t as (
  select corp, office, yearmonth, calc_mode,
         jsonb_object_agg(account_code, coalesce(amount_cny, 0)) as vals
    from acct_statement_lines
   where statement_type = 'CF'
   group by corp, office, yearmonth, calc_mode
), d as (
  select t.corp, t.office, t.yearmonth, t.calc_mode,
         a.code, a.name_ko, a.display_order,
         (t.vals ->> a.code)::numeric as stored,
         (acct_eval_formulas('CF', t.vals) ->> a.code)::numeric as calc
    from t
    join acct_accounts a
      on a.statement_type = 'CF' and a.active and a.formula is not null and a.formula <> ''
)
select corp as "법인", office as "지점", yearmonth as "년월", calc_mode as "계산모드",
       code as "코드", name_ko as "계정",
       stored as "저장값", calc as "계산값", calc - stored as "차이"
  from d
 where stored is distinct from calc
   and abs(coalesce(calc, 0) - coalesce(stored, 0)) > 0.005   -- 반올림 오차 무시
 order by abs(calc - stored) desc, yearmonth, corp, office, display_order;
