# 인수인계 — 4인치 모형 웨이퍼 검사 웹 콘솔 (2026-11-14 기준)

다음 작업자가 바로 이어서 일할 수 있게 지금까지 한 일, 막힌 곳, 남은 일을 정리한 문서다.
기준 요구사항은 「BAZE 개발 지시서 — 4인치 모형 웨이퍼 검사·분류」(2026-11-13,
`BAZE_Wafer_Inspection_Build_Brief_4inch.md`)이다.

- 저장소가 공개라 지시서는 GitHub에 올리지 않았다. 사용자에게 받는다.
- BAZE 프로젝트 안에서는 `.baze-files/outputs/`에 사본이 있다.
- 이 문서와 지시서가 다르면 지시서와 2장의 사용자 결정을 따른다.

## 0. 한눈에

- 끝난 것: 검사 콘솔, 시험 모드(가상 장치), 기준 사진 등록, 판정·기록·CSV, 인쇄용 시편, 문서 5종. 시험은 모두 통과했고 GitHub `main`에 올라가 있다.
- 남은 큰 일: 지시서 11장의 **Supabase 팀 로그인·공유 저장**. Supabase 프로젝트만 만들어져 있다. 표·버킷·코드는 아직 없다.
- 지금 막힌 것: BAZE의 Supabase 연결 토큰에 쓰기 권한이 없다. 환경 변수 두 값(DB 비밀번호, 공개용 키)도 잘못 들어가 있다. **사용자가 두 값을 고친 뒤에 시작한다** (5-1).
- 실물 작업(펌웨어 대조, 실제 카메라 재촬영, PLC·Uno·기구 통합)은 장치가 있어야 한다 (5-6).

## 1. 저장소·실행

- GitHub: https://github.com/1213ghgo-kimdy1217/semiconductor-meister-highschool (공개)
  - 앱 코드의 마지막 변경은 `main`의 커밋 `1efe2b5`(2026-11-14)다. 그 뒤 커밋은 이 문서와 `AGENTS.md` 메모뿐이다.
  - `.baze-files/`(BAZE 파일 보관함, 지시서 사본이 있음)는 커밋하지 않는다.
- 기술: Vite 7 · React 19 · TypeScript 5.9 · Tailwind 4 · react-router 7 · idb 8.
  - `@supabase/supabase-js ^2.119.0`은 의존성에만 있고 코드에서 아직 쓰지 않는다.
  - 서버(Worker) 코드가 없는 정적 앱이다.
- 명령
  - `npm ci`
  - `npm run dev` (포트 5173, `--host 0.0.0.0`)
  - `npm test` (vitest, 59개)
  - `npm run typecheck`
  - `npm run build` (타입 검사 + `dist/`)
  - 브라우저 시나리오: 개발 서버를 켠 상태에서 `npm i --no-save playwright && npx playwright install chromium && node tests/e2e/sim-flow.cjs` (25개). 개발 빌드에만 있는 `window.__station`을 읽으므로 개발 서버에서만 돈다.
- 카메라와 USB(Web Serial)는 HTTPS 또는 localhost의 Chrome·Edge에서만 동작한다.
- 기존 SemiGuard 교육 사이트(별도 저장소 `semiguard-ai`)는 다른 프로젝트다. 건드리지 않는다.

## 2. 바꾸면 안 되는 규칙 (지시서 + 사용자 결정)

1. 웹은 촬영·판정·결과(OK/NG)·CAPTURE_FAILED 전달만 한다. 이동·운전·정지·복구·수거 확인은 PLC/HMI가 맡는다. 웹에 운전 버튼을 만들지 않는다.
2. HOLD·판정 불확실·장치 실패에서 자동 NG·방출·복구·재개를 하지 않는다. 판정이 불확실하면 보내지 않고 장치의 60초 시간 초과에 맡긴다.
3. Uno 규약 V1(`PROTOCOL.md`)이 이전 제안(C/A/E)을 대체한다.
   - RESULT 값은 OK/NG뿐이다. HOLD·UNKNOWN·점수·사진·버전 필드를 붙이지 않는다.
   - 점수와 검사기 버전은 웹과 Supabase에만 기록한다.
