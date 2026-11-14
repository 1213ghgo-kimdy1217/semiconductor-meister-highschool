export type Tone = 'off' | 'ok' | 'busy' | 'warn' | 'bad';

const LAMP: Record<Tone, string> = {
  off: 'bg-[#b8c1c9]',
  ok: 'bg-ok shadow-[0_0_0_3px_rgba(22,128,60,0.18)]',
  busy: 'bg-signal shadow-[0_0_0_3px_rgba(31,95,173,0.18)]',
  warn: 'bg-hold shadow-[0_0_0_3px_rgba(244,183,64,0.3)]',
  bad: 'bg-ng shadow-[0_0_0_3px_rgba(200,49,43,0.2)]',
};

export function Lamp({ tone, className = '' }: { tone: Tone; className?: string }) {
  return <span aria-hidden className={`inline-block size-2.5 shrink-0 rounded-full ${LAMP[tone]} ${className}`} />;
}

/** 상단 상태 표시 한 칸: 램프 + 이름 + 현재 상태 문장 */
export function StatusCell({
  tone,
  title,
  value,
  detail,
  action,
}: {
  tone: Tone;
  title: string;
  value: string;
  detail?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-start gap-2.5 px-4 py-2.5">
      <Lamp tone={tone} className="mt-[7px]" />
      <div className="min-w-0 flex-1">
        <div className="text-[12px] text-steel">{title}</div>
        <div className="truncate text-[14px] font-semibold" title={value}>
          {value}
        </div>
        {detail && (
          <div className="truncate text-[12px] text-steel" title={detail}>
            {detail}
          </div>
        )}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </div>
  );
}
