-- =====================================================================
-- 阶段一: 표내 자동합계 (财务报表自动计算 方案 v5 · 6.2)
-- =====================================================================
--
-- 방안서: 财务报表自动计算_方案草案_v5.md
--
-- 이 파일이 하는 일:
--   1. acct_accounts 에 formula 컬럼 추가 (계산공식을 계정코드로 표현)
--   2. acct_statement_lines 에 compare_cny(대조값) / calc_mode(계산모드) 컬럼 추가
--   3. 28개 합계행의 공식 등록
--   4. 공식 평가 함수 acct_eval_formulas() 추가 (서버측 재계산 = "前端算、后端复算")
--   5. submit_statement / get_accounts / get_statement 를 공식 대응으로 교체
--   6. 기존 데이터의 calc_mode 백필 (v5 5.2 구간별 처리)
--
-- ⚠ schema.sql 은 자동 배포되지 않습니다. 이 파일을 Supabase SQL Editor 에서
--    **위에서 아래로 한 번에** 실행하십시오. 여러 번 실행해도 안전합니다(멱등).
--
-- ⚠ 실행 순서: schema.sql -> seed_accounts.sql -> seed_access_keys.sql -> 이 파일
--
-- 실행 후 반드시 확인: 이 파일 맨 아래 "검증 쿼리" 3건

-- =====================================================================
-- 1. 컬럼 추가
-- =====================================================================

-- 계산공식. 계정코드를 대괄호로 감싼 가감식만 지원합니다: "[BS-L18]-[BS-L19]"
-- 괄호/곱셈은 지원하지 않습니다 — 재무제표 합계행은 전부 가감식이라 불필요하고,
-- 문법을 좁게 잡아야 관리화면에서 잘못 입력할 여지가 없습니다.
alter table acct_accounts add column if not exists formula text;

-- 대조값: 지점이 올린 엑셀에 들어있던 회계프로그램 산출 합계 (v5 3.8).
-- amount_cny 에는 시스템 계산값이 들어가고, 엑셀 원본값은 여기 따로 보관해 자동 비교합니다.
alter table acct_statement_lines add column if not exists compare_cny numeric;

-- 계산모드: 'auto'(자동계산) | 'legacy'(공식 도입 전 데이터, 동결).
-- **제출건이 최초 생성될 때 한 번 찍히고 이후 바뀌지 않습니다** (v5 5.2).
-- 동결 구간(2026-01~08)을 재무팀이 다시 열어 수정하더라도 자동계산이 건드리지 않게 하는 장치입니다.
alter table acct_statement_lines add column if not exists calc_mode text;

-- =====================================================================
-- 2. 공식 등록 (v5 부록 "写入系统的公式清单")
-- =====================================================================
-- 감산 항목은 전 지점이 **양수로 입력**하는 것이 실측으로 확인되었으므로(v5 제2절),
-- 부호는 전부 공식 쪽에서 책임집니다.

-- ----- PL (4행) -----
update acct_accounts set formula = '[500000]-[600000]-[PL-L03]-[680000]'
 where statement_type = 'PL' and code = '699999';
update acct_accounts set formula = '[699999]+[708000]-[PL-L06B]-[700000]-[709000]+[710000]'
 where statement_type = 'PL' and code = '799999';
update acct_accounts set formula = '[799999]+[810000]+[820000]+[830000]-[840000]'
 where statement_type = 'PL' and code = '900000';
update acct_accounts set formula = '[900000]-[905000]'
 where statement_type = 'PL' and code = '999999';
-- 709098(이자비용) / 709099(환율손익)은 709000 재무비용의 "其中" 메모행이라 합계에 넣지 않습니다.

-- ----- PL_KR (4행) -----
update acct_accounts set formula = '[500000]-[600000]'
 where statement_type = 'PL_KR' and code = '699999';
update acct_accounts set formula = '[699999]-[700000]'
 where statement_type = 'PL_KR' and code = '799999';