4. Supabase 행 변경이나 Realtime 메시지를 장치 명령 큐로 쓰지 않는다.
5. DB 장애가 판정·결과 전송 경로를 멈추면 안 된다.
   - 로컬에 먼저 저장하고 업로드는 뒤에서 한다.
   - 실패하면 IndexedDB 대기열에 두고 다시 시도하며, 그 상태를 화면에 보인다.
6. 브라우저에는 publishable key만 쓴다. secret(`sb_secret_…`)과 service_role 키는 브라우저·번들·GitHub·채팅 어디에도 넣지 않는다. 이미지 버킷은 비공개(private)에 소유자 정책을 둔다.
7. 시험 모드는 실제 포트를 열지 않고 PLC 판정 신호도 내보내지 않는다. 시험 기록은 실제 통계와 따로 집계한다.
8. 실제 반도체 미세 결함 검사 성능을 주장하지 않는다. 확인하지 않은 하드웨어 값은 지어내지 않고 `HARDWARE_VALUES.md`에 빈칸으로 둔다.
9. 교정 전에는 실제 운전을 잠가 둔다. 펌웨어 대조 대상은 `arduino/Wafer_Two_Gate_PLC/controller.h`다.
10. 카메라, 영상 비교, 통신 파서, 상태 전이, DB 저장을 한 컴포넌트에 몰아넣지 않는다.
11. 사용자 결정: 팀 로그인·기록 공유는 Supabase로 하고, 인쇄용 시편은 앱에서 만든다(완료).
    - 로그인은 팀이 함께 쓰는 계정 하나(이메일+비밀번호)로 여러 PC가 같은 기록을 보는 방식으로 제안했다.
    - 지시서의 "소유 행만" 규칙은 그대로 지킨다.

## 3. 지금까지 한 것

### 화면

- `/` 검사 콘솔
  - 상단 네 칸: 카메라 · Uno USB · PLC 요청/운전 허가 · 기록 저장
  - 실시간 영상과 ROI, 공정 단계, 마지막 판정과 근거, 최근 10개 기록과 집계
  - 작업자 버튼: 카메라 연결 · 장치 연결 · 기준 사진 등록 · 검사만 시험 · 기록 내보내기(CSV)
- 상단 「시험 모드」: 가상 카메라·Uno·PLC·HMI·작업대. 실제 포트를 열지 않는다.
- `/print` 인쇄용 시편: 정상 A, 불량 A(권장)·B·C. A4 실제 크기로 인쇄하거나 SVG로 받는다. 자르는 원은 지름 101.6mm이고, 시편 안에는 글자와 QR이 없다.

### 코드 구조 (`src`)

| 위치 | 하는 일 |
|---|---|
| `core/camera` | 실제·가상 카메라, 프레임 |
| `core/vision` | 정렬·마스크·기준 비교·판정(`analyze.ts`) |
| `core/protocol` | Uno 규약 V1 줄 파서·링크(`v1.ts`, `link.ts`, `linebuffer.ts`) |
| `core/transport` | 실제 시리얼과 가상 장치(같은 인터페이스) |
| `core/station/cycle.ts`, `core/process/flow.ts`, `core/inspect/runner.ts` | 검사 요청 하나의 상태 전이 |
| `core/store` | IndexedDB 저장(`local.ts`), 자료형(`types.ts`), CSV |
| `core/specimen` | 인쇄 시편 생성 |
| `app/station.ts` | 앱 상태와 기록 흐름 (약 700줄) |
| `app/useStation.ts` | React 연결 |
| `ui/console/*` | 화면 조각 (`TopBar`, `RecordsPanel` 등) |
| `pages/*` | 화면 (`Console`, `PrintSpecimens`) |

