import { extractFallbackEntities, extractVulnerableGroups } from './entities';
import { keywordPresence } from './text';
import type { ExtractedEntities, LlmAnalysis, LlmStatus, Severity, SeverityReasoning, WeightedHit } from './types';

export const SEVERITY_RANK: Record<Severity, number> = { Low: 0, Medium: 1, High: 2, Critical: 3 };
export const SEVERITY_FLOOR: Record<Severity, number> = { Low: 0, Medium: 25, High: 50, Critical: 75 };

const KEYWORDS: { label: string; weight: number; pattern: RegExp }[] = [
  { label: 'not breathing', weight: 90, pattern: /\b(?:not breathing|cannot breathe|can't breathe)\b/ },
  { label: 'cardiac emergency', weight: 90, pattern: /\b(?:heart attack|cardiac arrest)\b/ },
  { label: 'drowning', weight: 85, pattern: /\bdrowning\b/ },
  { label: 'unconscious', weight: 80, pattern: /\bunconscious\b/ },
  { label: 'collapse', weight: 70, pattern: /\b(?:collapse[ds]?|collapsed|caved in)\b/ },
  { label: 'trapped', weight: 60, pattern: /\b(?:trapped|stranded|cannot escape)\b/ },
  { label: 'fire', weight: 60, pattern: /\b(?:fire|flames?|burning)\b/ },
  { label: 'bleeding', weight: 55, pattern: /\bbleeding\b/ },
  { label: 'rising water', weight: 40, pattern: /\b(?:rising water|water rising)\b/ },
  { label: 'flood', weight: 30, pattern: /\bflood(?:ed|ing|s)?\b/ },
  { label: 'injury', weight: 25, pattern: /\binjur(?:y|ies|ed)\b/ },
];

export function severityFromScore(score: number): Severity {
  if (!Number.isFinite(score) || score < 0 || score > 100) throw new RangeError('Score must be in [0, 100]');
  return score >= 75 ? 'Critical' : score >= 50 ? 'High' : score >= 25 ? 'Medium' : 'Low';
}

export function scoreUrgency(
  text: string,
  entities: ExtractedEntities = extractFallbackEntities(text),
  llm: LlmAnalysis | null = null,
  llmStatus: LlmStatus = llm ? 'used' : 'unavailable',
): SeverityReasoning {
  const keyword_hits: WeightedHit[] = [];
  const negated_keywords: string[] = [];
  for (const keyword of KEYWORDS) {
    const found = keywordPresence(text, keyword.pattern);
    if (found.positive) keyword_hits.push({ label: keyword.label, weight: keyword.weight });
    if (found.negated) negated_keywords.push(keyword.label);
  }
  const modifiers: WeightedHit[] = [];
  const groupWeights = { children: 15, elderly: 12, pregnant: 12, disabled: 12 };
  const groups = new Set([...extractVulnerableGroups(text), ...entities.vulnerable_groups]);
  for (const group of groups) modifiers.push({ label: group, weight: groupWeights[group] });
  if (entities.people_count !== null && entities.people_count >= 2) {
    const count = entities.people_count;
    modifiers.push({ label: `${count} people`, weight: count >= 10 ? 15 : count >= 5 ? 8 : 3 });
  }
  if (/\b(?:no|without|lack of)\s+(?:food|water|food\s*(?:and|or|\/)\s*water)\b/i.test(text)) {
    // Supply needs add 5, much less than a direct life threat. They never subtract urgency.
    modifiers.push({ label: 'food/water shortage', weight: 5 });
  }
  const rule_score = Math.min(100, 10 + [...keyword_hits, ...modifiers].reduce((sum, hit) => sum + hit.weight, 0));
  const validLlm = llm && Number.isFinite(llm.urgency_score) && llm.urgency_score >= 0 && llm.urgency_score <= 100;
  const output = validLlm && llmStatus === 'used' ? llm : null;
  const status = llm && !validLlm ? 'invalid' : output ? 'used' : llmStatus === 'used' ? 'unavailable' : llmStatus;
  const weighted_score = output ? Math.round(0.7 * rule_score + 0.3 * output.urgency_score) : rule_score;
  // A low model score cannot downgrade a rule-detected severity category.
  const safety_floor = SEVERITY_FLOOR[severityFromScore(rule_score)];
  const final_score = Math.max(safety_floor, weighted_score);
  return {
    version: 'hybrid-v1', keyword_hits, negated_keywords, modifiers, rule_score,
    llm_status: status, llm_output: output, rule_weight: output ? 0.7 : 1,
    llm_weight: output ? 0.3 : 0, weighted_score, safety_floor, final_score,
    severity: severityFromScore(final_score),
  };
}
