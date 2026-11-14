// 인쇄용 정상·불량 시편. 가상 카메라·자동 시험과 같은 도형 정의로 실제 크기(지름 101.6mm) A4에 두 장씩 찍는다.
// 시편 안에는 글자·QR이 없다. 이름표는 자르는 선 바깥에만 있어 잘라 내면 남지 않는다.
import { useState } from 'react';
import { Link } from 'react-router';
import { cutGuideSvg, PRINT_BOX_MM, SPECIMENS, specimenSvgDocument, specimenSvgGroup, WAFER_MM, type SpecimenId } from '../core/specimen/specimen';
import { btn } from '../ui/console/kit';

const SVG: Record<SpecimenId, string> = Object.fromEntries(SPECIMENS.map((s) => [s.id, specimenSvgGroup(s.id) + cutGuideSvg()])) as Record<SpecimenId, string>;
const VIEW = `${-PRINT_BOX_MM / 2} ${-PRINT_BOX_MM / 2} ${PRINT_BOX_MM} ${PRINT_BOX_MM}`;

const USE: Record<SpecimenId, string> = {
  'normal-a': '정상 기준 사진 등록과 정상 재촬영 시험(10회 이상)에 써요.',
  'defect-a': '불량 기준 사진 등록과 불량 재촬영 시험(10회 이상)에 써요. 처음 시연은 이 시편으로 해요.',
  'defect-b': '기준으로 등록하지 않아요. 등록하지 않은 불량이 정상으로 나오지 않는지 봐요. 불량 또는 판정보류가 맞는 결과예요.',
  'defect-c': '결함이 작아 판정보류가 나거나 놓칠 수 있어요. 결과를 기록해 한계를 확인하는 용도예요.',
};

const STEPS = [
  '인쇄할 시편과 장수를 골라요. 처음 시연은 정상 A와 불량 A 한 장씩이면 돼요.',
  "인쇄 창에서 용지 A4, 배율 '실제 크기(100%)'를 고르고 '페이지에 맞춤'과 머리글·바닥글은 꺼요.",
  '인쇄물의 100mm 눈금을 자로 재 봐요. 다르면 배율 설정을 다시 확인해요.',
  '바깥 원(자르는 선)을 따라 잘라 원판 윗면에 주름 없이 평평하게 붙여요. 무광 용지가 반사가 적어요.',
  '아래쪽 흰 삼각형(방향 표시)이 늘 같은 쪽을 보게 놓아요. 기준 사진을 찍을 때와 검사할 때 방향이 같아야 해요.',
  '붙인 실물로 검사 화면에서 기준 사진을 등록해요. 다른 프린터나 용지로 다시 인쇄하면 기준도 다시 찍어요.',
];

