-- =====================================================================
-- CF 내부거래 2행(CF-91 / CF-92)이 영업활동 소계에 합산되던 문제 수정
--   작성 2026-10-16
--
-- 【증상】 지점이 "收到/支付的其他与经营活动有关的现金(内部往来)" 를 입력하면
--          经营活动现金流入小计(CF-09) / 流出小计(CF-20) 가 그만큼 부풀어 오릅니다.
--
-- 【원인】 阶段一 공식에 [CF-91] / [CF-92] 를 넣은 것이 잘못이었습니다.
--          두 행은 line_no 가 null 입니다. 즉 会企03表 표준 양식의 행이 아니라
--          표 맨 아래에 따로 덧붙인 참고용 줄(분류='내부거래')입니다.
--          금액은 이미 CF-08(8행) / CF-18(18행) 안에 포함돼 있으므로,
--          소계에 다시 더하면 이중계상이 됩니다.
--
-- 【영향】 CF-09, CF-20 이 틀리면 CF-21(영업활동순현금) → CF-56(현금순증가액)
--          까지 연쇄로 틀어지고, 자금집행 모듈이 읽는 값도 같이 틀어집니다.
--          단 calc_mode='legacy' 인 2026-01~08 은 재계산이 걸리지 않으므로
--          저장된 소계는 지점이 붙여넣은 값 그대로이며 영향 없습니다.
-- =====================================================================


-- =====================================================================
-- 1단계. 공식 수정
-- =====================================================================
update acct_accounts set formula = '[CF-01]+[CF-03]+[CF-08]'
 where statement_type = 'CF' and code = 'CF-09';

update acct_accounts set formula = '[CF-10]+[CF-12]+[CF-13]+[CF-18]'
 where statement_type = 'CF' and code = 'CF-20';

-- ⚠ 백업표에도 반드시 반영해야 합니다.
--    acct_formula_backup 에는 "틀린 공식"이 들어 있어서, 이걸 안 고치고 나중에
--    자동계산을 껐다 켜면(rollback 1단계 되돌리기) 버그가 그대로 되살아납니다.
update acct_formula_backup b set formula = a.formula, backed_up_at = now()
  from acct_accounts a
 where a.statement_type = b.statement_type and a.code = b.code
   and b.statement_type = 'CF' and b.code in ('CF-09', 'CF-20');

-- 확인: 두 공식에 CF-91/CF-92 가 남아있지 않아야 합니다 (0건 기대)
select statement_type as "제표", code as "행", formula as "공식"
  from acct_accounts
 where formula like '%CF-91%' or formula like '%CF-92%';

-- 확인: 백업표도 같은 값인지 (차이 0건 기대)
select a.code as "행", a.formula as "현재공식", b.formula as "백업공식"
  from acct_accounts a join acct_formula_backup b
    on a.statement_type = b.statement_type and a.code = b.code
 where a.statement_type = 'CF' and a.formula is distinct from b.formula;


-- =====================================================================
-- 2단계. 피해 범위 파악  ※ 3단계 전에 반드시 먼저 실행
-- =====================================================================
-- 이미 자동계산으로 저장된 CF 중 내부거래 금액이 들어간 건을 찾습니다.
-- "소계차이" 가 0 이 아니면 그만큼 부풀어 저장돼 있다는 뜻입니다.
with cf as (
  select corp, office, yearmonth, calc_mode,
         max(amount_cny) filter (where account_code = 'CF-91') as cf91,
         max(amount_cny) filter (where account_code = 'CF-92') as cf92,
         max(amount_cny) filter (where account_code = 'CF-01') as cf01,
         max(amount_cny) filter (where account_code = 'CF-03') as cf03,
         max(amount_cny) filter (where account_code = 'CF-08') as cf08,
         max(amount_cny) filter (where account_code = 'CF-09') as cf09,
         max(amount_cny) filter (where account_code = 'CF-21') as cf21
    from acct_statement_lines
   where statement_type = 'CF'
   group by corp, office, yearmonth, calc_mode
)
select corp as "법인", office as "지점", yearmonth as "년월", calc_mode as "계산모드",
       cf91 as "내부수취", cf92 as "내부지급",
       cf09 as "저장된유입소계",
       coalesce(cf01,0) + coalesce(cf03,0) + coalesce(cf08,0) as "올바른유입소계",
       cf09 - (coalesce(cf01,0) + coalesce(cf03,0) + coalesce(cf08,0)) as "소계차이",
       cf21 as "저장된영업순현금"
  from cf
 where coalesce(cf91,0) <> 0 or coalesce(cf92,0) <> 0
    or cf09 is distinct from (coalesce(cf01,0) + coalesce(cf03,0) + coalesce(cf08,0))
 order by calc_mode, yearmonth, corp, office;


