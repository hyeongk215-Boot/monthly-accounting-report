-- ============================================================================
-- 阶段〇 시산 (试算) — 읽기 전용
-- ============================================================================
-- 목적: 2026-01~08 기존 제출 데이터를 v4 확정 공식으로 다시 계산해서,
--       "지점이 입력한 합계값" vs "공식으로 계산한 값"의 차이를 전수 조사합니다.
--
-- ⚠ 이 스크립트는 SELECT만 합니다. 데이터를 일절 수정하지 않습니다.
--
-- 사용법: Supabase SQL Editor에서 QUERY 1~4를 "하나씩" 실행하고
--         각 결과를 CSV로 내려받으세요. (SQL Editor는 마지막 결과만 표시합니다)
--
-- 근거 문서: 财务报表自动计算_方案草案_v4.md  附「写入系统的公式清单（定稿）」
-- 작성일: 2026-09-28
-- ============================================================================


-- ============================================================================
-- QUERY 1 — 표 내부 합계행 검증 (阶段一 대상)
-- ============================================================================
-- 각 합계행을 "바로 아래 단계 구성요소의 저장값"으로부터 계산합니다.
-- 재귀 계산이 아니라 1단계만 계산하므로, 어느 행이 틀렸는지 바로 특정됩니다.
--   예) 799999가 틀렸는데 699999는 맞다면 → 오류는 799999 한 행에만 있음
--
-- 결과 해석:
--   diff = 저장값 − 계산값
--   diff = 0        → 공식과 일치. 자동계산 적용해도 숫자 안 변함 (정상)
--   diff ≠ 0        → 조사 대상. QUERY 3의 부호 진단과 함께 보세요
-- ============================================================================

with
scope as (
  select distinct corp, office, yearmonth, statement_type
  from acct_statement_lines
  where yearmonth between '2026-01' and '2026-08'
),

