import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { createSessionToken, passcodeMatches, setSessionCookie } from './_lib/auth.js';
import { apiHandler, HttpError, parseBody, requireMethod, requireSameOrigin } from './_lib/http.js';

const schema = z.object({ passcode: z.string().min(1).max(256) }).strict();
const attempts = new Map<string, { count: number; resetAt: number }>();

export default apiHandler(async (request: VercelRequest, response: VercelResponse) => {
  requireMethod(request, ['POST']); requireSameOrigin(request);
  const ip = String(request.headers['x-forwarded-for'] ?? request.socket.remoteAddress ?? 'unknown').split(',')[0]!.trim();
  const now = Date.now(); const current = attempts.get(ip);
  const window = !current || current.resetAt < now ? { count: 0, resetAt: now + 10*60_000 } : current;
  if (window.count >= 8) throw new HttpError(429, 'Too many login attempts. Try again later.', 'rate_limited');
  const { passcode } = parseBody(request, schema);
  await new Promise((resolve) => setTimeout(resolve, 350));
  if (!passcodeMatches(passcode)) {
    window.count++; attempts.set(ip, window);
    throw new HttpError(401, 'Incorrect dispatcher passcode', 'invalid_credentials');
  }
  attempts.delete(ip);
  setSessionCookie(response, await createSessionToken());
  response.status(200).json({ ok: true, authenticated: true });
});