### 브라우저 저장 (이 PC에만)

- IndexedDB 이름 `wafer-inspection-4inch`, 버전 1. 저장소 세 개:
  - `kv`: 카메라별 설정, 고른 카메라(`camera:choice`) 등
  - `records`: keyPath `id`, 색인 `byTime`(requestedAt)
  - `events`: autoIncrement, 색인 `byRecord`(recordId)
- `local.ts`는 쓰기를 내부 대기열로 묶는다. 같은 kv 키 쓰기는 합친다.
- 기록 자료형은 `core/store/types.ts`에 있다.
  - `InspectionRecord`: mode(`live`/`sim`/`check`), session·cycle·capture, verdict(OK/NG/HOLD), PLC 전달 상태, 분기, 배출 종료(`released`), 실물 수거 확인(`collectionConfirmed`, 웹은 알 수 없어 항상 false), 96px 회색 PNG 썸네일 등
  - `StoredEvent`
  - `ProfileSettings`: ROI·기준값·기준 버전·기준 사진(`pixels`는 휘도 `Uint8Array`)
- 기록 `id`는 `crypto.randomUUID()`다.
- `session`은 포트를 열 때마다 새로 정하는 난수(1 ~ 2^31−1)다. `cycle`은 Uno가 발행하고, `capture`는 세션 안에서 1부터 늘어난다.

### 문서

- `PROTOCOL.md`: 웹이 구현한 Uno 규약 V1. 10장은 펌웨어 대조표다.
- `COMMISSIONING.md`: 0~10단계 시운전 순서
- `HARDWARE_VALUES.md`: 미확정 실물 값 빈칸
- `TEST_RESULTS.md`: 검증 범위와 결과
- `README.md`, `.env.example`, `AGENTS.md`(다음 작업자 메모)

### 시험 (2026-11-14)

- 단위 시험 59/59, 타입 검사, 빌드 통과
- 시험 모드 브라우저 시나리오 25/25 통과, 콘솔 오류 없음
- 실제 카메라·장치 시험은 하지 않았다 (장치 없음).

## 4. Supabase 현재 상태

### 프로젝트

| 항목 | 값 |
|---|---|
| 이름 | `wafer-inspection-4inch` (사용자가 대시보드에서 직접 만듦) |
| ref / URL | `ebrpuysakbfjjnjwesjh` / `https://ebrpuysakbfjjnjwesjh.supabase.co` |
| 지역 | `ap-southeast-2` (호주 시드니). 대시보드에 서울이 없어 Asia-Pacific을 고른 결과다. 업로드는 뒤에서 하므로 판정 속도에는 영향이 없다. |
| 상태 | ACTIVE_HEALTHY, Postgres 17, 무료 요금제 조직 |
| DB 접속 | 풀러 `aws-0-ap-southeast-2.pooler.supabase.com`, 5432(session)·6543(transaction), 사용자 `postgres.ebrpuysakbfjjnjwesjh`. 직접 주소 `db.<ref>.supabase.co`는 IPv6 전용이라 BAZE 샌드박스에서는 쓸 수 없다. 풀러 두 포트는 열려 있음을 확인했다. |
| 만들어진 것 | Storage 버킷 0개(확인). 표와 Auth 사용자는 새 프로젝트라 없을 것이다(SQL 권한이 없어 직접 확인은 못 함). |
| Auth 설정 | 읽을 권한이 없어 확인하지 못했다. 대시보드에서 확인할 것 (5-1). |

### BAZE의 Supabase 연결 토큰 (`SUPABASE_ACCESS_TOKEN`)

다시 연결(2026-11-14)한 뒤에도 결과가 같았다.

- 되는 것: 프로젝트 목록, 조직 정보, Storage 버킷 목록, 풀러 설정 읽기
- 안 되는 것 (403):
  - 프로젝트 만들기 `organization_projects_create`
  - SQL 실행 `database:write`
  - API 키 읽기 `api_gateway_keys_read`
  - Auth 설정 읽기 `auth_config_read`
