# PROTOCOL.md — 웹 ↔ Uno 직렬 규약 V1 (웹 쪽 구현)

이 문서는 웹 콘솔이 **실제로 구현한** 동작을 적는다. 기준은 개발 지시서 8·9·14장의 「동봉 Uno 펌웨어 직렬 규약 V1」이다.

- 대상 펌웨어: `arduino/Wafer_Two_Gate_PLC/controller.h` — **이 저장소에는 없다.** 받으면 맨 아래 「펌웨어와 대조할 항목」을 한 줄씩 확인한다.
- 보드 업로드·실물 통신 시험은 아직 하지 않았다. 아래 동작은 단위 시험과 가상 장치(시험 모드)로만 확인했다 → [TEST_RESULTS.md](TEST_RESULTS.md).
- 이전 제안 `C,1,…` / `A,1,…` / `E,1,…`는 쓰지 않는다.

## 1. 역할

| 주체 | 하는 일 | 하지 않는 일 |
|---|---|---|
| 웹 | 카메라 촬영, 인쇄 무늬 판정, 확정 OK/NG 또는 CAPTURE_FAILED 전달, 상태·기록 표시 | 모터·게이트 이동, 운전 시작·정지·복구, 수거 확인 |
| Uno | PLC 명령에 따른 두 모터 펄스, 원점·위치 상태, PC USB 통신, 검사 결과를 PLC 쪽 래치로 전달 | 웹 명령으로 이동 |
| PLC | 전체 시퀀스, 운전 허가, 인터록, 검사 요청(110), 결과에 따른 경로 선택(001/010), 열기(011) | — |
| HMI | 준비·시작·정지·복구·회수(수거) 확인, 상태 표시 | — |

웹은 이동 명령을 **만들 수조차 없다**: 명령 생성기(`src/core/protocol/v1.ts`의 `fmt`)에는 아래 5종만 있고, 시험이 이를 확인한다.

## 2. 전송 형식

- 115200 baud, 8N1, 흐름 제어 없음. ASCII CSV, 웹은 줄끝 LF로 보낸다. 받을 때는 LF·CRLF 모두 읽는다.
- 한 줄은 줄끝 제외 최대 95바이트. 웹이 만드는 가장 긴 줄도 95바이트 이하(시험으로 확인).
- 받은 줄이 95바이트를 넘으면 다음 줄바꿈까지 통째로 버리고 기록에 남긴다. 빈 줄은 무시한다.
- 쪼개져 오거나 여러 줄이 한 번에 붙어 와도 같은 결과가 되도록 줄 버퍼가 다시 자른다.
- 쓰기는 포트를 여는 동안 writer 하나만 잡고 순서대로 보낸다. 닫을 때 reader·writer 잠금을 푼다.
- Uno로 영상·base64·긴 JSON을 보내지 않는다. 점수·검사기 버전은 웹 기록에만 남긴다.

## 3. 식별자

| 값 | 웹의 규칙 |
|---|---|
| `session` | 포트를 새로 열 때마다 새 난수(1 ~ 2^31−1, `crypto.getRandomValues`). 장치 재부팅을 감지했을 때도 새로 만든다. 0은 쓰지 않는다. |
| `cycle` | 웹이 만들지 않는다. PLC의 110 ARM 요청으로 Uno가 발행한 값을 `INSPECT_REQUEST`에서 받아 그대로 쓴다. |
| `capture` | 판정에 쓴 새 캡처마다 세션 안에서 1부터 1씩. 처리한 캡처를 다음 cycle에 쓰지 않는다. |
| `seq` | 결과 전송마다 세션 안에서 1부터 1씩. 응답이 없어 다시 보낼 때는 **같은 줄 그대로**(같은 seq) 보낸다. |

식별자는 문자열이 아니라 정수로 비교한다. 웹은 session·cycle을 임의로 되돌리거나 맞추지 않는다.

## 4. PC → Uno (웹이 보내는 전부)

