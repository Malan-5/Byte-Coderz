import type { VercelRequest, VercelResponse } from '@vercel/node';
import { clearSessionCookie } from './_lib/auth.js';
import { apiHandler, requireMethod, requireSameOrigin } from './_lib/http.js';

export default apiHandler((request: VercelRequest, response: VercelResponse) => {
  requireMethod(request, ['POST']); requireSameOrigin(request);
  clearSessionCookie(response);
  response.status(200).json({ ok: true, authenticated: false });
});
