import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { cloudStatusText, useCloud } from '../../app/useCloud';
import { getStation } from '../../app/useStation';
import { btn } from './kit';

export function CloudPanel() {
  const cloud = useCloud();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [consent, setConsent] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const service = getStation().cloud;
  const configured = cloud.state !== 'unconfigured';
  const signedIn = Boolean(cloud.ownerId) && cloud.state !== 'auth_required';

  useEffect(() => {
    setConsent(false);
    setNotice(null);
  }, [cloud.ownerId, cloud.unassigned]);

  async function login(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy || !configured) return;
    setBusy(true);
    setNotice(null);
    const submittedPassword = password;
    setPassword('');
    try {
      await service.login(email.trim(), submittedPassword);
    } catch {
      setNotice('로그인하지 못했어요. 팀 계정과 연결 상태를 확인해 주세요.');
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    setNotice(null);
    setPassword('');
    try {
      await service.signOut();
    } catch {
      setNotice('로그아웃 상태를 확인하지 못했어요. 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  }

  async function backfill() {
    if (!consent || !signedIn || busy) return;
    setBusy(true);
    setNotice(null);
    setConsent(false);
    try {
      await service.backfill();
      setNotice('기존 항목을 팀 저장 대기열에 넣었어요. 뒤에서 차례로 올려요.');
    } catch {
      setNotice('기존 항목을 대기열에 넣지 못했어요. 이 PC의 기록은 유지돼요.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section data-testid="cloud-panel" aria-labelledby="cloud-heading" className="mx-4 mt-4 rounded-lg border border-rule bg-panel p-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h2 id="cloud-heading" className="text-[15px] font-bold">팀 계정 · 기록 저장</h2>
        <p data-testid="cloud-status" aria-live="polite" className="text-[13px] text-steel">{cloudStatusText(cloud)}</p>
        <Link to="/team" target="_blank" rel="noopener" className="ml-auto text-[13px] font-semibold text-signal underline-offset-2 hover:underline">팀 기록 보기<span className="sr-only"> (새 탭)</span></Link>
      </div>
      {!configured && <p className="mt-2 text-[13px] text-steel">팀 저장 연결 설정이 아직 없어요. 카메라 검사와 이 PC 저장은 계속 사용할 수 있어요.</p>}
      {signedIn ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span data-testid="cloud-email" className="text-[13px] font-semibold">{cloud.email ?? '팀 계정'}</span>
          <button data-testid="cloud-logout" type="button" className={btn.small} disabled={busy} onClick={() => void signOut()}>로그아웃</button>
          <button data-testid="cloud-retry" type="button" className={btn.small} disabled={busy} onClick={() => service.retry()}>저장 다시 시도</button>
        </div>
      ) : (
        <form onSubmit={(e) => void login(e)} className="mt-3 flex flex-wrap items-end gap-3" aria-label="팀 계정 로그인">
          <label className="flex min-w-[200px] flex-1 flex-col gap-1 text-[12px] text-steel">
            팀 계정 이메일
            <input data-testid="cloud-email-input" name="email" type="email" required autoComplete="username" value={email} disabled={!configured || busy} onChange={(e) => setEmail(e.target.value)} className="rounded-md border border-rule bg-panel px-3 py-2 text-[14px] text-ink disabled:bg-paper" />
          </label>
          <label className="flex min-w-[180px] flex-1 flex-col gap-1 text-[12px] text-steel">
            비밀번호
            <input data-testid="cloud-password-input" name="password" type="password" required autoComplete="current-password" value={password} disabled={!configured || busy} onChange={(e) => setPassword(e.target.value)} className="rounded-md border border-rule bg-panel px-3 py-2 text-[14px] text-ink disabled:bg-paper" />
          </label>
          <button data-testid="cloud-login" type="submit" className={btn.primary} disabled={!configured || busy}>{busy ? '확인 중이에요' : '팀 계정 로그인'}</button>
        </form>
      )}
      {(notice || cloud.error) && <p role="alert" className="mt-2 text-[13px] text-hold-ink">{notice ?? cloud.error?.message}</p>}
      {signedIn && cloud.unassigned > 0 && (
        <div className="mt-3 rounded-md border border-rule bg-paper p-3">
          <p className="text-[13px]">로그인 전에 이 PC에 남은 항목이 <strong>{cloud.unassigned}건</strong> 있어요. 현재 계정 <strong>{cloud.email ?? '팀 계정'}</strong>에 올릴지 선택해 주세요.</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-[13px]">
              <input data-testid="cloud-backfill-consent" type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} disabled={busy} />
              현재 팀 계정에 기존 항목을 올리는 데 동의해요
            </label>
            <button data-testid="cloud-backfill" type="button" className={btn.secondary} disabled={!consent || busy} onClick={() => void backfill()}>기존 항목 올리기</button>
          </div>
          <p className="mt-1 text-[12px] text-steel">동의하기 전에는 이 PC에만 남아요. 다른 계정에 속한 항목은 옮기지 않아요.</p>
        </div>
      )}
      <p className="mt-2 text-[12px] text-steel">기준 사진은 PC마다 따로 보관해요. 다른 PC의 기준을 자동 적용하지 않아요. 팀 저장이 지연돼도 검사와 결과 전달은 계속돼요.</p>
    </section>
  );
}
