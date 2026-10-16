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
4. 접근키 발급 — `seed_access_keys.sql`은 **평문 키가 없는 템플릿**입니다(전부 주석이라 그대로 실행해도
   아무것도 들어가지 않습니다). 새 DB를 세팅할 때는 아래 "접근키 발급/교체" 섹션대로 임의 키를 직접
   만들어 넣으세요. ⚠ 이 저장소는 공개입니다. 실제 키를 파일로 만들어 커밋하지 마세요.

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

## 7. 서버 공유 임시저장 (2026-10)

예전의 "임시저장"은 그 PC 브라우저(localStorage)에만 저장돼, 같은 지점의 다른 담당자(다른 PC)는 제출 전
입력을 볼 수 없었습니다. 이 기능은 임시저장을 서버에 두어 같은 지점 키로 들어온 누구나 이어서 입력/확인할 수
있게 합니다. 임시저장은 정식 데이터(`acct_statement_lines`)와 **완전히 분리된** 별도 테이블
`acct_statement_drafts`에 저장되므로 합병 재무제표·실적분석·본사 제출현황에는 섞이지 않습니다.

**배포 (사용자가 SQL을 한 번 실행)**
1. SQL Editor → **New query** → `migration_2026-10_shared_drafts.sql` 전체를 붙여넣고 Run.
   새 테이블 1개 + 새 함수 3개만 "추가"하며 기존 테이블/함수는 건드리지 않습니다. 여러 번 실행해도 안전합니다.
2. (선택) 새 쿼리에 `test_shared_drafts.sql`을 붙여넣고 Run. 20개 항목을 점검한 뒤 일부러 오류를 내서
   전부 롤백하므로 DB에는 아무것도 남지 않습니다. 결과는 오류 메시지로 보이며 맨 위의
   `SELFTEST (20 개 통과 / 0 개 실패)`가 정상입니다.
3. 이 SQL이 "스위치"입니다. 함수가 없으면 화면이 자동으로 예전 방식(이 PC에만 저장)으로 동작하고,
   함수가 생기면 그때부터 서버 공유로 바뀝니다. 되돌리려면 `drop function get_statement_drafts(text,text,text,text);`
   만 실행해도 화면이 예전 방식으로 돌아갑니다(저장된 임시저장 데이터는 `acct_statement_drafts`에 남음).

**동작 규칙**
- 입력 3초 뒤 자동 저장 + 「임시저장」 버튼은 즉시 저장. 다른 담당자가 먼저 저장했으면 덮어쓰지 않고
  "서버 저장본 불러오기 / 내 입력으로 덮어쓰기" 중에서 고르게 합니다(저장 시 내가 마지막으로 본 version을 함께 보냄).
- 제출하면 그 탭의 임시저장은 삭제됩니다. 이미 제출되어 잠긴 탭의 임시저장, 그리고 "마지막 정식 제출보다
  오래된" 임시저장은 조회에서 숨겨져 제출된 값을 가리지 못합니다.
- 마감된 달·잠긴 탭에는 저장할 수 없습니다(`system_admin`/`finance`는 잠금과 무관, 제출 규칙과 동일).
- 접근키의 `branch_scope`/`office_scope` 범위를 그대로 따릅니다(다른 지점 임시저장은 보이지도 저장되지도 않음).

## 8. 월별 제출 현황표 (2026-10)

입력 화면(`submit.html`) 맨 위 카드는 예전에 "최근 3개월 미제출"만 보여줬습니다. 2024~2026년 자료를 소급해서
입력하는 기간에는 어디까지 했고 어디가 남았는지 알 수 없어, 한 지점의 **월 × 제표 4종(PL / PL(한국) / BS / CF)**
제출 상태를 한 표로 보여주는 현황표를 추가했습니다. 각 칸에는 상태와 함께 누가·언제 제출(또는 저장)했는지가 나옵니다.

| 상태 | 의미 | 근거 |
|---|---|---|
| ✅ 제출 | 제출되어 잠김 | `acct_submission_lock` (누가 `locked_by` · 언제 `locked_at`) |
| ✏️ 작성 중 | 서버 임시저장만 있음 | `acct_statement_drafts` (`saved_by` · `saved_at`). 7절과 같은 규칙으로 낡은/잠긴 탭의 임시저장은 제외 |
| ⚠ 제출 미완료 | 저장된 금액은 있으나 잠기지 않음 (제출 도중 중단, 또는 본사가 잠금을 푼 경우) | `acct_statement_lines`만 있음 |
| 🔒 마감 | 마감된 달이고 제출 안 됨 | `acct_closed_months` — 지점이 할 수 있는 일이 없으므로 집계에서 제외 |
| 미제출 | 위 어디에도 없음 | |

한 칸에 여러 상태가 겹치면 제출 > 작성 중 > 제출 미완료 순으로 하나만 보입니다. 칸을 누르면 그 달·그 표의 입력 화면으로 이동하고,
"다음 할 일" 버튼은 가장 오래된 미제출 칸으로 바로 보내 줍니다. 조회 범위는 시스템 시작월(2024-01)부터 전월까지입니다.

**배포 (사용자가 SQL을 한 번 실행)**
1. 선행조건: 7절의 `migration_2026-10_shared_drafts.sql`이 이미 적용돼 있어야 합니다(`acct_statement_drafts` 사용).
2. SQL Editor → **New query** → `migration_2026-10_submission_overview.sql` 전체를 붙여넣고 Run.
   새 함수 `get_submission_overview` 1개만 "추가"하며 테이블/기존 함수는 건드리지 않습니다. 여러 번 실행해도 안전합니다.
3. (선택) 새 쿼리에 `test_submission_overview.sql`을 붙여넣고 Run. 12개 항목을 점검한 뒤 일부러 오류를 내서
   전부 롤백하므로 DB에는 아무것도 남지 않습니다. 결과는 오류 메시지로 보이며 맨 위의
   `SELFTEST (12 개 통과 / 0 개 실패)`가 정상입니다.
4. 이 SQL이 "스위치"입니다. 함수가 없으면 화면이 자동으로 예전의 "최근 3개월" 카드로 동작하고(처음 한 번만 확인하고 다시 묻지 않음),
   함수가 생기면 그때부터 현황표로 바뀝니다. 되돌리려면 `drop function get_submission_overview(text,text,text,text,text);`
   만 실행하면 됩니다(데이터는 건드리지 않음).

**권한**: `submit_statement` 등과 같은 규칙입니다. 접근키의 `branch_scope`/`office_scope`가 있으면 자기 법인·지점만 조회됩니다.

**화면 쪽 부수 보강** (같은 배포에 포함)
- 달을 옮기기 전에, 아직 저장되지 않은 입력(0.6초 자동저장 대기분)을 먼저 저장하고 서버에 못 올린 임시저장은 즉시 올립니다.
  (이전에는 입력 직후 다른 달로 옮기면 입력이 사라지거나 옮긴 달 이름으로 저장될 수 있었습니다.)
- 서버 저장 응답이 오기 전에 다른 달로 옮겨도, 응답이 새 달의 화면 상태(저장됨 표시·충돌 안내)를 덮어쓰지 않습니다.
- 달을 빠르게 연달아 옮길 때 늦게 도착한 옛 달의 응답이 화면을 덮어쓰지 않습니다.
- SQL 미적용 상태에서는 제출 직후 "최근 3개월" 카드도 새로 고쳐집니다(이전에는 새로고침 전까지 그대로였음).
