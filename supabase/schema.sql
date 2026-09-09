-- Supabase 마이그레이션: 회계관리 (중국법인 월별 재무제표 취합)
-- 사용법: Supabase 대시보드 > SQL Editor > New query 에 이 파일 전체를 붙여넣고 실행하세요.
-- 접대비 앱과 동일한 Supabase 프로젝트를 공유합니다. access_keys 테이블/verify_access_key 함수는
-- 접두사 없이 공용으로 두며, 향후 예산관리/자금집행/실적분석/인사관리도 이 테이블을 그대로 재사용합니다
-- (테이블 구조와 verify_access_key 시그니처는 바꾸지 말고, 키 행만 추가하세요).
-- 이 모듈만의 테이블/함수는 전부 acct_ 접두사를 씁니다.
--
-- ⚠ v2 변경사항 (실제 재무자료 검토 후 반영):
--   - 법인(corp) 아래 지점(office) 차원 추가 — 한 법인에 여러 지점이 있고, 지점별로 입력받아
--     법인 단위로 통합(get_consolidated_statement)합니다.
--   - access_keys에 office_scope 컬럼 추가 — null이면 해당 법인의 모든 지점, 값이 있으면 그 지점만.
--   - 이미 v1으로 이 스키마를 실행한 적이 있다면, 이 파일을 다시 실행해도 안전합니다
--     (alter table ... add column if not exists 패턴이라 재실행 시 데이터 손실 없음). 다만
--     acct_statement_lines의 자연키 unique index가 (corp, office, yearmonth, ...)로 바뀌므로
--     office가 빈 문자열('')로 채워진 기존 행들은 계속 유효합니다(기본값 '').
--
-- 실행 순서: schema.sql -> seed_accounts.sql -> seed_access_keys.sql
-- seed_access_keys.sql의 테스트용 키는 실제 운영 전 반드시 새 키로 교체하세요.

create extension if not exists pgcrypto;

-- =====================================================================
-- 공용: 접근키 (access_keys) — 향후 모든 ERP 모듈이 재사용
-- =====================================================================
create table if not exists access_keys (
  id bigint generated always as identity primary key,
  key_hash text not null unique,        -- sha256(평문 키) 해시. 평문은 저장하지 않음.
  label text not null,                  -- 사람이 알아볼 수 있는 설명. 예: "상해물류센터 회계담당자"
  role text not null,                   -- 'system_admin' | 'finance' | 'branch_<slug>' (컨벤션, CHECK 제약 없음 - 향후 모듈이 자유롭게 role을 해석)
  branch_scope text,                    -- null=전체 법인, 아니면 CORPORATIONS.ko 값 하나 (예: "상해물류센터")
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by text,
  last_used_at timestamptz
);
alter table access_keys add column if not exists office_scope text; -- null=branch_scope 법인의 모든 지점, 값 있으면 그 지점만
alter table access_keys enable row level security;
revoke all on access_keys from anon, authenticated;

