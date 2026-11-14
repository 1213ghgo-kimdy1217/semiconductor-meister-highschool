# 인수인계 — 4인치 모형 웨이퍼 검사 웹 콘솔

2026-11-14 갱신. 기준은 사용자 제공 `BAZE_Wafer_Inspection_Build_Brief_4inch.md`와 Uno 규약 V1이다. 지시서 원문과 `.baze-files/`는 공개 저장소에 올리지 않는다. 최신 시험 결과는 [TEST_RESULTS.md](TEST_RESULTS.md)를 읽는다.

## 0. 현재 상태

- 기존 검사 콘솔·시험 모드·기준 등록·판정·CSV·인쇄 시편 위에 Supabase 팀 로그인·지속 저장 대기열·팀 기록 조회를 추가하는 변경이다.
- 사용자는 초안을 참고해 다시 구성하고 연결 설정을 기다리는 동안에도 구현하도록 승인했다.
- 기존 전용 Supabase 프로젝트에 두 마이그레이션을 적용했다. 세 표·소유자 RLS·비공개 이미지 버킷과, 지연된 업로드가 새 기록/설정을 덮어쓰지 않게 하는 보호가 있다. SQL 역할 모의 RLS 시험은 68/68 통과했고 보안 advisors는 0건이었다. 시험 rollback 뒤 사용자·검사·이미지 행은 모두 0개임을 확인했다. 실제 이메일 로그인·REST·Storage HTTP 경로 시험과는 별개다.
- 확인 시점의 Auth 사용자 수는 0명이었다. 현재 작업 환경에는 `SUPABASE_DB_PASSWORD`와 `SUPABASE_PUBLISHABLE_KEY`가 없었다. 이전 BAZE 대화에는 두 값이 잘못됐다는 기록이 있다. 이후 변경 여부는 값을 노출하지 않고 다시 검증한다.
- 작업 브랜치는 `codex/team-cloud-storage`, 검토용 [초안 PR #2](https://github.com/1213ghgo-kimdy1217/semiconductor-meister-highschool/pull/2)가 열려 있다. main 직접 푸시·임의 병합은 하지 않는다.
- [Vercel 운영 사이트](https://wafer-inspection-4inch.vercel.app)를 파일 업로드 방식으로 배포했고 제공자 상태는 Production READY다. 배포 코드는 `a70ee06ea10fc2e0b80624597add475c3994bf3c`다. GitHub 자동 동기화는 없으며 변경 후 별도 재배포가 필요하다. 실제 운영 HTTP/화면 점검은 연결 실패로 미완료다.
- 실제 카메라·Uno·PLC·HMI·기구 통합은 미실시다.

## 1. 저장소와 실행

저장소: [semiconductor-meister-highschool](https://github.com/1213ghgo-kimdy1217/semiconductor-meister-highschool). 별도 SemiGuard 교육 사이트 `semiguard-ai`는 수정하지 않는다.

Vite 7·React 19·TypeScript 5.9·Tailwind 4·react-router 7·idb 8, Supabase JS 2.119.0을 쓴다. `@types/node` 24.0.0과 `undici-types` 7.8.0도 lockfile에 고정했다. `package-lock.json`을 유지하고 Node.js 24를 권장한다.

```bash
npm ci
npm run dev
npm test
npm run typecheck
npm run build
npm run preview
```

개발 서버는 5173, preview는 4173이다. 카메라와 Web Serial은 PC Chrome·Edge의 HTTPS 또는 localhost에서 쓴다. 브라우저 시험은 개발용 `window.__station`을 읽으므로 개발 서버에서 실행한다.

```bash
npm install --no-save --package-lock=false playwright@1.56.1
npx playwright install chromium
node tests/e2e/sim-flow.cjs
node tests/e2e/cloud-flow.cjs
```

작업 환경의 GitHub/npm DNS 제한으로 로컬 실행 대신 GitHub Actions를 사용했다. 커밋 `a70ee06ea10fc2e0b80624597add475c3994bf3c`의 [최종 CI](https://github.com/1213ghgo-kimdy1217/semiconductor-meister-highschool/actions/runs/43604547968)에서 `npm ci`·단위 96/96·타입 검사·빌드·번들 비밀값 검사·기존 브라우저 25/25·클라우드 브라우저 28/28이 통과했다. CI는 Ubuntu 24.04에서 Playwright 1.56.1을 `/tmp/wafer-browser`에 분리 설치한다. 클라우드 28개에는 로그인 대기 중 로그아웃과 다른 탭의 오래된 쓰기 회귀 시험이 포함된다. 클라우드 브라우저의 모의 응답 시험과 실제 Auth·REST·Storage HTTP 시험을 구분한다. 후자는 계정/공개용 키 미준비로 미실시이며 하드웨어 시험도 미실시다. 최종 결과는 `TEST_RESULTS.md`가 기준이다.

## 2. 고정 규칙과 확정 결정

1. 웹은 촬영·판정·OK/NG·CAPTURE_FAILED 전달과 기록만 한다. 운전·이동·정지·복구·수거 확인은 PLC/HMI가 맡는다.
2. HOLD·불확실·장치 실패를 자동 NG·방출·복구·재개로 바꾸지 않는다. 확정되지 않은 판정은 보내지 않고 장치의 60초 시간 초과에 맡긴다.
3. RESULT에는 OK/NG만 넣는다. 사진·점수·검사기 버전은 웹과 DB에만 기록한다.
4. Supabase와 Realtime을 장치 명령 통로로 쓰지 않는다. 업로드를 검사/결과 전송 경로에서 await하지 않는다.
5. 시험 모드는 실제 포트를 열거나 PLC 판정 신호를 보내지 않는다. live/sim/check를 조회·집계·CSV에서 구분한다.
6. 배출 동작 종료와 실물 수거 확인을 분리한다. 규약에 수거 확인 알림이 없어 `collectionConfirmed`는 false이며 DB도 true를 거부한다.
7. 실제 성능과 하드웨어 값을 지어내지 않는다. 교정 전 실제 운전 잠금을 유지한다.
8. 팀은 이메일·비밀번호 계정 하나를 여러 PC에서 사용한다. 앱에는 가입 화면이 없다.
9. 로그인 전 항목은 현재 계정·항목 수를 확인하고 명시적으로 동의했을 때만 올린다.
10. `/team`에서 모드별 페이지 목록과 선택 모드 전체 CSV를 제공한다.
11. 기준 사진·ROI·판정 기준은 PC별로 유지하고 다른 PC의 기준을 자동 적용하지 않는다.

## 3. 코드와 로컬 저장

| 위치 | 역할 |
|---|---|
| `core/camera`, `core/vision` | 카메라/새 프레임·기준 영상 비교 |
| `core/protocol`, `core/transport` | Uno V1 파서·연결·실제/가상 transport |
| `core/station`, `core/inspect`, `core/process` | 검사 요청·판정 합의·공정 표시 |
| `core/store/local.ts` | 로컬 자료와 지속 업로드 대기열 |
| `core/cloud` | 소유자 배정·자료 변환·로그인·동기화·재시도·팀 조회 |
| `config/cloud.ts`, `vite.config.ts` | 공개용 설정 검증과 개발/preview 응답 |
| `ui/console/CloudPanel.tsx`, `app/useCloud.ts` | 로그인·동의·재시도·저장 상태 |
| `pages/TeamRecords.tsx` | 팀 기록과 CSV |
| `supabase/migrations`, `tests/rls` | DB 스키마·정책과 SQL 시험 |

IndexedDB 이름은 `wafer-inspection-4inch`, 버전은 2다. `kv`·`records`·`events`를 보존하고 `outbox`를 추가한다. 로컬 자료와 대기 항목은 같은 트랜잭션에 저장한다. v1 항목은 미배정 상태로 인덱싱하므로 로그인만으로 소유자가 바뀌지 않는다.

PC UUID `device_id`와 항목별 소유자 메타데이터를 유지한다. 계정 A 항목은 B 로그인 후에도 A에 속한다. 동의받은 미배정 항목만 현재 계정에 배정한다. 대기 항목 수에는 검사·이벤트·설정이 포함되므로 웨이퍼 장수와 다르다.

검사 최신 변경은 합치고 revision이 맞는 업로드 응답만 대기 항목을 지운다. 관련 이벤트는 검사 행 다음에 전송한다. 네트워크 실패는 지수 백오프·지터로 재시도하고 online/화면 복귀 때 재개한다. 로그인 만료·정책 거부·충돌·스키마 오류는 구분한다.

사진은 비공개 `inspection-images` 버킷에 저장한다. 검사 썸네일은 `<owner_id>/inspections/<inspection-id>.png`, 기준은 `<owner_id>/refs/<device_id>/<real-or-virtual>/<kind>-<immutable-version>.png`다. 기준 휘도 배열은 PNG로 올리고 `settings.refs`에는 메타데이터·경로만 둔다. 팀 기준 자동 내려받기·교체는 없다.

## 4. Supabase와 키 다루기

| 항목 | 내용 |
|---|---|
| 전용 프로젝트 | `wafer-inspection-4inch` |
| ref / API 주소 | `ebrpuysakbfjjnjwesjh` / `https://ebrpuysakbfjjnjwesjh.supabase.co` |
| 지역 | `ap-southeast-2` (호주 시드니) |
| 마이그레이션 | `supabase/migrations/20261114133634_init_team_storage.sql` |
| 지연 업로드 보호 | `supabase/migrations/20261114134435_keep_newer_snapshots.sql` |
| 표 | `public.settings`, `public.inspections`, `public.events` |
| 이미지 | 비공개 `inspection-images`, PNG/JPEG·2MiB 제한 |

두 마이그레이션은 이번 연결의 Supabase 도구로 적용했다. 두 번째는 `settings`·`inspections`의 더 오래된 `local_updated_at` 업로드가 최신 행을 되돌리지 못하게 한다. 이전 BAZE 토큰의 403 제한을 현재 도구 권한으로 단정하지 않는다. 이미 적용한 SQL은 재실행하지 않고 새 변경은 별도 마이그레이션으로 만든다.

초안 대비 변경: `settings` 키는 `(owner_id,device_id,camera_id)`다. 검사 중복 기준에도 PC를 넣었다. 이벤트는 `(owner_id,device_id,local_event_id)`로 중복을 막고 소유자까지 포함한 외래키로 타인 검사 참조를 막는다. 세 표는 영구 로그인 사용자 본인 행 SELECT·INSERT·UPDATE만 허용하며 DELETE 권한은 없다. UPDATE에 USING/WITH CHECK를 함께 둔다. Storage는 소유 폴더와 객체 소유자가 모두 일치해야 한다.

키·비밀번호·접속 문자열은 일부도 출력하거나 채팅/커밋에 넣지 않는다.

| 환경 변수 | 사용처 |
|---|---|
| `SUPABASE_PUBLISHABLE_KEY` | 개발/preview 서버가 읽어 공개용 키만 `/api/cloud-config`로 전달 |
| `SUPABASE_URL` | 서버용 API 주소, 생략하면 위 전용 프로젝트 주소 |
| `SUPABASE_DB_PASSWORD` | 작업자의 DB 직접 연결·마이그레이션용만. 앱은 읽지 않음 |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | BAZE 밖 로컬/정적 빌드의 공개 설정 |

BAZE에서는 실제 값 파일을 만들지 않고 프로젝트 비밀값 설정을 쓴다. BAZE 밖에서는 무시되는 `.env.local`에 공개용 두 값만 둘 수 있다. 브라우저는 HTTPS Supabase 주소와 현대 publishable key만 받는다. legacy JWT·secret·service_role 키는 허용하지 않는다.

Vite `/api/cloud-config`는 개발·preview용이고, Vercel에는 Node 24 `api/cloud-config`와 공통 공개 설정 검증을 구현했다. 미등록 API는 JSON 404, 화면 경로는 SPA fallback으로 처리한다. 새 의존성은 추가하지 않았다. API 없는 다른 정적 호스팅은 공개용 `VITE_` 빌드 설정 또는 같은 출처의 API가 필요하다. 설정이 없으면 로컬 검사·저장은 계속되고 로그인만 비활성화된다.

현재 Vercel 프로젝트는 `prj_wkDJIFpPFENmdYfMXRoDg25ToeWy`, 팀은 `team_jygW9ZnBaGtmwpvrc8QVwKNq`다. `SUPABASE_URL`은 등록돼 있고 `SUPABASE_PUBLISHABLE_KEY`는 없다. Vercel 프로젝트 Settings → Environment Variables의 Production에 공개용 키를 직접 등록한 뒤 다시 배포한다. 키를 채팅으로 받거나 파일로 옮기지 않는다. BAZE와 Vercel 주소는 달라 기존 IndexedDB 기록이 자동 이관되지 않는다.

## 5. 다음 확인 순서

### 5-1. 계정과 실제 연결

Supabase **Authentication → Users → Add user**에서 팀 계정을 만들고 이메일 확인을 완료한다. 비밀번호는 팀만 보관하며 작업자/채팅에 주지 않는다. Email 로그인을 켜고 공개 신규 가입과 익명 로그인을 끈다. 앱 가입 화면 유무만으로 서버 가입이 막히는 것은 아니다.

실행 환경의 비밀값 설정에 실제 공개용 키를 공급한다. DB 직접 접속이 필요할 때만 `SUPABASE_DB_PASSWORD`도 공급한다. 키 형식과 API 성공 여부는 맞음/틀림으로만 확인한다. 기존 BAZE 값과 현재 작업 환경 값은 별개일 수 있다.

### 5-2. 데이터베이스 검증

`tests/rls/owner-policies.sql`은 관리자 연결에서 실행하고 전부 rollback한다. 68개 SQL 검증은 통과했다. A·B·익명 Auth·미로그인의 표/이미지 접근과 지연 업로드 보호를 검사하며 Storage의 직접 삭제 방지 장치는 유지한다.

실제 Auth·REST·Storage 검증에는 두 임시 사용자로 로그인해 본인 쓰기, 타인 조회/수정/소유자 위조 거부, 타인 폴더 읽기/업로드 거부를 따로 확인해야 한다. 준비되지 않은 시험은 TEST_RESULTS에 미실시로 남긴다.

### 5-3. 앱과 회귀 검증

단위·타입·빌드·브라우저·번들 비밀값 검사를 실행한다. v1→v2 보존, 명시적 업로드 동의, A/B 소유권 유지, 오프라인/새로고침 대기열 유지, 저장 실패 중 OK/NG·결과 전달, 모드별 팀 조회·CSV를 확인한다. 모의 클라우드 응답을 실제 업로드 성공으로 표시하지 않는다.

### 5-4. PR 전달

README·환경 변수 예시·AGENTS·HANDOFF·TEST_RESULTS·마이그레이션을 최신 상태로 맞춘다. 비밀값/`.baze-files`/런타임 자료가 없는지 확인하고 새 브랜치에 커밋한 뒤 PR을 연다. main 직접 푸시·임의 병합은 하지 않는다.

### 5-5. 실제 장치

`arduino/Wafer_Two_Gate_PLC/controller.h`를 받으면 PROTOCOL 10장을 대조한다. 실제 카메라로 정상/불량 각 10회 이상 새로 재촬영하고 COMMISSIONING 순서로 정상 3회·불량 3회 분류와 실패 상황을 확인한다. HARDWARE_VALUES 빈칸은 실측값으로만 채운다. 서버 게시와 실물 검증을 구분한다.
