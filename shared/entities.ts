import { findGazetteerMatches } from './gazetteer';
import { keywordPresence } from './text';
import type { EmergencyType, ExtractedEntities, VulnerableGroup } from './types';

const GROUP_PATTERNS: [VulnerableGroup, RegExp][] = [
  ['children', /\b(?:children|child|kids?|bab(?:y|ies)|infants?)\b/],
  ['elderly', /\b(?:elderly|senior citizens?|seniors?|old people)\b/],
  ['pregnant', /\bpregnan(?:t|cy)\b/],
  ['disabled', /\b(?:disabled|disabilit(?:y|ies)|wheelchair)\b/],
];

export function extractVulnerableGroups(text: string): VulnerableGroup[] {
  return GROUP_PATTERNS.filter(([, pattern]) => keywordPresence(text, pattern).positive).map(([group]) => group);
}

export function extractPeopleCount(text: string): number | null {
  const words: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
    nine: 9, ten: 10, eleven: 11, twelve: 12, twenty: 20,
  };
  const numberPattern = `(?:\\d+|${Object.keys(words).join('|')})`;
  const count = (pattern: RegExp) => Array.from(text.matchAll(pattern), (match) => {
    const token = match[1]!.toLowerCase();
    return words[token] ?? Number(token);
  }).filter((n) => Number.isInteger(n) && n >= 0 && n <= 10_000);
  // Prefer explicitly stated totals; "6 people including 2 children" means 6.
  const totals = [
    ...count(new RegExp(`\\b(${numberPattern})\\s+(?:people|persons|residents|patients|victims)\\b`, 'gi')),
    ...count(new RegExp(`\\b(?:family|group) of\\s+(${numberPattern})\\b`, 'gi')),
  ];
  if (totals.length) return Math.max(...totals);
  const groups = count(new RegExp(`\\b(${numberPattern})\\s+(?:children|adults|elderly|kids|babies)\\b`, 'gi'));
  // Conservative count of the largest explicit group; do not double-count repeated mentions.
  return groups.length ? Math.max(...groups) : null;
}

export function extractFallbackEntities(text: string): ExtractedEntities {
  const priorities: [EmergencyType, RegExp][] = [
    ['medical', /\b(?:not breathing|cannot breathe|can't breathe|unconscious|heart attack|cardiac arrest|severe bleeding)\b/],
    ['fire', /\b(?:fire|flames?|burning|smoke)\b/],
    ['collapse', /\b(?:collapse[ds]?|collapsed|caved in|building fell)\b/],
    ['flood', /\b(?:flood(?:ed|ing|s)?|rising water|water rising|drowning|waterlogged)\b/],
    ['medical', /\b(?:medical|bleeding|injur(?:y|ies|ed)|ambulance|pain)\b/],
    ['trapped', /\b(?:trapped|stranded|stuck|cannot escape)\b/],
  ];
  const emergency_type = priorities.find(([, pattern]) => keywordPresence(text, pattern).positive)?.[0] ?? 'other';
  return {
    location_mentions: findGazetteerMatches(text).map((locality) => locality.name),
    emergency_type,
    people_count: extractPeopleCount(text),
    vulnerable_groups: extractVulnerableGroups(text),
  };
}
