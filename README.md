# 인쇄 이미지 기반 모형 웨이퍼 검사 — 4인치 시연기 웹 콘솔

4인치(지름 101.6mm) 모형 웨이퍼 윗면에 붙인 정상·불량 **인쇄 시편**을 고정 카메라로 촬영해 정상(OK)·불량(NG)·판정보류(HOLD)로 판정하고, 확정된 OK/NG만 Arduino Uno(직렬 규약 V1)를 거쳐 PLC에 전달하는 웹 화면이다.

- 실제 반도체의 미세 결함을 검출하는 산업용 검사가 아니다. 인쇄 무늬를 실제 카메라로 찍은 정상·불량 기준과 비교할 뿐이다. 글자·QR을 읽지 않고, 외부 AI 모델·GPU 서버를 쓰지 않는다.
- 웹은 촬영·판정·결과 전달·기록만 한다. 이동·운전·정지·복구·수거 확인은 PLC/HMI가 맡는다. 웹에는 운전 버튼이 없고, 규약에도 웹용 이동 명령이 없다.
- 실제 장치(PLC·HMI·Uno·기구·카메라) 통합은 **아직 검증하지 않았다.** 무엇을 어디까지 확인했는지는 [TEST_RESULTS.md](TEST_RESULTS.md)에 나눠 적었다.

## 문서

| 문서 | 내용 |
|---|---|
| [PROTOCOL.md](PROTOCOL.md) | 웹이 구현한 Uno 직렬 규약 V1 — 명령·수신 처리·타이밍·HOLD 처리·펌웨어와 대조할 항목 |
| [COMMISSIONING.md](COMMISSIONING.md) | 학교 시운전 순서, 단계별 통과 기준, 기록 칸 |
| [TEST_RESULTS.md](TEST_RESULTS.md) | 소프트웨어 시험 결과(시뮬레이션)와 실제 장치 시험 기록 칸 |
| [HARDWARE_VALUES.md](HARDWARE_VALUES.md) | 실물로 확인해야 하는 값 목록 (지어낸 값 없음) |
| [HANDOFF.md](HANDOFF.md) | 현재 구현, 팀 저장 설정과 남은 검증 |

## 사용 환경

- PC의 **Chrome 또는 Edge**. USB 시리얼(Web Serial)과 카메라는 HTTPS 또는 `localhost`에서만 열린다. 지원하지 않는 브라우저에서는 화면에 이유를 표시한다.
- 실제 운전 중에는 검사 화면을 앞에 띄워 둔다. 탭이 뒤로 가면 브라우저가 타이머를 늦춰 연결 유지(PING)가 늦어지고, 장치가 PC 연결 시간 초과로 HOLD할 수 있다.

## Chrome/Edge 사용법

### 1) 카메라와 기준 사진 (처음 한 번, 카메라·조명을 옮기면 다시)
1. 검사 카메라를 꽂고 높이·조명·초점을 고정한다.
2. **카메라 연결** → 권한 허용 → 목록에서 검사 카메라를 고른다. 고른 카메라가 빠지면 노트북 카메라로 바꾸지 않고 다시 고르게 한다.
3. **기준 사진 등록** → ① ROI(점선 원)를 원판에 맞추고 적용 → 빈 자리·정상·불량을 차례로 놓고 각각 찍는다. 움직임 없는 새 프레임 8장을 평균한다. ROI를 바꾸면 그 ROI로 찍은 기준은 지워진다.
4. **검사만 시험**: 「놓은 것」을 고르고 시험한다. 장치로는 아무것도 보내지 않는다. 정상·불량 각 10회 이상, 매번 원판을 꺼냈다 다시 놓으며 반복하고 기록의 「재촬영 혼동 표」를 확인한다.

