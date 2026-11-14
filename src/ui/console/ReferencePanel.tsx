// 기준 사진 등록: ROI 맞추기 → 빈 자리·정상·불량 기준 촬영(새 프레임 8장 평균) → 판정 기준값 보정
import { useEffect, useMemo, useRef, useState } from 'react';
import type { StationSnapshot } from '../../app/station';
import { getStation } from '../../app/useStation';
import { DEFAULT_THRESHOLDS, type Thresholds } from '../../core/vision/analyze';
import type { Roi } from '../../core/vision/image';
import { REF_LABEL, type RefKind, type StoredReference } from '../../core/vision/reference';
import { btn, clock, num } from './kit';

const REF_NOTE: Record<RefKind, string> = {
  empty: '원판을 치운 빈 자리 — 물체 없음 판단에 써요 (권장)',
  ok: '정상 시편을 평평하게 놓고 찍어요 (필수)',
  ng: '시각적으로 뚜렷한 불량 시편 (필수)',
};

function RefThumb({ stored }: { stored: StoredReference }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.width = stored.w;
    c.height = stored.h;
    const img = new ImageData(stored.w, stored.h);
    for (let i = 0; i < stored.pixels.length; i++) {
      const v = stored.pixels[i];
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    c.getContext('2d')!.putImageData(img, 0, 0);
  }, [stored]);
  return <canvas ref={ref} className="size-20 rounded bg-well" role="img" aria-label={`${REF_LABEL[stored.kind]} 기준 사진`} />;
}

const ROI_FIELDS: { key: keyof Roi; label: string; min: number; max: number; step: number; unit: (v: number) => string }[] = [
  { key: 'cx', label: '가로 위치', min: 0.15, max: 0.85, step: 0.005, unit: (v) => `${(v * 100).toFixed(1)}%` },
  { key: 'cy', label: '세로 위치', min: 0.15, max: 0.85, step: 0.005, unit: (v) => `${(v * 100).toFixed(1)}%` },
  { key: 'size', label: '크기 (영상 높이 대비)', min: 0.2, max: 1, step: 0.005, unit: (v) => `${(v * 100).toFixed(1)}%` },
  { key: 'rot', label: '회전', min: -45, max: 45, step: 0.5, unit: (v) => `${v.toFixed(1)}°` },
];

type NumKey = 'minMatch' | 'minMargin' | 'consensus' | 'maxMotion' | 'maxOcclusion' | 'maxGlare' | 'minSharp';
const TH_FIELDS: { key: NumKey; label: string; step: number }[] = [
  { key: 'minMatch', label: '기준 일치 최소 유사도', step: 0.01 },
  { key: 'minMargin', label: '최소 판정 여유', step: 0.01 },
  { key: 'consensus', label: '연속 일치 프레임 수', step: 1 },
  { key: 'maxMotion', label: '정지로 보는 최대 움직임', step: 0.01 },
  { key: 'maxOcclusion', label: '가림 허용 비율', step: 0.01 },
  { key: 'maxGlare', label: '반사 허용 비율', step: 0.005 },
  { key: 'minSharp', label: '최소 선명도 비율', step: 0.05 },
];