-- 공식 정의: target = Σ(sign × source)
f (statement_type, target, source, sign) as (values
  -- ---------- PL (중국식 손익계산서) ----------
  ('PL'::text, '699999'::text, '500000'::text,  1),
  ('PL', '699999', '600000', -1),
  ('PL', '699999', 'PL-L03', -1),
  ('PL', '699999', '680000', -1),

  ('PL', '799999', '699999',  1),
  ('PL', '799999', '708000',  1),
  ('PL', '799999', 'PL-L06B', -1),
  ('PL', '799999', '700000', -1),
  ('PL', '799999', '709000', -1),
  ('PL', '799999', '710000',  1),

  ('PL', '900000', '799999',  1),
  ('PL', '900000', '810000',  1),
  ('PL', '900000', '820000',  1),
  ('PL', '900000', '830000',  1),
  ('PL', '900000', '840000', -1),

  ('PL', '999999', '900000',  1),
  ('PL', '999999', '905000', -1),

  -- ---------- PL_KR (한국기준 손익계산서) ----------
  ('PL_KR', '699999', '500000',  1),
  ('PL_KR', '699999', '600000', -1),

  ('PL_KR', '799999', '699999',  1),
  ('PL_KR', '799999', '700000', -1),

  ('PL_KR', '900000', '799999',    1),
  ('PL_KR', '900000', '708100-1',  1),
  ('PL_KR', '900000', '708200-1', -1),

  ('PL_KR', '999999', '900000',  1),
  ('PL_KR', '999999', '905001', -1),

  -- ---------- BS 자산 ----------
  -- 유동자산합계 = 행차 1~15 (L07 대손충당금 감산, L11 원재료는 메모라 제외)
  ('BS', 'BS-L16', 'BS-L01',  1),
  ('BS', 'BS-L16', 'BS-L02',  1),
  ('BS', 'BS-L16', 'BS-L03',  1),
  ('BS', 'BS-L16', 'BS-L04',  1),
  ('BS', 'BS-L16', 'BS-L05',  1),
  ('BS', 'BS-L16', 'BS-L06',  1),
  ('BS', 'BS-L16', 'BS-L07', -1),   -- 减：坏帐准备
  ('BS', 'BS-L16', 'BS-L08',  1),
  ('BS', 'BS-L16', 'BS-L09',  1),
  ('BS', 'BS-L16', 'BS-L10',  1),
  ('BS', 'BS-L16', 'BS-L12',  1),
  ('BS', 'BS-L16', 'BS-L13',  1),
  ('BS', 'BS-L16', 'BS-L14',  1),
  ('BS', 'BS-L16', 'BS-L15',  1),

  ('BS', 'BS-L20', 'BS-L18',  1),
  ('BS', 'BS-L20', 'BS-L19', -1),   -- 减：累计折旧

  -- A-2: 固定资产合计 = 净值 + 清理 + 待处理净损失 (부호 통일)
  ('BS', 'BS-L23', 'BS-L20',  1),
  ('BS', 'BS-L23', 'BS-L21',  1),
  ('BS', 'BS-L23', 'BS-L22',  1),

  -- A-3: 在建工程(L24)을 기타자산합계에서 제외
  ('BS', 'BS-L28', 'BS-L25',  1),
  ('BS', 'BS-L28', 'BS-L26',  1),
  ('BS', 'BS-L28', 'BS-L27',  1),

  -- A-1 + A-3: 자산총계에 長期投資(L17)과 在建工程(L24) 포함
  ('BS', 'BS-L29', 'BS-L16',  1),
  ('BS', 'BS-L29', 'BS-L17',  1),
  ('BS', 'BS-L29', 'BS-L23',  1),
  ('BS', 'BS-L29', 'BS-L24',  1),
  ('BS', 'BS-L29', 'BS-L28',  1),

  -- ---------- BS 부채·자본 ----------
  ('BS', 'BS-R42', 'BS-R29',  1),
  ('BS', 'BS-R42', 'BS-R30',  1),
  ('BS', 'BS-R42', 'BS-R31',  1),
  ('BS', 'BS-R42', 'BS-R32',  1),
  ('BS', 'BS-R42', 'BS-R33',  1),
  ('BS', 'BS-R42', 'BS-R34',  1),
  ('BS', 'BS-R42', 'BS-R35',  1),
  ('BS', 'BS-R42', 'BS-R36',  1),
  ('BS', 'BS-R42', 'BS-R37',  1),
  ('BS', 'BS-R42', 'BS-R38',  1),
  ('BS', 'BS-R42', 'BS-R39',  1),
  ('BS', 'BS-R42', 'BS-R40',  1),
  ('BS', 'BS-R42', 'BS-R41',  1),

  ('BS', 'BS-R45', 'BS-R43',  1),
  ('BS', 'BS-R45', 'BS-R44',  1),

  ('BS', 'BS-R47', 'BS-R42',  1),
  ('BS', 'BS-R47', 'BS-R45',  1),
  ('BS', 'BS-R47', 'BS-R46',  1),

  -- 所有者权益合计 = 实收资本+资本公积+盈余公积+本年利润+未分配利润
  -- (R49 중방투자 / R50 외방투자 / R53 공익금은 "其中" 메모라 가산 안 함)
  ('BS', 'BS-R56', 'BS-R48',  1),
  ('BS', 'BS-R56', 'BS-R51',  1),
  ('BS', 'BS-R56', 'BS-R52',  1),
  ('BS', 'BS-R56', 'BS-R54',  1),
  ('BS', 'BS-R56', 'BS-R55',  1),

  ('BS', 'BS-R57', 'BS-R47',  1),
  ('BS', 'BS-R57', 'BS-R56',  1),

  -- ---------- CF (현금흐름표) ----------
  ('CF', 'CF-09', 'CF-01',  1),
  ('CF', 'CF-09', 'CF-03',  1),
  ('CF', 'CF-09', 'CF-08',  1),
  ('CF', 'CF-09', 'CF-91',  1),   -- 내부거래 수취

  ('CF', 'CF-20', 'CF-10',  1),
  ('CF', 'CF-20', 'CF-12',  1),
  ('CF', 'CF-20', 'CF-13',  1),
  ('CF', 'CF-20', 'CF-18',  1),
  ('CF', 'CF-20', 'CF-92',  1),   -- 내부거래 지급

  ('CF', 'CF-21', 'CF-09',  1),
  ('CF', 'CF-21', 'CF-20', -1),

  ('CF', 'CF-29', 'CF-22',  1),
  ('CF', 'CF-29', 'CF-23',  1),
  ('CF', 'CF-29', 'CF-25',  1),
  ('CF', 'CF-29', 'CF-28',  1),

  ('CF', 'CF-36', 'CF-30',  1),
  ('CF', 'CF-36', 'CF-31',  1),
  ('CF', 'CF-36', 'CF-35',  1),

  -- B-3: 净额 = 流入小计 − 流出小计
  ('CF', 'CF-37', 'CF-29',  1),
  ('CF', 'CF-37', 'CF-36', -1),

  -- B-2: 筹资流入 = 38 + 40 + 43
  ('CF', 'CF-44', 'CF-38',  1),
  ('CF', 'CF-44', 'CF-40',  1),
  ('CF', 'CF-44', 'CF-43',  1),

  ('CF', 'CF-53', 'CF-45',  1),
  ('CF', 'CF-53', 'CF-46',  1),
  ('CF', 'CF-53', 'CF-52',  1),

  ('CF', 'CF-54', 'CF-44',  1),
  ('CF', 'CF-54', 'CF-53', -1),

  -- B-1: 净增加额 = 경영 + 투자 + 재무 + 환율변동  (소계 중복가산 금지)
  ('CF', 'CF-56', 'CF-21',  1),
  ('CF', 'CF-56', 'CF-37',  1),
  ('CF', 'CF-56', 'CF-54',  1),
  ('CF', 'CF-56', 'CF-55',  1),

  -- B-4: 期末余额 = 净增加额 + 期初现金 − 期末现金等价物 + 期初现金等价物
  ('CF', 'CF-57', 'CF-56',  1),
  ('CF', 'CF-57', 'CF-58',  1),
  ('CF', 'CF-57', 'CF-59', -1),
  ('CF', 'CF-57', 'CF-60',  1)
),