### 2) 장치 연결 (시운전·교정을 마친 뒤)
1. Arduino IDE의 시리얼 모니터·플로터를 닫는다 (포트를 같이 쓸 수 없다).
2. **장치 연결** → Uno 포트를 고른다. 포트를 열면 보드가 리셋될 수 있어 BOOT 줄을 기다린 뒤 HELLO를 한 번 보낸다. 연결만으로는 아무것도 움직이지 않는다.
3. 상단 네 칸(카메라 · Uno USB · PLC 요청/운전 허가 · 기록 저장)을 확인한다. 펌웨어 교정값이 잠겨 있으면 「운전 잠김 · 교정값 미확인」으로 보인다.
4. 운전·정지·복구·수거 확인은 **HMI**에서 한다. PLC가 새 검사를 요청하면 웹이 그 뒤의 새 프레임으로 판정해 OK/NG를 한 번 보낸다. 물체 없음·손 가림이면 기다리고, 판정이 불확실하면 보내지 않는다.

### 3) 시험 모드
상단 **시험 모드**: 실제 포트를 열지 않고 가상 카메라·가상 Uno·PLC·HMI·작업대로 전체 흐름을 연습한다. 시험 기록은 실제 운전 통계와 따로 집계된다.

### 4) 인쇄용 시편
상단 **인쇄용 시편**: 정상 A·불량 A(권장)·불량 B·불량 C를 A4 실제 크기(100%)로 인쇄하거나 SVG로 내려받는다. 자르는 원 지름 101.6mm, 100mm 눈금으로 배율을 확인한다. 시편 안에 글자·QR은 없다.

### 5) 기록
- 최근 10개 기록과 정상/불량/보류 집계. 실제 운전·시험 모드·검사만 시험을 섞지 않는다.
- **기록 내보내기**: CSV(엑셀용). 카메라 판정 · PLC 전달 · PLC 분기 · 배출 동작 종료 · 실물 수거 확인을 칸을 나눠 적는다. 웹은 실물 수거를 알 수 없어 항상 「미확인」이고, 확정 수거 통계에 넣지 않는다.
- 기록은 먼저 이 PC 브라우저의 IndexedDB에 저장한다. 로그인한 계정에 속한 업로드 대기열을 뒤에서 Supabase로 보낸다. 업로드 실패가 카메라 판정이나 Uno 결과 전송을 기다리게 하지 않는다.

### 6) 팀 로그인과 저장

1. Supabase 대시보드 **Authentication → Users**에서 팀 이메일·비밀번호 계정을 만들고 이메일 확인을 완료한다. 앱에는 가입 화면이 없다.
2. Email 로그인이 켜졌는지 확인하고 공개 신규 가입과 익명 로그인을 끈다. 계정 비밀번호는 팀만 보관하고 코드나 채팅에 넣지 않는다.
3. 아래 환경 변수 설정을 마친 뒤 앱의 **팀 계정 로그인**에 팀 계정을 입력한다.
4. 상단 **기록 저장**에서 이 PC 저장 상태와 팀 업로드 상태를 확인한다. 네트워크 실패는 대기열에 남겨 재시도한다. 로그인 만료는 다시 로그인하고, 정책·설정 오류는 원인을 고친 뒤 **저장 다시 시도**를 누른다.
5. 로그인 전 항목은 자동으로 올리지 않는다. 현재 계정과 항목 수를 확인하고 동의란을 체크한 뒤 **기존 항목 올리기**를 누른다. 검사 기록·이벤트·기준 설정을 포함한 대기 항목 수이므로 웨이퍼 장수와 같지 않을 수 있다.
6. 로그아웃해도 이 PC 기록은 남는다. 계정 A에 배정된 항목이 다음 로그인 계정 B로 옮겨지지 않는다.

기준 사진은 PC의 `device_id`와 실제/가상 카메라별로 저장한다. 같은 팀 계정이어도 다른 PC의 기준 사진·판정 기준을 자동 적용하지 않는다. 카메라·조명·설치 위치가 바뀌면 해당 PC에서 기준을 다시 등록한다.

### 7) 팀 기록

