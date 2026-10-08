import { createHash, timingSafeEqual } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { SignJWT, jwtVerify } from 'jose';
import { getEnv } from './env.js';
import { HttpError } from './http.js';

const COOKIE_NAME = 'dm_dispatcher';
const SESSION_SECONDS = 8 * 60 * 60;
const encoder = new TextEncoder();

function secret(): Uint8Array { return encoder.encode(getEnv().JWT_SECRET); }
function digest(value: string): Buffer { return createHash('sha256').update(value, 'utf8').digest(); }

export function passcodeMatches(candidate: string): boolean {
  return timingSafeEqual(digest(candidate), digest(getEnv().DISPATCHER_PASSCODE));
}

export async function createSessionToken(): Promise<string> {
  return new SignJWT({ role: 'dispatcher' }).setProtectedHeader({ alg: 'HS256' })
    .setSubject('dispatcher').setIssuer('disastermesh').setAudience('disastermesh-command')
    .setIssuedAt().setExpirationTime(`${SESSION_SECONDS}s`).sign(secret());
}

export function setSessionCookie(response: VercelResponse, token: string): void {
  const secure = getEnv().APP_ORIGIN.startsWith('https://');
  response.setHeader('Set-Cookie', `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_SECONDS}${secure ? '; Secure' : ''}`);
}

export function clearSessionCookie(response: VercelResponse): void {
  const secure = getEnv().APP_ORIGIN.startsWith('https://');
  response.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`);
}

function cookieValue(request: VercelRequest): string | undefined {
  if (request.cookies?.[COOKIE_NAME]) return request.cookies[COOKIE_NAME];
  const cookie = request.headers.cookie;
  return cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE_NAME}=`))?.slice(COOKIE_NAME.length + 1);
}

export async function requireDispatcher(request: VercelRequest): Promise<void> {
  const token = cookieValue(request);
  if (!token) throw new HttpError(401, 'Dispatcher login required', 'unauthorized');
  try {
    const verified = await jwtVerify(token, secret(), { issuer: 'disastermesh', audience: 'disastermesh-command' });
    if (verified.payload.role !== 'dispatcher') throw new Error('Wrong role');
  } catch { throw new HttpError(401, 'Dispatcher session expired', 'unauthorized'); }
}
