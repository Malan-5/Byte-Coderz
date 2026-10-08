import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { getEnv } from './_lib/env.js';
import { apiHandler, HttpError, requireMethod } from './_lib/http.js';

const integer = z.coerce.number().int().nonnegative();
export default apiHandler(async (request: VercelRequest, response: VercelResponse) => {
  requireMethod(request, ['GET']);
  const zValue = integer.max(19).parse(request.query.z);
  const maxCoordinate = 2 ** zValue - 1;
  const x = integer.max(maxCoordinate).parse(request.query.x);
  const y = integer.max(maxCoordinate).parse(request.query.y);
  const env = getEnv();
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 7_000);
  try {
    const upstream = await fetch(`https://tile.openstreetmap.org/${zValue}/${x}/${y}.png`, {
      signal: controller.signal, headers: { 'User-Agent': `DisasterMesh/1.0 (${env.OSM_CONTACT_EMAIL})` },
    });
    if (!upstream.ok) throw new HttpError(502, 'Map tile is temporarily unavailable', 'tile_unavailable');
    const buffer = Buffer.from(await upstream.arrayBuffer());
    response.setHeader('Content-Type', 'image/png');
    response.setHeader('Cache-Control', upstream.headers.get('cache-control') ?? 'public, max-age=604800');
    response.setHeader('Access-Control-Allow-Origin', env.APP_ORIGIN);
    response.status(200).send(buffer);
  } finally { clearTimeout(timeout); }
});