**팀 기록 보기**(`/team`)에서 같은 계정으로 여러 PC가 올린 기록을 조회한다. 실제 운전·시험 모드·검사만 시험을 골라 25건씩 보고, **선택한 모드 전체 CSV**로 해당 모드 전체를 내려받는다. 새 기록은 **새로 조회**로 불러온다. 계정 변경 시 이전 계정의 조회 결과와 진행 중인 내보내기를 버린다.

사진은 `inspection-images` 비공개 버킷에 저장한다. 검사 썸네일과 기준 사진의 경로만 행에 기록하고 공개 URL을 만들지 않는다. Supabase는 기록·설정 저장 용도이며 장치 명령이나 Realtime 제어 통로로 쓰지 않는다.

## 설정·빌드 절차

필요: Node.js 24 권장, npm.

```bash
npm ci              # package-lock.json 그대로 설치
npm run dev         # 개발 서버 — http://localhost:5173
npm test            # 단위 시험 (vitest)
npm run typecheck   # 타입 검사
npm run build       # 타입 검사 + dist/ 정적 파일
npm run preview     # 빌드 결과 확인 — http://localhost:4173
```

- 웹 화면은 `dist/`에 빌드한다. Vercel 배포에는 Node 24의 `api/` 설정 응답도 함께 포함된다. 카메라·USB 시리얼은 HTTPS 또는 localhost에서만 열린다.
- 브라우저 시험은 개발 서버에서 실행한다. 개발용 `window.__station`은 배포 빌드에 없다.

```bash
npm install --no-save --package-lock=false playwright@1.56.1
npx playwright install chromium
node tests/e2e/sim-flow.cjs
node tests/e2e/cloud-flow.cjs
```

GitHub Actions의 [검증 설정](.github/workflows/verify.yml)도 단위 시험·타입 검사·빌드·브라우저 시나리오·번들 비밀값 검사를 실행한다. 클라우드 브라우저 시나리오의 응답은 시험용 모형이다. 실제 RLS 검증 범위와 하드웨어 미실시 항목은 [TEST_RESULTS.md](TEST_RESULTS.md)를 따른다.

