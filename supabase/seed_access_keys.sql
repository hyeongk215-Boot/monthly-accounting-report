-- 테스트용 접근키 시드. schema.sql 실행 후 실행하세요.
-- ⚠ 아래 평문 키(TESTADMIN123 등)는 로컬/데모 테스트 전용입니다. 실제 배포 전 반드시
-- 새 키를 발급하고(admin.html 또는 SQL로 직접 access_keys에 insert) 이 시드는 지우거나 비활성화하세요.

-- 시스템관리자 (모든 법인, 계정과목 교체 등 최고 권한)
insert into access_keys (key_hash, label, role, branch_scope)
values (encode(digest('TESTADMIN123', 'sha256'), 'hex'), '테스트 시스템관리자', 'system_admin', null)
on conflict (key_hash) do nothing;

-- 본사 회계담당 (모든 법인 조회/마감/환율설정 가능, 계정과목 교체는 불가)
insert into access_keys (key_hash, label, role, branch_scope)
values (encode(digest('TESTFINANCE1', 'sha256'), 'hex'), '테스트 본사회계', 'finance', null)
on conflict (key_hash) do nothing;

-- 지점 담당 예시 (해당 법인의 모든 지점 데이터를 제출/조회 가능 - office_scope가 null)
insert into access_keys (key_hash, label, role, branch_scope) values
  (encode(digest('TESTYJC0001', 'sha256'), 'hex'), '테스트 YJC포워딩담당', 'branch_yjc', 'YJC 포워딩'),
  (encode(digest('TESTSHC0001', 'sha256'), 'hex'), '테스트 상해물류센터담당', 'branch_shanghai', '상해물류센터'),
  (encode(digest('TESTHAJ0001', 'sha256'), 'hex'), '테스트 흥아물류담당', 'branch_heunga', '흥아물류'),
  (encode(digest('TESTYFG0001', 'sha256'), 'hex'), '테스트 윤봉물류담당', 'branch_yunfeng', '윤봉물류'),
  (encode(digest('TESTQDC0001', 'sha256'), 'hex'), '테스트 청도CY담당', 'branch_qingdao', '청도 CY'),
  (encode(digest('TESTCXC0001', 'sha256'), 'hex'), '테스트 창씽CY담당', 'branch_changxing', '창씽 CY')
on conflict (key_hash) do nothing;

-- 지점(사무소) 단위로 더 좁게 스코프를 준 예시 - office_scope가 있으면 그 지점 데이터만 제출/조회 가능
insert into access_keys (key_hash, label, role, branch_scope, office_scope) values
  (encode(digest('TESTYJCSHA01', 'sha256'), 'hex'), '테스트 YJC포워딩-상해지점담당', 'branch_yjc', 'YJC 포워딩', '상해')
on conflict (key_hash) do nothing;
