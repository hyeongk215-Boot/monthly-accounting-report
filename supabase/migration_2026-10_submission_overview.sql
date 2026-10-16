-- 마이그레이션: 회계관리 "월별 제출 현황표" (2026-10)
--
-- 배경
--   입력 화면 맨 위 카드는 "최근 3개월"의 미제출만 보여줘서, 2024~2026년 자료를 소급해서 입력하는 작업
--   (최대 30여 개월 × 제표 4종)에서는 어디까지 했고 어디가 남았는지 알 수 없었습니다.
--   이 함수는 한 지점의 월별·제표별 상태를 한 번에 돌려줍니다(누가·언제 제출/저장했는지 포함).
--
-- 이 파일이 하는 일 (새 함수 1개만 "추가"합니다 — 테이블/기존 함수는 하나도 바꾸지 않습니다)
--   get_submission_overview(p_access_key, p_corp, p_office, p_from, p_to)
--
-- 상태(탭 하나 = 월 × 제표 1칸)와 우선순위
--   submitted : 제출되어 잠김 (acct_submission_lock)               → 누가(locked_by)·언제(locked_at)
--   draft     : 서버 임시저장이 있음 (acct_statement_drafts)       → 누가(saved_by)·언제(saved_at)
--                (잠긴 탭의 임시저장, 마지막 정식 제출보다 오래된 임시저장은 제외 — get_statement_drafts와 같은 규칙)
--   partial   : 저장된 금액(acct_statement_lines)은 있으나 아직 잠기지 않음 (예: PL(한국) 제출 도중 중단)
--   (그 외)    : 목록에 나오지 않음 = 미제출. 화면이 빈 칸을 "미제출"로 채웁니다.
--   한 칸에 여러 상태가 겹치면 submitted > draft > partial 순으로 하나만 돌려줍니다.
--
-- 사용법
--   Supabase 대시보드 > SQL Editor > "New query"(새 쿼리)에 이 파일 전체를 붙여넣고 Run.
--   (저장된 예전 쿼리를 다시 실행하지 마세요.) 여러 번 실행해도 안전합니다.
--   이 함수가 없으면 화면이 자동으로 예전의 "최근 3개월" 카드로 동작합니다(= 이 SQL이 스위치).
--   선행조건: 앞서 적용한 migration_2026-10_shared_drafts.sql (acct_statement_drafts 테이블 사용).
--   실행 뒤 test_submission_overview.sql로 점검하세요(DB에 아무것도 남기지 않음).
--
-- 권한: submit_statement 등과 같은 규칙. 접근키의 branch_scope / office_scope 가 있으면 자기 법인·지점만 봅니다.

create or replace function get_submission_overview(
  p_access_key text,
  p_corp text,
  p_office text,
  p_from text,
  p_to text
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

  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'invalid_payload';
  end if;

  return coalesce((
    with lines_agg as (
      select l.yearmonth, l.statement_type,
             max(l.submitted_at) as last_at,
             (array_agg(l.submitted_by order by l.submitted_at desc))[1] as actor
        from acct_statement_lines l
       where l.corp = v_corp and l.office = v_office and l.yearmonth between p_from and p_to
       group by l.yearmonth, l.statement_type
    ),
    locks as (
      select k.yearmonth, k.statement_type, 'submitted'::text as state, k.locked_by as actor, k.locked_at as ts
        from acct_submission_lock k
       where k.corp = v_corp and k.office = v_office and k.yearmonth between p_from and p_to
    ),
    drafts as (
      select d.yearmonth, d.statement_type, 'draft'::text as state, d.saved_by as actor, d.saved_at as ts
        from acct_statement_drafts d
        left join lines_agg a on a.yearmonth = d.yearmonth and a.statement_type = d.statement_type
       where d.corp = v_corp and d.office = v_office and d.yearmonth between p_from and p_to
         -- 마지막 정식 제출보다 오래된 임시저장은 낡은 것이라 제외
         and d.saved_at > coalesce(a.last_at, '-infinity'::timestamptz)
         and not exists (select 1 from locks k where k.yearmonth = d.yearmonth and k.statement_type = d.statement_type)
    ),
    partial_lines as (
      select a.yearmonth, a.statement_type, 'partial'::text as state, a.actor, a.last_at as ts
        from lines_agg a
       where not exists (select 1 from locks k where k.yearmonth = a.yearmonth and k.statement_type = a.statement_type)
         and not exists (select 1 from drafts d where d.yearmonth = a.yearmonth and d.statement_type = a.statement_type)
    ),
    merged as (
      select * from locks
      union all select * from drafts
      union all select * from partial_lines
    )
    select jsonb_agg(
             jsonb_build_object(
               'yearmonth', m.yearmonth,
               'statementType', m.statement_type,
               'state', m.state,
               'by', m.actor,
               'at', m.ts
             )
             order by m.yearmonth desc, m.statement_type
           )
      from merged m
  ), '[]'::jsonb);
end;
$$;

grant execute on function get_submission_overview(text, text, text, text, text) to anon, authenticated;

-- PostgREST가 새 함수를 바로 인식하도록 스키마 캐시를 갱신
notify pgrst, 'reload schema';