현재 변경은 [초안 PR #2](https://github.com/1213ghgo-kimdy1217/semiconductor-meister-highschool/pull/2)에서 검토한다. [최종 CI](https://github.com/1213ghgo-kimdy1217/semiconductor-meister-highschool/actions/runs/43604547968)에서 `npm ci`·단위 96/96·타입 검사·빌드·번들 비밀값 검사·기존 브라우저 25/25·클라우드 브라우저 28/28이 통과했다. 실제 DB의 SQL 역할 모의 RLS 검증은 68/68 통과했다. 클라우드 브라우저는 모의 응답 시험이며 실제 이메일 로그인·REST·Storage HTTP 시험은 계정과 공개용 키 준비 후 별도로 해야 한다.

### Supabase 설정

| 환경 | 공개용 설정을 주는 방법 |
|---|---|
| BAZE 개발·미리보기 | 프로젝트 비밀값 설정의 `SUPABASE_PUBLISHABLE_KEY`를 서버가 읽는다. `SUPABASE_URL`은 선택이며 기본값은 현재 전용 프로젝트 주소다. 실제 값 파일을 만들지 않는다. 변경 후 서버를 다시 시작한다. |
| BAZE 밖 로컬 PC | Git에서 제외된 `.env.local`의 `VITE_SUPABASE_URL`과 `VITE_SUPABASE_PUBLISHABLE_KEY`, 또는 위 서버 환경 변수를 쓴다. |
| 현재 Vercel 배포 | `api/cloud-config`가 서버 환경 변수의 공개용 설정만 전달한다. Vercel 프로젝트 Settings → Environment Variables에서 Production의 `SUPABASE_PUBLISHABLE_KEY`를 등록하고 다시 배포한다. `SUPABASE_URL`은 등록돼 있다. |
| API가 없는 다른 정적 호스팅 | 빌드 때 공개용 `VITE_` 두 값을 공급하거나 같은 출처의 설정 API가 필요하다. Vite 미들웨어는 개발·preview 전용이다. |

예시 이름은 [`.env.example`](.env.example)에 있다. 브라우저는 HTTPS Supabase 프로젝트 주소와 `sb_publishable_` 형식 키만 받는다. legacy JWT·secret·service_role 키는 받지 않는다. DB 비밀번호는 작업자의 `SUPABASE_DB_PASSWORD` 환경 변수에만 두고 앱이나 `VITE_` 변수에 넣지 않는다. 설정이 없으면 로그인은 비활성화되고 로컬 검사·저장은 계속 사용할 수 있다.

### 현재 배포

[검사 사이트 열기](https://wafer-inspection-4inch.vercel.app). Vercel에서 Production **READY**를 확인했다. 현재 공개용 키가 없어 로컬 저장 모드가 예상되며 팀 로그인은 아직 연결 전이다. 실제 사이트의 HTTP 응답·화면 점검은 연결 문제로 완료하지 못했다.

이번 배포는 파일 업로드 방식이며 GitHub 자동 배포 연결은 없다. 코드 변경 후 별도 재배포가 필요하고 PR을 main에 합친 상태도 아니다. BAZE와 Vercel은 주소가 달라 기존 BAZE 브라우저 기록이 자동으로 옮겨지지 않는다. 키는 Vercel 환경 변수 설정에 직접 넣고 채팅에 보내지 않는다.

데이터베이스의 [초기 마이그레이션](supabase/migrations/20261114133634_init_team_storage.sql)과 [지연 업로드 보호](supabase/migrations/20261114134435_keep_newer_snapshots.sql)를 현재 전용 프로젝트에 적용했다. `settings`, `inspections`, `events`의 RLS는 영구 로그인 계정 본인 행의 SELECT·INSERT·UPDATE만 허용하고 삭제는 허용하지 않는다. 오래된 탭의 업로드가 최신 검사·설정 행을 되돌리지 못하게 한다. 이미지 버킷도 소유자와 폴더를 확인한다. [RLS SQL 시험 안내](tests/rls/README.md)를 읽고 관리자 연결에서 rollback 시험을 실행한다. 이미 적용한 SQL은 다시 붙여 넣지 않는다.

## 코드 구조

카메라·영상 비교·통신 파서·상태 전이·저장을 각각 다른 모듈에 둔다.

| 폴더 | 내용 |
|---|---|
| `src/core/protocol` | 규약 V1 파서·명령 생성·줄 버퍼·연결(`DeviceLink`) |
| `src/core/transport` | Web Serial과 가상 장치 — 같은 `Transport` 인터페이스 |
| `src/core/camera` | 카메라 선택·해상도 협상·프레임, 가상 카메라 |
| `src/core/vision` | ROI, 위치·회전 보정, 밝기 정규화, 기준 비교, 차이 영역 |
| `src/core/inspect` | 프레임 안정 확인·연속 프레임 합의 |
| `src/core/station` | PLC 검사 요청 하나 처리 — 보낼지·기다릴지·촬영 실패 |
| `src/core/process` | 공정 단계 표시 (Uno STATUS 기준) |
| `src/core/store` | IndexedDB 기록·이벤트·설정, CSV |
| `src/core/cloud` | 업로드 대기열, 자료 변환, 재시도, 로그인과 팀 조회 |
| `src/core/specimen` | 인쇄용 시편 SVG |
| `src/app` | 화면 상태 연결 |
| `src/ui`, `src/pages` | 검사 콘솔 `/`, 인쇄용 시편 `/print`, 팀 기록 `/team` |
| `src/config/cloud.ts`, `vite.config.ts` | 공개용 설정 검증과 개발·preview 설정 응답 |
| `supabase/migrations`, `tests/rls` | DB 스키마·소유자 정책과 SQL 검증 |
| `src/config/hardware.ts` | `PLC_INTERFACE_VERIFIED` — 시운전 뒤에만 true (표시용) |
| `tests` | 단위 시험, `tests/e2e` 브라우저 시나리오 |