v as (
  select corp, office, yearmonth, statement_type, account_code, amount_cny
  from acct_statement_lines
  where yearmonth between '2026-01' and '2026-08'
),

calc as (
  select s.corp, s.office, s.yearmonth, s.statement_type, f.target,
         sum(f.sign * coalesce(v.amount_cny, 0)) as computed,
         count(v.amount_cny)                     as source_rows_found,
         count(*)                                as source_rows_expected
  from scope s
  join f on f.statement_type = s.statement_type
  left join v
    on  v.corp           = s.corp
    and v.office         = s.office
    and v.yearmonth      = s.yearmonth
    and v.statement_type = s.statement_type
    and v.account_code   = f.source
  group by s.corp, s.office, s.yearmonth, s.statement_type, f.target
)

select
  c.corp                                  as "법인",
  c.office                                as "지점",
  c.yearmonth                             as "연월",
  c.statement_type                        as "표",
  c.target                                as "계정코드",
  a.name_ko                               as "계정명",
  round(coalesce(st.amount_cny, 0), 2)    as "저장값",
  round(c.computed, 2)                    as "계산값",
  round(coalesce(st.amount_cny, 0) - c.computed, 2) as "차이",
  case when st.amount_cny is null then '합계행 미입력'
       when c.source_rows_found = 0       then '⚠ 구성항목 전부 없음(합계만 입력)'
       when c.source_rows_found < c.source_rows_expected
            then '구성항목 일부 없음 (' || c.source_rows_found || '/' || c.source_rows_expected || ')'
       else '' end                        as "비고"
from calc c
left join v st
  on  st.corp           = c.corp
  and st.office         = c.office
  and st.yearmonth      = c.yearmonth
  and st.statement_type = c.statement_type
  and st.account_code   = c.target
left join acct_accounts a
  on a.code = c.target and a.statement_type = c.statement_type
where abs(coalesce(st.amount_cny, 0) - c.computed) >= 0.01
   or st.amount_cny is null
order by c.corp, c.office, c.yearmonth, c.statement_type, a.display_order;


-- ============================================================================
-- QUERY 2 — 표 간 / 월 간 검증 (阶段二 대상)
-- ============================================================================
-- QUERY 1이 "한 표 안"을 봤다면, 여기는 표끼리·월끼리 맞물리는 부분입니다.
--
-- ① BS-R54 (本年利润)  vs  PL 999999 당해 1월~당월 누계
-- ② BS-R55 (未分配利润) 의 연내 항상성  ← 담당자 주장의 직접 검증
-- ③ CF-58  (현금 기초잔액) vs 전월 CF-57 (현금 기말잔액)
-- ④ BS-L29 (자산총계) vs BS-R57 (부채와자본총계)  ← 대차 일치
-- ============================================================================

