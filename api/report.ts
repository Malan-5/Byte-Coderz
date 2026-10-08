import { randomUUID } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { extractFallbackEntities } from '../shared/entities.js';
import { scoreUrgency } from '../shared/scoring.js';
import type { ExtractedEntities, VulnerableGroup } from '../shared/types.js';
import { callRpc } from './_lib/db.js';
import { getEnv } from './_lib/env.js';
import { resolveLocation } from './_lib/geocode.js';
import { apiHandler, parseBody, requireMethod, requireSameOrigin } from './_lib/http.js';
import { analyzeDistress } from './_lib/llm.js';

const imageDataUrl = z.string().max(1_500_000).regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/);
const schema = z.object({
  clientRequestId: z.string().uuid().optional(), channel: z.enum(['text','voice','image']),
  text: z.string().trim().max(4000).default(''), transcript: z.string().trim().max(4000).default(''),
  image: imageDataUrl.nullable().optional(), manualLocation: z.string().trim().max(300).default(''),
  gps: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).strict().nullable().optional(),
}).strict().superRefine((value, context) => {
  if (!value.text && !value.transcript && !value.image) context.addIssue({ code: 'custom', message: 'Provide text, a transcript, or an image' });
  if (value.channel === 'image' && !value.image) context.addIssue({ code: 'custom', path: ['image'], message: 'Image channel requires an image' });
});

export default apiHandler(async (request: VercelRequest, response: VercelResponse) => {
  requireMethod(request, ['POST']); requireSameOrigin(request);
  const input = parseBody(request, schema);
  const rawText = input.channel === 'voice' ? input.transcript || input.text : input.text || input.transcript;
  const llm = await analyzeDistress(rawText, input.image ?? null);
  const imageDescription = llm.analysis?.image_description ?? null;
  const analysisText = [rawText, imageDescription].filter(Boolean).join('\n');
  const fallback = extractFallbackEntities(analysisText);
  const groups = [...new Set<VulnerableGroup>([...fallback.vulnerable_groups, ...(llm.analysis?.vulnerable_groups ?? [])])];
  const entities: ExtractedEntities = {
    location_mentions: [...new Set([...fallback.location_mentions, ...(llm.analysis?.location_mentions ?? [])])],
    emergency_type: llm.analysis?.emergency_type ?? fallback.emergency_type,
    people_count: llm.analysis?.people_count ?? fallback.people_count,
    vulnerable_groups: groups,
  };
  const reasoning = scoreUrgency(analysisText, entities, llm.analysis, llm.status);
  const location = await resolveLocation(input.manualLocation, entities.location_mentions, analysisText, input.gps);
  const env = getEnv();
  const prepared = {
    client_request_id: input.clientRequestId ?? randomUUID(), channel: input.channel, raw_text: rawText,
    image_description: imageDescription, image_data_url: input.image ?? null,
    location_label: location.label, location_source: location.source, lat: location.lat, lng: location.lng,
    emergency_type: entities.emergency_type, people_count: entities.people_count, vulnerable_groups: groups,
    final_score: reasoning.final_score, entities,
    reasoning: { ...reasoning, llm_provider: llm.provider, llm_model: llm.model, llm_latency_ms: llm.latency_ms },
    is_demo: env.DEMO_MODE,
  };
  const data = await callRpc<Record<string, unknown>>('ingest_report', { p_report: prepared });
  response.status(201).json({ ok: true, ...data, analysis: { location, entities, severity: reasoning.severity,
    final_score: reasoning.final_score, llm_status: llm.status } });
});
