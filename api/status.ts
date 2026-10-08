import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb } from './_lib/db.js';
import { getEnv } from './_lib/env.js';
import { apiHandler, requireMethod } from './_lib/http.js';

export default apiHandler(async (request: VercelRequest, response: VercelResponse) => {
  requireMethod(request, ['GET']);
  const started = Date.now();
  const { error } = await getDb().from('incidents').select('id', { head: true, count: 'exact' });
  const env = getEnv();
  response.status(error ? 503 : 200).json({ ok: !error, database: error ? 'unavailable' : 'connected',
    llm: 'configured', provider: env.LLM_PROVIDER, demo_mode: env.DEMO_MODE, latency_ms: Date.now()-started });
});
