import { lookupGazetteer } from '../../shared/gazetteer.js';
import type { Coordinates, LocationSource } from '../../shared/types.js';
import { getEnv } from './env.js';

export interface ResolvedLocation { lat: number | null; lng: number | null; label: string; source: LocationSource }
const CHENNAI_BOUNDS = { south: 12.70, north: 13.35, west: 79.80, east: 80.50 };

function validGps(gps: Coordinates | null | undefined): gps is Coordinates {
  return Boolean(gps && Number.isFinite(gps.lat) && Number.isFinite(gps.lng)
    && gps.lat >= -90 && gps.lat <= 90 && gps.lng >= -180 && gps.lng <= 180);
}

async function nominatim(locationText: string): Promise<ResolvedLocation | null> {
  const env = getEnv();
  const query = new URLSearchParams({ q: `${locationText}, Chennai, Tamil Nadu, India`, format: 'jsonv2', limit: '1',
    countrycodes: 'in', bounded: '1', viewbox: `${CHENNAI_BOUNDS.west},${CHENNAI_BOUNDS.north},${CHENNAI_BOUNDS.east},${CHENNAI_BOUNDS.south}`,
    email: env.OSM_CONTACT_EMAIL });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/search?${query}`, {
      signal: controller.signal, headers: { 'User-Agent': `DisasterMesh/1.0 (${env.OSM_CONTACT_EMAIL})`, Accept: 'application/json' },
    });
    if (!response.ok) return null;
    const rows = await response.json() as { lat?: string; lon?: string; display_name?: string }[];
    const lat = Number(rows[0]?.lat); const lng = Number(rows[0]?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < CHENNAI_BOUNDS.south || lat > CHENNAI_BOUNDS.north
      || lng < CHENNAI_BOUNDS.west || lng > CHENNAI_BOUNDS.east) return null;
    return { lat, lng, label: rows[0]?.display_name?.slice(0,300) || locationText, source: 'nominatim' };
  } catch { return null; }
  finally { clearTimeout(timeout); }
}

export async function resolveLocation(manualLocation: string, locationMentions: readonly string[], reportText: string, gps?: Coordinates | null): Promise<ResolvedLocation> {
  const candidates = [manualLocation, ...locationMentions, reportText].map((value) => value.trim()).filter(Boolean);
  for (const candidate of candidates) {
    const locality = lookupGazetteer(candidate);
    if (locality) return { lat: locality.lat, lng: locality.lng, label: locality.name, source: 'gazetteer' };
  }
  const geocodeText = manualLocation.trim() || locationMentions[0]?.trim() || '';
  if (geocodeText) {
    const resolved = await nominatim(geocodeText);
    if (resolved) return resolved;
  }
  if (validGps(gps)) return { ...gps, label: 'GPS location', source: 'gps' };
  return { lat: null, lng: null, label: manualLocation.trim() || locationMentions[0]?.trim() || 'Location unverified', source: 'unverified' };
}