-- 접근키 검증: 일치하는 키의 role/branch_scope/office_scope를 반환. 실패 시 invalid_access_key 예외.
-- 다른 모듈의 RPC도 이 함수를 그대로 호출해서 재사용합니다. (기존 모듈들은 role/branch_scope만
-- 명시적으로 select하므로 office_scope 컬럼 추가는 하위호환 — 예산관리/자금집행/실적분석 수정 불필요)
create or replace function verify_access_key(p_key text)
returns table(role text, branch_scope text, office_scope text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hash text;
begin
  if p_key is null or p_key = '' then
    raise exception 'invalid_access_key';
  end if;
  v_hash := encode(digest(p_key, 'sha256'), 'hex');
  return query
    update access_keys
       set last_used_at = now()
     where key_hash = v_hash and active = true
    returning access_keys.role, access_keys.branch_scope, access_keys.office_scope;
  if not found then
    raise exception 'invalid_access_key';
  end if;
end;
$$;

-- =====================================================================
-- 회계관리 전용 테이블 (acct_ 접두사)
-- =====================================================================

-- 계정과목 (실제 표준 COA는 admin.html에서 엑셀 업로드로 통째로 교체 가능)
-- code는 PL_KR과 PL이 같은 AC CODE(예: 500000)를 공유할 수 있어 statement_type과 함께 복합키로 관리합니다.
create table if not exists acct_accounts (
  code text not null,
  name_ko text not null,
  name_zh text not null,
  statement_type text not null check (statement_type in ('PL','PL_KR','BS','CF')),
  category text not null,
  display_order integer not null default 0,
  is_subtotal boolean not null default false,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table acct_accounts drop constraint if exists acct_accounts_pkey;
alter table acct_accounts add primary key (code, statement_type);
alter table acct_accounts drop constraint if exists acct_accounts_statement_type_check;
alter table acct_accounts add constraint acct_accounts_statement_type_check
  check (statement_type in ('PL','PL_KR','BS','CF'));
alter table acct_accounts enable row level security;
revoke all on acct_accounts from anon, authenticated;

-- 월별 고정환율 (CNY -> KRW), 관리자가 월 1회 설정
create table if not exists acct_exchange_rates (
  yearmonth text primary key,
  cny_to_krw numeric not null,
  set_by text,
  set_at timestamptz not null default now()
);
alter table acct_exchange_rates enable row level security;
revoke all on acct_exchange_rates from anon, authenticated;

-- 월 마감
create table if not exists acct_closed_months (
  yearmonth text primary key,
  closed_at timestamptz not null default now(),
  closed_by text
);
alter table acct_closed_months enable row level security;
revoke all on acct_closed_months from anon, authenticated;

-- 재무제표 라인 (P&L/B/S/CF 공통 - 법인+지점+계정당 금액 하나가 자연키이므로 upsert로 관리)
create table if not exists acct_statement_lines (
  id bigint generated always as identity primary key,
  corp text not null,
  yearmonth text not null,
  statement_type text not null,
  account_code text not null,
  amount_cny numeric not null default 0,
  amount_krw numeric,
  submitted_by text not null,
  submitted_by_role text,
  submitted_at timestamptz not null default now(),
  note text default '',
  created_at timestamptz not null default now()
);
alter table acct_statement_lines add column if not exists office text not null default '';
drop index if exists uq_acct_lines_natural;
create unique index if not exists uq_acct_lines_natural
  on acct_statement_lines(corp, office, yearmonth, statement_type, account_code);
create index if not exists idx_acct_lines_ym on acct_statement_lines(yearmonth);
create index if not exists idx_acct_lines_corp_ym on acct_statement_lines(corp, yearmonth);
alter table acct_statement_lines enable row level security;
revoke all on acct_statement_lines from anon, authenticated;

-- PL(한국) 제출 시 같이 입력하는 비재무 수기값 (인원수) + 접대비 월간 합계(접대비 앱은 별도
-- Supabase 프로젝트라 DB 조인이 불가능해 지점이 회계관리 쪽에 수기로 입력합니다).
create table if not exists acct_pl_kr_extra (
  corp text not null,
  office text not null default '',
  yearmonth text not null,
  headcount integer,
  entertainment_cny numeric,
  submitted_by text,
  submitted_at timestamptz not null default now(),
  primary key (corp, office, yearmonth)
);
alter table acct_pl_kr_extra enable row level security;
revoke all on acct_pl_kr_extra from anon, authenticated;

-- =====================================================================
-- RPC 함수
-- =====================================================================

-- 계정과목 목록 (공개 - 제출/조회 화면 렌더링에 필요, 민감정보 아님)
create or replace function get_accounts() returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(to_jsonb(a) order by a."statementType", a."displayOrder"), '[]'::jsonb)
  from (
    select code, name_ko as "nameKo", name_zh as "nameZh", statement_type as "statementType",
           category, display_order as "displayOrder", is_subtotal as "isSubtotal"
    from acct_accounts where active = true
  ) a;
$$;

-- 마감된 월 목록 (공개 - 제출 화면에서 마감 안내 배너용)
create or replace function get_closed_months() returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(yearmonth order by yearmonth), '[]'::jsonb) from acct_closed_months;
$$;

-- 해당 월 환율 조회 (공개 - 지점 화면에서 KRW 환산 미리보기용, 없으면 null)
create or replace function get_exchange_rate(p_yearmonth text) returns numeric
language sql
security definer
set search_path = public
as $$
  select cny_to_krw from acct_exchange_rates where yearmonth = p_yearmonth;
$$;

