-- 점검 스크립트: 회계관리 "월별 제출 현황표" (migration_2026-10_submission_overview.sql 실행 뒤에 돌립니다)
--
-- 이 스크립트는 운영 DB에 아무것도 남기지 않습니다.
--   - 이 실행 안에서만 존재하는 임시 접근키 2개(무작위)와 가짜 데이터(2098년 1~6월)로 함수를 점검하고,
--   - 맨 끝에서 일부러 오류를 내서 트랜잭션 전체를 롤백합니다.
-- 그래서 결과는 "오류 메시지"로 보입니다(정상입니다). 메시지 맨 위의
--   SELFTEST (N 개 통과 / M 개 실패)
-- 줄을 확인하세요. M이 0이면 정상입니다. 실패 줄이 있으면 메시지 전체를 그대로 전달해 주세요.
-- (Supabase의 "Debug with AI"가 이 오류를 고장으로 오해해 수정안을 제안해도 무시하세요.)
--
-- 사용법: Supabase SQL Editor의 "New query"(새 쿼리)에 붙여넣어 Run. (저장된 예전 쿼리를 재실행하지 마세요.)
-- 선행조건: migration_2026-10_shared_drafts.sql 과 migration_2026-10_submission_overview.sql 이 적용돼 있어야 합니다.

do $$
declare
  v_ka text := md5(random()::text || clock_timestamp()::text || 'a');
  v_kc text := md5(random()::text || clock_timestamp()::text || 'c');
  r jsonb;
  e jsonb;
  v_rep text := '';
  v_ok int;
  v_fail int;