| 줄 | 언제 | 비고 |
|---|---|---|
| `V1,HELLO,<session>` | 포트를 연 뒤 BOOT 줄을 받으면, 또는 3초 안에 BOOT가 없으면 한 번 | 게이트를 움직이지 않는다. 응답이 2.5초 없으면 다시 보내지 않고 「응답 없음」으로 멈춘다 (재전송이 HOST_RECONNECTED HOLD를 일으킬 수 있어서). |
| `V1,PING,<session>` | 등록 뒤 500ms마다 | 연결 유지 |
| `V1,STATUS,<session>` | 등록 뒤 1초마다, 그리고 DONE·REJECT·CAPTURE_FAILED 직후 | 공정 표시는 STATUS의 phase만 쓴다 |
| `V1,RESULT,<session>,<seq>,<cycle>,<capture>,OK\|NG` | 열린 현재 검사 요청에 확정 OK/NG가 나오면 한 번 | 값은 OK·NG뿐. HOLD·UNKNOWN·점수·사진을 붙이지 않는다. |
| `V1,CAPTURE_FAILED,<session>,<cycle>` | 복구할 수 없는 카메라 실패일 때 현재 cycle로 한 번 | 장치를 HOLD시킨다. 자동 NG·재촬영·방출 없음. |

RESULT를 보낼 수 있는 조건(모두 만족): 포트 열림·등록됨·Uno 응답 중, 현재 `INSPECT_REQUEST`의 cycle과 같음, 그 요청이 아직 열려 있음, 그 요청에 결과나 촬영 실패를 아직 보내지 않음.

RESULT 접수 응답(`RESULT_ACCEPTED_PENDING_VALID`·`RESULT_VALID`·`RESULT_DUPLICATE_IGNORED`)이 400ms 안에 없으면 같은 줄을 다시 보낸다. 모두 3번까지. 그래도 없으면 「접수 응답 없음」으로 표시하고 멈춘다 — 장치는 검사 시간 초과로 HOLD할 수 있다.

`START`, `HOME`, `JOG`, `OPEN`, `DIVERTER`, `BENCH` 계열 명령은 없다.

## 5. Uno → PC (웹이 받는 줄)

| 줄 | 웹의 처리 |
|---|---|
| `V1,BOOT,<size>,<build>,<autostart>` | 보드 시작. `PLC_MAIN`·`NO_AUTOSTART`가 아니면 경고. 이미 등록된 상태에서 오면 재부팅으로 보고 이전 요청·판정을 버리고 새 session으로 HELLO. |
| `V1,EVENT,<s>,<c>,CONNECTED_NO_AUTOSTART` | 등록 완료 → PING/STATUS 시작 |
| `V1,EVENT,<s>,<c>,HOST_RECONNECTED` | 장치가 재접속으로 HOLD, 이전 판정 무효. 「HMI에서 복구」로 표시. |
| `V1,EVENT,<s>,<c>,INSPECT_REQUEST` | cycle이 0이 아니고 이 세션에서 처음 보는 cycle일 때만 새 검사 시작. 요청 시각 이후 프레임만 쓴다. 같은 cycle이 다시 오면 다시 촬영하지 않는다. |
| `V1,EVENT,<s>,<c>,RESULT_ACCEPTED_PENDING_VALID` | 접수 (PLC 전달 래치 전) |
| `V1,EVENT,<s>,<c>,RESULT_VALID` | PLC 전달 래치 준비. **분류·수거 완료가 아니다.** |
| `V1,EVENT,<s>,<c>,RESULT_DUPLICATE_IGNORED` | 같은 줄 재전송을 장치가 다시 실행하지 않음 |
| 그 밖의 EVENT | 기록만 |
| `V1,STATUS,<s>,<c>,<phase>,<configured>,<homed>,<busy>,<done>,<fault>,<valid>,<ok>,<fault_code>` | 13필드, 플래그는 0/1. 공정 단계 표시의 유일한 기준. `ok`는 `valid=1`일 때만 판정으로 읽는다. `configured=0`이면 「운전 잠김 · 교정값 미확인」. |
| `V1,DONE,<plc_command>,<phase>` | PLC 요청 완료 알림. session/cycle이 없어 직전 STATUS와 함께 해석하고 곧바로 STATUS를 다시 묻는다. 웹은 DONE을 받아 다음 동작을 명령하지 않는다. 명령은 숫자(`001`)·이름(`ROUTE_OK`) 어느 쪽이든 읽는다. |
| `V1,REJECT,<reason>` | 오류 문구와 현재 STATUS를 보인다. 자동으로 다시 보내지 않는다. |

다른 session의 EVENT는 무시한다. 다른 session의 STATUS는 「다른 세션이 등록돼 있어요」로 표시한다. STATUS의 session이 0이면(장치가 세션을 잃음 — BOOT 줄을 놓친 재부팅) 새 session으로 다시 등록한다.