function ThresholdEditor({ th, disabled }: { th: Thresholds; disabled: boolean }) {
  const station = getStation();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const value = (k: NumKey | 'minTexture') => draft[k] ?? (th[k] === null ? '' : String(th[k]));
  const changed = Object.keys(draft).length > 0;

  const apply = () => {
    const patch: Partial<Thresholds> = {};
    for (const [k, v] of Object.entries(draft)) {
      if (k === 'minTexture') {
        patch.minTexture = v.trim() === '' ? null : Number(v);
        continue;
      }
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) return window.alert(`${TH_FIELDS.find((f) => f.key === k)?.label}: 0 이상의 숫자를 넣어 주세요.`);
      (patch as Record<string, number>)[k] = k === 'consensus' ? Math.max(1, Math.min(8, Math.round(n))) : n;
    }
    station.setThresholds(patch);
    setDraft({});
  };

  return (
    <details className="mt-4 rounded-md border border-rule">
      <summary className="cursor-pointer px-3 py-2 text-[14px] font-semibold">판정 기준값 보정 (재촬영 결과를 본 뒤에)</summary>
      <div className="border-t border-rule p-3">
        <p className="text-[12px] text-steel">값을 바꾸면 교정 버전이 올라가고, 이후 기록에 새 버전이 남아요. 점수는 확률이 아니에요.</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {TH_FIELDS.map((f) => (
            <label key={f.key} className="grid gap-0.5 text-[13px]">
              <span className="text-steel">
                {f.label} <span className="text-[11px]">(기본 {DEFAULT_THRESHOLDS[f.key]})</span>
              </span>
              <input
                type="number"
                inputMode="decimal"
                step={f.step}
                min={0}
                className="rounded border border-rule px-2 py-1 font-mono text-[13px] tnum"
                value={value(f.key)}
                disabled={disabled}
                onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
              />
            </label>
          ))}
          <label className="grid gap-0.5 text-[13px]">
            <span className="text-steel">물체 있음 최소 무늬 진하기 (빈칸 = 빈 자리 기준으로 자동)</span>
            <input
              type="number"
              inputMode="decimal"
              step={0.01}
              min={0}
              className="rounded border border-rule px-2 py-1 font-mono text-[13px] tnum"
              value={value('minTexture')}
              placeholder="자동"
              disabled={disabled}
              onChange={(e) => setDraft((d) => ({ ...d, minTexture: e.target.value }))}
            />
          </label>
        </div>
        <div className="mt-3 flex gap-2">
          <button type="button" className={btn.small} disabled={!changed || disabled} onClick={apply}>
            적용
          </button>
          <button type="button" className={btn.small} disabled={!changed} onClick={() => setDraft({})}>
            되돌리기
          </button>
          <button
            type="button"
            className={btn.small}
            disabled={disabled}
            onClick={() => window.confirm('판정 기준값을 모두 기본값으로 되돌릴까요?') && (station.resetThresholds(), setDraft({}))}
          >
            기본값으로
          </button>
        </div>
      </div>
    </details>
  );
}

