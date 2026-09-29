-- =====================================================================
-- 자동계산(阶段一) 백업 및 원상복구 스크립트
--   작성 2026-09-29 / 대상 migration_2026-09_formula.sql
--
-- 【사용법】
--   A. 지점에 열기 "전"에 --- 0단계 --- 를 실행해 백업을 떠 두십시오. (1회)
--   B. 문제가 생기면 --- 1단계 --- 한 줄로 즉시 수기입력 상태로 돌아갑니다.
--   C. 2~4단계는 1단계로 부족할 때만, 위에서부터 순서대로.
--
-- 【설계 원칙】
--   이 시스템의 자동계산은 acct_accounts.formula 가 "있을 때만" 작동합니다.
--   화면(isAutoCalc)도 서버(acct_eval_formulas)도 똑같이 formula 유무로 판단하므로,
--   formula 를 비우면 프런트 재배포 없이 즉시 전체가 수기입력으로 돌아갑니다.
--   → 이것이 1단계이며, 평상시 원복은 여기서 끝나야 합니다.
-- =====================================================================


-- =====================================================================
-- 0단계. 백업  ※ 지점에 열기 전에 반드시 1회 실행
-- =====================================================================

-- 0-1. 공식 28개 백업 (1단계로 끈 뒤 다시 켤 때 필요합니다)
create table if not exists acct_formula_backup (
  statement_type text not null,
  code           text not null,
  formula        text,
  backed_up_at   timestamptz not null default now(),
  primary key (statement_type, code)
);

-- 백업 테이블은 public 스키마에 생기므로 RLS를 켜 두지 않으면 anon 키로 읽힙니다.
-- 정책을 하나도 만들지 않으면 = 아무도 못 읽음(서비스롤/SQL에디터만 접근). 의도된 상태입니다.
alter table acct_formula_backup enable row level security;

insert into acct_formula_backup (statement_type, code, formula)
select statement_type, code, formula
  from acct_accounts
 where active = true and formula is not null and formula <> ''
on conflict (statement_type, code) do update
  set formula = excluded.formula, backed_up_at = now();

-- 확인: 28 이어야 합니다
select count(*) as "백업된_공식수" from acct_formula_backup;


-- 0-2. 재무제표 데이터 전량 스냅샷
--      지금(자동계산 가동 전) 저장돼 있는 값 그대로를 통째로 복사해 둡니다.
--      날짜를 바꿔가며 여러 번 떠도 됩니다. 기존 스냅샷은 덮어쓰지 않습니다.
create table if not exists acct_lines_backup_20260929 as
  select * from acct_statement_lines;

alter table acct_lines_backup_20260929 enable row level security;

-- 확인: 17,696 (= legacy 17,000 + auto 696) 이어야 합니다
select count(*) as "스냅샷_행수",
       min(yearmonth) as "최초월",
       max(yearmonth) as "최종월"
  from acct_lines_backup_20260929;


-- =====================================================================
-- 1단계. 즉시 정지 — 자동계산 끄기 (데이터는 건드리지 않음)
-- =====================================================================
-- 【언제】 계산 로직이 의심스러울 때. 지점이 "숫자가 이상하다"고 할 때.
-- 【효과】 실행 즉시(지점이 새로고침하면) 합계행 잠금이 풀리고 수기입력으로 돌아갑니다.
--         서버도 재계산을 멈추고 지점이 보낸 값을 그대로 저장합니다.
--         → 배포 되돌릴 필요 없음. 이미 저장된 데이터는 그대로 보존됩니다.
-- 【주의】 0-1 백업을 떴는지 먼저 확인하십시오. 안 떴으면 공식 28개가 사라집니다.

-- update acct_accounts set formula = null
--  where formula is not null and formula <> '';

-- 확인용 (0건이어야 꺼진 것):
-- select count(*) from acct_accounts where active = true and formula is not null and formula <> '';


-- --- 1단계 되돌리기 (다시 켜기) ---
-- update acct_accounts a set formula = b.formula
--   from acct_formula_backup b
--  where a.statement_type = b.statement_type and a.code = b.code;


-- =====================================================================
-- 1-b단계. 부분 정지 — 특정 장표만 끄기
-- =====================================================================
-- 【언제】 예컨대 CF 합계만 이상하고 BS/PL은 멀쩡할 때. 전체를 끌 이유가 없습니다.

-- update acct_accounts set formula = null where statement_type = 'CF';
-- update acct_accounts a set formula = b.formula                      -- 되돌리기
--   from acct_formula_backup b
--  where a.statement_type = b.statement_type and a.code = b.code and a.statement_type = 'CF';