update acct_accounts set formula = '[799999]+[708100-1]-[708200-1]'
 where statement_type = 'PL_KR' and code = '900000';
update acct_accounts set formula = '[900000]-[905001]'
 where statement_type = 'PL_KR' and code = '999999';

-- ----- BS (10행) -----
-- BS-L11(원재료)은 BS-L10 재고자산의 "其中" 메모행이라 제외. BS-L07 대손충당금은 감산.
update acct_accounts set formula =
  '[BS-L01]+[BS-L02]+[BS-L03]+[BS-L04]+[BS-L05]+[BS-L06]-[BS-L07]+[BS-L08]+[BS-L09]'
  || '+[BS-L10]+[BS-L12]+[BS-L13]+[BS-L14]+[BS-L15]'
 where statement_type = 'BS' and code = 'BS-L16';
update acct_accounts set formula = '[BS-L18]-[BS-L19]'
 where statement_type = 'BS' and code = 'BS-L20';
update acct_accounts set formula = '[BS-L20]+[BS-L21]+[BS-L22]'
 where statement_type = 'BS' and code = 'BS-L23';
-- A-3: 건설중인자산(BS-L24)을 기타자산합계에서 빼고 자산총계에 직접 가산합니다.
update acct_accounts set formula = '[BS-L25]+[BS-L26]+[BS-L27]'
 where statement_type = 'BS' and code = 'BS-L28';
update acct_accounts set formula = '[BS-L16]+[BS-L17]+[BS-L23]+[BS-L24]+[BS-L28]'
 where statement_type = 'BS' and code = 'BS-L29';
update acct_accounts set formula =
  '[BS-R29]+[BS-R30]+[BS-R31]+[BS-R32]+[BS-R33]+[BS-R34]+[BS-R35]'
  || '+[BS-R36]+[BS-R37]+[BS-R38]+[BS-R39]+[BS-R40]+[BS-R41]'
 where statement_type = 'BS' and code = 'BS-R42';
update acct_accounts set formula = '[BS-R43]+[BS-R44]'
 where statement_type = 'BS' and code = 'BS-R45';
update acct_accounts set formula = '[BS-R42]+[BS-R45]+[BS-R46]'
 where statement_type = 'BS' and code = 'BS-R47';
-- BS-R49/R50(중방·외방투자), BS-R53(공익금)은 메모행이라 제외.
update acct_accounts set formula = '[BS-R48]+[BS-R51]+[BS-R52]+[BS-R54]+[BS-R55]'
 where statement_type = 'BS' and code = 'BS-R56';
update acct_accounts set formula = '[BS-R47]+[BS-R56]'
 where statement_type = 'BS' and code = 'BS-R57';
-- BS-R54(본년이윤) / BS-R55(미분배이익)은 阶段二의 跨表·结转 대상이라 여기서는 수기 입력 유지.

-- ----- CF (10행) -----
update acct_accounts set formula = '[CF-01]+[CF-03]+[CF-08]+[CF-91]'
 where statement_type = 'CF' and code = 'CF-09';
update acct_accounts set formula = '[CF-10]+[CF-12]+[CF-13]+[CF-18]+[CF-92]'
 where statement_type = 'CF' and code = 'CF-20';
update acct_accounts set formula = '[CF-09]-[CF-20]'
 where statement_type = 'CF' and code = 'CF-21';
update acct_accounts set formula = '[CF-22]+[CF-23]+[CF-25]+[CF-28]'
 where statement_type = 'CF' and code = 'CF-29';
update acct_accounts set formula = '[CF-30]+[CF-31]+[CF-35]'
 where statement_type = 'CF' and code = 'CF-36';
update acct_accounts set formula = '[CF-29]-[CF-36]'
 where statement_type = 'CF' and code = 'CF-37';