잘못된 줄(필드 수·숫자·0/1 플래그·ASCII 밖 글자·`V1`로 시작하지 않음)은 버리고 기록에 남긴다.

phase: `BOOT_LOCKED`, `NEED_HOME`, `IDLE_CLOSED`, `WAIT_INSPECTION`, `RESULT_PENDING`, `RESULT_READY`, `ROUTE_SET`, `OPEN_WAIT_DRAIN`, `HOLD_FAULT`.

## 6. 검사 요청 하나의 처리 (웹)

```text
INSPECT_REQUEST(cycle N)
 → 요청 시각 + 120ms 이후 프레임만 사용 (이전 캡처 재사용 없음)
 → 프레임 안정: 연속 3장의 움직임이 기준 이하
 → 판정 프레임 최대 8장, 같은 판정 3장 연속이면 합의
 → OK / NG / HOLD(사유)
```

| 시도 결과 | 웹의 다음 동작 |
|---|---|
| OK 또는 NG 합의 | RESULT 한 번 |
| 물체 없음 · 움직임 · 손 가림 · 반사 · 흐림 | 아무것도 보내지 않고 새 프레임으로 다시 본다 (원판을 놓거나 손을 치울 때까지) |
| 기준 불일치 · 판정 여유 부족 · 연속 프레임 불일치(OK/NG 엇갈림) · 기준 미등록 | 아무것도 보내지 않고 멈춘다 → 장치가 검사 시간 초과(60초)로 HOLD |
| 카메라 프레임이 멈춤 | 카메라가 연결된 채 처음 멈춘 것이면 한 번 다시 본다. 끊겼거나 두 번째면 CAPTURE_FAILED 한 번 |

요청이 닫히는 때: STATUS의 cycle이 바뀜, phase가 WAIT_INSPECTION을 벗어남(웹 결과 접수 전), USB 단절, 연결 해제, 재부팅 감지. 닫히면 진행 중인 판정을 멈추고 아무것도 보내지 않는다.

판정 불확실을 장치에 「즉시」 알리는 명령은 규약 V1에 없다. 웹은 CAPTURE_FAILED를 판정 불확실에 쓰지 않는다(카메라 실패와 원인이 섞이므로). 그래서 판정 불확실은 60초 검사 시간 초과로 HOLD된다 — 아래 대조 항목 9번.

## 7. 오류·HOLD — 자동 NG·자동 복귀·자동 재개 없음

| 상황 | 웹 | 장치·PLC에 기대하는 동작 |
|---|---|---|
| USB 케이블 단절 | 진행 중 판정 중단, 결과 보내지 않음, 자동 재연결 없음 | PC_LINK_TIMEOUT(2.5초) → HOLD. 원판은 정지 게이트에 그대로. |
| Uno가 3초 동안 아무 줄도 안 보냄 | 「응답 끊김」, 결과를 보내지 않음 | — |
| 페이지 새로고침·다시 연결 | 포트·카메라를 자동으로 다시 열지 않음. 다시 열면 새 session HELLO | HOST_RECONNECTED → HOLD, 이전 판정 무효 |
| 보드 재부팅 | 새 session으로 등록, 이전 요청 무효 | 원점 필요 상태로 대기 |
| 카메라 실패 | CAPTURE_FAILED 한 번 | HOLD, 자동 NG·재촬영·방출 없음 |
| 판정 불확실·기준 미등록 | 보내지 않음 | INSPECTION_TIMEOUT(60초) → HOLD |
| REJECT | 표시 + STATUS 조회, 재시도 없음 | — |
| 운전 허가 상실 | 표시만 | HOLD 래치, 허가 복원만으로 재개하지 않음 |
| 검사 화면이 뒤로 감 | 통신 기록에 경고 (브라우저가 타이머를 늦춤) | PING이 늦으면 PC_LINK_TIMEOUT으로 HOLD할 수 있음 |

복구 순서는 PLC/HMI가 맡는다: 원인 확인 → RESET_HOLD(101) → 통로 비움 확인 → HOME(100) → 새 사이클(110). 웹은 이 중 어떤 것도 대신하지 않는다.

## 8. 기록에 따로 남기는 것

지시서 8장대로 다음을 칸을 나눠 기록·CSV로 남긴다.