-- 환율 설정 (system_admin/finance 전용) - 설정 즉시 해당 월 기존 데이터도 재계산
create or replace function set_exchange_rate(
  p_access_key text,
  p_yearmonth text,
  p_cny_to_krw numeric
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  select role into v_role from verify_access_key(p_access_key);
  if v_role not in ('system_admin', 'finance') then
    raise exception 'unauthorized';
  end if;
  if p_yearmonth is null or p_cny_to_krw is null or p_cny_to_krw <= 0 then
    raise exception 'invalid_payload';
  end if;

  insert into acct_exchange_rates (yearmonth, cny_to_krw, set_by)
  values (p_yearmonth, p_cny_to_krw, v_role)
  on conflict (yearmonth) do update
    set cny_to_krw = excluded.cny_to_krw, set_by = excluded.set_by, set_at = now();

  update acct_statement_lines
     set amount_krw = amount_cny * p_cny_to_krw
   where yearmonth = p_yearmonth;
end;
$$;

-- 지점 제출: 자연키(corp/office/yearmonth/statement_type/account_code) 기준 upsert.
-- office_scope가 설정된 키는 자기 지점 외에는 제출할 수 없도록 강제합니다.
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

  select cny_to_krw into v_rate from acct_exchange_rates where yearmonth = p_yearmonth;

  for v_row in select * from jsonb_array_elements(p_lines)
  loop
    insert into acct_statement_lines (
      corp, office, yearmonth, statement_type, account_code, amount_cny, amount_krw,
      submitted_by, submitted_by_role, submitted_at
    ) values (
      p_corp, p_office, p_yearmonth, p_statement_type,
      v_row->>'accountCode',
      coalesce(nullif(v_row->>'amountCny', '')::numeric, 0),
      case when v_rate is null then null else coalesce(nullif(v_row->>'amountCny', '')::numeric, 0) * v_rate end,
      p_submitted_by, v_role, now()
    )
    on conflict (corp, office, yearmonth, statement_type, account_code) do update
      set amount_cny = excluded.amount_cny,
          amount_krw = excluded.amount_krw,
          submitted_by = excluded.submitted_by,
          submitted_by_role = excluded.submitted_by_role,
          submitted_at = now();
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- 특정 법인/지점/월의 기존 입력값 조회 (수정형 UX 프리필용)
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
             amount_cny as "amountCny", amount_krw as "amountKrw"
      from acct_statement_lines
      where corp = v_corp and office = v_office and yearmonth = p_yearmonth
    ) l
  );
end;
$$;

-- 법인 통합 재무제표: 해당 법인의 모든 지점을 계정별로 합산 (지점 구분 없이 법인 전체 총계 확인용)
create or replace function get_consolidated_statement(
  p_access_key text,
  p_corp text,
  p_yearmonth text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_branch_scope text;
  v_corp text;
begin
  select role, branch_scope into v_role, v_branch_scope from verify_access_key(p_access_key);
  v_corp := coalesce(v_branch_scope, p_corp);

  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x."statementType", x."accountCode")
    from (
      select statement_type as "statementType", account_code as "accountCode",
             sum(amount_cny) as "amountCny", sum(amount_krw) as "amountKrw",
             count(distinct office) as "officeCount"
      from acct_statement_lines
      where corp = v_corp and yearmonth = p_yearmonth
      group by statement_type, account_code
    ) x
  ), '[]'::jsonb);
end;
$$;

