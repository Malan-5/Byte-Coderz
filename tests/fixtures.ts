import { randomUUID } from 'node:crypto';
import { extractFallbackEntities } from '../shared/entities';
import { lookupGazetteer } from '../shared/gazetteer';
import { scoreUrgency } from '../shared/scoring';
import type { Incident, PreparedReport, Unit } from '../shared/types';

export const DEMO_SOS = 'SOS! We are trapped in rising water in Velachery. 6 people including 2 children need rescue.';

export function incident(overrides: Partial<Incident> = {}): Incident {
  return {
    id: '10000000-0000-4000-8000-000000000001', incident_number: 1, emergency_type: 'flood',
    status: 'open', severity: 'High', final_score: 55, location_label: 'Velachery',
    lat: 12.9815, lng: 80.2180, report_count: 2, is_demo: true,
    created_at: '2026-10-08T09:00:00.000Z', last_report_at: '2026-10-08T09:05:00.000Z',
    resolved_at: null, cluster_reasoning: {}, ...overrides,
  };
}

export function unit(overrides: Partial<Unit> = {}): Unit {
  return {
    id: 'R-01', name: 'Test boat', unit_type: 'rescue_boat', status: 'available',
    station_name: 'Test station', lat: 12.9765, lng: 80.2160, station_lat: 12.9765, station_lng: 80.2160,
    current_incident_id: null, last_moved_at: '2026-10-08T09:00:00.000Z', is_demo: true, ...overrides,
  };
}

export function preparedReport(text = DEMO_SOS, overrides: Partial<PreparedReport> = {}): PreparedReport {
  const entities = extractFallbackEntities(text);
  const location = lookupGazetteer(text);
  const reasoning = scoreUrgency(text, entities);
  return {
    client_request_id: randomUUID(), channel: 'text', raw_text: text,
    location_label: location?.name ?? 'Location unverified',
    location_source: location ? 'gazetteer' : 'unverified', lat: location?.lat ?? null, lng: location?.lng ?? null,
    ...entities, entities, reasoning, final_score: reasoning.final_score, is_demo: true, ...overrides,
  };
}
