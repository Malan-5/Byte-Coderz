import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { requireDispatcher } from './_lib/auth.js';
import { callRpc } from './_lib/db.js';
import { apiHandler, parseBody, requireMethod, requireSameOrigin } from './_lib/http.js';

const schema = z.object({ incidentId: z.string().uuid() }).strict();
export default apiHandler(async (request: VercelRequest, response: VercelResponse) => {
  requireMethod(request, ['POST']); requireSameOrigin(request); await requireDispatcher(request);
  const input = parseBody(request, schema);
  const data = await callRpc<Record<string, unknown>>('dispatch_incident', { p_incident_id: input.incidentId, p_is_auto: false });
  response.status(200).json({ ok: true, result: data });
});
