-- 점검 스크립트: 회계관리 "서버 공유 임시저장" (migration_2026-10_shared_drafts.sql 실행 뒤에 돌립니다)
--
-- 이 스크립트는 운영 DB에 아무것도 남기지 않습니다.
--   - 이 실행 안에서만 존재하는 임시 접근키 3개(무작위)와 가짜 데이터(2099-12월)로 함수들을 점검하고,
--   - 맨 끝에서 일부러 오류를 내서 트랜잭션 전체를 롤백합니다.
-- 그래서 결과는 "오류 메시지"로 보입니다(정상입니다). 메시지 맨 위의
--   SELFTEST (N 개 통과 / M 개 실패)
-- 줄을 확인하세요. M이 0이면 정상입니다. 실패 줄이 있으면 메시지 전체를 그대로 전달해 주세요.
--
-- 사용법: Supabase SQL Editor의 "New query"(새 쿼리)에 붙여넣어 Run. (저장된 예전 쿼리를 재실행하지 마세요.)

do $$
declare
  ym constant text := '2099-12';   -- 실제 데이터와 겹치지 않는 가짜 달
  v_ka text := md5(random()::text || clock_timestamp()::text || 'a');
  v_kb text := md5(random()::text || clock_timestamp()::text || 'b');
  v_kc text := md5(random()::text || clock_timestamp()::text || 'c');
  r jsonb;
  v_rep text := '';
  v_ok int;
  v_fail int;