-- =====================================================================
-- 1-c단계. 월/지점 단위 정지 — calc_mode 를 legacy 로
-- =====================================================================
-- 【언제】 특정 지점·특정 월만 수기로 받아야 할 때.
-- 【주의】 calc_mode 는 "이미 행이 있는" 조합에만 작동합니다. 한 번도 제출 안 된
--         월은 행이 없어 auto 로 시작합니다. 전체 차단은 1단계를 쓰십시오.

-- select set_calc_mode('<접근키>', 'YJC 포워딩', '상해', '2026-09', 'BS', 'legacy');


-- =====================================================================
-- 2단계. 잘못 저장된 데이터 되돌리기
-- =====================================================================
-- 【언제】 자동계산이 틀린 값을 덮어써 버렸을 때.
-- 【원칙】 절대 전량 복원하지 마십시오. 백업 이후의 "정상" 제출까지 같이 날아갑니다.
--         반드시 corp/office/yearmonth 로 좁혀서 복원합니다.

-- 2-1. 먼저 뭐가 달라졌는지 봅니다 (읽기전용)
-- select l.corp, l.office, l.yearmonth, l.statement_type, l.account_code,
--        b.amount_cny as "백업값", l.amount_cny as "현재값",
--        l.amount_cny - b.amount_cny as "차이"
--   from acct_statement_lines l
--   join acct_lines_backup_20260929 b
--     on b.corp = l.corp and b.office = l.office and b.yearmonth = l.yearmonth
--    and b.statement_type = l.statement_type and b.account_code = l.account_code
--  where l.amount_cny is distinct from b.amount_cny
--  order by l.corp, l.office, l.yearmonth, l.statement_type, l.account_code;

-- 2-2. 확인했으면, 범위를 좁혀 복원합니다 (아래 3줄의 값을 반드시 바꾸십시오)
-- update acct_statement_lines l
--    set amount_cny = b.amount_cny,
--        amount_krw = b.amount_krw
--   from acct_lines_backup_20260929 b
--  where b.corp = l.corp and b.office = l.office and b.yearmonth = l.yearmonth
--    and b.statement_type = l.statement_type and b.account_code = l.account_code
--    and l.corp       = 'YJC 포워딩'     -- ← 바꾸십시오
--    and l.office     = '상해'            -- ← 바꾸십시오
--    and l.yearmonth  = '2026-09';        -- ← 바꾸십시오

-- 2-3. 백업 이후 "새로 생긴" 행은 위 update 로 안 지워집니다. 필요하면 별도로:
-- delete from acct_statement_lines l
--  where l.corp = 'YJC 포워딩' and l.office = '상해' and l.yearmonth = '2026-09'
--    and not exists (
--      select 1 from acct_lines_backup_20260929 b
--       where b.corp = l.corp and b.office = l.office and b.yearmonth = l.yearmonth
--         and b.statement_type = l.statement_type and b.account_code = l.account_code);


-- =====================================================================
-- 3단계. 함수 원복 — submit_statement / replace_accounts 를 마이그레이션 이전으로
-- =====================================================================
-- 【언제】 1단계로 껐는데도 제출 동작 자체가 이상할 때.
-- 【참고】 1단계(formula=null) 상태면 신규 함수도 구 함수와 동일하게 동작하므로
--         보통은 여기까지 올 일이 없습니다. 아래는 schema.sql 원본 그대로입니다.