with
bs as (
  select corp, office, yearmonth, account_code, amount_cny
  from acct_statement_lines
  where statement_type = 'BS' and yearmonth between '2026-01' and '2026-08'
),
cf as (
  select corp, office, yearmonth, account_code, amount_cny
  from acct_statement_lines
  where statement_type = 'CF' and yearmonth between '2026-01' and '2026-08'
),
pl_ytd as (
  select corp, office, yearmonth,
         (select sum(p.amount_cny)
            from acct_statement_lines p
           where p.corp = x.corp and p.office = x.office
             and p.statement_type = 'PL' and p.account_code = '999999'
             and p.yearmonth between left(x.yearmonth,4) || '-01' and x.yearmonth
         ) as pl_net_ytd
  from (select distinct corp, office, yearmonth from bs) x
),

-- ① 本年利润 = PL 순이익 누계
chk1 as (
  select '① 本年利润 = PL순이익 누계' as "검증항목",
         b.corp, b.office, b.yearmonth,
         round(b.amount_cny, 2)                        as "BS-R54 저장값",
         round(coalesce(y.pl_net_ytd, 0), 2)           as "PL 누계",
         round(b.amount_cny - coalesce(y.pl_net_ytd,0), 2) as "차이"
  from bs b
  join pl_ytd y on y.corp = b.corp and y.office = b.office and y.yearmonth = b.yearmonth
  where b.account_code = 'BS-R54'
    and abs(b.amount_cny - coalesce(y.pl_net_ytd, 0)) >= 0.01
),

-- ② 未分配利润 의 연내 항상성 (담당자: "연중 계속 동일한 숫자여야 한다")
--    2025-12 BS가 없어도 지금 바로 검증 가능한 항목입니다.
r55 as (
  select corp, office, yearmonth, amount_cny
  from bs where account_code = 'BS-R55'
),
chk2 as (
  select '② 未分配利润 연내 항상성' as "검증항목",
         corp, office, yearmonth,
         round(amount_cny, 2) as "BS-R55 저장값",
         round(first_value(amount_cny) over w, 2) as "1월값(기준)",
         round(amount_cny - first_value(amount_cny) over w, 2) as "차이"
  from r55
  window w as (partition by corp, office order by yearmonth
               rows between unbounded preceding and unbounded following)
),

-- ③ 현금 기초잔액 = 전월 현금 기말잔액
chk3 as (
  select '③ CF기초 = 전월 CF기말' as "검증항목",
         cur.corp, cur.office, cur.yearmonth,
         round(cur.amount_cny, 2) as "CF-58 저장값",
         round(prv.amount_cny, 2) as "전월 CF-57",
         round(cur.amount_cny - prv.amount_cny, 2) as "차이"
  from cf cur
  join cf prv
    on  prv.corp   = cur.corp
    and prv.office = cur.office
    and prv.account_code = 'CF-57'
    and prv.yearmonth = to_char((cur.yearmonth || '-01')::date - interval '1 month', 'YYYY-MM')
  where cur.account_code = 'CF-58'
    and abs(cur.amount_cny - prv.amount_cny) >= 0.01
),

-- ④ 대차 일치
chk4 as (
  select '④ 자산총계 = 부채와자본총계' as "검증항목",
         l.corp, l.office, l.yearmonth,
         round(l.amount_cny, 2) as "BS-L29 자산총계",
         round(r.amount_cny, 2) as "BS-R57 부채자본총계",
         round(l.amount_cny - r.amount_cny, 2) as "차이"
  from bs l
  join bs r on r.corp = l.corp and r.office = l.office
           and r.yearmonth = l.yearmonth and r.account_code = 'BS-R57'
  where l.account_code = 'BS-L29'
    and abs(l.amount_cny - r.amount_cny) >= 0.01
)

select * from chk1
union all select * from chk2 where "차이" <> 0
union all select * from chk3
union all select * from chk4
order by 1, 2, 3, 4;


-- ============================================================================
-- QUERY 3 — 부호 입력 관행 진단
-- ============================================================================
-- 表头에 "减：" 가 붙은 행은 지점마다 양수로 넣기도 하고 음수로 넣기도 합니다.
-- 어느 관행인지 확정해야 QUERY 1의 부호(-1)가 맞는지 판단할 수 있습니다.
--
-- 해석:
--   음수건수 = 0        → 전부 양수 입력. QUERY 1의 −1 부호가 맞음
--   양수건수 = 0        → 전부 음수 입력. 공식을 +1로 바꿔야 함
--   둘 다 > 0           → ⚠ 지점마다 다름. 통일 지침을 먼저 내려야 함
-- ============================================================================

