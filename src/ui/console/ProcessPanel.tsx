// 현재 공정 단계: 장치가 STATUS로 보고한 phase가 기준이고, 웹은 자기 촬영·판정 진행만 덧붙인다.
import type { StationSnapshot } from '../../app/station';
import { getStation, useLinkLogVersion, useNow } from '../../app/useStation';
import { latchedRoute, processState, STATE_LABEL } from '../../core/process/flow';
import type { LinkSnapshot } from '../../core/protocol/link';
import { faultLabel, isPhase, PHASE_LABEL, plcCommandLabel, REJECT_LABEL } from '../../core/protocol/v1';
import { ProcessTrack } from '../ProcessTrack';
import { ago, Card, Flag } from './kit';

function LinkLog() {
  useLinkLogVersion();
  const log = getStation().link.log.slice(-60).reverse();
  return (
    <details className="mt-3 rounded-md border border-rule">
      <summary className="cursor-pointer px-3 py-1.5 text-[13px] font-semibold">통신 기록 (최근 {log.length}줄)</summary>
      <ol className="max-h-56 overflow-auto border-t border-rule bg-[#f7f9fa] px-3 py-2 font-mono text-[11.5px] leading-5">
        {log.length === 0 && <li className="text-steel">아직 없어요</li>}
        {log.map((e) => (
          <li key={e.id} className={e.level === 'error' ? 'text-ng' : e.level === 'warn' ? 'text-hold-ink' : e.dir === 'tx' ? 'text-signal' : e.dir === 'sys' ? 'text-steel' : 'text-ink'}>
            <span className="text-[#8a96a0]">{new Date(e.t).toLocaleTimeString('ko-KR', { hour12: false })}</span> {e.dir === 'tx' ? 'PC→' : e.dir === 'rx' ? 'Uno→' : '··'} {e.text}
            {e.note && <span className="font-sans text-steel"> — {e.note}</span>}
          </li>
        ))}
      </ol>
    </details>
  );
}

export function ProcessPanel({ st, link }: { st: StationSnapshot; link: LinkSnapshot }) {
  const now = useNow(500);
  const status = link.status;
  const online = link.phase === 'online';
  const state = online ? processState({ status, web: st.cycle && !st.cycle.closed && st.cycle.cycle === status?.cycle ? st.cycle.stage : 'idle', releasedCycle: st.releasedCycle }) : null;
  const route = latchedRoute(status);
  const statusAge = link.statusAt ? now - link.statusAt : null;

  return (
    <Card id="process-title" title="현재 공정 단계" right={state && <span className="rounded bg-paper px-2 py-0.5 text-[13px] font-semibold">{STATE_LABEL[state]}</span>}>
      <ProcessTrack
        state={state}
        route={route}
        sourceLabel={
          online
            ? `장치가 보고한 상태로 그린 그림이에요${statusAge !== null ? ` (STATUS ${ago(statusAge)})` : ''}. 실제 위치는 장비에서 확인하세요.`
            : link.phase === 'closed'
              ? '웹은 공정 단계를 스스로 정하지 않아요. Uno가 보고한 단계가 기준이에요.'
              : '장치 응답이 없어 마지막 단계를 믿을 수 없어요. 실제 상태는 HMI에서 확인하세요.'
        }
      />

      {status && (
        <div className="mt-3 rounded-md bg-paper p-2.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
            <span>
              장치 단계 <b>{isPhase(status.phase) ? PHASE_LABEL[status.phase] : status.phase}</b>
            </span>
            <span className="font-mono text-[12px] text-steel">
              {status.phase} · cycle {status.cycle}
            </span>
            {status.faultCode !== 'NONE' && <span className="font-semibold text-ng">코드 {faultLabel(status.faultCode)}</span>}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1">
            <Flag on={status.configured} label="configured" />
            <Flag on={status.homed} label="homed" />
            <Flag on={status.busy} label="busy" tone="busy" />
            <Flag on={status.done} label="done" tone="busy" />
            <Flag on={status.fault} label="fault" tone="bad" />
            <Flag on={status.valid} label="valid" />
            <Flag on={status.valid && status.ok} label={status.valid ? 'ok' : 'ok(무효)'} />
          </div>
          {!status.configured && <p className="mt-1.5 text-[12px] text-hold-ink">교정 확인 플래그가 꺼져 있어 운전이 잠겨 있어요. 연결 신호가 있어도 준비 상태가 아니에요.</p>}
        </div>
      )}

      <ul className="mt-2 grid gap-1 text-[13px]">
        {link.hostReconnected && <li className="text-ng">PC 재접속으로 장치가 HOLD했고 이전 판정은 무효예요. HMI에서 원인 확인 뒤 복구해 주세요.</li>}
        {link.lastReject && (
          <li className="text-ng">
            장치가 거부: {REJECT_LABEL[link.lastReject.reason] ?? link.lastReject.reason} ({ago(now - link.lastReject.at)}) — 자동으로 다시 보내지 않아요.
          </li>
        )}
        {link.lastDone && (
          <li className="text-steel">
            마지막 PLC 요청 완료: {plcCommandLabel(link.lastDone.command)} ({ago(now - link.lastDone.at)}) — 웹은 이 알림으로 다음 동작을 명령하지 않아요.
          </li>
        )}
        {state === 'WAIT_COLLECTION' && <li className="font-semibold text-hold-ink">배출 동작 종료 · 실물 수거 미확인 — HMI에서 수거를 확인해 주세요.</li>}
        {online && <li className="text-[12px] text-steel">운전 중에는 이 탭을 앞에 띄워 두세요. 뒤로 가면 연결 유지가 늦어져 장치가 HOLD할 수 있어요.</li>}
      </ul>
      <LinkLog />
    </Card>
  );
}
