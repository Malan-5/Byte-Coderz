import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireDispatcher } from './_lib/auth.js';
import { callRpc } from './_lib/db.js';
import { getEnv } from './_lib/env.js';
import { apiHandler, HttpError, requireMethod, requireSameOrigin } from './_lib/http.js';

export default apiHandler(async (request: VercelRequest, response: VercelResponse) => {
  requireMethod(request, ['POST']); requireSameOrigin(request); await requireDispatcher(request);
  if (!getEnv().DEMO_MODE) throw new HttpError(403, 'Demo reset is disabled', 'demo_disabled');
  const data = await callRpc<Record<string, unknown>>('seed_demo', { p_reset: true });
  response.status(200).json({ ok: true, result: data });
});
