import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sortTriage } from '../shared/clustering.js';
import { recommendUnits } from '../shared/dispatch.js';
import type { Dispatch, Incident, Report, Unit } from '../shared/types.js';
import { requireDispatcher } from './_lib/auth.js';
import { getDb, throwIfDbError } from './_lib/db.js';
import { apiHandler, requireMethod } from './_lib/http.js';

export default apiHandler(async (request: VercelRequest, response: VercelResponse) => {
  requireMethod(request, ['GET']); await requireDispatcher(request);
  const db = getDb();
  const [incidentResult, reportResult, unitResult, dispatchResult] = await Promise.all([
    db.from('incidents').select('*').order('created_at', { ascending: false }),
    db.from('reports').select('id,client_request_id,incident_id,channel,raw_text,image_description,location_label,location_source,lat,lng,emergency_type,people_count,vulnerable_groups,severity,final_score,entities,reasoning,cluster_outcome,match_distance_m,created_at,is_demo').order('created_at', { ascending: false }),
    db.from('units').select('*').order('id'), db.from('dispatches').select('*').order('dispatched_at', { ascending: false }),
  ]);
  for (const result of [incidentResult, reportResult, unitResult, dispatchResult]) throwIfDbError(result.error);
  const incidents = sortTriage((incidentResult.data ?? []) as Incident[]);
  const units = (unitResult.data ?? []) as Unit[];
  const recommendations = Object.fromEntries(incidents.map((incident) => [incident.id,
    recommendUnits(incident, units).slice(0,3).map(({ unit, distance_m, eta_seconds, reasoning }) => ({ unit, distance_m, eta_seconds, reasoning }))]));
  const counters = { open: incidents.length, critical: incidents.filter((entry) => entry.severity === 'Critical').length,
    available: units.filter((unit) => unit.status === 'available').length,
    en_route: units.filter((unit) => unit.status === 'en_route').length };
  response.status(200).json({ ok: true, server_time: new Date().toISOString(), authenticated: true, counters,
    incidents, reports: (reportResult.data ?? []) as Report[], units, dispatches: (dispatchResult.data ?? []) as Dispatch[], recommendations });
});