update acct_accounts set formula = '[CF-38]+[CF-40]+[CF-43]'
 where statement_type = 'CF' and code = 'CF-44';
update acct_accounts set formula = '[CF-45]+[CF-46]+[CF-52]'
 where statement_type = 'CF' and code = 'CF-53';
update acct_accounts set formula = '[CF-44]-[CF-53]'
 where statement_type = 'CF' and code = 'CF-54';
update acct_accounts set formula = '[CF-21]+[CF-37]+[CF-54]+[CF-55]'
 where statement_type = 'CF' and code = 'CF-56';

-- ⚠ CF-57(현금 기말잔액)은 **阶段二까지 보류**합니다.
--    공식은 '[CF-56]+[CF-58]-[CF-59]+[CF-60]' 인데, 실측 결과 CF-58(현금 기초)이 전 지점
--    비어 있습니다(v5 4.4). CF-58을 전월 BS에서 자동으로 가져오도록 만들기 전에 CF-57만
--    자동화하면 "틀린 줄 알면서 계산한 값"이 저장됩니다.
--    阶段二에서 아래 한 줄의 주석을 풀면 됩니다:
-- update acct_accounts set formula = '[CF-56]+[CF-58]-[CF-59]+[CF-60]'
--  where statement_type = 'CF' and code = 'CF-57';

-- 공식이 붙은 행은 화면에서 회색 읽기전용으로 표시되므로 is_subtotal 도 맞춰둡니다.
update acct_accounts set is_subtotal = true
 where formula is not null and formula <> '' and is_subtotal = false;

-- =====================================================================
-- 3. 공식 평가 함수
-- =====================================================================
--
-- p_values = { "계정코드": 금액, ... } 을 받아 공식행을 채운 같은 모양의 jsonb 를 돌려줍니다.
--
-- 위상정렬 대신 **수렴할 때까지 반복**하는 방식을 씁니다. 재무제표 공식은 깊이가 3단을
-- 넘지 않아 2~3회 패스면 끝나고, 순환참조가 있어도 무한루프에 빠지지 않습니다.
-- (관리화면에서 공식을 잘못 고쳐 A=B, B=A 같은 걸 만들 수 있으므로 상한이 필요합니다.)
create or replace function acct_eval_formulas(p_statement_type text, p_values jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_vals jsonb := coalesce(p_values, '{}'::jsonb);
  v_pass integer;
  v_changed boolean;
  v_acct record;
  v_m record;
  v_sum numeric;
begin
  for v_pass in 1..12 loop
    v_changed := false;

    for v_acct in
      select code, formula
        from acct_accounts
       where statement_type = p_statement_type
         and active = true
         and formula is not null and formula <> ''
       order by display_order
    loop
      v_sum := 0;
      -- '[코드]' 앞의 +/- 를 부호로 읽습니다. 맨 앞 항은 부호가 없으므로 가산.
      for v_m in
        select regexp_matches(v_acct.formula, '([+-]?)\s*\[([^\]]+)\]', 'g') as tok
      loop
        if v_m.tok[1] = '-' then
          v_sum := v_sum - coalesce((v_vals ->> v_m.tok[2])::numeric, 0);
        else
          v_sum := v_sum + coalesce((v_vals ->> v_m.tok[2])::numeric, 0);
        end if;
      end loop;

      if coalesce((v_vals ->> v_acct.code)::numeric, 0) is distinct from v_sum then
        v_vals := jsonb_set(v_vals, array[v_acct.code], to_jsonb(v_sum), true);
        v_changed := true;
      end if;
    end loop;

    exit when not v_changed;
  end loop;

  return v_vals;
end;
$$;
revoke all on function acct_eval_formulas(text, jsonb) from anon, authenticated;

-- =====================================================================
-- 4. get_accounts: formula 컬럼 노출
-- =====================================================================
create or replace function get_accounts() returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(to_jsonb(a) order by a."statementType", a."displayOrder"), '[]'::jsonb)
  from (
    select code, name_ko as "nameKo", name_zh as "nameZh", statement_type as "statementType",
           category, display_order as "displayOrder", is_subtotal as "isSubtotal", line_no as "lineNo",
           formula
    from acct_accounts where active = true
  ) a;
