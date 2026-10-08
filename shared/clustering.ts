import { haversineMeters, isCoordinates, meanCoordinates } from './geo';
import { SEVERITY_RANK } from './scoring';
import { SEVERITIES } from './types';
import type { Coordinates, EmergencyType, Incident, Severity } from './types';

export const CLUSTER_RADIUS_M = 300;
export const CLUSTER_WINDOW_MS = 60 * 60 * 1000;

export function compatibleEmergencies(a: EmergencyType, b: EmergencyType): boolean {
  return a === b || ([a, b].every((type) => type === 'flood' || type === 'trapped'));
}

export interface ClusterInput {
  lat: number | null;
  lng: number | null;
  emergency_type: EmergencyType;
  created_at: string;
  is_demo: boolean;
}
export interface ClusterMatch { incident: Incident; distance_m: number; explanation: string }

export function findCluster(report: ClusterInput, incidents: readonly Incident[]): ClusterMatch | null {
  if (!isCoordinates(report)) return null;
  const received = Date.parse(report.created_at);
  if (!Number.isFinite(received)) throw new RangeError('Invalid report timestamp');
  const matches: ClusterMatch[] = [];
  for (const incident of incidents) {
    if (incident.status !== 'open' || incident.is_demo !== report.is_demo || !isCoordinates(incident)) continue;
    const age = received - Date.parse(incident.last_report_at);
    if (!Number.isFinite(age) || age < 0 || age > CLUSTER_WINDOW_MS) continue;
    if (!compatibleEmergencies(report.emergency_type, incident.emergency_type)) continue;
    const distance_m = haversineMeters(report, incident);
    if (distance_m > CLUSTER_RADIUS_M) continue;
    matches.push({ incident, distance_m, explanation: clusterExplanation(incident.incident_number, distance_m, incident.report_count + 1) });
  }
  // Stable tie break makes the same input choose the same incident.
  matches.sort((a, b) => a.distance_m - b.distance_m || a.incident.id.localeCompare(b.incident.id));
  return matches[0] ?? null;
}

export function clusterExplanation(number: number, distanceM: number | null, count: number): string {
  return distanceM === null ? 'New incident created'
    : `Merged with Incident #${number} (distance ${Math.round(distanceM)} m, ${count} reports)`;
}

export function mergedSeverity(current: Severity, reportSeverities: readonly Severity[]): Severity {
  if (!reportSeverities.length) throw new RangeError('Cannot merge an empty report list');
  const highestReportRank = Math.max(...reportSeverities.map((severity) => SEVERITY_RANK[severity]));
  // One tier of corroboration for 3+ reports, measured against the raw reports.
  // Repeated merges do not repeatedly promote an already promoted incident.
  const corroborated = Math.min(3, highestReportRank + (reportSeverities.length >= 3 ? 1 : 0));
  return SEVERITIES[Math.max(SEVERITY_RANK[current], corroborated)]!;
}

export function recomputeCluster(current: Severity, reports: readonly (Coordinates & { severity: Severity })[]) {
  return {
    ...meanCoordinates(reports),
    report_count: reports.length,
    severity: mergedSeverity(current, reports.map((report) => report.severity)),
  };
}

export function sortTriage(incidents: readonly Incident[]): Incident[] {
  return incidents.filter((incident) => incident.status === 'open').sort((a, b) =>
    SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]
    || b.report_count - a.report_count
    || Date.parse(a.created_at) - Date.parse(b.created_at)
    || a.id.localeCompare(b.id),
  );
}