- 그래서 `supabase db push`나 Management API로는 표를 만들 수 없다. **DB 비밀번호로 풀러에 직접 붙어서** 만든다.
- 이 토큰은 만료되며 게시 앱에는 들어가지 않는다.

### 환경 변수 (BAZE 「설정 > 환경 변수」)

| 이름 | 용도 | 상태 |
|---|---|---|
| `SUPABASE_DB_PASSWORD` | 작업자가 마이그레이션·RLS 시험에 쓰는 DB 접속용. 앱에는 넣지 않는다. | ❌ 현재 값이 틀림 |
| `SUPABASE_PUBLISHABLE_KEY` | 브라우저가 쓸 공개용 키 (`sb_publishable_…`) | ❌ 현재 값이 틀림 |

- 처음 넣을 때 카드에서 생성된 임의 값(둘 다 40자)이 들어간 것으로 보인다. 어느 쪽도 이 프로젝트의 API 키나 DB 비밀번호로 통하지 않았다.
- 값을 확인할 때는 **일부도 출력하지 말고** 맞음/틀림만 출력한다 (6장 예시).

### 키 다루는 방법 (정한 것)

- BAZE 안에서는 값을 파일에 쓰지 않는다(플랫폼 규칙).
  - 개발 서버(`vite.config.ts`의 `configureServer` / `configurePreviewServer` 미들웨어)가 `process.env`에서 URL과 공개용 키를 읽는다. 이것을 `/api/cloud-config` 같은 경로로 브라우저에 넘긴다.
  - 서버 쪽에서 키 모양을 검사한다. `sb_secret_`로 시작하거나 role이 service_role인 JWT면 거부한다.
- 지금 떠 있는 미리보기 개발 서버(09:13 시작)는 이 환경 변수를 모른다. 위 코드를 넣은 뒤 한 번 다시 띄워야 한다. BAZE 안이면 `preview-server` 스킬의 `stop-bg` / `serve-bg`를 쓴다.
- BAZE 밖(로컬 PC)에서는 `.env.local`(`.gitignore`에 포함)의 `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY`를 읽어도 된다. 코드가 두 방법을 다 받게 하면 좋다. 커밋은 금지다.
- 게시(BAZE 호스팅 등)할 때는 같은 경로를 서버가 환경 변수로 응답해야 한다. 아직 게시하지 않았다.

## 5. 앞으로 할 일 (순서대로)

### 5-1. 사용자가 먼저 할 일

1. BAZE 「설정 > 환경 변수」에서 두 값을 고친다.
   - `SUPABASE_DB_PASSWORD`: 프로젝트 DB 비밀번호. 모르면 Supabase의 Project Settings → Database → Reset database password에서 새로 만든다.
   - `SUPABASE_PUBLISHABLE_KEY`: Project Settings → API Keys의 Publishable key (`sb_publishable_…`)
2. Supabase 대시보드 Authentication → Users → Add user → Create new user에서 팀 계정을 만든다.
   - 이메일과 비밀번호를 넣고 Auto Confirm User를 켠다.
   - 비밀번호는 팀만 알고, 작업자나 채팅에는 주지 않는다.
3. (권장) Authentication → Sign In / Providers에서 확인한다.
   - Email 로그인이 켜져 있는지 본다.
   - 새 가입(Allow new users to sign up)을 끈다. 저장소가 공개라 URL과 공개용 키는 누구나 볼 수 있기 때문이다.
   - 익명 로그인이 꺼져 있는지 본다.
   - 작업자 토큰은 Auth 설정 권한이 없어서 이 단계는 사용자가 해야 한다. 대시보드 문구는 바뀌었을 수 있다.

### 5-2. 데이터베이스 (작업자)