$$;

-- =====================================================================
-- 5. get_statement: 대조값 / 계산모드 노출
-- =====================================================================
create or replace function get_statement(
  p_access_key text,
  p_corp text,
  p_office text,
  p_yearmonth text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_branch_scope text;
  v_office_scope text;
  v_corp text;
  v_office text;
begin
  select role, branch_scope, office_scope into v_role, v_branch_scope, v_office_scope from verify_access_key(p_access_key);
  v_corp := coalesce(v_branch_scope, p_corp);
  v_office := coalesce(v_office_scope, p_office);

  return (
    select coalesce(jsonb_agg(to_jsonb(l)), '[]'::jsonb)
    from (
      select statement_type as "statementType", account_code as "accountCode",
             amount_cny as "amountCny", amount_krw as "amountKrw",
             compare_cny as "compareCny", calc_mode as "calcMode"
      from acct_statement_lines
      where corp = v_corp and office = v_office and yearmonth = p_yearmonth
    ) l
  );
end;
$$;

-- =====================================================================
-- 6. submit_statement: 서버측 재계산 + 대조값 저장
-- =====================================================================
-- 변경점 3가지 (그 외 권한/마감/잠금 로직은 종전과 완전히 동일):
--   (a) 이 제표의 calc_mode 를 먼저 판정 — 기존 행이 있으면 그 값을, 없으면 'auto'
--   (b) auto 이면 클라이언트가 보낸 금액을 acct_eval_formulas() 로 **다시 계산**해 덮어씀
--       (프런트 계산을 신뢰하지 않습니다 — v5 6.1 "前端算、后端复算")
--   (c) p_lines 의 compareCny 를 compare_cny 에 보관 (엑셀 원본 합계값, v5 3.8)
create or replace function submit_statement(
  p_access_key text,
  p_corp text,
  p_office text,
  p_yearmonth text,
  p_statement_type text,
  p_submitted_by text,
  p_lines jsonb
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_branch_scope text;
  v_office_scope text;
  v_rate numeric;
  v_row jsonb;
  v_count integer := 0;
  v_mode text;
  v_vals jsonb;
  v_calc jsonb;
  v_code text;
  v_amount numeric;
begin
  select role, branch_scope, office_scope into v_role, v_branch_scope, v_office_scope from verify_access_key(p_access_key);

  if v_branch_scope is not null and p_corp is distinct from v_branch_scope then
    raise exception 'unauthorized_branch';
  end if;
  if v_office_scope is not null and p_office is distinct from v_office_scope then
    raise exception 'unauthorized_office';
  end if;

  if exists (select 1 from acct_closed_months where yearmonth = p_yearmonth) then
    raise exception 'month_closed';
  end if;

  if p_corp is null or p_office is null or p_yearmonth is null or p_statement_type is null or p_submitted_by is null
     or p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'invalid_payload';
  end if;

  if v_role not in ('system_admin', 'finance')
     and exists (
       select 1 from acct_submission_lock
       where corp = p_corp and office = p_office and yearmonth = p_yearmonth and statement_type = p_statement_type
     ) then
    raise exception 'submission_locked';
  end if;

  -- (a) 계산모드 판정. 기존 행이 하나도 없으면 not found 라 v_mode 는 null 로 남고 'auto' 가 됩니다.
  select calc_mode into v_mode
    from acct_statement_lines
   where corp = p_corp and office = p_office and yearmonth = p_yearmonth
     and statement_type = p_statement_type
   limit 1;
  v_mode := coalesce(v_mode, 'auto');

  -- (b) 서버측 재계산
  select coalesce(jsonb_object_agg(e->>'accountCode', coalesce(nullif(e->>'amountCny','')::numeric, 0)), '{}'::jsonb)
    into v_vals
    from jsonb_array_elements(p_lines) e
   where e->>'accountCode' is not null;

  if v_mode = 'auto' then
    v_calc := acct_eval_formulas(p_statement_type, v_vals);
  else
    v_calc := v_vals;
  end if;

  select cny_to_krw into v_rate from acct_exchange_rates where yearmonth = p_yearmonth;

  for v_row in select * from jsonb_array_elements(p_lines)
  loop
    v_code := v_row->>'accountCode';
    continue when v_code is null;
    v_amount := coalesce((v_calc ->> v_code)::numeric, 0);

    insert into acct_statement_lines (
      corp, office, yearmonth, statement_type, account_code, amount_cny, amount_krw,
      compare_cny, calc_mode, submitted_by, submitted_by_role, submitted_at
    ) values (
      p_corp, p_office, p_yearmonth, p_statement_type, v_code,
      v_amount,
      case when v_rate is null then null else v_amount * v_rate end,
      nullif(v_row->>'compareCny', '')::numeric,
      v_mode,
      p_submitted_by, v_role, now()
    )
    on conflict (corp, office, yearmonth, statement_type, account_code) do update
      set amount_cny = excluded.amount_cny,
          amount_krw = excluded.amount_krw,
          -- 대조값은 이번에 보내온 게 있을 때만 갱신합니다(엑셀 없이 수기 제출한 경우 기존값 보존).
          compare_cny = coalesce(excluded.compare_cny, acct_statement_lines.compare_cny),
          -- calc_mode 는 최초 생성 시점의 값을 끝까지 유지합니다 (v5 5.2).
          submitted_by = excluded.submitted_by,
          submitted_by_role = excluded.submitted_by_role,
          submitted_at = now();
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- =====================================================================
-- 7. set_calc_mode: 계산모드 수동 전환 (system_admin/finance 전용)
-- =====================================================================
-- 동결로 잘못 찍힌 제표를 자동계산으로 돌리거나 그 반대로 되돌리는 비상구입니다.
-- 값만 바꿀 뿐 재계산은 하지 않습니다 — 다음 제출 때부터 적용됩니다.
create or replace function set_calc_mode(
  p_access_key text,
  p_corp text,
  p_office text,
  p_yearmonth text,
  p_statement_type text,
  p_mode text
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_count integer;
begin
  select role into v_role from verify_access_key(p_access_key);
  if v_role not in ('system_admin', 'finance') then
    raise exception 'unauthorized';
  end if;
  if p_mode not in ('auto', 'legacy') then
    raise exception 'invalid_payload';
  end if;

  update acct_statement_lines set calc_mode = p_mode
   where corp = p_corp and office = p_office and yearmonth = p_yearmonth
     and statement_type = p_statement_type;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function set_calc_mode(text, text, text, text, text, text) from anon, authenticated;

-- =====================================================================
-- 8. 기존 데이터 백필 (v5 5.2 구간별 처리)
-- =====================================================================
--   2026-01~08  -> legacy (동결. 공식 도입 전 데이터라 재계산 대상이 아님)
--   그 외        -> auto   (2024-12 기점, 2025년 보정입력, 2026-09 이후 모두 자동계산)
--
-- calc_mode 가 이미 찍힌 행은 건드리지 않습니다. 여러 번 실행해도 안전합니다.
update acct_statement_lines
   set calc_mode = case
         when yearmonth >= '2026-01' and yearmonth <= '2026-08' then 'legacy'
         else 'auto'
       end
 where calc_mode is null;

-- =====================================================================
-- 9. replace_accounts: COA 일괄교체 시 공식 보존
-- =====================================================================
-- ⚠ 이걸 안 하면 관리화면에서 계정과목 엑셀을 되올리는 순간 28개 공식이 전부 날아갑니다.
--   그러고도 에러는 안 나고 합계행이 0원으로만 표시됩니다 — 자금집행 BS-R67 사고와 같은 형태.
--
-- 규칙: 업로드 엑셀에 formula 값이 있으면 그 값으로, **비어 있거나 열 자체가 없으면 기존 공식 유지**.
--   (구버전 엑셀로 되올려도 안전. 대신 공식을 "지우는" 건 이 경로로는 불가능하며,
--    지우려면 아래처럼 직접 실행해야 합니다:
--      update acct_accounts set formula = null where statement_type='BS' and code='BS-L16';)
create or replace function replace_accounts(
  p_access_key text,
  p_accounts jsonb
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_row jsonb;
  v_new_pairs text[];
  v_count integer := 0;
begin
  select role into v_role from verify_access_key(p_access_key);
  if v_role <> 'system_admin' then
    raise exception 'unauthorized';
  end if;
  if p_accounts is null or jsonb_array_length(p_accounts) = 0 then
    raise exception 'invalid_payload';
  end if;

  select array_agg((x->>'code') || '::' || (x->>'statementType')) into v_new_pairs
  from jsonb_array_elements(p_accounts) x;

  update acct_accounts set active = false
   where (code || '::' || statement_type) <> all(v_new_pairs);

  for v_row in select * from jsonb_array_elements(p_accounts)
  loop
    insert into acct_accounts (code, name_ko, name_zh, statement_type, category, display_order, is_subtotal, line_no, formula, active, updated_at)
    values (
      v_row->>'code', v_row->>'nameKo', v_row->>'nameZh', v_row->>'statementType',
      v_row->>'category', coalesce(nullif(v_row->>'displayOrder','')::integer, 0),
      coalesce((v_row->>'isSubtotal')::boolean, false), nullif(v_row->>'lineNo', ''),
      nullif(v_row->>'formula', ''), true, now()
    )
    on conflict (code, statement_type) do update
      set name_ko = excluded.name_ko, name_zh = excluded.name_zh,
          category = excluded.category, display_order = excluded.display_order,
          is_subtotal = excluded.is_subtotal, line_no = excluded.line_no,
          formula = coalesce(excluded.formula, acct_accounts.formula),
          active = true, updated_at = now();
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

grant execute on function set_calc_mode(text, text, text, text, text, text) to anon, authenticated;

-- =====================================================================
-- 검증 쿼리 — 실행 후 아래 3건을 반드시 확인하십시오
-- =====================================================================

-- [1] 공식이 28개 붙었는지. 기대: PL 4 / PL_KR 4 / BS 10 / CF 10 = 28
select statement_type as "제표", count(*) as "공식행수"
  from acct_accounts
 where active = true and formula is not null and formula <> ''
 group by statement_type
 order by statement_type;

-- [2] 공식이 참조하는 계정코드가 전부 실재하는지. 기대: **0건**
--     (오타나 비활성 코드를 참조하면 그 항은 조용히 0으로 계산되므로 반드시 확인해야 합니다)
with ref as (
  select a.statement_type, a.code as owner,
         (regexp_matches(a.formula, '\[([^\]]+)\]', 'g'))[1] as ref_code
    from acct_accounts a
   where a.active = true and a.formula is not null and a.formula <> ''
)
select ref.statement_type as "제표", ref.owner as "공식행", ref.ref_code as "찾을수없는참조"
  from ref
  left join acct_accounts t
    on t.statement_type = ref.statement_type and t.code = ref.ref_code and t.active = true
 where t.code is null
 order by 1, 2, 3;

-- [3] 계산모드 백필 결과. 기대: 2026-01~08 = legacy, 나머지 = auto
select calc_mode as "계산모드", min(yearmonth) as "최초월", max(yearmonth) as "최종월", count(*) as "행수"
  from acct_statement_lines
 group by calc_mode
 order by 1;
