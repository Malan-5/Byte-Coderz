// Small, explainable English negation heuristic. It is not a full language parser.
export function keywordPresence(text: string, pattern: RegExp): { positive: boolean; negated: boolean } {
  const matches = text.matchAll(new RegExp(pattern.source, 'gi'));
  let positive = false;
  let negated = false;
  for (const match of matches) {
    const prefix = text.slice(0, match.index).split(/[.!?;,\n]|\b(?:but|however|and)\b/i).at(-1) ?? '';
    const nearPrefix = prefix.slice(-70).replace(/\bnot only\b/gi, '');
    const isNegated = /\b(?:no|not|never|without|nobody|none)\b(?:\s+[\w']+){0,3}\s*$/i.test(nearPrefix);
    if (isNegated) negated = true;
    else positive = true;
  }
  return { positive, negated };
}
