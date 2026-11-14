// Browser integration tests with a mock cloud. No real account, key, database,
// camera or serial port is used. Actual RLS/Storage checks are a separate suite.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const BASE = process.argv[2] || 'http://localhost:5173';
const CLOUD = 'https://wafer-test.supabase.co';
const OWNER_A = '11111111-1111-4111-8111-111111111111';
const OWNER_B = '22222222-2222-4222-8222-222222222222';
const SEED_ID = '33333333-3333-4333-8333-333333333333';
const REMOTE_ID = '44444444-4444-4444-8444-444444444444';
const results = [];

function check(name, ok) {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
}

function seedRecord(id = SEED_ID) {
  return {
    id, mode: 'check', camera: 'virtual', expected: 'ok', deviceSession: null,
    cycle: null, capture: null, frameIds: [], verdict: 'OK', holdReason: null,
    attempts: 1, trail: [], method: 'mock-old-record', version: 'migration-fixture',
    calibrationVersion: 1, scores: null, requestedAt: '2026-11-01T01:00:00.000Z',
    firstFrameAt: null, decidedAt: '2026-11-01T01:00:01.000Z', cameraLabel: 'migration fixture',
    plc: 'none', plcDetail: null, route: null, released: false,
    collectionConfirmed: false, faultCode: null, closedWhy: null, thumb: null,
    updatedAt: '2026-11-01T01:00:01.000Z',
  };
}

function user(owner) {
  const email = owner === OWNER_A ? 'team-a@example.test' : 'team-b@example.test';
  return {
    id: owner, aud: 'authenticated', role: 'authenticated', email,
    email_confirmed_at: '2026-01-01T00:00:00.000Z', phone: '',
    app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {},
    identities: [], created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z', is_anonymous: false,
  };
}

