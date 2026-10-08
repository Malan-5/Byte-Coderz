import type { Coordinates } from './types.js';

export interface Locality extends Coordinates { name: string; aliases: readonly string[] }

// Approximate locality centres, not building locations or verified caller GPS.
// Demo seeds use these same centres. No network/geocoder is needed for these names.
export const CHENNAI_LOCALITIES: readonly Locality[] = [
  { name: 'Velachery', lat: 12.9815, lng: 80.2180, aliases: ['velachery', 'velacherry', 'வேளச்சேரி'] },
  { name: 'Adyar', lat: 13.0012, lng: 80.2565, aliases: ['adyar', 'adayar', 'அடையாறு'] },
  { name: 'T. Nagar', lat: 13.0418, lng: 80.2341, aliases: ['t nagar', 'tnagar', 'thyagaraya nagar', 'theagaraya nagar'] },
  { name: 'Tambaram', lat: 12.9249, lng: 80.1000, aliases: ['tambaram', 'தாம்பரம்'] },
  { name: 'Avadi', lat: 13.1147, lng: 80.1098, aliases: ['avadi', 'ஆவடி'] },
  { name: 'Mylapore', lat: 13.0339, lng: 80.2692, aliases: ['mylapore', 'mayilapur', 'மயிலாப்பூர்'] },
  { name: 'Anna Nagar', lat: 13.0850, lng: 80.2101, aliases: ['anna nagar', 'annanagar'] },
  { name: 'Guindy', lat: 13.0067, lng: 80.2206, aliases: ['guindy', 'கிண்டி'] },
  { name: 'Sholinganallur', lat: 12.9009, lng: 80.2279, aliases: ['sholinganallur', 'sholinganalloor', 'solinganallur'] },
  { name: 'Perambur', lat: 13.1148, lng: 80.2328, aliases: ['perambur', 'பெரம்பூர்'] },
  { name: 'Royapuram', lat: 13.1137, lng: 80.2950, aliases: ['royapuram', 'rayapuram'] },
  { name: 'Kodambakkam', lat: 13.0521, lng: 80.2255, aliases: ['kodambakkam', 'kodambakam'] },
  { name: 'Pallikaranai', lat: 12.9346, lng: 80.2101, aliases: ['pallikaranai', 'pallikkaranai'] },
  { name: 'Madipakkam', lat: 12.9648, lng: 80.2080, aliases: ['madipakkam', 'madipakam'] },
  { name: 'Medavakkam', lat: 12.9171, lng: 80.1923, aliases: ['medavakkam', 'medavakam'] },
  { name: 'Porur', lat: 13.0356, lng: 80.1589, aliases: ['porur', 'போரூர்'] },
  { name: 'Thoraipakkam', lat: 12.9416, lng: 80.2362, aliases: ['thoraipakkam', 'thoraipakam'] },
  { name: 'Taramani', lat: 12.9863, lng: 80.2432, aliases: ['taramani', 'tharamani'] },
  { name: 'Saidapet', lat: 13.0213, lng: 80.2231, aliases: ['saidapet', 'saidapettai'] },
  { name: 'Ennore', lat: 13.2146, lng: 80.3203, aliases: ['ennore', 'ennur'] },
  { name: 'Tiruvottiyur', lat: 13.1600, lng: 80.3000, aliases: ['tiruvottiyur', 'thiruvottiyur'] },
];

export function normalizeLocation(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim();
}

export function findGazetteerMatches(text: string): Locality[] {
  const normalized = ` ${normalizeLocation(text)} `;
  return CHENNAI_LOCALITIES.filter((locality) => locality.aliases.some(
    (alias) => normalized.includes(` ${normalizeLocation(alias)} `),
  ));
}

export function lookupGazetteer(text: string): Locality | null {
  const matches = findGazetteerMatches(text);
  // "Between Adyar and Velachery" is ambiguous; do not pick a random centre.
  return matches.length === 1 ? matches[0]! : null;
}