begin
  -- 임시 접근키: A는 YJC 포워딩/상해, C는 다른 지점(닝보). 이 실행이 끝나면 롤백되어 사라진다.
  insert into access_keys (key_hash, label, role, branch_scope, office_scope) values
    (encode(digest(v_ka, 'sha256'), 'hex'), 'selftest-A', 'branch_yjc', 'YJC 포워딩', '상해'),
    (encode(digest(v_kc, 'sha256'), 'hex'), 'selftest-C', 'branch_yjc', 'YJC 포워딩', '닝보');

  -- ---- 가짜 데이터 (상해, 2098년) ----
  -- 2098-01 PL     : 제출·잠금
  insert into acct_submission_lock (corp, office, yearmonth, statement_type, locked_by)
  values ('YJC 포워딩', '상해', '2098-01', 'PL', 'selftest-A');
  -- 2098-02 PL_KR  : 서버 임시저장만 있음
  perform save_statement_draft(v_ka, 'YJC 포워딩', '상해', '2098-02', 'PL_KR', 'selftest-A', '{"values":{"500000":"1"}}'::jsonb);
  -- 2098-03 BS     : 금액만 저장되고 잠기지 않음
  insert into acct_statement_lines (corp, office, yearmonth, statement_type, account_code, amount_cny, submitted_by, submitted_at)
  values ('YJC 포워딩', '상해', '2098-03', 'BS', 'BS-L01', 1, 'selftest-L', now() - interval '1 hour');
  -- 2098-04 CF     : 잠금 + 임시저장 + 금액이 모두 겹침 → 제출 하나로만 나와야 함
  insert into acct_submission_lock (corp, office, yearmonth, statement_type, locked_by)
  values ('YJC 포워딩', '상해', '2098-04', 'CF', 'selftest-A');
  insert into acct_statement_lines (corp, office, yearmonth, statement_type, account_code, amount_cny, submitted_by, submitted_at)
  values ('YJC 포워딩', '상해', '2098-04', 'CF', 'CF-01', 1, 'selftest-A', now() - interval '1 hour');
  insert into acct_statement_drafts (corp, office, yearmonth, statement_type, payload, saved_by, saved_at, version)
  values ('YJC 포워딩', '상해', '2098-04', 'CF', '{"values":{}}'::jsonb, 'selftest-A', now(), 1);
  -- 2098-05 PL     : 금액보다 오래된(낡은) 임시저장 + 금액 → 임시저장이 아니라 "저장됨(미잠금)"으로 나와야 함
  insert into acct_statement_lines (corp, office, yearmonth, statement_type, account_code, amount_cny, submitted_by, submitted_at)
  values ('YJC 포워딩', '상해', '2098-05', 'PL', '500000', 1, 'selftest-A', now() - interval '1 hour');
  insert into acct_statement_drafts (corp, office, yearmonth, statement_type, payload, saved_by, saved_at, version)
  values ('YJC 포워딩', '상해', '2098-05', 'PL', '{"values":{}}'::jsonb, 'selftest-A', now() - interval '2 hours', 1);
  -- 2098-09 PL     : 조회 범위(1~6월) 밖
  insert into acct_submission_lock (corp, office, yearmonth, statement_type, locked_by)
  values ('YJC 포워딩', '상해', '2098-09', 'PL', 'selftest-A');
  -- 닝보 지점 2098-01 PL : 다른 지점 데이터
  insert into acct_submission_lock (corp, office, yearmonth, statement_type, locked_by)
  values ('YJC 포워딩', '닝보', '2098-01', 'PL', 'selftest-C');

  r := get_submission_overview(v_ka, 'YJC 포워딩', '상해', '2098-01', '2098-06');

  v_rep := v_rep || case when jsonb_array_length(r) = 5 then 'PASS ' else 'FAIL ' end
           || '1. 범위 안에서 5칸만 나온다(제출·임시저장·저장됨·제출·저장됨, 범위 밖/다른 지점 제외) → ' || jsonb_array_length(r) || '칸' || E'\n';

  v_rep := v_rep || case when r->0->>'yearmonth' = '2098-05' and r->4->>'yearmonth' = '2098-01' then 'PASS ' else 'FAIL ' end
           || '2. 최근 달부터 내림차순으로 정렬된다' || E'\n';

  select x into e from jsonb_array_elements(r) x where x->>'yearmonth' = '2098-01' and x->>'statementType' = 'PL';
  v_rep := v_rep || case when e->>'state' = 'submitted' and e->>'by' = 'selftest-A' and e->>'at' is not null then 'PASS ' else 'FAIL ' end
           || '3. 잠긴 탭은 submitted, 제출자·시각이 함께 나온다' || E'\n';

  select x into e from jsonb_array_elements(r) x where x->>'yearmonth' = '2098-02' and x->>'statementType' = 'PL_KR';
  v_rep := v_rep || case when e->>'state' = 'draft' and e->>'by' = 'selftest-A' then 'PASS ' else 'FAIL ' end
           || '4. 서버 임시저장만 있으면 draft, 저장자가 나온다' || E'\n';

  select x into e from jsonb_array_elements(r) x where x->>'yearmonth' = '2098-03' and x->>'statementType' = 'BS';
  v_rep := v_rep || case when e->>'state' = 'partial' and e->>'by' = 'selftest-L' then 'PASS ' else 'FAIL ' end
           || '5. 금액만 있고 잠기지 않았으면 partial' || E'\n';

  v_rep := v_rep || case when (select count(*) from jsonb_array_elements(r) x where x->>'yearmonth' = '2098-04' and x->>'statementType' = 'CF') = 1
                          and (select x->>'state' from jsonb_array_elements(r) x where x->>'yearmonth' = '2098-04' and x->>'statementType' = 'CF') = 'submitted'
                     then 'PASS ' else 'FAIL ' end
           || '6. 잠금·임시저장·금액이 겹쳐도 한 칸에 submitted 하나만 나온다' || E'\n';

  select x into e from jsonb_array_elements(r) x where x->>'yearmonth' = '2098-05' and x->>'statementType' = 'PL';
  v_rep := v_rep || case when e->>'state' = 'partial' then 'PASS ' else 'FAIL ' end
           || '7. 금액보다 오래된 임시저장은 draft가 아니라 partial로 나온다' || E'\n';

  v_rep := v_rep || case when not exists (select 1 from jsonb_array_elements(r) x where x->>'yearmonth' = '2098-09') then 'PASS ' else 'FAIL ' end
           || '8. 조회 범위 밖의 달은 나오지 않는다' || E'\n';

  -- 다른 지점 키(C)로 상해를 요청해도 자기 지점(닝보) 데이터만 나온다
  r := get_submission_overview(v_kc, 'YJC 포워딩', '상해', '2098-01', '2098-06');
  v_rep := v_rep || case when jsonb_array_length(r) = 1 and r->0->>'by' = 'selftest-C' then 'PASS ' else 'FAIL ' end
           || '9. 다른 지점 키는 자기 지점(닝보) 데이터만 보고 상해 데이터는 보이지 않는다' || E'\n';

  begin
    perform get_submission_overview('not-a-real-key', 'YJC 포워딩', '상해', '2098-01', '2098-06');
    v_rep := v_rep || 'FAIL 10. 틀린 키인데 조회됐다' || E'\n';
  exception when others then
    v_rep := v_rep || case when sqlerrm = 'invalid_access_key' then 'PASS ' else 'FAIL ' end
             || '10. 틀린 접근키는 거부(' || sqlerrm || ')' || E'\n';
  end;

  begin
    perform get_submission_overview(v_ka, 'YJC 포워딩', '상해', '2098-06', '2098-01');
    v_rep := v_rep || 'FAIL 11. 시작월이 끝월보다 뒤인데 거부되지 않았다' || E'\n';
  exception when others then
    v_rep := v_rep || case when sqlerrm = 'invalid_payload' then 'PASS ' else 'FAIL ' end
             || '11. 시작월이 끝월보다 뒤면 거부(' || sqlerrm || ')' || E'\n';
  end;

  r := get_submission_overview(v_ka, 'YJC 포워딩', '상해', '2097-01', '2097-12');
  v_rep := v_rep || case when r = '[]'::jsonb then 'PASS ' else 'FAIL ' end
           || '12. 데이터가 없는 기간은 빈 배열' || E'\n';

  v_fail := (length(v_rep) - length(replace(v_rep, 'FAIL ', ''))) / 5;
  v_ok := (length(v_rep) - length(replace(v_rep, 'PASS ', ''))) / 5;
  -- 일부러 오류를 내서 위의 모든 임시 데이터를 롤백한다
  raise exception E'SELFTEST (% 개 통과 / % 개 실패)\n%', v_ok, v_fail, v_rep;
end;
$$;
