import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { VercelRequest } from '@vercel/node';
import { createSessionToken, passcodeMatches, requireDispatcher } from '../api/_lib/auth';
import { clearEnvCacheForTests } from '../api/_lib/env';
import { resolveLocation } from '../api/_lib/geocode';
import { HttpError, requireSameOrigin } from '../api/_lib/http';
import { analyzeDistress } from '../api/_lib/llm';

function configureTestEnv() {
  Object.assign(process.env, {
    SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key-long-enough',
    DISPATCHER_PASSCODE: 'correct-horse-battery', JWT_SECRET: 'a'.repeat(64), LLM_PROVIDER: 'gemini',
    GEMINI_API_KEY: 'test-gemini-key', GEMINI_MODEL: 'test-model', OPENAI_API_KEY: '', OPENAI_MODEL: '',
    APP_ORIGIN: 'http://localhost:3000', OSM_CONTACT_EMAIL: 'test@example.com', DEMO_MODE: 'true',
  });
  clearEnvCacheForTests();
}

test('dispatcher passcode and signed session work without exposing the passcode', async () => {
  configureTestEnv();
  assert.equal(passcodeMatches('correct-horse-battery'), true);
  assert.equal(passcodeMatches('wrong-password'), false);
  const token = await createSessionToken();
  assert.ok(!token.includes('correct-horse-battery'));
  await requireDispatcher({ cookies: { dm_dispatcher: token }, headers: {} } as unknown as VercelRequest);
  await assert.rejects(() => requireDispatcher({ cookies: {}, headers: {} } as unknown as VercelRequest),
    (error: unknown) => error instanceof HttpError && error.status === 401);
});

test('same-origin guard rejects browser cross-site requests', () => {
  configureTestEnv();
  assert.doesNotThrow(() => requireSameOrigin({ headers: { origin: 'http://localhost:3000' } } as unknown as VercelRequest));
  assert.doesNotThrow(() => requireSameOrigin({ headers: {
    origin: 'https://disastermesh.vercel.app', host: 'disastermesh.vercel.app', 'x-forwarded-proto': 'https',
  } } as unknown as VercelRequest));
  assert.throws(() => requireSameOrigin({ headers: {
    origin: 'https://evil.example', host: 'disastermesh.vercel.app', 'x-forwarded-proto': 'https',
  } } as unknown as VercelRequest),
  (error: unknown) => error instanceof HttpError && error.status === 403);
  assert.throws(() => requireSameOrigin({ headers: { origin: 'https://evil.example' } } as unknown as VercelRequest),
    (error: unknown) => error instanceof HttpError && error.status === 403);
  assert.throws(() => requireSameOrigin({ headers: { 'sec-fetch-site': 'cross-site' } } as unknown as VercelRequest), HttpError);
});

test('gazetteer location resolution does not make a network request', async () => {
  configureTestEnv();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('Network should not be called'); };
  try {
    assert.deepEqual(await resolveLocation('', ['Velachery'], 'SOS in Velachery', null),
      { lat: 12.9815, lng: 80.218, label: 'Velachery', source: 'gazetteer' });
  } finally { globalThis.fetch = originalFetch; }
});

test('Gemini helper sends its key in a server header and validates structured JSON', async () => {
  configureTestEnv();
  const originalFetch = globalThis.fetch;
  let requestedUrl = ''; let requestedHeaders: Headers | undefined;
  globalThis.fetch = async (input, init) => {
    requestedUrl = String(input); requestedHeaders = new Headers(init?.headers);
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({
      location_mentions: ['Adyar'], emergency_type: 'medical', people_count: 1,
      vulnerable_groups: ['elderly'], urgency_score: 90, explanation: 'Unconscious person', image_description: '',
    }) }] } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const result = await analyzeDistress('One elderly person is unconscious in Adyar.');
    assert.equal(result.status, 'used');
    assert.equal(result.analysis?.people_count, 1);
    assert.equal(requestedHeaders?.get('x-goog-api-key'), 'test-gemini-key');
    assert.ok(!requestedUrl.includes('test-gemini-key'));
  } finally { globalThis.fetch = originalFetch; }
});