select
  l.statement_type                              as "표",
  l.account_code                                as "계정코드",
  a.name_ko                                     as "계정명",
  a.name_zh                                     as "중문",
  count(*) filter (where l.amount_cny > 0)      as "양수건수",
  count(*) filter (where l.amount_cny < 0)      as "음수건수",
  count(*) filter (where l.amount_cny = 0)      as "영건수",
  string_agg(distinct l.corp || '/' || l.office, ', ')
    filter (where l.amount_cny < 0)             as "음수로 넣은 지점"
from acct_statement_lines l
join acct_accounts a on a.code = l.account_code and a.statement_type = l.statement_type
where l.yearmonth between '2026-01' and '2026-08'
  and l.account_code in ('BS-L07', 'BS-L19', 'BS-L13', 'BS-L22',
                         'CF-58', 'CF-60', 'PL-L06B', '600000', '700000', '905000')
group by l.statement_type, l.account_code, a.name_ko, a.name_zh, a.display_order
order by l.statement_type, a.display_order;


-- ============================================================================
-- QUERY 4 — 제출 현황 요약 (모수 파악용)
-- ============================================================================
-- QUERY 1~3의 차이 건수를 "전체 몇 건 중 몇 건인지" 가늠하기 위한 분모입니다.
-- 독립 실행 가능합니다.
-- ============================================================================

select
  corp                                   as "법인",
  office                                 as "지점",
  statement_type                         as "표",
  count(distinct yearmonth)              as "제출월수",
  count(*)                               as "행수",
  count(*) filter (where account_code in
    ('699999','799999','900000','999999',
     'BS-L16','BS-L20','BS-L23','BS-L28','BS-L29',
     'BS-R42','BS-R45','BS-R47','BS-R56','BS-R57',
     'CF-09','CF-20','CF-21','CF-29','CF-36','CF-37',
     'CF-44','CF-53','CF-54','CF-56','CF-57'))  as "합계행수",
  count(*) filter (where amount_cny <> 0) as "0이아닌행수"
from acct_statement_lines
where yearmonth between '2026-01' and '2026-08'
group by corp, office, statement_type
order by corp, office, statement_type;


-- ============================================================================
-- QUERY 5 — QUERY 3 결과에서 나온 이상징후 3건 확인 (2026-09-28 추가)
-- ============================================================================
-- QUERY 3에서 CF-58이 136건(=17지점×8개월) 나왔습니다.
-- v4 4.1 실사표는 중경·홍콩 CF를 "무(면보)"로 적었는데 실제로는 행이 존재합니다.
-- 5-a 가 그것을 확인합니다. 5-b, 5-c는 부수 확인입니다.
-- ============================================================================

-- 5-a) CF를 실제로 제출한 지점과, 그 내용이 "빈 표(전부 0)"인지 판정
--      절대값합계 = 0  →  0으로 채운 빈 표 (실질 미제출)
--      절대값합계 > 0  →  실제 데이터 있음
select
  corp                                        as "법인",
  office                                      as "지점",
  count(distinct yearmonth)                   as "CF제출월수",
  count(*)                                    as "행수",
  round(sum(abs(amount_cny)), 2)              as "절대값합계",
  case when sum(abs(amount_cny)) = 0 then '⚠ 빈 표 (전부 0)'
       else '' end                            as "판정"
from acct_statement_lines
where statement_type = 'CF' and yearmonth between '2026-01' and '2026-08'
group by corp, office
order by corp, office;


-- 5-b) BS-L19(감가상각누계액)가 0인 지점·월 — 같은 행의 BS-L18과 대조
--      유형자산원가 > 0 인데 감가상각 = 0 이면 누락 의심
select
  corp    as "법인",
  office  as "지점",
  yearmonth as "연월",
  round(max(amount_cny) filter (where account_code = 'BS-L18'), 2) as "유형자산원가",
  round(max(amount_cny) filter (where account_code = 'BS-L19'), 2) as "감가상각누계",
  case when coalesce(max(amount_cny) filter (where account_code = 'BS-L18'), 0) > 0
       then '⚠ 원가는 있는데 상각 0' else '자산 없음 (정상)' end   as "판정"
from acct_statement_lines
where statement_type = 'BS' and yearmonth between '2026-01' and '2026-08'
  and account_code in ('BS-L18', 'BS-L19')
group by corp, office, yearmonth
having coalesce(max(amount_cny) filter (where account_code = 'BS-L19'), 0) = 0
order by corp, office, yearmonth;


