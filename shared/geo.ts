import type { Coordinates } from './types';

export const EARTH_RADIUS_M = 6_371_000;

export function isCoordinates(value: unknown): value is Coordinates {
  if (!value || typeof value !== 'object') return false;
  const point = value as Partial<Coordinates>;
  return typeof point.lat === 'number' && Number.isFinite(point.lat)
    && typeof point.lng === 'number' && Number.isFinite(point.lng)
    && Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180;
}

export function haversineMeters(from: Coordinates, to: Coordinates): number {
  if (!isCoordinates(from) || !isCoordinates(to)) throw new RangeError('Invalid coordinates');
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const dLat = radians(to.lat - from.lat);
  const dLng = radians(to.lng - from.lng);
  // a is the squared half-chord length on a unit sphere.
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(radians(from.lat)) * Math.cos(radians(to.lat)) * Math.sin(dLng / 2) ** 2;
  // Floating point rounding can put antipodal points just above 1.
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(Math.min(1, Math.max(0, a))));
}

export function meanCoordinates(points: readonly Coordinates[]): Coordinates {
  if (!points.length || points.some((point) => !isCoordinates(point))) {
    throw new RangeError('A centroid needs at least one valid coordinate');
  }
  // Arithmetic mean of every report, appropriate for a 300 m city cluster.
  return {
    lat: points.reduce((sum, point) => sum + point.lat, 0) / points.length,
    lng: points.reduce((sum, point) => sum + point.lng, 0) / points.length,
  };
}

export function moveToward(from: Coordinates, to: Coordinates, distanceM: number): Coordinates & { arrived: boolean } {
  if (!Number.isFinite(distanceM) || distanceM < 0) throw new RangeError('Movement must be nonnegative');
  const remaining = haversineMeters(from, to);
  if (remaining <= 5 || distanceM >= remaining) return { ...to, arrived: true };
  const fraction = distanceM / remaining;
  return {
    lat: from.lat + (to.lat - from.lat) * fraction,
    lng: from.lng + (to.lng - from.lng) * fraction,
    arrived: false,
  };
}
