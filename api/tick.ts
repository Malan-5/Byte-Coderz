import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireDispatcher } from './_lib/auth.js';
import { callRpc } from './_lib/db.js';
import { apiHandler, requireMethod, requireSameOrigin } from './_lib/http.js';

export default apiHandler(async (request: VercelRequest, response: VercelResponse) => {
  requireMethod(request, ['POST']); requireSameOrigin(request); await requireDispatcher(request);
  const data = await callRpc<Record<string, unknown>>('tick_simulation', { p_demo_multiplier: 15 });
  response.status(200).json({ ok: true, result: data });
});