- 마이그레이션은 `supabase/migrations/<타임스탬프>_init.sql`로 커밋한다.
- 풀러로 적용한다: `supabase db push --db-url …` 또는 node `pg`.
- 접속 문자열은 명령 안에서 환경 변수로 조립한다. 출력하거나 파일에 쓰지 않는다. 비밀번호에 특수문자가 있으면 URL 인코딩한다.
- 아래는 **초안이다. 아직 한 번도 실행하지 않았으니** 검토한 뒤 쓴다.

```sql
-- 설정: 카메라 프로필(real/virtual)마다 한 행
create table public.settings (
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  camera_id text not null check (camera_id in ('real', 'virtual')),
  roi jsonb not null,
  calibration_version integer not null,
  thresholds jsonb not null,
  refs jsonb not null default '{}'::jsonb,           -- 기준 사진 메타데이터, 이미지는 버킷 경로
  updated_at timestamptz not null default now(),
  primary key (owner_id, camera_id)
);

-- 검사: 브라우저 기록 하나 = 한 행. id는 브라우저 기록 id(randomUUID)를 그대로 쓴다.
create table public.inspections (
  id uuid primary key,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  device_session bigint,                               -- 검사만 시험(check)이면 null
  cycle_id bigint,
  capture_id bigint,
  mode text not null check (mode in ('live', 'sim', 'check')),
  verdict text not null check (verdict in ('OK', 'NG', 'HOLD')),
  hold_reason text,
  method text not null,
  version text not null,
  calibration_version integer not null,
  scores jsonb,
  capture_time timestamptz,                            -- firstFrameAt
  decision_time timestamptz,                           -- decidedAt
  requested_at timestamptz not null,
  image_path text,                                     -- <owner_id>/inspections/<id>.png
  plc_result_state text not null,                      -- PlcState 값 그대로
  plc_detail text,
  route text check (route in ('OK', 'NG')),
  released boolean not null default false,
  collection_confirmed boolean not null default false,
  fault_code text,
  closed_why text,
  expected text,
  camera text,
  camera_label text,
  attempts integer not null default 0,
  trail jsonb not null default '[]'::jsonb,
  frame_ids jsonb not null default '[]'::jsonb,
  local_updated_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (owner_id, device_session, cycle_id, capture_id)  -- null은 서로 다르게 취급되어 check 기록은 겹치지 않음
);
create index inspections_owner_created_idx on public.inspections (owner_id, created_at desc);

-- 이벤트: 브라우저마다 device_id 하나 + IndexedDB 자동 번호로 중복 방지
create table public.events (
  id bigint generated always as identity primary key,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  inspection_id uuid references public.inspections (id) on delete set null,  -- 검사 행이 먼저 올라가야 함
  device_id uuid not null,
  local_event_id bigint not null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null,
  unique (owner_id, device_id, local_event_id)
);
create index events_owner_created_idx on public.events (owner_id, created_at desc);

alter table public.settings enable row level security;
alter table public.inspections enable row level security;
alter table public.events enable row level security;
revoke all on public.settings, public.inspections, public.events from anon;
grant select, insert, update on public.settings, public.inspections, public.events to authenticated;

-- 세 표 모두 같은 세 정책: 로그인한 본인 행만 SELECT/INSERT/UPDATE. DELETE 정책은 만들지 않는다.
create policy settings_select_own on public.settings for select to authenticated
  using (owner_id = (select auth.uid()));
create policy settings_insert_own on public.settings for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy settings_update_own on public.settings for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
-- inspections_*, events_* 도 이름만 바꿔 똑같이 만든다.
-- (선택) 익명 로그인을 막으려면 조건에 and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false 추가

-- 비공개 이미지 버킷 + 소유자 폴더 정책 (경로 첫 폴더 = 사용자 id)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('inspection-images', 'inspection-images', false, 2097152, array['image/png', 'image/jpeg'])
on conflict (id) do nothing;
create policy images_select_own on storage.objects for select to authenticated
  using (bucket_id = 'inspection-images' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy images_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'inspection-images' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy images_update_own on storage.objects for update to authenticated
  using (bucket_id = 'inspection-images' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'inspection-images' and (storage.foldername(name))[1] = (select auth.uid())::text);
```

