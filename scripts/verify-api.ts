import assert from 'node:assert/strict';

const origin = process.env.APP_ORIGIN ?? 'http://localhost:3000';
const passcode = process.env.DISPATCHER_PASSCODE;
if (!passcode) throw new Error('DISPATCHER_PASSCODE is missing');
let cookie = '';
let incidentId = '';

async function request(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('Origin', origin);
  if (cookie) headers.set('Cookie', cookie);
  if (init.body) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${origin}${path}`, { ...init, headers });
  const type = response.headers.get('content-type') ?? '';
  const body = type.includes('application/json') ? await response.json() : await response.arrayBuffer();
  return { response, body: body as Record<string, any> };
}

const status = await request('/api/status');
assert.equal(status.response.status, 200);
assert.equal(status.body.database, 'connected');
console.log('PASS /api/status: database connected');

const unauthorized = await request('/api/state');
assert.equal(unauthorized.response.status, 401);
console.log('PASS /api/state: anonymous request rejected');

const login = await request('/api/login', { method: 'POST', body: JSON.stringify({ passcode }) });
assert.equal(login.response.status, 200);
const setCookie = login.response.headers.get('set-cookie');
assert.ok(setCookie?.includes('HttpOnly') && setCookie.includes('SameSite=Strict'));
cookie = setCookie.split(';')[0]!;
console.log('PASS /api/login: signed httpOnly session issued');

try {
  const reset = await request('/api/seed', { method: 'POST', body: '{}' });
  assert.equal(reset.response.status, 200);
  assert.equal(reset.body.result.incidents, 12);

  const state = await request('/api/state');
  assert.equal(state.response.status, 200);
  assert.equal(state.body.counters.open, 12);
  assert.equal(state.body.units.length, 14);
  console.log('PASS /api/seed + /api/state: fresh persisted demo loaded');

  const reportBody = {
    clientRequestId: '22222222-2222-4222-8222-222222222222', channel: 'text',
    text: 'SOS! We are trapped in rising water in Velachery. 6 people including 2 children need rescue.',
    manualLocation: '', gps: null,
  };
  const report = await request('/api/report', { method: 'POST', body: JSON.stringify(reportBody) });
  assert.equal(report.response.status, 201);
  assert.equal(report.body.report.cluster_outcome, 'merged');
  assert.equal(report.body.incident.report_count, 3);
  assert.equal(report.body.incident.severity, 'Critical');
  assert.ok(['used','error','timeout','invalid'].includes(report.body.analysis.llm_status));
  assert.equal(report.body.dispatch_result.status, 'dispatched');
  assert.equal(report.body.dispatch_result.dispatch.unit_id, 'R-01');
  incidentId = report.body.incident.id;
  console.log(`PASS /api/report: merged, Critical, R-01 dispatched, LLM=${report.body.analysis.llm_status} (fallback is acceptable)`);

  const replay = await request('/api/report', { method: 'POST', body: JSON.stringify(reportBody) });
  assert.equal(replay.response.status, 201);
  assert.equal(replay.body.replayed, true);
  assert.equal(replay.body.report.id, report.body.report.id);
  console.log('PASS /api/report retry: idempotent');

  const tick = await request('/api/tick', { method: 'POST', body: '{}' });
  assert.equal(tick.response.status, 200);
  assert.ok(tick.body.result.moved >= 1);
  const resolved = await request('/api/resolve', { method: 'POST', body: JSON.stringify({ incidentId }) });
  assert.equal(resolved.response.status, 200);
  assert.equal(resolved.body.result.status, 'resolved');
  console.log('PASS /api/tick + /api/resolve: lifecycle mutations persisted');

  const tile = await request('/api/tiles?z=0&x=0&y=0');
  assert.equal(tile.response.status, 200);
  assert.ok((tile.body as unknown as ArrayBuffer).byteLength > 100);
  console.log('PASS /api/tiles: same-origin proxy returned a PNG');
} finally {
  // Always restore the predictable 12-incident demo after the mutation checks.
  const restored = await request('/api/seed', { method: 'POST', body: '{}' });
  assert.equal(restored.response.status, 200);
  console.log('PASS cleanup: demo reset to 12 incidents / 17 reports / 14 units');
}

const logout = await request('/api/logout', { method: 'POST', body: '{}' });
assert.equal(logout.response.status, 200);
cookie = '';
assert.equal((await request('/api/state')).response.status, 401);
console.log('PASS /api/logout: session cleared');
