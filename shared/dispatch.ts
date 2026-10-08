import { haversineMeters, isCoordinates } from './geo';
import type { EmergencyType, Incident, Unit, UnitType } from './types';

export const ASSUMED_SPEED_KPH = 30;
export const DEMO_MOVEMENT_MULTIPLIER = 15;
export const UNIT_LABEL: Record<UnitType, string> = {
  ambulance: 'ambulance', fire_engine: 'fire engine', rescue_boat: 'boat',
  ndrf_team: 'NDRF team', general_rescue: 'general rescue unit',
};

export const COMPATIBLE_UNITS: Record<EmergencyType, readonly UnitType[]> = {
  medical: ['ambulance'], fire: ['fire_engine'],
  flood: ['rescue_boat', 'ndrf_team'], trapped: ['rescue_boat', 'ndrf_team'],
  collapse: ['ndrf_team', 'general_rescue'], other: ['ndrf_team', 'general_rescue'],
};

export function estimateEtaSeconds(distanceM: number, speedKph = ASSUMED_SPEED_KPH): number {
  if (!Number.isFinite(distanceM) || distanceM < 0 || !Number.isFinite(speedKph) || speedKph <= 0) {
    throw new RangeError('ETA needs a nonnegative distance and positive speed');
  }
  return Math.ceil(distanceM / (speedKph * 1000 / 3600));
}

export interface UnitRecommendation { unit: Unit; distance_m: number; eta_seconds: number; reasoning: string }

export function recommendUnits(incident: Incident, units: readonly Unit[]): UnitRecommendation[] {
  if (incident.status !== 'open' || !isCoordinates(incident)) return [];
  const eligible = units.filter((unit) => unit.status === 'available' && unit.current_incident_id === null
    && unit.is_demo === incident.is_demo && isCoordinates(unit)
    && COMPATIBLE_UNITS[incident.emergency_type].includes(unit.unit_type))
    .map((unit) => {
      const distance_m = haversineMeters(unit, incident);
      return {
        unit, distance_m, eta_seconds: estimateEtaSeconds(distance_m),
      };
    }).sort((a, b) => a.distance_m - b.distance_m || a.unit.id.localeCompare(b.unit.id));
  return eligible.map((recommendation, index) => ({
    ...recommendation,
    reasoning: `Unit ${recommendation.unit.id}${index === 0 ? ' chosen: nearest' : ':'} available compatible ${UNIT_LABEL[recommendation.unit.unit_type]}, ${(recommendation.distance_m / 1000).toFixed(1)} km`,
  }));
}

export function pickNearestUnit(incident: Incident, units: readonly Unit[]): UnitRecommendation | null {
  return recommendUnits(incident, units)[0] ?? null;
}