-- =====================================================================
-- 3단계. 재계산  ==> 【실행하지 마십시오】 2026-10-16 조사 결과 불필요·유해
-- =====================================================================
-- 2단계 결과(2026-10-16):
--   auto 로 저장된 CF 는 4건뿐이었고, 그 중 소계가 부푼 것은
--   흥아물류 상해 2025-12 / 2026-09 두 건입니다. 나머지는 차이 0 입니다.
--   YJC 지점들은 한 건도 없습니다 - 엑셀 대조 경고(⚠)를 보고 제출 전에
--   멈췄기 때문에, 틀린 값이 저장된 적이 없습니다.
--
-- 그런데 그 두 건은 "틀린" 것이 아니었습니다. 지점별 입력 관행이 다릅니다.
--   . 16개 지점: CF-08 안에 내부거래가 포함됨 (하문은 CF-08 = CF-91 로 완전 동일)
--     -> 소계에 CF-91 을 더하면 이중계상. 공식 수정이 맞습니다.
--   . 흥아물류 상해만: CF-08 에서 내부거래를 빼고 CF-91 에 따로 적음
--     2026-08 은 CF-08 = 0 인데 CF-91 = 15,410,452.01 입니다.
--     -> 이 지점은 소계에 더해야 총액이 맞았고, 실제로 legacy 10개월 내내
--        차이가 CF-91 과 1전까지 일치했습니다.
--
-- 따라서 여기서 blanket 재계산을 돌리면 흥아 상해의 영업활동 현금유입이
-- 월 1,500만~2,200만 위안 과소계상됩니다. 멀쩡한 숫자를 망가뜨립니다.
--
-- 해법은 SQL 이 아니라 입력 관행 통일입니다. 흥아물류 상해가 내부거래 금액을
-- CF-08 / CF-18 에 포함시켜 입력하면(2026-10-16 통지 완료), 수정된 공식으로도
-- 소계가 똑같이 나옵니다. 2026-09 로 검산:
--     현재 6,454,094.68 + 1,784.21 + 17,976,146.05(CF-91) = 24,432,024.94
--     개선 6,454,094.68 + 17,977,930.26(CF-08 에 합침)    = 24,432,024.94
-- 금액은 그대로이고 어느 칸에 들어가느냐만 달라집니다.
--
-- 이미 저장된 데이터는 전 지점 소계·순현금이 정확하므로 손대지 않습니다.
-- 자금집행 / 실적분석에도 영향이 없습니다.
--
-- 아래 쿼리는 혹시 나중에 공식을 또 고칠 일이 생겼을 때를 위해 남겨둡니다.
-- 그때도 반드시 2단계로 범위를 먼저 확인하고, 지점별 관행 차이를 점검하십시오.

-- -- 3-1. 바뀔 내용 미리보기 (읽기전용)
-- with src as (
--   select l.corp, l.office, l.yearmonth,
--          jsonb_object_agg(l.account_code, coalesce(l.amount_cny, 0)) as vals
--     from acct_statement_lines l
--    where l.statement_type = 'CF' and l.calc_mode = 'auto'
--    group by l.corp, l.office, l.yearmonth
-- ), calc as (
--   select corp, office, yearmonth, acct_eval_formulas('CF', vals) as v from src
-- )
-- select l.corp as "법인", l.office as "지점", l.yearmonth as "년월", l.account_code as "계정",
--        l.amount_cny as "현재값", (c.v ->> l.account_code)::numeric as "재계산값",
--        (c.v ->> l.account_code)::numeric - l.amount_cny as "차이"
--   from acct_statement_lines l
--   join calc c on c.corp = l.corp and c.office = l.office and c.yearmonth = l.yearmonth
--  where l.statement_type = 'CF' and l.calc_mode = 'auto'
--    and l.amount_cny is distinct from (c.v ->> l.account_code)::numeric
--  order by l.yearmonth, l.corp, l.office, l.account_code;

-- -- 3-2. 실제 반영 (KRW 환산도 같이 갱신)
-- with src as (
--   select l.corp, l.office, l.yearmonth,
--          jsonb_object_agg(l.account_code, coalesce(l.amount_cny, 0)) as vals
--     from acct_statement_lines l
--    where l.statement_type = 'CF' and l.calc_mode = 'auto'
--    group by l.corp, l.office, l.yearmonth
-- ), calc as (
--   select corp, office, yearmonth, acct_eval_formulas('CF', vals) as v from src
-- )
-- update acct_statement_lines l
--    set amount_cny = (c.v ->> l.account_code)::numeric,
--        amount_krw = case when r.cny_to_krw is null then null
--                          else (c.v ->> l.account_code)::numeric * r.cny_to_krw end
--   from calc c
--   left join acct_exchange_rates r on r.yearmonth = c.yearmonth
--  where l.corp = c.corp and l.office = c.office and l.yearmonth = c.yearmonth
--    and l.statement_type = 'CF' and l.calc_mode = 'auto'
--    and l.amount_cny is distinct from (c.v ->> l.account_code)::numeric;

-- -- 3-3. 반영 후 검증: 2단계 쿼리를 다시 돌려 "소계차이"가 전부 0 인지 확인


-- =====================================================================
-- 되돌리기
-- =====================================================================
-- update acct_accounts set formula = '[CF-01]+[CF-03]+[CF-08]+[CF-91]'
--  where statement_type = 'CF' and code = 'CF-09';
-- update acct_accounts set formula = '[CF-10]+[CF-12]+[CF-13]+[CF-18]+[CF-92]'
--  where statement_type = 'CF' and code = 'CF-20';
-- ※ 되돌릴 이유는 없을 것입니다. 이중계상이 맞는 처리인 경우는 없습니다.