/*
create or replace function submit_statement(
  p_access_key text, p_corp text, p_office text, p_yearmonth text,
  p_statement_type text, p_submitted_by text, p_lines jsonb
) returns integer
language plpgsql security definer set search_path = public
as $func$
declare
  v_role text; v_branch_scope text; v_office_scope text;
  v_rate numeric; v_row jsonb; v_count integer := 0;
begin
  select role, branch_scope, office_scope into v_role, v_branch_scope, v_office_scope
    from verify_access_key(p_access_key);

  if v_branch_scope is not null and p_corp is distinct from v_branch_scope then
    raise exception 'unauthorized_branch';
  end if;
  if v_office_scope is not null and p_office is distinct from v_office_scope then
    raise exception 'unauthorized_office';
  end if;
  if exists (select 1 from acct_closed_months where yearmonth = p_yearmonth) then
    raise exception 'month_closed';
  end if;
  if p_corp is null or p_office is null or p_yearmonth is null or p_statement_type is null
     or p_submitted_by is null or p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'invalid_payload';
  end if;
  if v_role not in ('system_admin', 'finance')
     and exists (select 1 from acct_submission_lock
                  where corp = p_corp and office = p_office
                    and yearmonth = p_yearmonth and statement_type = p_statement_type) then
    raise exception 'submission_locked';
  end if;

  select cny_to_krw into v_rate from acct_exchange_rates where yearmonth = p_yearmonth;

  for v_row in select * from jsonb_array_elements(p_lines)
  loop
    insert into acct_statement_lines (
      corp, office, yearmonth, statement_type, account_code, amount_cny, amount_krw,
      submitted_by, submitted_by_role, submitted_at
    ) values (
      p_corp, p_office, p_yearmonth, p_statement_type, v_row->>'accountCode',
      coalesce(nullif(v_row->>'amountCny', '')::numeric, 0),
      case when v_rate is null then null
           else coalesce(nullif(v_row->>'amountCny', '')::numeric, 0) * v_rate end,
      p_submitted_by, v_role, now()
    )
    on conflict (corp, office, yearmonth, statement_type, account_code) do update
      set amount_cny = excluded.amount_cny, amount_krw = excluded.amount_krw,
          submitted_by = excluded.submitted_by, submitted_by_role = excluded.submitted_by_role,
          submitted_at = now();
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$func$;

create or replace function replace_accounts(p_access_key text, p_accounts jsonb) returns integer
language plpgsql security definer set search_path = public
as $func$
declare
  v_role text; v_row jsonb; v_new_pairs text[]; v_count integer := 0;
begin
  select role into v_role from verify_access_key(p_access_key);
  if v_role <> 'system_admin' then raise exception 'unauthorized'; end if;
  if p_accounts is null or jsonb_array_length(p_accounts) = 0 then
    raise exception 'invalid_payload';
  end if;

  select array_agg((x->>'code') || '::' || (x->>'statementType')) into v_new_pairs
    from jsonb_array_elements(p_accounts) x;
  update acct_accounts set active = false
   where (code || '::' || statement_type) <> all(v_new_pairs);

  for v_row in select * from jsonb_array_elements(p_accounts)
  loop
    insert into acct_accounts (code, name_ko, name_zh, statement_type, category,
                               display_order, is_subtotal, line_no, active, updated_at)
    values (v_row->>'code', v_row->>'nameKo', v_row->>'nameZh', v_row->>'statementType',
            v_row->>'category', coalesce(nullif(v_row->>'displayOrder','')::integer, 0),
            coalesce((v_row->>'isSubtotal')::boolean, false), nullif(v_row->>'lineNo', ''), true, now())
    on conflict (code, statement_type) do update
      set name_ko = excluded.name_ko, name_zh = excluded.name_zh,
          category = excluded.category, display_order = excluded.display_order,
          is_subtotal = excluded.is_subtotal, line_no = excluded.line_no,
          active = true, updated_at = now();
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$func$;
*/
-- ⚠ 위 replace_accounts 구버전은 formula 를 보존하지 않습니다. 이걸 되살린 뒤
--    관리화면에서 계정 엑셀을 올리면 공식이 전부 지워집니다(0-1 백업으로 복구 가능).


-- =====================================================================
-- 4단계. 컬럼 제거 — 최후의 수단, 되돌릴 수 없음
-- =====================================================================
-- 【언제】 이 기능을 영구 폐기하기로 확정했을 때만.
-- 【주의】 compare_cny(엑셀 대조값)와 calc_mode 이력이 영구 소실됩니다.
--         0단계 백업 테이블은 남으니 데이터 자체는 보존됩니다.

-- alter table acct_accounts        drop column if exists formula;
-- alter table acct_statement_lines drop column if exists compare_cny;
-- alter table acct_statement_lines drop column if exists calc_mode;
-- drop function if exists acct_eval_formulas(text, jsonb);
-- drop function if exists set_calc_mode(text, text, text, text, text, text);
-- ※ 컬럼을 지우면 get_accounts / get_statement / submit_statement 가 깨집니다.
--    반드시 3단계(함수 원복)를 먼저 하고, get_accounts / get_statement 도
--    schema.sql 원본으로 되돌린 뒤에 실행하십시오.


-- =====================================================================
-- 부록. 상태 점검 (아무 때나 읽기전용으로 실행 가능)
-- =====================================================================
-- select
--   (select count(*) from acct_accounts where active and formula is not null and formula <> '') as "현재_공식수",
--   (select count(*) from acct_formula_backup)                                                  as "백업_공식수",
--   (select count(*) from acct_lines_backup_20260929)                                           as "스냅샷_행수",
--   (select count(*) from acct_statement_lines)                                                 as "현재_행수";
