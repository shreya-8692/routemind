/**
 * Guardrails against hallucinated geographic or traffic facts in LLM output.
 * The LLM may only (a) pick one of the routes the engine evaluated as viable and
 * (b) explain it using numbers and facts present in the tool data.
 */

const TRAFFIC_CLAIM = /\b(light|heavy|moderate|low|high|clear|free[- ]flowing|congested|smooth)\s+traffic\b|\btraffic\s+(is|was|looks|appears)\s+(light|heavy|moderate|clear|smooth|congested)\b|\btraffic jam/i;
const HAZARD_WORDS = {
  'Road Block': /\b(road ?block|roadblock|road closure|closed road|blocked road)\b/i,
  Flooding: /\b(flood|flooding|waterlogg)/i,
  Construction: /\b(construction|roadworks?)\b/i,
  Fire: /\b(fire on|fire near|blaze)\b/i,
};

function collectNumbers(evaluation) {
  const km = new Set();
  const min = new Set();
  const evals = evaluation.evaluations;
  for (const e of evals) {
    km.add(e.distance / 1000);
    for (const sec of [e.baseDuration, e.adjustedDuration, e.hazardDelaySeconds]) min.add(sec / 60);
    for (const h of e.hazards) min.add(h.estimatedDelaySeconds / 60);
  }
  for (const a of evals) {
    for (const b of evals) {
      if (a === b) continue;
      km.add(Math.abs(a.distance - b.distance) / 1000);
      min.add(Math.abs(a.baseDuration - b.baseDuration) / 60);
      min.add(Math.abs(a.adjustedDuration - b.adjustedDuration) / 60);
    }
  }
  return { km: [...km], min: [...min] };
}

function checkExplanation(text, { evaluation, traffic, routes, chosenRouteId }) {
  const violations = [];
  if (!text || typeof text !== 'string' || text.trim().length < 20) {
    return { passed: false, violations: ['Explanation missing or too short.'] };
  }

  // 1. Route labels must exist.
  const labels = new Set(routes.map((r) => r.label.replace(/ \(detour\)$/, '')));
  for (const m of text.matchAll(/\bRoute ([A-Z])\b/g)) {
    if (!labels.has(`Route ${m[1]}`)) violations.push(`Mentions non-existent ${m[0]}.`);
  }
  const chosen = routes.find((r) => r.id === chosenRouteId);
  if (chosen && /\bRoute [A-Z]\b/.test(text) && !text.includes(chosen.label.replace(/ \(detour\)$/, ''))) {
    violations.push(`Explanation does not mention the chosen route (${chosen.label}).`);
  }

  // 2. No live-traffic claims when no live traffic data exists.
  if (!traffic?.liveTrafficAvailable && TRAFFIC_CLAIM.test(text)) {
    violations.push('Claims live traffic conditions, but no live traffic data is available.');
  }

  // 3. Hazard types mentioned must be present in the data.
  const presentTypes = new Set(evaluation.evaluations.flatMap((e) => e.hazards.map((h) => h.type)));
  for (const [type, pattern] of Object.entries(HAZARD_WORDS)) {
    if (pattern.test(text) && !presentTypes.has(type)) violations.push(`Mentions ${type.toLowerCase()} but no such hazard is reported.`);
  }

  // 4. Distances and durations must match tool data (route values or differences).
  const known = collectNumbers(evaluation);
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s*(km|kilomet)/gi)) {
    const v = Number(m[1]);
    if (!known.km.some((k) => Math.abs(k - v) <= Math.max(0.3, k * 0.1))) violations.push(`Distance "${m[0]}" not supported by route data.`);
  }
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s*(min|minute)/gi)) {
    const v = Number(m[1]);
    if (!known.min.some((k) => Math.abs(k - v) <= Math.max(1.5, k * 0.15))) violations.push(`Duration "${m[0]}" not supported by route data.`);
  }

  return { passed: violations.length === 0, violations };
}

module.exports = { checkExplanation };