### 5-3. 앱 코드 (작업자)

**구조**

- 새 모듈은 `src/core/cloud/`에 둔다 (설정 받기, 클라이언트, 대기열, 동기화, 자료 변환).
- 화면은 `src/ui/console/`에 둔다 (로그인 패널, 저장 상태).
- `station.ts`에는 "저장했음 → 대기열에 넣기" 같은 좁은 인터페이스만 연결한다.

**저장 흐름**

- 로컬 IndexedDB에 먼저 저장하고, 대기열(outbox)에 넣은 뒤, 뒤에서 업로드한다.
- 판정과 결과 전송 경로에서는 업로드를 `await`하지 않는다.
- IndexedDB 버전을 1에서 2로 올리고 `outbox` 저장소를 추가한다. 기존 `kv`·`records`·`events`는 그대로 남는지 이관 시험을 한다.

**업로드**

- `inspections`: upsert (`on_conflict=id`). 같은 기록이 여러 번 갱신되면 대기열에서 최신 상태 하나로 합친다.
- `events`: 중복 무시 insert (`owner_id, device_id, local_event_id`). 그 기록의 검사 행 다음에 올린다.
- `settings`: upsert (`owner_id, camera_id`).

**재시도와 상태 표시**

- 지수 백오프로 다시 시도한다 (예: 2초 → 최대 5분, 지터). `online` 이벤트와 화면이 다시 보일 때 즉시 재개한다.
- 오류를 나눈다: 네트워크 / 401 로그인 만료 / 403 정책 거부 / 409 충돌 / 스키마 불일치.
- 상단 「기록 저장」 칸에 상태를 보인다. 한국어 해요체로 쓴다.
  - 이 PC에만 저장 (로그인 전)
  - 팀 저장 대기 N건
  - 저장 실패 · 다시 시도 중 (이유)
  - 모두 저장됨 (시각)
- 로그인한 이메일과 로그아웃 버튼을 둔다. 앱에는 가입 화면을 두지 않는다 (계정은 대시보드에서 만든다).

**이미지**

- 썸네일(96px 회색 PNG data URL)은 비공개 버킷 `inspection-images/<owner_id>/inspections/<id>.png`에 올리고 `image_path`를 채운다.
- 기준 사진(`StoredReference.pixels`, 휘도 배열)은 PNG로 바꿔 `<owner_id>/refs/<camera>/<kind>-v<calibrationVersion>.png`에 올린다. `settings.refs`에는 메타데이터만 둔다.

**mode**

- 시험 모드와 검사만 시험 기록도 `mode`로 구분해 올린다. 화면 집계는 지금처럼 mode별로 나눈다.

**사용자와 정할 것**

- 로그인 전에 쌓인 이 PC 기록을 로그인 뒤 올릴지 (백필)
- 다른 PC의 기록을 보는 「팀 기록」 목록과 CSV를 만들지. 지금 화면은 이 PC의 최근 10개만 보인다. 만든다면 `(owner_id, created_at)` 색인으로 페이지 단위로 읽는다.
- 두 PC가 기준 사진을 따로 등록했을 때 어느 쪽을 쓸지. 예: `calibration_version`이 큰 쪽을 쓰고 사용자에게 알림.

**주의**

- 로그아웃 상태에서 쌓인 대기열은 다음에 로그인한 계정으로 올라간다. 대기열 항목에 의도한 계정을 적거나, 로그인할 때 확인한다.
- Realtime은 쓰지 않는다. 쓰더라도 표시용으로만 쓰고 장치 명령에는 절대 쓰지 않는다.

### 5-4. 검증 (작업자)

