# Supabase 배포 방법 (회계관리)

관리부 ERP 4개 모듈(회계관리/예산관리/자금집행/실적분석) 전용 **별도 Supabase 프로젝트**를 씁니다
(접대비는 이미 운영 중인 별개 프로젝트를 그대로 유지 — 기술적으로 공유할 필요가 없어 분리했습니다).
테이블은 `acct_` 접두사를 써서 향후 다른 모듈과도 충돌하지 않습니다.

## 1. 테이블/함수 생성

1. Supabase 대시보드 → **SQL Editor → New query**
2. `schema.sql` 전체를 붙여넣고 **Run**.
   - `access_keys` 테이블과 `verify_access_key` 함수는 접두사가 없는 **공용** 객체입니다. 이미
     다른 모듈(예산관리 등)이 먼저 만들어 놓았다면 안전하게 재실행됩니다(`alter table ... add
     column if not exists` 패턴이라 데이터 손실 없음).
   - **v1(플레이스홀더 21개 계정, 법인 단일 레벨)을 이미 실행한 적이 있다면**, 이 v2 schema.sql을
     다시 실행해도 안전합니다 — `acct_statement_lines`에 `office` 컬럼이 추가되고 기존 행은
     `office=''`(빈 문자열)로 유지됩니다.
3. `seed_accounts.sql` 실행 — 실제 계정과목 70개(PL 16개 + BS 54개 + CF 플레이스홀더 4개)가
   들어가고, v1의 플레이스홀더 코드(PL-010~080, BS-010~090)는 자동으로 비활성화됩니다.
4. `seed_access_keys.sql` 실행 — 테스트용 접근키가 들어갑니다(법인 단위 키 + 지점 단위 키 예시 1개).
   **실제 운영 전 반드시 이 키들을 지우거나 새 키로 교체**하세요 (아래 "접근키 발급/교체" 참고).

> 보안 방식: `access_keys`/`acct_*` 테이블은 모두 RLS를 켜고 정책을 하나도 만들지 않았으므로 외부에서
> 직접 접근할 수 없습니다. 모든 읽기/쓰기는 SECURITY DEFINER 함수(RPC)를 통해서만 가능하고, 각 함수
> 내부에서 `verify_access_key`로 키를 검사한 뒤 role/branch_scope/office_scope에 따라 동작을 제한합니다.

## 2. 프론트엔드에 연결

`docs/js/config.js`에 1단계에서 만든 관리부 ERP 전용 프로젝트의 값을 넣습니다.

```js
SUPABASE_URL: "https://xxxxxxxx.supabase.co",   // 관리부 ERP 전용 프로젝트 (예산관리/자금집행/실적분석과 동일)
SUPABASE_ANON_KEY: "sb_publishable_...",         // Project Settings > API > Publishable key
```

## 3. 접근키 발급/교체 (법인 단위 / 지점 단위)

평문 키는 어디에도 저장되지 않고 sha256 해시만 `access_keys.key_hash`에 저장됩니다.

```sql
-- 법인 전체(모든 지점) 조회/제출 가능한 키
insert into access_keys (key_hash, label, role, branch_scope)
values (encode(digest('원하는평문키', 'sha256'), 'hex'), '설명', 'branch_yjc', 'YJC 포워딩');

-- 특정 지점만 조회/제출 가능한 키 (office_scope 추가)
insert into access_keys (key_hash, label, role, branch_scope, office_scope)
values (encode(digest('원하는평문키2', 'sha256'), 'hex'), '설명', 'branch_yjc', 'YJC 포워딩', '상해');
```

역할(role) 컨벤션:
- `system_admin` — 모든 법인/지점 + 계정과목 교체 등 최고 권한
- `finance` — 모든 법인/지점 조회/제출/마감/환율설정/법인통합조회 (계정과목 교체는 불가)
- `branch_<slug>` — `branch_scope`에 지정된 법인만, `office_scope`가 있으면 그 지점만 제출/조회 가능

키를 비활성화하려면 삭제 대신 `update access_keys set active = false where label = '...';` 를 권장합니다
(감사 이력 보존).

## 4. 데이터 확인

Supabase 대시보드 **Table Editor**에서 `acct_accounts`/`acct_exchange_rates`/`acct_statement_lines`/
`acct_closed_months`/`access_keys`를 직접 조회할 수 있습니다.

## 5. 계정과목(COA) 교체 시 주의사항 (중요)

`seed_accounts.sql`은 YJC 포워딩·상해물류센터의 실제 회계프로그램 리포트를 기준으로 확정한
계정과목입니다. 다른 법인이 다른 계정 체계를 쓴다면 admin.html의 "계정과목 관리" 패널에서
엑셀 업로드로 전체 교체할 수 있습니다 (`replace_accounts` RPC, system_admin 키 필요).

**단, 계정코드를 바꾸면 다음 모듈들도 함께 갱신해야 합니다** (해당 모듈이 특정 코드를 하드코딩으로
참조하기 때문):
- 자금집행 `get_dividend_available` — 이익잉여금 코드(현재 `BS-R67`)
- 실적분석 `get_profitability_series`/`get_stability_series`/`get_budget_variance_summary`/
  `get_performance_aggregate` — 매출액(`500000`)/영업이익(`799999`)/당기순이익(`999999`)/
  유동자산합계(`BS-L18`)/자산총계(`BS-L36`)/유동부채합계(`BS-R52`)/부채합계(`BS-R58`)/
  자본총계(`BS-R68`) 코드

각 모듈의 `supabase/README-deploy.md`에도 동일 안내가 있습니다.

## 6. 전용 파서 적용 범위

`docs/js/common.js`의 `parseStandardPlReport`/`parseStandardBsReport`는 YJC 포워딩·상해물류센터가
공유하는 회계프로그램의 PL.xls/BS.xls 내보내기 형식 전용입니다. 다른 법인이 다른 회계프로그램을
쓴다면 그 법인만을 위한 별도 파서를 추가로 만들어야 합니다 (이번 범위 밖).