-- PL(한국) 부가 수기입력(인원수/접대비) 제출. office_scope가 있으면 자기 지점만 가능.
create or replace function submit_pl_kr_extra(
  p_access_key text,
  p_corp text,
  p_office text,
  p_yearmonth text,
  p_headcount integer,
  p_entertainment_cny numeric,
  p_submitted_by text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_branch_scope text;
  v_office_scope text;
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
  if p_corp is null or p_office is null or p_yearmonth is null then
    raise exception 'invalid_payload';
  end if;

  insert into acct_pl_kr_extra (corp, office, yearmonth, headcount, entertainment_cny, submitted_by, submitted_at)
  values (p_corp, p_office, p_yearmonth, p_headcount, p_entertainment_cny, p_submitted_by, now())
  on conflict (corp, office, yearmonth) do update
    set headcount = excluded.headcount, entertainment_cny = excluded.entertainment_cny,
        submitted_by = excluded.submitted_by, submitted_at = now();
end;
$$;

-- PL(한국) 부가 수기입력 조회 (제출화면 프리필용)
create or replace function get_pl_kr_extra(
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

  return coalesce((
    select to_jsonb(x) from (
      select headcount, entertainment_cny as "entertainmentCny"
      from acct_pl_kr_extra
      where corp = v_corp and office = v_office and yearmonth = p_yearmonth
    ) x
  ), '{}'::jsonb);
end;
$$;

-- 본사 집계 조회 (system_admin/finance 전용) - 지점별 상세 (office 포함)
create or replace function get_aggregate(
  p_access_key text,
  p_yearmonth text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_lines jsonb;
  v_submissions jsonb;
  v_extras jsonb;
begin
  select role into v_role from verify_access_key(p_access_key);
  if v_role not in ('system_admin', 'finance') then
    raise exception 'unauthorized';
  end if;
  if p_yearmonth is null then
    raise exception 'yearmonth_required';
  end if;

  select coalesce(jsonb_agg(to_jsonb(l) order by l.corp, l.office, l."statementType", l."accountCode"), '[]'::jsonb)
    into v_lines
  from (
    select id, corp, office, statement_type as "statementType", account_code as "accountCode",
           amount_cny as "amountCny", amount_krw as "amountKrw",
           submitted_by as "submittedBy", submitted_at as "submittedAt"
    from acct_statement_lines where yearmonth = p_yearmonth
  ) l;

  select coalesce(jsonb_agg(s), '[]'::jsonb)
    into v_submissions
  from (
    select distinct on (corp, office, statement_type) corp, office, statement_type as "statementType",
           submitted_by as "submittedBy", submitted_at as "submittedAt"
    from acct_statement_lines where yearmonth = p_yearmonth
    order by corp, office, statement_type, submitted_at desc
  ) s;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.corp, x.office), '[]'::jsonb)
    into v_extras
  from (
    select corp, office, headcount, entertainment_cny as "entertainmentCny"
    from acct_pl_kr_extra where yearmonth = p_yearmonth
  ) x;

  return jsonb_build_object('lines', v_lines, 'submissions', v_submissions, 'extras', v_extras);
end;
$$;

create or replace function close_month(
  p_access_key text,
  p_yearmonth text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  select role into v_role from verify_access_key(p_access_key);
  if v_role not in ('system_admin', 'finance') then
    raise exception 'unauthorized';
  end if;
  if p_yearmonth is null then
    raise exception 'yearmonth_required';
  end if;
  insert into acct_closed_months (yearmonth, closed_by) values (p_yearmonth, v_role)
  on conflict (yearmonth) do nothing;
end;
$$;

create or replace function reopen_month(
  p_access_key text,
  p_yearmonth text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  select role into v_role from verify_access_key(p_access_key);
  if v_role not in ('system_admin', 'finance') then
    raise exception 'unauthorized';
  end if;
  delete from acct_closed_months where yearmonth = p_yearmonth;
end;
$$;

create or replace function delete_statement_line(
  p_access_key text,
  p_id bigint
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  select role into v_role from verify_access_key(p_access_key);
  if v_role not in ('system_admin', 'finance') then
    raise exception 'unauthorized';
  end if;
  delete from acct_statement_lines where id = p_id;
end;
$$;

-- 계정과목 일괄 교체 (system_admin 전용 - finance보다 엄격. COA 훼손은 전체 지점 데이터 매핑에 영향)
-- 새 목록에 없는 기존 코드는 소프트 비활성화(active=false)만 하고 삭제하지 않음 - 과거 제출 데이터가
-- 참조하는 account_code는 계속 조회 가능해야 하기 때문 (acct_statement_lines에는 하드 FK 없음).
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
    insert into acct_accounts (code, name_ko, name_zh, statement_type, category, display_order, is_subtotal, active, updated_at)
    values (
      v_row->>'code', v_row->>'nameKo', v_row->>'nameZh', v_row->>'statementType',
      v_row->>'category', coalesce(nullif(v_row->>'displayOrder','')::integer, 0),
      coalesce((v_row->>'isSubtotal')::boolean, false), true, now()
    )
    on conflict (code, statement_type) do update
      set name_ko = excluded.name_ko, name_zh = excluded.name_zh,
          category = excluded.category, display_order = excluded.display_order,
          is_subtotal = excluded.is_subtotal, active = true, updated_at = now();
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

grant execute on function verify_access_key(text) to anon, authenticated;
grant execute on function get_accounts() to anon, authenticated;
grant execute on function get_closed_months() to anon, authenticated;
grant execute on function get_exchange_rate(text) to anon, authenticated;
grant execute on function set_exchange_rate(text, text, numeric) to anon, authenticated;
grant execute on function submit_statement(text, text, text, text, text, text, jsonb) to anon, authenticated;
grant execute on function get_statement(text, text, text, text) to anon, authenticated;
grant execute on function get_consolidated_statement(text, text, text) to anon, authenticated;
grant execute on function submit_pl_kr_extra(text, text, text, text, integer, numeric, text) to anon, authenticated;
grant execute on function get_pl_kr_extra(text, text, text, text) to anon, authenticated;
grant execute on function get_aggregate(text, text) to anon, authenticated;
grant execute on function close_month(text, text) to anon, authenticated;
grant execute on function reopen_month(text, text) to anon, authenticated;
grant execute on function delete_statement_line(text, bigint) to anon, authenticated;
grant execute on function replace_accounts(text, jsonb) to anon, authenticated;