begin
  -- 임시 접근키: A·B는 같은 지점(YJC 포워딩/상해), C는 다른 지점(닝보). 이 실행이 끝나면 롤백되어 사라진다.
  insert into access_keys (key_hash, label, role, branch_scope, office_scope) values
    (encode(digest(v_ka, 'sha256'), 'hex'), 'selftest-A', 'branch_yjc', 'YJC 포워딩', '상해'),
    (encode(digest(v_kb, 'sha256'), 'hex'), 'selftest-B', 'branch_yjc', 'YJC 포워딩', '상해'),
    (encode(digest(v_kc, 'sha256'), 'hex'), 'selftest-C', 'branch_yjc', 'YJC 포워딩', '닝보');

  -- 1. A가 처음 저장
  r := save_statement_draft(v_ka, 'YJC 포워딩', '상해', ym, 'PL', 'selftest-A', '{"values":{"500000":"1000"}}'::jsonb);
  v_rep := v_rep || case when (r->>'ok')::boolean and (r->>'version')::int = 1 then 'PASS ' else 'FAIL ' end
           || '1. A가 처음 저장하면 ok, version 1' || E'\n';

  -- 2. B가 A의 임시저장을 본다 (같은 지점)
  r := get_statement_drafts(v_kb, 'YJC 포워딩', '상해', ym);
  v_rep := v_rep || case when jsonb_array_length(r) = 1 and r->0->>'savedBy' = 'selftest-A'
                          and (r->0->>'version')::int = 1 and r->0->'payload'->'values'->>'500000' = '1000'
                     then 'PASS ' else 'FAIL ' end
           || '2. B가 A의 임시저장을 본다(저장자 selftest-A, 값 1000)' || E'\n';

  -- 3. B가 본 version(1)을 기준으로 저장 → version 2
  r := save_statement_draft(v_kb, 'YJC 포워딩', '상해', ym, 'PL', 'selftest-B', '{"values":{"500000":"2000"}}'::jsonb, 1);
  v_rep := v_rep || case when (r->>'ok')::boolean and (r->>'version')::int = 2 then 'PASS ' else 'FAIL ' end
           || '3. B가 version 1을 보고 저장하면 ok, version 2' || E'\n';

  -- 4. A는 아직 version 1만 알고 있다 → 덮어쓰지 않고 충돌을 알려준다
  r := save_statement_draft(v_ka, 'YJC 포워딩', '상해', ym, 'PL', 'selftest-A', '{"values":{"500000":"3000"}}'::jsonb, 1);
  v_rep := v_rep || case when (r->>'conflict')::boolean and (r->'current'->>'version')::int = 2
                          and r->'current'->>'savedBy' = 'selftest-B'
                     then 'PASS ' else 'FAIL ' end
           || '4. A가 낡은 version 1로 저장하면 충돌(현재 version 2, 저장자 selftest-B)' || E'\n';

  r := get_statement_drafts(v_ka, 'YJC 포워딩', '상해', ym);
  v_rep := v_rep || case when r->0->'payload'->'values'->>'500000' = '2000' then 'PASS ' else 'FAIL ' end
           || '5. 충돌 때 B의 값(2000)이 그대로 남아 있다' || E'\n';

  -- 6. 강제로 덮어쓰기
  r := save_statement_draft(v_ka, 'YJC 포워딩', '상해', ym, 'PL', 'selftest-A', '{"values":{"500000":"3000"}}'::jsonb, 1, true);
  v_rep := v_rep || case when (r->>'ok')::boolean and (r->>'version')::int = 3 then 'PASS ' else 'FAIL ' end
           || '6. p_force=true 로 덮어쓰면 ok, version 3' || E'\n';

  -- 7. 다른 지점 키(C)는 상해의 임시저장을 볼 수 없다 (요청 지점이 자기 지점으로 강제됨)
  r := get_statement_drafts(v_kc, 'YJC 포워딩', '상해', ym);
  v_rep := v_rep || case when jsonb_array_length(r) = 0 then 'PASS ' else 'FAIL ' end
           || '7. 다른 지점 키(닝보)로는 상해 임시저장이 보이지 않는다' || E'\n';

  -- 8. 다른 지점 키(C)가 상해에 저장하려 하면 거부
  begin
    perform save_statement_draft(v_kc, 'YJC 포워딩', '상해', ym, 'PL', 'selftest-C', '{"values":{}}'::jsonb);
    v_rep := v_rep || 'FAIL 8. 다른 지점 키로 저장했는데 거부되지 않았다' || E'\n';
  exception when others then
    v_rep := v_rep || case when sqlerrm = 'unauthorized_office' then 'PASS ' else 'FAIL ' end
             || '8. 다른 지점 키로 저장하면 거부(' || sqlerrm || ')' || E'\n';
  end;

  -- 9. 틀린 접근키
  begin
    perform get_statement_drafts('not-a-real-key', 'YJC 포워딩', '상해', ym);
    v_rep := v_rep || 'FAIL 9. 틀린 키인데 조회됐다' || E'\n';
  exception when others then
    v_rep := v_rep || case when sqlerrm = 'invalid_access_key' then 'PASS ' else 'FAIL ' end
             || '9. 틀린 접근키는 거부(' || sqlerrm || ')' || E'\n';
  end;

  -- 10. 잘못된 본문 / 잘못된 제표 종류
  begin
    perform save_statement_draft(v_ka, 'YJC 포워딩', '상해', ym, 'PL', 'selftest-A', '[1,2]'::jsonb, 3);
    v_rep := v_rep || 'FAIL 10. 배열 본문이 거부되지 않았다' || E'\n';
  exception when others then
    v_rep := v_rep || case when sqlerrm = 'invalid_payload' then 'PASS ' else 'FAIL ' end
             || '10. 객체가 아닌 본문은 거부(' || sqlerrm || ')' || E'\n';
  end;
  begin
    perform save_statement_draft(v_ka, 'YJC 포워딩', '상해', ym, 'XX', 'selftest-A', '{"values":{}}'::jsonb, 3);
    v_rep := v_rep || 'FAIL 11. 없는 제표 종류가 거부되지 않았다' || E'\n';
  exception when others then
    v_rep := v_rep || case when sqlerrm = 'invalid_payload' then 'PASS ' else 'FAIL ' end
             || '11. 없는 제표 종류는 거부(' || sqlerrm || ')' || E'\n';
  end;

  -- 12. 너무 큰 본문
  begin
    perform save_statement_draft(v_ka, 'YJC 포워딩', '상해', ym, 'PL', 'selftest-A',
      jsonb_build_object('values', jsonb_build_object('x', repeat('a', 120000))), 3);
    v_rep := v_rep || 'FAIL 12. 너무 큰 본문이 거부되지 않았다' || E'\n';
  exception when others then
    v_rep := v_rep || case when sqlerrm = 'payload_too_large' then 'PASS ' else 'FAIL ' end
             || '12. 너무 큰 본문은 거부(' || sqlerrm || ')' || E'\n';
  end;

  -- 13. 이미 제출되어 잠긴 탭: 저장 거부 + 조회에서 숨김
  insert into acct_submission_lock (corp, office, yearmonth, statement_type, locked_by)
  values ('YJC 포워딩', '상해', ym, 'PL', 'selftest');
  begin
    perform save_statement_draft(v_ka, 'YJC 포워딩', '상해', ym, 'PL', 'selftest-A', '{"values":{}}'::jsonb, 3);
    v_rep := v_rep || 'FAIL 13. 잠긴 탭에 저장됐다' || E'\n';
  exception when others then
    v_rep := v_rep || case when sqlerrm = 'submission_locked' then 'PASS ' else 'FAIL ' end
             || '13. 잠긴 탭에는 저장 거부(' || sqlerrm || ')' || E'\n';
  end;
  r := get_statement_drafts(v_kb, 'YJC 포워딩', '상해', ym);
  v_rep := v_rep || case when jsonb_array_length(r) = 0 then 'PASS ' else 'FAIL ' end
           || '14. 잠긴 탭의 임시저장은 조회에서 숨겨진다' || E'\n';
  delete from acct_submission_lock
   where corp = 'YJC 포워딩' and office = '상해' and yearmonth = ym and statement_type = 'PL';

  -- 15. 마감된 달: 저장 거부
  insert into acct_closed_months (yearmonth, closed_by) values (ym, 'selftest');
  begin
    perform save_statement_draft(v_ka, 'YJC 포워딩', '상해', ym, 'PL', 'selftest-A', '{"values":{}}'::jsonb, 3);
    v_rep := v_rep || 'FAIL 15. 마감된 달에 저장됐다' || E'\n';
  exception when others then
    v_rep := v_rep || case when sqlerrm = 'month_closed' then 'PASS ' else 'FAIL ' end
             || '15. 마감된 달에는 저장 거부(' || sqlerrm || ')' || E'\n';
  end;
  delete from acct_closed_months where yearmonth = ym;

  -- 16. 낡은 임시저장(마지막 정식 제출보다 오래됨)은 숨겨지고, 새로 저장하면 충돌 없이 덮어쓴다
  update acct_statement_drafts set saved_at = now() - interval '2 hours'
   where corp = 'YJC 포워딩' and office = '상해' and yearmonth = ym and statement_type = 'PL';
  insert into acct_statement_lines (corp, office, yearmonth, statement_type, account_code, amount_cny, submitted_by, submitted_at)
  values ('YJC 포워딩', '상해', ym, 'PL', '500000', 1, 'selftest', now() - interval '1 hour');
  r := get_statement_drafts(v_kb, 'YJC 포워딩', '상해', ym);
  v_rep := v_rep || case when jsonb_array_length(r) = 0 then 'PASS ' else 'FAIL ' end
           || '16. 마지막 제출보다 오래된 임시저장은 숨겨진다' || E'\n';
  r := save_statement_draft(v_kb, 'YJC 포워딩', '상해', ym, 'PL', 'selftest-B', '{"values":{"500000":"7"}}'::jsonb);
  v_rep := v_rep || case when (r->>'ok')::boolean then 'PASS ' else 'FAIL ' end
           || '17. 낡은 임시저장 위에는 충돌 없이 새로 저장된다' || E'\n';
  r := get_statement_drafts(v_ka, 'YJC 포워딩', '상해', ym);
  v_rep := v_rep || case when jsonb_array_length(r) = 1 and r->0->'payload'->'values'->>'500000' = '7' then 'PASS ' else 'FAIL ' end
           || '18. 새로 저장하면 다시 보인다(값 7)' || E'\n';

  -- 19. 삭제: 다른 지점 키는 거부, 같은 지점 키는 삭제 가능
  begin
    perform delete_statement_draft(v_kc, 'YJC 포워딩', '상해', ym, 'PL');
    v_rep := v_rep || 'FAIL 19. 다른 지점 키로 삭제됐다' || E'\n';
  exception when others then
    v_rep := v_rep || case when sqlerrm = 'unauthorized_office' then 'PASS ' else 'FAIL ' end
             || '19. 다른 지점 키로 삭제하면 거부(' || sqlerrm || ')' || E'\n';
  end;
  perform delete_statement_draft(v_kb, 'YJC 포워딩', '상해', ym, 'PL');
  r := get_statement_drafts(v_ka, 'YJC 포워딩', '상해', ym);
  v_rep := v_rep || case when jsonb_array_length(r) = 0 then 'PASS ' else 'FAIL ' end
           || '20. 같은 지점 키로 삭제하면 사라진다' || E'\n';

  v_fail := (length(v_rep) - length(replace(v_rep, 'FAIL ', ''))) / 5;
  v_ok := (length(v_rep) - length(replace(v_rep, 'PASS ', ''))) / 5;
  -- 일부러 오류를 내서 위의 모든 임시 데이터를 롤백한다
  raise exception E'SELFTEST (% 개 통과 / % 개 실패)\n%', v_ok, v_fail, v_rep;
end;
$$;
