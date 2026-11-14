# AGENTS.md

## 프로젝트와 기준

4인치(101.6mm) 인쇄 시편을 카메라로 OK·NG·HOLD 판정하고, 확정 OK/NG만 Uno 규약 V1로 PLC에 넘기는 웹 콘솔이다. 전용 저장소는 `1213ghgo-kimdy1217/semiconductor-meister-highschool`이다. 별도 `semiguard-ai` 서비스는 건드리지 않는다.

사용자가 제공한 `BAZE_Wafer_Inspection_Build_Brief_4inch.md`, 최신 `PROTOCOL.md`, 현재 대화의 결정을 따른다. 지시서 원문과 `.baze-files/`는 공개 저장소에 올리지 않는다. 다음 작업자는 `HANDOFF.md`와 `TEST_RESULTS.md`를 읽고 실제 현재 상태를 확인한다.

## 장치 경계

- 웹은 촬영·판정·OK/NG·CAPTURE_FAILED 전달만 한다. 운전·이동·정지·복구·수거 확인은 PLC/HMI에서 한다.
- HOLD·불확실·장치 실패를 자동 NG·방출·복구·재개로 바꾸지 않는다. 불확실 판정은 보내지 않고 장치의 검사 시간 초과에 맡긴다.
- 통신 생성기는 HELLO·PING·STATUS·RESULT·CAPTURE_FAILED만 지원한다. 사진·점수·버전을 Uno로 보내지 않는다.
- Supabase 행과 Realtime을 장치 명령 통로로 쓰지 않는다. 클라우드 업로드를 판정/결과 전송 경로에서 await하지 않는다.
- 시험 모드는 실제 포트를 열거나 PLC 판정 신호를 보내지 않는다. 실제/시험/검사만 시험 기록을 구분한다.
- 실물 수거 확인을 웹이 알 수 없어 `collectionConfirmed`는 false다. 배출 동작 종료와 혼동하지 않는다.
- 실제 카메라·Uno·PLC·기구 시험과 가상 시험을 구분한다. 미확정 값은 `HARDWARE_VALUES.md`에 빈칸으로 남긴다.

## 구현 구조와 사용자 결정

- `/`: 검사 콘솔, 네 가지 상태 칸, 기준 등록, 기록·CSV, 팀 로그인.
- `/print`: 글자·QR이 없는 101.6mm 정상/불량 인쇄 시편.
- `/team`: 같은 계정의 여러 PC 기록을 모드별 페이지 조회하고 CSV로 내보낸다.
- `core/camera`, `vision`, `protocol`, `transport`, `station`, `store`, `cloud`의 역할을 분리한다.
- IndexedDB `wafer-inspection-4inch` 버전 2의 `kv`·`records`·`events`를 보존하며 `outbox`를 추가했다. 로컬 자료와 대기 항목은 같은 트랜잭션에 저장한다.
- 업로드 항목은 원래 소유 계정에 묶는다. 로그인 전 항목은 현재 계정·항목 수를 보여 주고 명시적 동의를 받은 뒤에만 배정한다. 계정 변경으로 기존 소유자를 바꾸지 않는다.
- 기준 사진/ROI/판정 기준은 PC `device_id`와 실제/가상 카메라별로 보관한다. 다른 PC 기준을 자동 적용하지 않는다.
- 최신 변경은 대기열에서 합친다. 업로드 중 변경된 항목을 옛 응답으로 지우지 않도록 revision을 확인한다. 검사 행을 관련 이벤트보다 먼저 올린다.

## Supabase와 비밀값

전용 프로젝트 ref는 `ebrpuysakbfjjnjwesjh`다. `supabase/migrations/20261114133634_init_team_storage.sql`과 `20261114134435_keep_newer_snapshots.sql`을 적용했다. 세 표·비공개 `inspection-images` 버킷과 지연 업로드 보호가 있다. 모든 공개 표에 RLS를 켜고 본인 행 SELECT·INSERT·UPDATE만 허용한다. 익명 Auth도 차단한다. UPDATE는 USING/WITH CHECK를 함께 둔다. 이벤트는 다른 소유자의 검사 행을 참조할 수 없다. 오래된 탭이 새 검사/설정 행을 덮어쓰게 하지 않는다.

- 팀 이메일/비밀번호 계정은 Supabase 대시보드에서 만든다. 앱에는 가입 화면을 두지 않는다.
- 실제 키·비밀번호를 코드·번들·문서·GitHub·채팅·출력에 넣지 않는다. 앞부분도 출력하지 않는다. 비밀번호를 채팅으로 요구하지 않는다.
- BAZE에서는 `SUPABASE_PUBLISHABLE_KEY`와 선택 `SUPABASE_URL`을 서버 환경 변수로 공급한다. `/api/cloud-config`는 공개용 주소/키만 반환한다.
- BAZE 밖에서는 무시되는 `.env.local`의 `VITE_SUPABASE_URL`/`VITE_SUPABASE_PUBLISHABLE_KEY`를 허용한다. 공개용 키만 넣는다.
- DB 비밀번호는 작업자의 `SUPABASE_DB_PASSWORD` 환경 변수로만 읽는다. 브라우저에 넣지 않는다. 관리자 키를 가져와 우회하지 않는다.
- Vercel에는 Node 24 `api/cloud-config`와 공통 공개 설정 검증, 미등록 API JSON 404, SPA fallback을 구현했다. Vite 미들웨어는 개발/preview용이다. API가 없는 다른 정적 호스팅에는 공개용 빌드 설정 또는 같은 출처의 설정 API가 필요하다.
- 정책 SQL 시험은 rollback한다. Storage의 직접 삭제 방지 장치를 끄지 않는다. SQL 역할 모의 시험과 실제 Auth/REST/Storage HTTP 시험을 구분한다.

## 검증과 전달

`npm test`, `npm run typecheck`, `npm run build`, 개발 서버에서 `tests/e2e/sim-flow.cjs`·`cloud-flow.cjs`를 실행한다. [최종 CI](https://github.com/1213ghgo-kimdy1217/semiconductor-meister-highschool/actions/runs/43604547968)에서 단위 96/96·타입 검사·빌드·번들 비밀값 검사·기존 브라우저 25/25·클라우드 브라우저 28/28이 통과했고 실제 SQL RLS는 68/68 통과했다. CI는 Ubuntu 24.04에서 Playwright를 별도 `/tmp` 폴더에 설치한다. 클라우드 브라우저 응답은 모형이며 실제 Auth/REST/Storage HTTP와 하드웨어 시험은 미실시다. 최신 결과는 `TEST_RESULTS.md`가 기준이다.

`codex/team-cloud-storage`의 초안 PR #2로 전달한다. **main에 직접 푸시하거나 PR을 임의로 병합하지 않는다.** 키·런타임 자료·`node_modules`·`dist`·`.baze-files`를 커밋하지 않는다.

Vercel Production은 `https://wafer-inspection-4inch.vercel.app`에서 READY로 확인했다. 프로젝트 `prj_wkDJIFpPFENmdYfMXRoDg25ToeWy`, 팀 `team_jygW9ZnBaGtmwpvrc8QVwKNq`다. 배포 코드는 `a70ee06ea10fc2e0b80624597add475c3994bf3c`이며 파일 업로드 배포라 GitHub 자동 동기화가 없다. 코드 수정 후 별도 재배포해야 한다. `SUPABASE_URL`만 등록돼 있고 공개용 키는 미등록이다. 실제 운영 HTTP·브라우저 점검은 연결 문제로 미완료이며 READY를 화면 동작 검증으로 보고하지 않는다. BAZE와 배포 주소의 IndexedDB는 서로 별개다.