- 단위 시험: 대기열 합치기, 백오프, 오류 분류, 자료 변환, IndexedDB 1→2 이관
- RLS를 SQL로 확인한다. 트랜잭션 안에서 `set local role authenticated`와 `set local request.jwt.claims`로 사용자 A·B를 흉내 낸 뒤 rollback한다.
  - A가 B의 행을 SELECT·UPDATE할 수 없다.
  - `owner_id = B`로 INSERT할 수 없다.
  - DELETE는 막힌다.
  - anon 역할에서는 0행이다.
- RLS를 실제 경로(REST·Storage)로도 확인한다.
  - 임시 사용자 둘로 로그인해 위 항목을 다시 본다.
  - 남의 폴더 업로드·읽기가 막히고 버킷이 공개가 아닌지 본다.
  - 끝나면 임시 사용자를 지운다.
- 앱 흐름(시험 모드)
  - 로그인 → 검사 → 업로드됨을 확인한다.
  - 네트워크를 끊으면 대기 N건이 되고, 다시 연결하면 자동으로 올라가는지 본다.
  - 업로드가 실패하는 동안에도 판정과 결과 전송이 그대로 진행되는지 본다.
  - 이 흐름을 `tests/e2e`에 시나리오로 추가한다.
- `npm test`, `npm run typecheck`, `npm run build`, e2e를 모두 통과시킨다.
- `dist/`에 `sb_secret_`나 service_role 문자열이 없는지 검사한다.
- `TEST_RESULTS.md`에 결과를 적는다. 실제 장치 시험이 아닌 것은 그렇다고 쓴다.

### 5-5. 문서·커밋 (작업자)

- `README.md`: 팀 로그인 사용법과 환경 변수 설명
- `.env.example`
- `TEST_RESULTS.md`, `AGENTS.md`
- 마이그레이션 파일
- 모두 커밋하고 `main`에 푸시한다. 키와 비밀번호는 절대 커밋하지 않는다.

### 5-6. 실물 쪽 (장치가 있어야 함)

- 펌웨어 `arduino/Wafer_Two_Gate_PLC/controller.h`와 STL을 아직 받지 못했다. 받으면 `PROTOCOL.md` 10장 표로 대조한다.
- 실제 카메라로 정상·불량 각 10회 이상 다시 찍고 판정 기준값을 다시 정한다 (`HARDWARE_VALUES.md` 6장).
- `COMMISSIONING.md` 0~10단계 순서로 시운전하고 통합 인수한다 (지시서 12장).
- `HARDWARE_VALUES.md` 빈칸은 실측한 값으로만 채운다.

### 5-7. 선택: 게시

- 아직 게시하지 않았다.
- 게시한다면 공개용 키를 넘기는 경로를 서버 쪽에도 만들어야 한다 (4장).
- 카메라와 USB 때문에 HTTPS가 필요하다.

## 6. 값 확인 예시 (값을 출력하지 않음)

```js
// node check.mjs — 결과만 출력한다. 값이나 그 일부는 절대 출력하지 않는다.
import pg from "pg";
const ref = "ebrpuysakbfjjnjwesjh";
const key = process.env.SUPABASE_PUBLISHABLE_KEY ?? "";
const r = await fetch(`https://${ref}.supabase.co/auth/v1/settings`, { headers: { apikey: key } });
console.log("공개용 키 모양:", key.startsWith("sb_publishable_"), "/ 키 통함:", r.status === 200);
const c = new pg.Client({ host: "aws-0-ap-southeast-2.pooler.supabase.com", port: 5432,
  user: `postgres.${ref}`, password: process.env.SUPABASE_DB_PASSWORD, database: "postgres",
  ssl: { rejectUnauthorized: false } });
try { await c.connect(); console.log("DB 비밀번호 통함: true"); }
catch (e) { console.log("DB 비밀번호 통함: false", e.code); }
finally { await c.end().catch(() => {}); }
```
