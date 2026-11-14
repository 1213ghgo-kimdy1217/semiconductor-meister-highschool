// 콘솔 화면 공용 조각: 버튼 모양, 카드, 판정 표시, 숫자·시각 표기
import type { ReactNode } from 'react';
import { HOLD_LABEL, type HoldReason } from '../../core/vision/analyze';

export const btn = {
  primary:
    'inline-flex items-center justify-center gap-1.5 rounded-md bg-ink px-3 py-1.5 text-[14px] font-semibold text-white hover:bg-[#28394a] disabled:bg-[#9aa5ae]',
  secondary:
    'inline-flex items-center justify-center gap-1.5 rounded-md border border-rule bg-panel px-3 py-1.5 text-[14px] font-semibold text-ink hover:border-steel disabled:text-[#97a2ab] disabled:hover:border-rule',
  small:
    'inline-flex items-center justify-center rounded border border-rule bg-panel px-2 py-1 text-[13px] font-semibold text-ink hover:border-steel disabled:text-[#97a2ab] disabled:hover:border-rule',
  danger:
    'inline-flex items-center justify-center rounded border border-ng/40 bg-panel px-2 py-1 text-[13px] font-semibold text-ng hover:border-ng disabled:opacity-50',
};

export function Card({ title, right, children, className = '', id }: { title: ReactNode; right?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section aria-labelledby={id} className={`rounded-lg border border-rule bg-panel ${className}`}>
      <div className="flex flex-wrap items-center gap-2 border-b border-rule px-4 py-2.5">
        <h2 id={id} className="text-[15px] font-bold">
          {title}
        </h2>
        {right && <div className="ml-auto flex flex-wrap items-center gap-2">{right}</div>}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

const VERDICT_STYLE = {
  OK: 'bg-ok text-white',
  NG: 'bg-ng text-white',
  HOLD: 'bg-hold text-ink',
} as const;

export const VERDICT_NAME = { OK: '정상', NG: '불량', HOLD: '판정보류' } as const;

export function VerdictChip({ verdict, reason, size = 'sm' }: { verdict: 'OK' | 'NG' | 'HOLD'; reason?: HoldReason | null; size?: 'sm' | 'lg' }) {
  const label = verdict === 'HOLD' && reason ? `${VERDICT_NAME.HOLD} · ${HOLD_LABEL[reason] ?? reason}` : `${VERDICT_NAME[verdict]} ${verdict === 'HOLD' ? '' : verdict}`.trim();
  return (
    <span
      className={`inline-flex items-center rounded font-bold whitespace-nowrap ${VERDICT_STYLE[verdict]} ${
        size === 'lg' ? 'px-3 py-1.5 text-[22px]' : 'px-1.5 py-0.5 text-[12px]'
      }`}
    >
      {label}
    </span>
  );
}

export function num(v: number | null | undefined, digits = 3) {
  return v === null || v === undefined || Number.isNaN(v) ? '—' : v.toFixed(digits);
}

export function clock(iso: string | null | undefined) {
  if (!iso) return '—';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function day(iso: string) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function ago(ms: number) {
  if (ms < 1000) return '방금';
  if (ms < 60000) return `${Math.round(ms / 1000)}초 전`;
  return `${Math.round(ms / 60000)}분 전`;
}

/** 0/1 신호 표시 */
export function Flag({ on, label, tone = 'ok' }: { on: boolean; label: string; tone?: 'ok' | 'bad' | 'busy' }) {
  const onCls = tone === 'bad' ? 'border-ng bg-ng-soft text-ng' : tone === 'busy' ? 'border-signal bg-[#e5eef9] text-signal' : 'border-ok bg-ok-soft text-ok';
  return (
    <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[11px] font-semibold ${on ? onCls : 'border-rule text-[#8a96a0]'}`}>
      {label}
      <span>{on ? 1 : 0}</span>
    </span>
  );
}
