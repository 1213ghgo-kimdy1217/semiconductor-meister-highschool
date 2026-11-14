// 시험 모드 브라우저 시나리오: 가상 카메라 + 가상 Uno·PLC·HMI. 실제 장치 시험이 아니다.
// 실행: 개발 서버(npm run dev)를 켠 상태에서
//   npm i --no-save playwright && npx playwright install chromium
//   node tests/e2e/sim-flow.cjs [주소, 기본 http://localhost:5173]
// 개발 서버에서만 동작한다 (상태를 읽는 window.__station 은 개발 빌드에만 있다).
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const BASE = process.argv[2] || 'http://localhost:5173';
const results = [];

function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('dialog', (d) => d.accept());
  page.setDefaultTimeout(15000);

  const wait = (ms) => page.waitForTimeout(ms);
  const tx = () => page.evaluate(() => window.__station.link.log.filter((e) => e.dir === 'tx').map((e) => e.text));
  const sim = () =>
    page.evaluate(() => {
      const s = window.__station.getSnapshot().sim?.snapshot;
      return s && { phase: s.phase, step: s.plcStep, fault: s.faultCode, at: s.wafer?.at ?? null, collection: s.collection, cycle: s.cycle };
    });
  const resultsFor = async (c) => (await tx()).filter((t) => new RegExp(`^V1,RESULT,\\d+,\\d+,${c},\\d+,(OK|NG)$`).test(t));
  const failedFor = async (c) => (await tx()).filter((t) => t.match(new RegExp(`^V1,CAPTURE_FAILED,\\d+,${c}$`)));
  const lastRecord = () =>
    page.evaluate(() => {
      const r = window.__station.getSnapshot().records[0];
      return r && { cycle: r.cycle, verdict: r.verdict, plc: r.plc, released: r.released, collected: r.collectionConfirmed, mode: r.mode };
    });
  const until = async (fn, ms = 15000) => {
    const t0 = Date.now();
    for (;;) {
      const v = await fn();
      if (v) return v;
      if (Date.now() - t0 > ms) return null;
      await wait(200);
    }
  };

  try {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: '시험 모드' }).click();
    check('시험 모드가 상단에 표시된다', (await page.locator('header').innerText()).includes('시험 모드 — 실제 포트를 열지 않고'));

    await page.getByRole('button', { name: '카메라 연결' }).click();
    await page.getByRole('button', { name: '장치 연결' }).click();
    const online = await until(async () => (await sim())?.phase === 'NEED_HOME' && (await tx()).length >= 4);
    const first = await tx();
    check(
      '연결 직후 HELLO 한 번, 그 뒤 PING/STATUS만 보낸다 (웹은 아무것도 움직이지 않음)',
      online && first.filter((t) => t.startsWith('V1,HELLO,')).length === 1 && first.every((t) => /^V1,(HELLO|PING|STATUS),\d+$/.test(t)),
    );
    check('연결 직후 장치는 원점 복귀 필요로 대기 (자동 운전 없음)', (await sim())?.step === 'idle');

    // ---- 기준 사진 등록
    const bench = page.getByRole('group', { name: '가상 작업대' });
    await page.getByRole('button', { name: '기준 사진 등록' }).click();
    for (const [item, idx] of [['빈 자리', 0], ['정상 시편 A', 1], ['불량 시편 A', 2]]) {
      await bench.getByRole('button', { name: item, exact: true }).click();
      await wait(300);
      await page.locator('[aria-labelledby="ref-title"] li').nth(idx).getByRole('button', { name: /찍기/ }).click();
      await page.waitForFunction((i) => document.querySelectorAll('[aria-labelledby="ref-title"] li')[i]?.querySelector('canvas'), idx);
    }
    check('기준 사진 3종 등록 (빈 자리·정상·불량, 새 프레임 8장 평균)', true);

    // ---- 검사만 시험 (장치로 보내지 않음)
    const runCheck = async (item, expected) => {
      await bench.getByRole('button', { name: item, exact: true }).click();
      await wait(300);
      await page.getByLabel('놓은 것').selectOption(expected);
      await page.getByRole('button', { name: '검사만 시험' }).click();
      await page.waitForFunction(() => !document.body.innerText.includes('검사 중…'));
      const v = await page.locator('[aria-labelledby="verdict-title"]').innerText();
      return v.includes('정상 OK') ? 'OK' : v.includes('불량 NG') ? 'NG' : v.includes('판정보류') ? 'HOLD' : '?';
    };
    const many = async (item, expected, n) => {
      const out = [];
      for (let i = 0; i < n; i++) out.push(await runCheck(item, expected));
      return out;
    };
    const ok = await many('정상 시편 A', 'ok', 3);
    check('검사만 시험: 정상 시편 3회 → 모두 OK', ok.every((v) => v === 'OK'), ok.join(' '));
    const ng = await many('불량 시편 A', 'ng', 3);
    check('검사만 시험: 불량 시편 3회 → 모두 NG', ng.every((v) => v === 'NG'), ng.join(' '));
    const empty = await many('빈 자리', 'empty', 2);
    check('검사만 시험: 빈 자리 2회 → 판정보류', empty.every((v) => v === 'HOLD'), empty.join(' '));
    await page.getByRole('button', { name: '손 가림' }).click();
    const hand = await many('정상 시편 A', 'occluded', 2);
    await page.getByRole('button', { name: '✓ 손 가림' }).click();
    check('검사만 시험: 손 가림 2회 → 판정보류', hand.every((v) => v === 'HOLD'), hand.join(' '));
    check('검사만 시험은 장치로 결과를 보내지 않는다', (await tx()).every((t) => !t.startsWith('V1,RESULT')));

    // ---- 가상 HMI로 실제 사이클
    await bench.getByRole('button', { name: '치우기' }).click();
    await page.getByRole('button', { name: '닫기' }).click();
    await page.getByRole('button', { name: '준비 · 운전 허가' }).click();
    await page.getByRole('button', { name: '원점 복귀 (100)' }).click();
    check('HMI 원점 복귀 뒤 정지 게이트 닫힘 대기', await until(async () => (await sim())?.phase === 'IDLE_CLOSED'));
    const start = page.getByRole('group', { name: '한 장 투입 · 시작' });
    const waitCollection = () => until(async () => ((await sim())?.step === 'wait_collection' ? sim() : null), 20000);
    const confirm = async () => {
      await page.getByRole('button', { name: '수거 확인' }).click();
      await until(async () => (await sim())?.step === 'idle');
    };

    for (const [label, verdict, cassette] of [
      ['정상 시편 A 투입', 'OK', 'cassette_ok'],
      ['불량 시편 A 투입', 'NG', 'cassette_ng'],
    ]) {
      const c = (await sim()).cycle + 1;
      await start.getByRole('button', { name: label }).click();
      const s = await waitCollection();
      const r = await resultsFor(c);
      check(`${label}: 결과 ${verdict} 한 번 → ${cassette === 'cassette_ok' ? '정상' : '불량'} 카세트로 배출`, s && r.length === 1 && r[0].endsWith(`,${verdict}`) && s.at === cassette, r.join(' / '));
      const rec = await lastRecord();
      check(`${label}: 기록에 PLC 전달·배출 종료·실물 수거 미확인을 따로 남긴다`, rec && rec.cycle === c && rec.plc === 'valid' && rec.released && !rec.collected && rec.mode === 'sim');
      await confirm();
      const after = await lastRecord();
      check(`${label}: 가상 HMI가 수거를 확인해도 웹은 그 신호를 받지 못해 '미확인'을 유지`, after && !after.collected);
    }

    // ---- 손 가림 중 투입
    await page.getByRole('button', { name: '손 가림' }).click();
    const c3 = (await sim()).cycle + 1;
    await start.getByRole('button', { name: '정상 시편 A 투입' }).click();
    await wait(6000);
    check('손으로 가린 6초 동안 결과·촬영 실패를 보내지 않는다', (await resultsFor(c3)).length === 0 && (await failedFor(c3)).length === 0 && (await sim()).step === 'wait_result');
    await page.getByRole('button', { name: '✓ 손 가림' }).click();
    const s3 = await waitCollection();
    check('손을 치우면 그때 OK를 한 번 보낸다', s3 && (await resultsFor(c3)).length === 1);
    await confirm();

    // ---- 빈 트레이 투입 → 카메라 끊김
    const c4 = (await sim()).cycle + 1;
    await start.getByRole('button', { name: '빈 트레이 (물체 없음) 투입' }).click();
    await wait(5000);
    const hud = await page.locator('[role=status]').first().innerText();
    check('빈 트레이: 결과를 보내지 않고 원판을 기다린다', (await resultsFor(c4)).length === 0 && hud.includes('원판이 보이길 기다려요'), hud);
    await page.getByRole('button', { name: '카메라 끊김' }).click();
    const held = await until(async () => ((await sim())?.phase === 'HOLD_FAULT' ? sim() : null));
    check(
      '검사 중 카메라 끊김: CAPTURE_FAILED 한 번 → 장치 HOLD, 결과·방출 없음',
      held && held.fault === 'CAPTURE_FAILED' && (await failedFor(c4)).length === 1 && (await resultsFor(c4)).length === 0 && held.at === 'gate',
      held ? `${held.phase} · ${held.fault} · 원판 ${held.at}` : '',
    );
    await wait(3000);
    check('HOLD는 자동으로 풀리거나 재개되지 않는다 (HMI 복구 필요)', (await sim())?.phase === 'HOLD_FAULT' && (await resultsFor(c4)).length === 0);

    // ---- 검사 화면이 뒤로 감 (브라우저가 타이머를 늦춤)
    const setHidden = (hidden) =>
      page.evaluate((h) => {
        Object.defineProperty(document, 'hidden', { value: h, configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
      }, hidden);
    await setHidden(true);
    await setHidden(false);
    const notes = await page.evaluate(() => window.__station.link.log.filter((e) => e.dir === 'sys').map((e) => e.text));
    check('검사 화면이 뒤로 가면 통신 기록에 HOLD 가능 경고를 남긴다', notes.some((t) => t.includes('검사 화면이 뒤로 갔어요')) && notes.some((t) => t.includes('다시 앞에')));

    // ---- 새로고침
    const n = await page.evaluate(() => window.__station.getSnapshot().records.length);
    await page.reload({ waitUntil: 'networkidle' });
    await wait(1500);
    const st = await page.evaluate(() => ({ link: window.__station.link.snapshot.phase, cam: window.__station.camera.snapshot.phase }));
    check('새로고침 뒤 카메라·장치를 자동으로 다시 열지 않는다', st.link === 'closed' && st.cam === 'off', JSON.stringify(st));
    const kept = await until(async () => (await page.evaluate(() => window.__station.getSnapshot().records.length)) >= n);
    check('새로고침 뒤에도 기록이 남아 있다 (이 브라우저 저장소)', kept, `${n}건`);
  } catch (e) {
    check('시나리오가 끝까지 진행된다', false, String(e).split('\n')[0]);
  } finally {
    check('브라우저 콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
    await browser.close();
    const bad = results.filter((r) => !r.ok).length;
    console.log(`\n${results.length - bad}/${results.length} 통과`);
    process.exitCode = bad ? 1 : 0;
  }
})();