-- 5-c) CF-58(현금 기초잔액)이 0인 25건의 정체
--      1월이 0이면 → 전년말 잔액 미입력
--      중경·홍콩이면 → 빈 표
select
  corp      as "법인",
  office    as "지점",
  yearmonth as "연월",
  round(amount_cny, 2) as "CF-58 현금기초",
  round((select p.amount_cny from acct_statement_lines p
          where p.corp = l.corp and p.office = l.office
            and p.statement_type = 'CF' and p.account_code = 'CF-57'
            and p.yearmonth = to_char((l.yearmonth || '-01')::date - interval '1 month', 'YYYY-MM')
        ), 2) as "전월 CF-57 기말"
from acct_statement_lines l
where statement_type = 'CF' and account_code = 'CF-58'
  and yearmonth between '2026-01' and '2026-08'
  and amount_cny = 0
order by corp, office, yearmonth;


-- ============================================================================
-- QUERY 6 — 상해 / 충칭 현금 검수 (2026-09-28 추가)
-- ============================================================================
-- 담당자 확인: 충칭도 CF를 분리 작성. "상해 지점"은 콘솔상 상해+충칭 합계를 뜻함.
-- → 각 표는 분리, 합병 시 단순 합산. 이 쿼리로 그것을 실증합니다.
--
-- 검증 두 가지:
--   [대사①] BS 현금(08월) == CF-57 현금기말(08월)      … 잔량 대사
--   [대사②] BS 현금 증감(08−07) == CF-56 순증가액(08월) … 유량 대사
--            (CF는 「당월 발생수」 입력 원칙이므로 성립해야 함 — v4 C-1)
--
-- 마지막 행(◆ 상해+충칭)이 콘솔 관점입니다.
-- ============================================================================

with d as (
  select office, yearmonth, statement_type, account_code, amount_cny
  from acct_statement_lines
  where corp = 'YJC 포워딩'
    and office in ('상해', '충칭')
    and yearmonth in ('2026-07', '2026-08')
)
select
  coalesce(office, '◆ 상해+충칭') as "지점",

  round(sum(amount_cny) filter (
    where yearmonth = '2026-07' and statement_type = 'BS'
      and account_code in ('BS-L01','BS-L02')), 2)            as "BS현금 07월",

  round(sum(amount_cny) filter (
    where yearmonth = '2026-08' and statement_type = 'BS'
      and account_code in ('BS-L01','BS-L02')), 2)            as "BS현금 08월",

  round(
      coalesce(sum(amount_cny) filter (where yearmonth = '2026-08' and statement_type = 'BS'
                                         and account_code in ('BS-L01','BS-L02')), 0)
    - coalesce(sum(amount_cny) filter (where yearmonth = '2026-07' and statement_type = 'BS'
                                         and account_code in ('BS-L01','BS-L02')), 0)
  , 2)                                                        as "BS증감(08−07)",

  round(sum(amount_cny) filter (
    where yearmonth = '2026-08' and statement_type = 'CF'
      and account_code = 'CF-56'), 2)                         as "CF56 순증가액",

  round(
      coalesce(sum(amount_cny) filter (where yearmonth = '2026-08' and statement_type = 'BS'
                                         and account_code in ('BS-L01','BS-L02')), 0)
    - coalesce(sum(amount_cny) filter (where yearmonth = '2026-07' and statement_type = 'BS'
                                         and account_code in ('BS-L01','BS-L02')), 0)
    - coalesce(sum(amount_cny) filter (where yearmonth = '2026-08' and statement_type = 'CF'
                                         and account_code = 'CF-56'), 0)
  , 2)                                                        as "◀ 대사② 차이",

  round(sum(amount_cny) filter (
    where yearmonth = '2026-08' and statement_type = 'CF'
      and account_code = 'CF-58'), 2)                         as "CF58 기초",

  round(sum(amount_cny) filter (
    where yearmonth = '2026-08' and statement_type = 'CF'
      and account_code = 'CF-57'), 2)                         as "CF57 기말",

  round(
      coalesce(sum(amount_cny) filter (where yearmonth = '2026-08' and statement_type = 'BS'
                                         and account_code in ('BS-L01','BS-L02')), 0)
    - coalesce(sum(amount_cny) filter (where yearmonth = '2026-08' and statement_type = 'CF'
                                         and account_code = 'CF-57'), 0)
  , 2)                                                        as "◀ 대사① 차이"

from d
group by rollup(office)
order by grouping(office), office;
