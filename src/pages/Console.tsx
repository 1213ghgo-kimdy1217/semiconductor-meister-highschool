import { useState } from 'react';
import { useCamera, useLink, useStation, useStore } from '../app/useStation';
import type { Roi } from '../core/vision/image';
import { ProcessPanel } from '../ui/console/ProcessPanel';
import { RecordsPanel } from '../ui/console/RecordsPanel';
import { ReferencePanel } from '../ui/console/ReferencePanel';
import { SimPanel } from '../ui/console/SimPanel';
import { TopBar } from '../ui/console/TopBar';
import { VerdictPanel } from '../ui/console/VerdictPanel';
import { VideoPanel } from '../ui/console/VideoPanel';
import { CloudPanel } from '../ui/console/CloudPanel';

export default function Console() {
  const st = useStation();
  const cam = useCamera();
  const link = useLink();
  const store = useStore();
  const [refOpen, setRefOpen] = useState(false);
  const [draftRoi, setDraftRoi] = useState<Roi | null>(null);

  const closeRef = () => {
    setRefOpen(false);
    setDraftRoi(null);
  };

  return (
    <div className="min-h-screen">
      <TopBar st={st} cam={cam} link={link} store={store} />
      <CloudPanel />
      <main className="grid gap-4 p-4 xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <VideoPanel st={st} cam={cam} refOpen={refOpen} onToggleRef={() => (refOpen ? closeRef() : setRefOpen(true))} draftRoi={refOpen ? draftRoi : null} />
          {refOpen && <ReferencePanel st={st} draft={draftRoi} setDraft={setDraftRoi} onClose={closeRef} />}
          {st.mode === 'sim' && <SimPanel st={st} />}
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <ProcessPanel st={st} link={link} />
          <VerdictPanel st={st} />
        </div>
      </main>
      <RecordsPanel st={st} />
      <footer className="px-4 pb-6 text-[12px] text-steel">
        운전 시작·정지·복구는 HMI에서 해요. 이 화면은 촬영·판정과 결과 전달만 하고 모터나 게이트를 움직이는 명령을 보내지 않아요. PC의 Chrome 또는 Edge에서 쓰세요.
      </footer>
    </div>
  );
}