function session(owner) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
    sub: owner, aud: 'authenticated', role: 'authenticated',
    email: user(owner).email, iat: now, exp: now + 3600, is_anonymous: false,
  })}.mock_signature_not_a_credential`;
  return { access_token: token, token_type: 'bearer', expires_in: 3600,
    expires_at: now + 3600, refresh_token: `mock-refresh-${owner}`, user: user(owner) };
}

function ownerFrom(request) {
  try {
    const token = request.headers().authorization?.replace(/^Bearer /i, '') ?? '';
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub;
  } catch { return null; }
}

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  const inspections = new Map();
  const events = new Map();
  const settings = new Map();
  const uploadedImages = new Set();
  const writeOwners = [];
  let cloudUnavailable = false;
  let historyRequests = 0;
  const historyModes = [];
  let delayPasswordLogin = false;
  let delayedLoginEntered = false;
  let releaseDelayedLogin = null;
  let raceInspectionId = null;
  let delayedWriteEntered = false;
  let releaseDelayedWrite = null;
  let newerWriteOverlapped = false;
  const raceWriteOrder = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('dialog', (dialog) => dialog.accept());
  page.setDefaultTimeout(15000);

  const fulfill = (route, data, status = 200, headers = {}) => route.fulfill({
    status, contentType: 'application/json', body: JSON.stringify(data),
    headers: { 'access-control-allow-origin': '*', ...headers },
  });
  await context.route('**/api/cloud-config', (route) => fulfill(route, {
    url: CLOUD, publishableKey: 'sb_publishable_mock_for_browser_tests_only',
  }));
  await context.route(`${CLOUD}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const owner = ownerFrom(request);
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: {
      'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
      'access-control-allow-headers': '*', 'access-control-expose-headers': 'content-range',
    } });
    if (url.pathname === '/auth/v1/token') {
      const body = request.postDataJSON();
      const id = body.email === 'team-b@example.test' || body.refresh_token?.includes(OWNER_B) ? OWNER_B : OWNER_A;
      if (delayPasswordLogin && url.searchParams.get('grant_type') === 'password') {
        delayedLoginEntered = true;
        await new Promise((resolve) => { releaseDelayedLogin = resolve; });
      }
      return fulfill(route, session(id));
    }
    if (url.pathname === '/auth/v1/user') return fulfill(route, user(owner || OWNER_A));
    if (url.pathname === '/auth/v1/logout') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
    if (cloudUnavailable) return fulfill(route, { code: 'MOCK_NETWORK_DOWN', message: 'Mock network unavailable' }, 503);
    if (url.pathname.startsWith('/storage/v1/object/')) {
      if (method === 'POST' || method === 'PUT') {
        uploadedImages.add(url.pathname);
        return fulfill(route, { Key: url.pathname.replace('/storage/v1/object/', ''), Id: REMOTE_ID });
      }
      return route.fulfill({ status: 200, contentType: 'image/png',
        body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64'),
        headers: { 'access-control-allow-origin': '*' } });
    }
    if (url.pathname.startsWith('/rest/v1/')) {
      const table = url.pathname.split('/').pop();
      const target = table === 'inspections' ? inspections : table === 'events' ? events : settings;
      if (method !== 'GET' && method !== 'HEAD') {
        const data = request.postDataJSON();
        const rows = Array.isArray(data) ? data : [data];
        for (const row of rows) {
          if (table === 'inspections' && row.id === raceInspectionId) {
            if (row.method === 'multi-tab-old' && !delayedWriteEntered) {
              delayedWriteEntered = true;
              await new Promise((resolve) => { releaseDelayedWrite = resolve; });
            } else if (row.method === 'multi-tab-new' && releaseDelayedWrite) {
              newerWriteOverlapped = true;
            }
          }
          writeOwners.push({ tokenOwner: owner, rowOwner: row.owner_id, table, id: row.id });
          if (!owner || row.owner_id !== owner) return fulfill(route, { code: '42501', message: 'Mock ownership denied' }, 403);
          const key = table === 'inspections' ? row.id : table === 'events'
            ? `${row.owner_id}:${row.device_id}:${row.local_event_id}`
            : `${row.owner_id}:${row.device_id}:${row.camera_id}`;
          target.set(key, { ...target.get(key), ...row, created_at: row.created_at || row.requested_at || new Date().toISOString() });
          if (table === 'inspections' && row.id === raceInspectionId) raceWriteOrder.push(row.method);
        }
        return fulfill(route, rows, 201);
      }
      historyRequests++;
      let rows = [...target.values()].filter((row) => row.owner_id === owner);
      const mode = url.searchParams.get('mode')?.replace(/^eq\./, '');
      if (table === 'inspections') historyModes.push(mode);
      if (mode) rows = rows.filter((row) => row.mode === mode);
      rows.sort((a, b) => (b.requested_at || b.created_at).localeCompare(a.requested_at || a.created_at));
      const total = rows.length;
      const range = request.headers().range?.match(/(\d+)-(\d+)/);
      const offset = Number(url.searchParams.get('offset') || range?.[1] || 0);
      const limit = Number(url.searchParams.get('limit') || (range ? Number(range[2]) - offset + 1 : total || 1));
      rows = rows.slice(offset, offset + limit);
      const contentRange = rows.length ? `${offset}-${offset + rows.length - 1}/${total}` : `*/${total}`;
      return fulfill(route, rows, 200, { 'content-range': contentRange, 'access-control-expose-headers': 'content-range' });
    }
    return fulfill(route, { message: 'Unexpected mock route' }, 404);
  });

  const wait = (ms) => page.waitForTimeout(ms);
  const until = async (fn, ms = 20000) => {
    const start = Date.now();
    for (;;) {
      const value = await fn();
      if (value) return value;
      if (Date.now() - start > ms) return null;
      await wait(150);
    }
  };
  const cloud = () => page.evaluate(() => window.__station.cloud.snapshot);
  const outbox = () => page.evaluate(() => window.__station.store.listOutbox());
  const login = async (who) => {
    await page.getByTestId('cloud-email-input').fill(`team-${who}@example.test`);
    await page.getByTestId('cloud-password-input').fill('mock-password-for-browser-tests-only');
    await page.getByTestId('cloud-login').click();
    const owner = who === 'a' ? OWNER_A : OWNER_B;
    return until(async () => (await cloud()).ownerId === owner);
  };
  const settled = () => until(async () => {
    const snapshot = await cloud();
    const local = await page.evaluate(() => window.__station.store.status);
    return snapshot.state === 'ready' && snapshot.pending === 0
      && local.state === 'ok' && local.pending === 0
      && !(await outbox()).some((item) => item.ownerId === snapshot.ownerId);
  });

  try {
    // Seed a real version-1 database before the application opens it.
    await page.route('**/__cloud-e2e-seed', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Fixture</title>' }));
    await page.goto(`${BASE}/__cloud-e2e-seed`);
    await page.evaluate(async (record) => {
      await new Promise((resolve, reject) => {
        const request = indexedDB.open('wafer-inspection-4inch', 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          db.createObjectStore('kv');
          db.createObjectStore('records', { keyPath: 'id' }).createIndex('byTime', 'requestedAt');
          db.createObjectStore('events', { keyPath: 'id', autoIncrement: true }).createIndex('byRecord', 'recordId');
        };
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(['kv', 'records', 'events'], 'readwrite');
          tx.objectStore('kv').put({ preserved: true }, 'migration-probe');
          tx.objectStore('records').put(record);
          tx.objectStore('events').add({ recordId: record.id, type: 'migration-probe', payload: { preserved: true }, createdAt: record.requestedAt });
          tx.oncomplete = () => { db.close(); resolve(); };
          tx.onerror = () => reject(tx.error);
        };
      });
    }, seedRecord());
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__station?.cloud && window.__station.store.status.state !== 'opening');
    const migrated = await page.evaluate(async () => {
      const station = window.__station;
      const marker = await station.store.getKv('migration-probe');
      const records = await station.store.allRecords();
      const events = await station.store.allEvents();
      const schema = await new Promise((resolve) => {
        const request = indexedDB.open('wafer-inspection-4inch');
        request.onsuccess = () => { const db = request.result; resolve({ version: db.version, stores: [...db.objectStoreNames] }); db.close(); };
      });
      return { marker, records, events, schema };
    });
    check('IDB 1→2 preserves settings, records and events and adds outbox', migrated.schema.version === 2
      && migrated.schema.stores.includes('outbox') && migrated.marker?.preserved
      && migrated.records.some((record) => record.id === SEED_ID)
      && migrated.events.some((event) => event.type === 'migration-probe'));
    check('Signed-out records stay on this PC', (await cloud()).ownerId === null && inspections.size === 0);
    check('Login panel has no sign-up action', await page.getByTestId('cloud-login').count() === 1
      && await page.getByRole('button', { name: /회원가입|가입하기/ }).count() === 0);

    check('Team account A can log in through the panel', await login('a'));
    await wait(500);
    check('Pre-login records are not uploaded without explicit consent', !inspections.has(SEED_ID));
    check('Backfill button requires consent', await page.getByTestId('cloud-backfill').isDisabled());
    await page.getByTestId('cloud-backfill-consent').check();
    await page.getByTestId('cloud-backfill').click();
    await settled();
    check('Consented local record is uploaded under account A', inspections.get(SEED_ID)?.owner_id === OWNER_A);
    check('Historical event follows its inspection and keeps its local identity', [...events.values()].some((event) =>
      event.inspection_id === SEED_ID && event.owner_id === OWNER_A && Number.isInteger(event.local_event_id)));

    // Real application simulation path, while the cloud fails.
    await page.getByRole('button', { name: '시험 모드', exact: true }).click();
    await page.getByRole('button', { name: '카메라 연결', exact: true }).click();
    await page.getByRole('button', { name: '장치 연결', exact: true }).click();
    await until(() => page.evaluate(() => window.__station.getSnapshot().sim?.snapshot.phase === 'NEED_HOME'));
    const bench = page.getByRole('group', { name: '가상 작업대' });
    await page.getByRole('button', { name: '기준 사진 등록', exact: true }).click();
    for (const [item, index] of [['빈 자리', 0], ['정상 시편 A', 1], ['불량 시편 A', 2]]) {
      await bench.getByRole('button', { name: item, exact: true }).click();
      await wait(300);
      await page.locator('[aria-labelledby="ref-title"] li').nth(index).getByRole('button', { name: /찍기/ }).click();
      await page.waitForFunction((i) => document.querySelectorAll('[aria-labelledby="ref-title"] li')[i]?.querySelector('canvas'), index);
    }
    await bench.getByRole('button', { name: '치우기', exact: true }).click();
    await page.getByRole('button', { name: '닫기', exact: true }).click();
    await page.getByRole('button', { name: '준비 · 운전 허가', exact: true }).click();
    await page.getByRole('button', { name: '원점 복귀 (100)', exact: true }).click();
    await until(() => page.evaluate(() => window.__station.getSnapshot().sim?.snapshot.phase === 'IDLE_CLOSED'));
    await settled();
    check('Reference images use account/device folders', [...uploadedImages].some((path) => path.includes(`/${OWNER_A}/refs/`)));
    cloudUnavailable = true;
    await page.getByRole('group', { name: '한 장 투입 · 시작' }).getByRole('button', { name: '정상 시편 A 투입', exact: true }).click();
    const completed = await until(() => page.evaluate(() => {
      const station = window.__station;
      const record = station.getSnapshot().records[0];
      return station.getSnapshot().sim?.snapshot.plcStep === 'wait_collection' && record?.mode === 'sim'
        ? { record, tx: station.link.log.filter((entry) => entry.dir === 'tx').map((entry) => entry.text) } : null;
    }), 25000);
    check('Cloud failure does not stop OK decision and simulated PLC result', completed?.record.verdict === 'OK'
      && completed.record.plc === 'valid' && completed.tx.some((line) => /^V1,RESULT,\d+,\d+,\d+,\d+,OK$/.test(line)));
    const pending = await until(async () => (await cloud()).pending > 0 && (await outbox()).length > 0);
    check('Failed uploads remain in a durable IndexedDB queue', pending);
    await until(async () => /대기|실패|다시|연결/.test(await page.getByTestId('cloud-status').innerText()));
    check('Storage status shows pending upload or retry', /대기|실패|다시|연결/.test(await page.getByTestId('cloud-status').innerText()));
    const queuedIds = (await outbox()).filter((item) => item.ownerId === OWNER_A).map((item) => item.key);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__station?.cloud && window.__station.store.status.state !== 'opening');
    await until(async () => (await cloud()).ownerId === OWNER_A);
    const persisted = await outbox();
    check('Reload preserves account A upload queue', queuedIds.length > 0 && queuedIds.every((key) => persisted.some((item) => item.key === key && item.ownerId === OWNER_A)));
    await page.getByTestId('cloud-logout').click();
    await until(async () => (await cloud()).ownerId === null);
    check('Logging out retains queued records locally', (await outbox()).some((item) => item.ownerId === OWNER_A));
    cloudUnavailable = false;
    check('A different account B can log in', await login('b'));
    await wait(800);
    check('Account B does not adopt account A queue', (await outbox()).some((item) => item.ownerId === OWNER_A)
      && !writeOwners.some((write) => write.tokenOwner === OWNER_B && write.rowOwner === OWNER_A));

    // Write through the same local persistence seam used by the station.
    const bRecord = seedRecord('55555555-5555-4555-8555-555555555555');
    bRecord.updatedAt = bRecord.requestedAt = new Date().toISOString();
    await page.evaluate((record) => window.__station.store.putRecord(record), bRecord);
    await until(() => inspections.has(bRecord.id));
    check('New account B records sync without draining account A queue', inspections.get(bRecord.id)?.owner_id === OWNER_B
      && (await outbox()).some((item) => item.ownerId === OWNER_A));
    await page.getByTestId('cloud-logout').click();
    await until(async () => (await cloud()).ownerId === null);
    await login('a');
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await settled();
    check('Returning online with account A resumes its saved queue', completed && inspections.get(completed.record.id)?.owner_id === OWNER_A
      && !(await outbox()).some((item) => item.ownerId === OWNER_A));
    check('Repeated updates keep one cloud row per inspection', completed && [...inspections.values()].filter((row) => row.id === completed.record.id).length === 1);
    check('Inspection thumbnails upload to owner inspection folders', completed && [...uploadedImages].some((path) => path.endsWith(`/${OWNER_A}/inspections/${completed.record.id}.png`)));

    const remote = { ...inspections.get(SEED_ID), id: REMOTE_ID, device_id: '66666666-6666-4666-8666-666666666666',
      mode: 'sim', camera_label: '다른 PC 시험 기록', requested_at: '2026-11-14T13:00:00.000Z', created_at: '2026-11-14T13:00:00.000Z' };
    inspections.set(REMOTE_ID, remote);
    const historyBefore = historyRequests;
    await page.goto(`${BASE}/team`, { waitUntil: 'networkidle' });
    await page.getByTestId('team-records').waitFor();
    await page.getByTestId('team-mode').selectOption('sim');
    await until(async () => (await page.getByTestId('team-records').innerText()).includes('다른 PC 시험 기록'));
    check('Team history reads another PC record from cloud', historyRequests > historyBefore
      && (await page.getByTestId('team-records').innerText()).includes('다른 PC 시험 기록'));
    check('Team history can filter simulation records separately', historyModes.at(-1) === 'sim'
      && !(await page.getByTestId('team-records').innerText()).includes(SEED_ID.slice(0, 8)));
    const downloadReady = page.waitForEvent('download');
    await page.getByTestId('team-csv').click();
    const download = await downloadReady;
    const stream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const csv = Buffer.concat(chunks).toString('utf8');
    check('Team CSV downloads the selected cloud records', /\.csv$/i.test(download.suggestedFilename()) && csv.includes(REMOTE_ID));
    for (let index = 0; index < 27; index++) {
      const id = require('node:crypto').randomUUID();
      inspections.set(id, { ...remote, id, requested_at: new Date(Date.parse(remote.requested_at) + (index + 1) * 1000).toISOString() });
    }
    await page.getByTestId('team-refresh').click();
    await page.getByTestId('team-next').waitFor({ state: 'visible' });
    await until(async () => await page.getByTestId('team-next').isEnabled());
    const firstPage = await page.getByTestId('team-records').innerText();
    await page.getByTestId('team-next').click();
    await until(async () => await page.getByTestId('team-prev').isEnabled());
    check('Team history loads later pages instead of only the local recent list', await page.getByTestId('team-prev').isEnabled()
      && (await page.getByTestId('team-records').innerText()) !== firstPage);

    // Regression: an old sign-in response must not undo a later logout.
    await page.getByTestId('cloud-logout').click();
    await until(async () => (await cloud()).ownerId === null);
    delayPasswordLogin = true;
    await page.evaluate(() => {
      window.__e2eLogin = window.__station.cloud.login('team-a@example.test', 'mock-password-for-browser-tests-only')
        .then(() => 'resolved', () => 'cancelled');
    });
    await until(() => delayedLoginEntered);
    await page.evaluate(() => { window.__e2eLogout = window.__station.cloud.signOut(); });
    const finishLogin = releaseDelayedLogin;
    releaseDelayedLogin = null;
    delayPasswordLogin = false;
    finishLogin?.();
    await page.evaluate(async () => { await Promise.all([window.__e2eLogin, window.__e2eLogout]); });
    await wait(400);
    const cancelledLogin = await page.evaluate(() => ({
      owner: window.__station.cloud.snapshot.ownerId,
      state: window.__station.cloud.snapshot.state,
      savedToken: localStorage.getItem('wafer-cloud-auth:wafer-test.supabase.co') !== null,
    }));
    check('A delayed login response cannot restore a logged-out session or saved token', delayedLoginEntered
      && cancelledLogin.owner === null && cancelledLogin.state === 'signed_out' && !cancelledLogin.savedToken);

    // Regression: both tabs share a device and durable queue. Hold the older
    // request while another tab commits a newer revision of the same record.
    await login('a');
    await settled();
    const secondPage = await context.newPage();
    secondPage.on('pageerror', (error) => errors.push(error.message));
    secondPage.setDefaultTimeout(15000);
    await secondPage.goto(`${BASE}/team`, { waitUntil: 'networkidle' });
    await secondPage.waitForFunction((id) => window.__station?.cloud.snapshot.ownerId === id, OWNER_A);
    const sharedDevice = await secondPage.evaluate(() => window.__station.store.deviceId);
    const firstDevice = await page.evaluate(() => window.__station.store.deviceId);
    raceInspectionId = '77777777-7777-4777-8777-777777777777';
    const oldRevision = { ...seedRecord(raceInspectionId), method: 'multi-tab-old', updatedAt: new Date().toISOString() };
    const newRevision = { ...oldRevision, method: 'multi-tab-new', updatedAt: new Date(Date.now() + 1000).toISOString() };
    await page.evaluate((record) => window.__station.store.putRecord(record), oldRevision);
    await until(() => delayedWriteEntered);
    await secondPage.evaluate((record) => window.__station.store.putRecord(record), newRevision);
    await until(() => secondPage.evaluate(async (id) => {
      const records = await window.__station.store.allRecords();
      return records.some((record) => record.id === id && record.method === 'multi-tab-new')
        && window.__station.store.status.pending === 0;
    }, raceInspectionId));
    await wait(500);
    const releaseOldWrite = releaseDelayedWrite;
    releaseDelayedWrite = null;
    releaseOldWrite?.();
    await until(async () => inspections.get(raceInspectionId)?.method === 'multi-tab-new'
      && !(await outbox()).some((item) => item.kind === 'inspection' && item.payload.id === raceInspectionId));
    check('Two tabs serialize read-upload-ack and preserve the newest server revision', firstDevice === sharedDevice
      && delayedWriteEntered && !newerWriteOverlapped
      && inspections.get(raceInspectionId)?.method === 'multi-tab-new'
      && raceWriteOrder[0] === 'multi-tab-old' && raceWriteOrder.at(-1) === 'multi-tab-new');
    await secondPage.close();
    check('Every mock cloud write uses its signed-in owner', writeOwners.length > 0 && writeOwners.every((write) => write.rowOwner === write.tokenOwner));
  } catch (error) {
    check('Cloud browser scenarios complete without exception', false);
    console.error(String(error).split('\n').slice(0, 4).join('\n'));
  } finally {
    releaseDelayedLogin?.();
    releaseDelayedWrite?.();
    check('No uncaught browser exceptions', errors.length === 0);
    await browser.close();
    const failures = results.filter((result) => !result.ok).length;
    console.log(`\n${results.length - failures}/${results.length} cloud browser checks passed (mock services; no hardware/RLS claim)`);
    process.exitCode = failures ? 1 : 0;
  }
})();