export function ReferencePanel({ st, draft, setDraft, onClose }: { st: StationSnapshot; draft: Roi | null; setDraft: (r: Roi | null) => void; onClose: () => void }) {
  const station = getStation();
  const busy = station.busyWithDevice || !!st.register || !!st.checking;
  const roi = draft ?? st.settings.roi;
  const refs = st.settings.refs;
  const regWhy = station.canRegister;
  const nRefs = Object.keys(refs).length;
  const calib = st.settings.calibrationVersion;

  // 지금 교정 버전에서 한 재촬영(검사만 시험) 횟수
  const retakes = useMemo(() => {
    const c = { ok: 0, ng: 0, empty: 0, occluded: 0 };
    for (const r of st.records) {
      if (r.mode !== 'check' || r.calibrationVersion !== calib || r.camera !== st.profile || !r.expected) continue;
      if (r.expected in c) c[r.expected as keyof typeof c]++;
    }
    return c;
  }, [st.records, calib, st.profile]);

  const applyRoi = () => {
    if (!draft) return;
    if (nRefs > 0 && !window.confirm(`ROI를 바꾸면 이 ROI로 찍은 기준 사진 ${nRefs}장이 지워져요. 바꿀까요?`)) return;
    station.setRoi(draft);
    setDraft(null);
  };

  return (
    <section aria-labelledby="ref-title" className="rounded-lg border-2 border-hold bg-panel">
      <div className="flex items-center gap-2 border-b border-rule px-4 py-2.5">
        <h2 id="ref-title" className="text-[15px] font-bold">
          기준 사진 등록 · {st.profile === 'virtual' ? '가상 카메라용' : '실제 카메라용'}
        </h2>
        <span className="text-[12px] text-steel">교정 버전 {calib}</span>
        <button type="button" className={`${btn.small} ml-auto`} onClick={onClose}>
          닫기
        </button>
      </div>
      <div className="grid gap-5 p-4 lg:grid-cols-2">
        <div>
          <h3 className="text-[14px] font-bold">① ROI를 원판에 맞추기</h3>
          <p className="mt-0.5 text-[12px] text-steel">조명·초점·카메라 높이를 먼저 고정해요. 정상 시편을 놓고 점선 원이 무늬를 덮도록 맞춰요.</p>
          <div className="mt-2 grid gap-2">
            {ROI_FIELDS.map((f) => (
              <label key={f.key} className="grid grid-cols-[7.5rem_1fr_4rem] items-center gap-2 text-[13px]">
                <span className="text-steel">{f.label}</span>
                <input
                  type="range"
                  min={f.min}
                  max={f.max}
                  step={f.step}
                  value={roi[f.key]}
                  disabled={busy}
                  onChange={(e) => setDraft({ ...roi, [f.key]: Number(e.target.value) })}
                  className="accent-[#1f5fad]"
                />
                <span className="text-right font-mono text-[12px] tnum">{f.unit(roi[f.key])}</span>
              </label>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <button type="button" className={btn.small} disabled={!draft || busy} onClick={applyRoi}>
              ROI 적용
            </button>
            <button type="button" className={btn.small} disabled={!draft} onClick={() => setDraft(null)}>
              되돌리기
            </button>
          </div>
          {st.prepared && (
            <p className="mt-3 text-[12px] text-steel">
              정상·불량 기준 차이 <span className="font-mono text-ink tnum">{num(st.prepared.separation)}</span>
              {st.prepared.emptyTexture !== null && (
                <>
                  {' '}
                  · 빈 자리 무늬 진하기 비율 <span className="font-mono text-ink tnum">{num(st.prepared.emptyTexture)}</span>
                </>
              )}
            </p>
          )}
        </div>

        <div>
          <h3 className="text-[14px] font-bold">② 기준 찍기 (움직임 없는 새 프레임 8장 평균)</h3>
          <ul className="mt-2 grid gap-2">
            {(['empty', 'ok', 'ng'] as RefKind[]).map((k) => {
              const s = refs[k];
              const doing = st.register?.kind === k;
              return (
                <li key={k} className="flex items-center gap-3 rounded-md border border-rule p-2">
                  {s ? <RefThumb stored={s} /> : <div className="grid size-20 shrink-0 place-items-center rounded bg-paper text-[12px] text-steel">미등록</div>}
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-semibold">{REF_LABEL[k]} 기준</div>
                    <div className="text-[12px] text-steel">{REF_NOTE[k]}</div>
                    {s && (
                      <div className="text-[12px] text-steel">
                        {clock(s.capturedAt)} · {s.frames}장 · {s.cameraLabel ?? '카메라 이름 없음'}
                      </div>
                    )}
                    {doing && st.register && (
                      <div className="mt-1">
                        <div className="h-1.5 overflow-hidden rounded bg-paper">
                          <div className="h-full bg-hold transition-[width]" style={{ width: `${(st.register.got / st.register.need) * 100}%` }} />
                        </div>
                        <div className="mt-0.5 text-[12px] text-hold-ink">{st.register.note}</div>
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col gap-1">
                    {doing ? (
                      <button type="button" className={btn.small} onClick={() => station.cancelRegister()}>
                        취소
                      </button>
                    ) : (
                      <button type="button" className={btn.small} disabled={!!regWhy || !!draft} title={draft ? 'ROI를 먼저 적용해 주세요' : (regWhy ?? undefined)} onClick={() => void station.registerRef(k)}>
                        {s ? '다시 찍기' : '찍기'}
                      </button>
                    )}
                    {s && !doing && (
                      <button type="button" className={btn.danger} disabled={busy} onClick={() => window.confirm(`${REF_LABEL[k]} 기준 사진을 지울까요?`) && station.clearRef(k)}>
                        지우기
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          {st.registerError && <p className="mt-2 text-[13px] text-ng">{st.registerError}</p>}
          {st.refsNote && <p className="mt-2 text-[13px] text-hold-ink">{st.refsNote}</p>}
        </div>

        <div className="lg:col-span-2">
          <h3 className="text-[14px] font-bold">③ 재촬영 시험 (정상·불량 각각 10회 이상)</h3>
          <p className="mt-0.5 text-[12px] text-steel">
            원판을 꺼냈다가 다시 놓고 → 영상 아래 ‘놓은 것’을 고르고 → 검사만 시험. 매번 새 프레임만 쓰고 기준 등록 프레임은 다시 쓰지 않아요. 위치·조명을 조금씩
            바꾸고 손 가림과 빈 자리도 섞어요.
          </p>
          <dl className="mt-2 grid grid-cols-4 gap-2 text-center">
            {(
              [
                ['정상', retakes.ok, 10],
                ['불량', retakes.ng, 10],
                ['빈 자리', retakes.empty, 3],
                ['가림', retakes.occluded, 3],
              ] as const
            ).map(([label, n, goal]) => (
              <div key={label} className={`rounded-md py-1.5 ${n >= goal ? 'bg-ok-soft' : 'bg-paper'}`}>
                <dt className="text-[12px] text-steel">{label}</dt>
                <dd className="font-mono text-[16px] font-bold tnum">
                  {n}
                  <span className="text-[12px] font-normal text-steel">/{goal}</span>
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-1 text-[12px] text-steel">지금 교정 버전({calib})에서 한 횟수예요. 결과 표는 아래 기록의 ‘검사만 시험’에서 볼 수 있어요.</p>
          <ThresholdEditor th={st.settings.thresholds} disabled={busy} />
        </div>
      </div>
    </section>
  );
}
