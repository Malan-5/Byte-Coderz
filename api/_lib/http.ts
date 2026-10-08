import type { VercelRequest, VercelResponse } from '@vercel/node';
import { ZodError, type ZodType } from 'zod';
import { getEnv } from './env.js';

export class HttpError extends Error {
  constructor(public status: number, message: string, public code = 'request_error') { super(message); }
}

export function setApiHeaders(response: VercelResponse): void {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
}

export function requireMethod(request: VercelRequest, allowed: readonly string[]): void {
  if (!request.method || !allowed.includes(request.method)) {
    throw new HttpError(405, `Use ${allowed.join(' or ')}`, 'method_not_allowed');
  }
}

export function requireSameOrigin(request: VercelRequest): void {
  const origin = request.headers.origin;
  if (typeof origin === 'string' && origin !== getEnv().APP_ORIGIN) {
    throw new HttpError(403, 'Cross-origin request rejected', 'origin_rejected');
  }
  const fetchSite = request.headers['sec-fetch-site'];
  if (fetchSite === 'cross-site') throw new HttpError(403, 'Cross-site request rejected', 'origin_rejected');
}

export function parseBody<T>(request: VercelRequest, schema: ZodType<T>): T {
  const contentType = request.headers['content-type'] ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new HttpError(415, 'Content-Type must be application/json', 'unsupported_media_type');
  }
  return schema.parse(request.body);
}

export function sendError(response: VercelResponse, error: unknown): void {
  setApiHeaders(response);
  if (error instanceof HttpError) {
    response.status(error.status).json({ ok: false, error: { code: error.code, message: error.message } });
    return;
  }
  if (error instanceof ZodError) {
    response.status(400).json({ ok: false, error: { code: 'validation_error', message: 'Invalid request', fields: error.flatten().fieldErrors } });
    return;
  }
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : 'internal_error';
  console.error('API error', { code, message: error instanceof Error ? error.message : 'Unknown error' });
  response.status(code === '23505' ? 409 : 500).json({
    ok: false,
    error: { code: code === '23505' ? 'conflict' : 'internal_error', message: code === '23505' ? 'The action conflicts with current state' : 'The request could not be completed' },
  });
}

export function apiHandler(handler: (request: VercelRequest, response: VercelResponse) => Promise<void> | void) {
  return async (request: VercelRequest, response: VercelResponse) => {
    try { setApiHeaders(response); await handler(request, response); }
    catch (error) { sendError(response, error); }
  };
}
