-- 마이그레이션: 회계관리 "서버 공유 임시저장" (2026-10)
--
-- 배경
--   지금의 "임시저장"은 그 PC 브라우저(localStorage)에만 저장돼서, 같은 지점의 다른 담당자(다른 PC)는
--   제출 전 입력을 볼 수 없습니다. 이 마이그레이션은 임시저장을 서버에 두어 같은 지점 키로 들어온
--   누구나 이어서 입력/확인할 수 있게 합니다.
--
-- 이 파일이 하는 일 (모두 "추가"입니다 — 기존 테이블/함수는 하나도 바꾸지 않습니다)
--   1) 새 테이블 acct_statement_drafts            (임시저장 본문. 정식 데이터 acct_statement_lines와 완전히 분리)
--   2) 새 함수 get_statement_drafts(...)           (임시저장 조회)
--   3) 새 함수 save_statement_draft(...)           (임시저장 저장 + 동시 편집 충돌 감지)
--   4) 새 함수 delete_statement_draft(...)         (임시저장 삭제 — 제출 후 정리/직접 지우기)
--
-- 정식 데이터와 분리돼 있으므로: 임시저장 숫자는 합병 재무제표·실적분석·본사 제출현황에 절대 섞이지 않습니다.
--
-- 사용법
--   Supabase 대시보드 > SQL Editor > "New query"(새 쿼리)에 이 파일 전체를 붙여넣고 Run.
--   (SQL Editor에 저장된 예전 쿼리를 다시 실행하지 마세요.) 여러 번 실행해도 안전합니다.
--   배포 전/후 어느 쪽이든 화면은 깨지지 않습니다: 이 함수들이 없으면 화면이 자동으로 예전 방식(이 PC에만 저장)으로
--   동작하고, 함수가 생기면 그때부터 서버 공유로 바뀝니다. (= 이 SQL이 "스위치"입니다)
--   실행 뒤 test_shared_drafts.sql을 한 번 돌리면 운영 DB에 아무것도 남기지 않고 동작을 점검할 수 있습니다.
--
-- 권한/규칙 (submit_statement 등 기존 함수와 같은 규칙)
--   - 접근키 검증은 verify_access_key. branch_scope / office_scope 가 있는 키는 자기 법인·지점 것만 다룹니다.
--   - 마감된 달(acct_closed_months)에는 저장할 수 없습니다 (month_closed).
--   - 이미 제출되어 잠긴 탭(acct_submission_lock)에는 저장할 수 없습니다 (submission_locked).
--     system_admin / finance 는 잠금과 무관하게 저장할 수 있습니다(제출 규칙과 동일).
--   - 잠긴 탭의 임시저장, 그리고 "마지막 정식 제출보다 오래된" 임시저장은 조회에서 숨깁니다.
--     (본사가 잠금을 풀었을 때 낡은 임시저장이 되살아나 제출된 값을 가리는 일을 막기 위함)
--   - 동시 편집: 저장할 때 "내가 마지막으로 본 version"을 같이 보냅니다. 그 사이 다른 사람이 저장했으면
--     덮어쓰지 않고 conflict 를 돌려줍니다(p_force=true 로만 덮어쓰기).

create table if not exists acct_statement_drafts (
  corp text not null,
  office text not null,
  yearmonth text not null,
  statement_type text not null check (statement_type in ('PL', 'PL_KR', 'BS', 'CF')),
  payload jsonb not null,            -- { values: {계정코드: "금액"}, compare: {...}, extra: {...} }
  saved_by text,                     -- 저장한 접근키의 라벨(예: 상해-1)
  saved_at timestamptz not null default now(),
  version integer not null default 1,
  primary key (corp, office, yearmonth, statement_type)
);
alter table acct_statement_drafts enable row level security;
revoke all on acct_statement_drafts from anon, authenticated;