1. 카메라 판정 (OK / NG / HOLD와 사유, 점수, 프레임 id, 검사기 `ref-compare` `cmp1.0`, 기준 버전)
2. PLC 전달 상태 (보내지 않음 / 전송 중 / 접수 / 래치 준비 / 거부 / 응답 없음 / 촬영 실패 전송 / 요청 닫힘)
3. PLC 분기 — 이 cycle에서 DONE 001(분기 OK) 또는 010(분기 NG)을 받았는지
4. 배출 동작 종료 — DONE 011(정지 게이트 열기) 완료. **실물 수거가 아니다.**
5. 실물 수거 확인 — 규약 V1에는 HMI 수거 확인을 PC로 알리는 줄이 없어 웹은 항상 「미확인」으로 둔다. 확정 수거 통계에 넣지 않는다.

## 9. PLC ↔ Uno 논리 핸드셰이크 (참고 — 웹은 관여하지 않음)

PLC→Uno: CMD0/CMD1/CMD2, REQ, RUN_PERMIT. Uno→PLC: BUSY, DONE, FAULT, RESULT_VALID, RESULT_OK. 실제 P주소·배선표가 아니다.

| 코드 | 이름 | 뜻 |
|---|---|---|
| 000 | CLOSE_STOP | 정지 게이트 닫기 (촬영을 자동 시작하지 않음) |
| 001 | ROUTE_OK | 분기 OK |
| 010 | ROUTE_NG | 분기 NG |
| 011 | OPEN_STOP | 정지 게이트 열기 |
| 100 | HOME | 원점 복귀 |
| 101 | RESET_HOLD | HOLD 복구 요청 |
| 110 | ARM_INSPECTION | 새 검사 사이클 · 이전 결과 초기화 · 토큰 생성 |
| 111 | RESERVED | 예약·거부 |

순서: PLC 코드 설정 → REQ 유지 → Uno 래치/BUSY → 처리 후 DONE → PLC가 확인하고 REQ OFF → Uno DONE OFF. 즉시 끝나는 ARM/RESET은 BUSY가 생략될 수 있어 PLC는 DONE/FAULT도 감시한다. 분기 게이트는 정지 게이트가 닫혀 있을 때만 바꾼다.

## 10. 펌웨어와 대조할 항목

`controller.h`를 받으면 확인한다. 웹 쪽 위치를 함께 적었다.

| # | 웹의 가정 | 웹 쪽 위치 |
|---|---|---|
| 1 | BOOT는 `V1,BOOT,101.6MM,PLC_MAIN,NO_AUTOSTART` 네 값 | `v1.ts` parseLine |
| 2 | HELLO 응답은 `EVENT,<session>,<cycle>,CONNECTED_NO_AUTOSTART` (이미 세션이 있으면 `HOST_RECONNECTED`) | `link.ts` onEvent |
| 3 | 세션이 없을 때 STATUS의 session 필드는 `0` | `link.ts` onStatus |
| 4 | STATUS 필드 순서·개수(13)와 플래그 0/1 | `v1.ts` parseLine |
| 5 | fault_code 문자열: `NONE`, `PC_LINK_TIMEOUT`, `INSPECTION_TIMEOUT`, `CAPTURE_FAILED`, `RUN_PERMIT_LOST`, `HOST_RECONNECTED`, `HOME_FAILED` (모르는 코드는 그대로 표시) | `v1.ts` FAULT_LABEL |
| 6 | DONE의 plc_command가 숫자 코드인지 이름인지 (둘 다 읽음) | `station.ts` onNotice |
| 7 | REJECT reason 목록 (`LINE_TOO_LONG` 외) | `v1.ts` REJECT_LABEL |
| 8 | RESULT에 접수 이벤트가 400ms 안에 오는지, RESULT_VALID까지 100ms | `link.ts` DEFAULT_LINK.ackMs |
| 9 | 판정 불확실을 즉시 HOLD로 알릴 방법이 없음 — 60초 시간 초과에 맡기는 것이 PLC 팀과 합의된 동작인지 | `cycle.ts` decide |
| 10 | PING에 응답 줄이 있는지 (웹은 어떤 줄이든 받으면 살아 있다고 본다) | `link.ts` onLine |
| 11 | PC 연결 유효시간 2500ms, 검사 시간 초과 60초 | 장치 쪽 값 |
| 12 | CAPTURE_FAILED 뒤 phase가 `HOLD_FAULT`, fault_code `CAPTURE_FAILED` | `link.ts` sendCaptureFailed |

대조 결과는 [COMMISSIONING.md](COMMISSIONING.md) 1단계 표에 적는다.