function download(id: SpecimenId) {
  const url = URL.createObjectURL(new Blob([specimenSvgDocument(id)], { type: 'image/svg+xml' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `specimen-${id}-${WAFER_MM}mm.svg`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ScaleBar() {
  return (
    <svg width="110mm" height="9mm" viewBox="-5 0 110 9" aria-hidden className="block">
      <line x1="0" y1="4" x2="100" y2="4" stroke="#15202b" strokeWidth="0.3" />
      {Array.from({ length: 11 }, (_, i) => (
        <line key={i} x1={i * 10} y1={i % 5 === 0 ? 1 : 2.5} x2={i * 10} y2="4" stroke="#15202b" strokeWidth="0.25" />
      ))}
      <text x="0" y="8.2" fontSize="2.6" textAnchor="middle" fill="#15202b">0</text>
      <text x="100" y="8.2" fontSize="2.6" textAnchor="middle" fill="#15202b">100mm</text>
    </svg>
  );
}

function Sheet({ ids, page, pages }: { ids: SpecimenId[]; page: number; pages: number }) {
  return (
    <section className="print-sheet flex h-[277mm] w-[190mm] flex-col text-ink">
      <div className="flex items-baseline justify-between border-b border-ink/40 pb-[1.5mm] text-[8.5pt]">
        <span className="font-semibold">인쇄 이미지 기반 모형 웨이퍼 검사 · 인쇄용 시편 · A4 실제 크기(100%)</span>
        <span>
          {page}/{pages}
        </span>
      </div>
      <div className="mt-[3mm] flex items-center gap-[4mm] text-[8pt]">
        <ScaleBar />
        <span>이 선이 자로 100mm인지 확인해요. 다르면 배율을 ‘실제 크기’로 다시 인쇄해요.</span>
      </div>
      {ids.map((id, i) => {
        const info = SPECIMENS.find((s) => s.id === id)!;
        return (
          <div key={`${id}-${i}`} className="mt-[6mm] flex items-center gap-[6mm]">
            <svg width={`${PRINT_BOX_MM}mm`} height={`${PRINT_BOX_MM}mm`} viewBox={VIEW} className="shrink-0" role="img" aria-label={info.title} dangerouslySetInnerHTML={{ __html: SVG[id] }} />
            <div className="min-w-0 text-[9pt] leading-[1.55]">
              <p className="text-[13pt] font-bold">{info.title.replace(' (권장)', '').replace(' (어려움)', '')}</p>
              <p className="mt-[1mm] font-semibold">{info.kind === 'normal' ? '정상 시편' : '불량 시편'} · {id}</p>
              <p className="mt-[2mm]">자르는 선: 바깥 원 (지름 {WAFER_MM}mm)</p>
              <p>방향: 흰 삼각형이 아래(6시)</p>
              <p className="mt-[2mm] text-[8pt]">{USE[id]}</p>
              <p className="mt-[2mm] text-[7.5pt]">이 이름표는 원 바깥이라 잘라 내면 남지 않아요. 판정은 무늬 비교로만 해요.</p>
            </div>
          </div>
        );
      })}
    </section>
  );
}

export default function PrintSpecimens() {
  const [copies, setCopies] = useState<Record<SpecimenId, number>>({ 'normal-a': 1, 'defect-a': 1, 'defect-b': 0, 'defect-c': 0 });
  const items = SPECIMENS.flatMap((s) => Array.from({ length: copies[s.id] }, () => s.id));
  const sheets: SpecimenId[][] = [];
  for (let i = 0; i < items.length; i += 2) sheets.push(items.slice(i, i + 2));

  return (
    <div className="min-h-screen">
      <title>인쇄용 시편 · 모형 웨이퍼 검사</title>
      <header className="border-b border-rule bg-panel print:hidden">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-1 px-4 py-3">
          <div className="min-w-0">
            <h1 className="text-[18px] font-bold">인쇄용 시편</h1>
            <p className="text-[12px] text-steel">4인치(지름 {WAFER_MM}mm) 모형 웨이퍼 윗면에 붙이는 정상·불량 인쇄 무늬 · 실제 반도체 결함과는 관계없어요</p>
          </div>
          <Link to="/" className="ml-auto text-[13px] font-semibold text-signal underline-offset-2 hover:underline">
            검사 화면으로
          </Link>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_22rem] print:hidden">
        <ul className="grid gap-4 sm:grid-cols-2" aria-label="시편 목록">
          {SPECIMENS.map((s) => (
            <li key={s.id} className="flex flex-col rounded-lg border border-rule bg-panel p-3">
              <div className="rounded-md bg-paper p-3">
                <svg viewBox={VIEW} className="mx-auto block w-full max-w-[18rem]" role="img" aria-label={`${s.title} 무늬`} dangerouslySetInnerHTML={{ __html: SVG[s.id] }} />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <h2 className="text-[15px] font-bold">{s.title}</h2>
                <span className={`rounded px-1.5 py-0.5 text-[12px] font-bold ${s.kind === 'normal' ? 'bg-ok-soft text-ok' : 'bg-ng-soft text-ng'}`}>{s.kind === 'normal' ? '정상' : '불량'}</span>
              </div>
              <p className="mt-1 text-[13px]">{s.note}</p>
              <p className="mt-1 text-[12.5px] text-steel">{USE[s.id]}</p>
              <div className="mt-auto flex flex-wrap items-center gap-2 pt-3">
                <label className="flex items-center gap-1.5 text-[13px] text-steel">
                  인쇄 장수
                  <select
                    className="rounded border border-rule bg-panel px-1.5 py-1 text-[13px] text-ink"
                    value={copies[s.id]}
                    onChange={(e) => setCopies((c) => ({ ...c, [s.id]: Number(e.target.value) }))}
                  >
                    {[0, 1, 2, 3, 4].map((n) => (
                      <option key={n} value={n}>
                        {n}장
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" className={`${btn.small} ml-auto`} onClick={() => download(s.id)}>
                  SVG 내려받기
                </button>
              </div>
            </li>
          ))}
        </ul>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-4 lg:self-start">
          <section aria-labelledby="print-go" className="rounded-lg border border-rule bg-panel p-4">
            <h2 id="print-go" className="text-[15px] font-bold">
              인쇄하기
            </h2>
            <p className="mt-1 text-[14px]">
              {items.length ? (
                <>
                  시편 <b className="tnum">{items.length}</b>개 · A4 <b className="tnum">{sheets.length}</b>장
                </>
              ) : (
                '인쇄할 시편을 1장 이상 골라 주세요.'
              )}
            </p>
            <button type="button" className={`${btn.primary} mt-3 w-full`} disabled={!items.length} onClick={() => window.print()}>
              인쇄하기
            </button>
            <p className="mt-2 text-[12px] text-steel">흑백 인쇄도 괜찮아요. 판정은 밝기 무늬로 해요. 같은 인쇄물로 기준 사진을 찍는 게 중요해요.</p>
          </section>
          <section aria-labelledby="print-how" className="rounded-lg border border-rule bg-panel p-4">
            <h2 id="print-how" className="text-[15px] font-bold">
              인쇄하고 붙이는 순서
            </h2>
            <ol className="mt-2 grid gap-2 text-[13px]">
              {STEPS.map((t, i) => (
                <li key={i} className="flex gap-2">
                  <span className="grid size-5 shrink-0 place-items-center rounded-full bg-ink text-[11px] font-bold text-white">{i + 1}</span>
                  <span>{t}</span>
                </li>
              ))}
            </ol>
          </section>
          <p className="px-1 text-[12px] text-steel">
            시편 안에는 글자나 QR이 없어요. 웹은 등록한 정상·불량 기준과 무늬를 비교해서만 판정해요. 인쇄 품질·조명·카메라 높이에 따라 결과가 달라지니, 실제 카메라로 정상·불량을 각각 10회 이상 다시
            찍어 확인해요.
          </p>
        </aside>
      </main>

      <div className="hidden print:block">
        {sheets.map((ids, i) => (
          <Sheet key={i} ids={ids} page={i + 1} pages={sheets.length} />
        ))}
      </div>
    </div>
  );
}