-- ---------------------------------------------------------------------
-- 조회: 해당 법인·지점·월의 임시저장 목록 (탭별 최대 1건)
-- ---------------------------------------------------------------------
create or replace function get_statement_drafts(
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
    select jsonb_agg(
             jsonb_build_object(
               'statementType', d.statement_type,
               'payload', d.payload,
               'savedBy', d.saved_by,
               'savedAt', d.saved_at,
               'version', d.version
             )
             order by d.statement_type
           )
      from acct_statement_drafts d
     where d.corp = v_corp and d.office = v_office and d.yearmonth = p_yearmonth
       -- 이미 제출되어 잠긴 탭의 임시저장은 보이지 않는다
       and not exists (
         select 1 from acct_submission_lock k
          where k.corp = d.corp and k.office = d.office
            and k.yearmonth = d.yearmonth and k.statement_type = d.statement_type)
       -- 마지막 정식 제출보다 오래된 임시저장은 낡은 것이라 보이지 않는다
       and d.saved_at > coalesce((
         select max(l.submitted_at) from acct_statement_lines l
          where l.corp = d.corp and l.office = d.office
            and l.yearmonth = d.yearmonth and l.statement_type = d.statement_type), '-infinity'::timestamptz)
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------
-- 저장: 임시저장을 만들거나 갱신. 성공하면 {ok:true, version, savedAt},
--       그 사이 다른 사람이 저장했으면 {ok:false, conflict:true, current:{...}}
-- ---------------------------------------------------------------------
create or replace function save_statement_draft(
  p_access_key text,
  p_corp text,
  p_office text,
  p_yearmonth text,
  p_statement_type text,
  p_saved_by text,
  p_payload jsonb,
  p_base_version integer default null,
  p_force boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_branch_scope text;
  v_office_scope text;
  v_cur acct_statement_drafts%rowtype;
  v_last_submit timestamptz;
  v_version integer;
  v_saved_at timestamptz;
begin
  select role, branch_scope, office_scope into v_role, v_branch_scope, v_office_scope from verify_access_key(p_access_key);

  if v_branch_scope is not null and p_corp is distinct from v_branch_scope then
    raise exception 'unauthorized_branch';
  end if;
  if v_office_scope is not null and p_office is distinct from v_office_scope then
    raise exception 'unauthorized_office';
  end if;

  if p_corp is null or p_office is null or p_yearmonth is null
     or p_statement_type is null or p_statement_type not in ('PL', 'PL_KR', 'BS', 'CF')
     or p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'invalid_payload';
  end if;
  -- 한 탭 분량(계정 수십 줄)을 훨씬 넘는 크기는 거부 (키를 가진 누구나 쓸 수 있는 함수라서 남용 방지)
  if octet_length(p_payload::text) > 100000 then
    raise exception 'payload_too_large';
  end if;

  if exists (select 1 from acct_closed_months where yearmonth = p_yearmonth) then
    raise exception 'month_closed';
  end if;

  if v_role not in ('system_admin', 'finance')
     and exists (
       select 1 from acct_submission_lock
        where corp = p_corp and office = p_office and yearmonth = p_yearmonth and statement_type = p_statement_type
     ) then
    raise exception 'submission_locked';
  end if;

  select max(submitted_at) into v_last_submit from acct_statement_lines
   where corp = p_corp and office = p_office and yearmonth = p_yearmonth and statement_type = p_statement_type;

  -- 행 잠금: 같은 탭을 동시에 저장하는 두 요청을 차례로 처리한다
  select * into v_cur from acct_statement_drafts
   where corp = p_corp and office = p_office and yearmonth = p_yearmonth and statement_type = p_statement_type
   for update;

  if found then
    -- 낡지 않은(마지막 제출 이후에 저장된) 초안이 있는데, 내가 마지막으로 본 version과 다르면 충돌
    if v_cur.saved_at > coalesce(v_last_submit, '-infinity'::timestamptz)
       and not coalesce(p_force, false)
       and p_base_version is distinct from v_cur.version then
      return jsonb_build_object(
        'ok', false, 'conflict', true,
        'current', jsonb_build_object(
          'payload', v_cur.payload, 'savedBy', v_cur.saved_by,
          'savedAt', v_cur.saved_at, 'version', v_cur.version));
    end if;

    update acct_statement_drafts
       set payload = p_payload, saved_by = p_saved_by, saved_at = now(), version = v_cur.version + 1
     where corp = p_corp and office = p_office and yearmonth = p_yearmonth and statement_type = p_statement_type
    returning version, saved_at into v_version, v_saved_at;
  else
    insert into acct_statement_drafts (corp, office, yearmonth, statement_type, payload, saved_by, saved_at, version)
    values (p_corp, p_office, p_yearmonth, p_statement_type, p_payload, p_saved_by, now(), 1)
    on conflict (corp, office, yearmonth, statement_type) do nothing
    returning version, saved_at into v_version, v_saved_at;

    if v_version is null then
      -- 거의 동시에 다른 사람이 먼저 만들었다
      select * into v_cur from acct_statement_drafts
       where corp = p_corp and office = p_office and yearmonth = p_yearmonth and statement_type = p_statement_type;
      return jsonb_build_object(
        'ok', false, 'conflict', true,
        'current', jsonb_build_object(
          'payload', v_cur.payload, 'savedBy', v_cur.saved_by,
          'savedAt', v_cur.saved_at, 'version', v_cur.version));
    end if;
  end if;

  return jsonb_build_object('ok', true, 'version', v_version, 'savedAt', v_saved_at);
end;
$$;

-- ---------------------------------------------------------------------
-- 삭제: 제출 뒤 정리하거나, 사용자가 "임시저장 지우기"를 눌렀을 때.
--       잠긴 탭/마감된 달에서도 지울 수 있습니다(정리용이라 데이터를 만들지 않음).
-- ---------------------------------------------------------------------
create or replace function delete_statement_draft(
  p_access_key text,
  p_corp text,
  p_office text,
  p_yearmonth text,
  p_statement_type text
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

  delete from acct_statement_drafts
   where corp = p_corp and office = p_office and yearmonth = p_yearmonth and statement_type = p_statement_type;
end;
$$;

grant execute on function get_statement_drafts(text, text, text, text) to anon, authenticated;
grant execute on function save_statement_draft(text, text, text, text, text, text, jsonb, integer, boolean) to anon, authenticated;
grant execute on function delete_statement_draft(text, text, text, text, text) to anon, authenticated;

-- PostgREST가 새 함수를 바로 인식하도록 스키마 캐시를 갱신 (Supabase는 DDL 뒤 자동 갱신도 하지만 확실히 하기 위함)
notify pgrst, 'reload schema';
