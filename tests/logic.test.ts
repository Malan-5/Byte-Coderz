import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compatibleEmergencies, findCluster, mergedSeverity, recomputeCluster, sortTriage } from '../shared/clustering';
import { estimateEtaSeconds, pickNearestUnit, recommendUnits } from '../shared/dispatch';
import { extractFallbackEntities, extractPeopleCount } from '../shared/entities';
import { findGazetteerMatches, lookupGazetteer } from '../shared/gazetteer';
import { EARTH_RADIUS_M, haversineMeters, isCoordinates, meanCoordinates, moveToward } from '../shared/geo';
import { scoreUrgency, severityFromScore } from '../shared/scoring';
import type { LlmAnalysis } from '../shared/types';
import { DEMO_SOS, incident, unit } from './fixtures';

test('Haversine: same point, known equatorial degree, symmetry and antipodes', () => {
  const origin = { lat: 0, lng: 0 };
  assert.equal(haversineMeters(origin, origin), 0);
  assert.ok(Math.abs(haversineMeters(origin, { lat: 0, lng: 1 }) - 111194.9266) < 0.01);
  const destination = { lat: 13.0012, lng: 80.2565 };
  assert.equal(haversineMeters(origin, destination), haversineMeters(destination, origin));
  assert.ok(Math.abs(haversineMeters(origin, { lat: 0, lng: 180 }) - Math.PI * EARTH_RADIUS_M) < 0.01);
});

test('coordinates accept zeros and reject NaN, infinity, missing or out-of-range values', () => {
  assert.ok(isCoordinates({ lat: 0, lng: 0 }));
  for (const invalid of [null, { lat: NaN, lng: 80 }, { lat: 91, lng: 80 }, { lat: 13, lng: Infinity }]) {
    assert.equal(isCoordinates(invalid), false);
  }
  assert.throws(() => haversineMeters({ lat: 91, lng: 0 }, { lat: 0, lng: 0 }), RangeError);
});

test('centroids use every point, not an unweighted average of old/new centroids', () => {
  assert.deepEqual(meanCoordinates([{ lat: 12, lng: 80 }, { lat: 12, lng: 80 }, { lat: 15, lng: 83 }]), { lat: 13, lng: 81 });
  assert.throws(() => meanCoordinates([]), RangeError);
});

test('gazetteer matches punctuation, aliases, Tamil and whole locality names', () => {
  assert.equal(lookupGazetteer('Help near T.Nagar, Chennai!')?.name, 'T. Nagar');
  assert.equal(lookupGazetteer('AnnaNagar')?.name, 'Anna Nagar');
  assert.equal(lookupGazetteer('வேளச்சேரி')?.name, 'Velachery');
  assert.equal(lookupGazetteer('Unknown street'), null);
  assert.equal(lookupGazetteer('NotVelachery'), null);
  assert.equal(lookupGazetteer('between Adyar and Velachery'), null);
  assert.equal(findGazetteerMatches('between Adyar and Velachery').length, 2);
});

test('fallback extracts the demo location, type, total people and vulnerability', () => {
  assert.deepEqual(extractFallbackEntities(DEMO_SOS), {
    location_mentions: ['Velachery'], emergency_type: 'flood', people_count: 6, vulnerable_groups: ['children'],
  });
  assert.equal(extractPeopleCount('six people including two children'), 6);
  assert.equal(extractPeopleCount('family of four'), 4);
  assert.equal(extractPeopleCount('Chennai 600042, call 1234567890'), null);
});

test('fallback does not treat negated danger or vulnerability as present', () => {
  const entities = extractFallbackEntities('No fire. No children here. Need water in Adyar.');
  assert.equal(entities.emergency_type, 'other');
  assert.deepEqual(entities.vulnerable_groups, []);
  assert.equal(extractFallbackEntities('A person is not breathing in Adyar.').emergency_type, 'medical');
  assert.equal(extractFallbackEntities("A person can't breathe in Adyar.").emergency_type, 'medical');
});

test('severity thresholds are explicit and reject invalid numbers', () => {
  for (const [score, expected] of [[0,'Low'],[24,'Low'],[25,'Medium'],[49,'Medium'],[50,'High'],[74,'High'],[75,'Critical'],[100,'Critical']] as const) {
    assert.equal(severityFromScore(score), expected);
  }
  for (const score of [-1,101,NaN,Infinity]) assert.throws(() => severityFromScore(score), RangeError);
});

test('SOS is critical with auditable keyword and people modifiers', () => {
  const score = scoreUrgency(DEMO_SOS);
  assert.equal(score.severity, 'Critical');
  assert.equal(score.final_score, 100);
  assert.deepEqual(score.keyword_hits.map((hit) => hit.label), ['trapped','rising water']);
  assert.deepEqual(score.modifiers.map((hit) => hit.label), ['children','6 people']);
});

test('repeating keywords does not inflate the score; shortages remain low', () => {
  assert.equal(scoreUrgency('fire fire fire').final_score, scoreUrgency('fire').final_score);
  assert.equal(scoreUrgency('No food or water in a shelter').severity, 'Low');
  assert.equal(scoreUrgency('No food or water. A person is unconscious.').severity, 'Critical');
});

test('negative keywords are recorded, while positive danger in another clause still counts', () => {
  const safe = scoreUrgency('No fire. Nobody is trapped?');
  assert.ok(safe.negated_keywords.includes('fire'));
  assert.ok(safe.negated_keywords.includes('trapped'));
  assert.equal(safe.severity,'Low');
  const mixed = scoreUrgency('No fire, but a person is unconscious.');
  assert.equal(mixed.severity, 'Critical');
  assert.equal(scoreUrgency('He is not breathing').severity, 'Critical');
  assert.equal(scoreUrgency('Heart attack in Adyar').severity, 'Critical');
});

test('LLM hybrid weights are 70/30 and cannot downgrade rule severity', () => {
  const llm: LlmAnalysis = { ...extractFallbackEntities(DEMO_SOS), urgency_score: 0, explanation: 'Test low model score', image_description: null };
  const result = scoreUrgency(DEMO_SOS, extractFallbackEntities(DEMO_SOS), llm);
  assert.equal(result.weighted_score, 70);
  assert.equal(result.final_score, 75);
  assert.equal(result.severity, 'Critical');
  assert.equal(result.llm_status, 'used');
  const raised = scoreUrgency('An injury', extractFallbackEntities('An injury'), { ...llm, urgency_score: 100 });
  assert.equal(raised.severity, 'High');
});

test('timeouts and invalid model scores use only deterministic rules', () => {
  const entities = extractFallbackEntities(DEMO_SOS);
  const fallback = scoreUrgency(DEMO_SOS, entities, null, 'timeout');
  assert.equal(fallback.llm_status, 'timeout');
  assert.equal(fallback.llm_weight, 0);
  assert.equal(fallback.final_score, fallback.rule_score);
  const invalid = scoreUrgency(DEMO_SOS, entities, { ...entities, urgency_score: NaN, explanation: '', image_description: null });
  assert.equal(invalid.llm_status, 'invalid');
  assert.equal(invalid.llm_output, null);
});

test('clustering includes 300 m / 60 minute boundaries and excludes just outside', () => {
  const old = incident();
  const input = { lat: old.lat!, lng: old.lng!, emergency_type: old.emergency_type, created_at: '2026-10-08T10:05:00.000Z', is_demo: true };
  assert.equal(findCluster(input, [old])?.incident.id, old.id);
  assert.equal(findCluster({ ...input, created_at: '2026-10-08T10:05:00.001Z' }, [old]), null);
  const offset = (meters: number) => ({ ...input, lat: old.lat! + meters / EARTH_RADIUS_M * 180 / Math.PI });
  assert.ok(findCluster(offset(299.999), [old]));
  assert.equal(findCluster(offset(300.001), [old]), null);
});

test('clustering rejects closed, incompatible, future, unverified and other-mode incidents', () => {
  const base = incident();
  const input = { lat: base.lat, lng: base.lng, emergency_type: base.emergency_type, created_at: '2026-10-08T09:10:00.000Z', is_demo: true };
  assert.equal(findCluster(input, [incident({ status: 'resolved' })]), null);
  assert.equal(findCluster(input, [incident({ emergency_type: 'fire' })]), null);
  assert.equal(findCluster(input, [incident({ last_report_at: '2026-10-08T10:00:00.000Z' })]), null);
  assert.equal(findCluster(input, [incident({ is_demo: false })]), null);
  assert.equal(findCluster({ ...input, lat: null, lng: null }, [base]), null);
  assert.ok(compatibleEmergencies('flood','trapped'));
  assert.equal(compatibleEmergencies('other','flood'), false);
});

test('nearest matching cluster wins and merge explanation contains the new count', () => {
  const input = { lat: 12.9815, lng: 80.2180, emergency_type: 'flood' as const, created_at: '2026-10-08T09:10:00.000Z', is_demo: true };
  const nearest = incident({ id: 'near' });
  const farther = incident({ id: 'far', lat: 12.982 });
  const match = findCluster(input, [farther,nearest]);
  assert.equal(match?.incident.id, 'near');
  assert.equal(match?.explanation, 'Merged with Incident #1 (distance 0 m, 3 reports)');
});

test('three reports promote once; later merges never downgrade or repeatedly promote', () => {
  assert.equal(mergedSeverity('Medium',['Medium','Medium']), 'Medium');
  assert.equal(mergedSeverity('Medium',['Medium','Medium','Low']), 'High');
  assert.equal(mergedSeverity('High',['Medium','Medium','Low','Low']), 'High');
  assert.equal(mergedSeverity('High',['High','High','Low']), 'Critical');
  assert.equal(mergedSeverity('Critical',['Low']), 'Critical');
  const merged = recomputeCluster('Low', [{ lat: 13, lng: 80, severity: 'Low' },{ lat: 13.002, lng: 80.002, severity: 'High' }]);
  assert.ok(Math.abs(merged.lat-13.001) < 1e-10);
  assert.ok(Math.abs(merged.lng-80.001) < 1e-10);
  assert.equal(merged.report_count,2);
  assert.equal(merged.severity,'High');
});

test('triage sorts severity first, then report count; resolved incidents disappear', () => {
  const sorted = sortTriage([incident({ id: 'low', severity: 'Low', report_count: 9 }),
    incident({ id: 'critical', severity: 'Critical', report_count: 1 }),
    incident({ id: 'many', severity: 'High', report_count: 5 }),incident({ id: 'few' }),
    incident({ id: 'closed', status: 'resolved', severity: 'Critical' })]);
  assert.deepEqual(sorted.map((entry) => entry.id), ['critical','many','few','low']);
});

test('dispatch filters busy, wrong-type and other-mode units before finding the nearest', () => {
  const picked = pickNearestUnit(incident(), [
    unit({ id: 'A-01', unit_type: 'ambulance', lat: 12.9815, lng: 80.2180 }),
    unit({ id: 'R-02', status: 'returning', current_incident_id: 'busy', lat: 12.9815, lng: 80.2180 }),
    unit({ id: 'N-01', unit_type: 'ndrf_team', lat: 13.01 }),unit(),
    unit({ id: 'R-03', is_demo: false, lat: 12.9815, lng: 80.2180 }),
  ]);
  assert.equal(picked?.unit.id, 'R-01');
  assert.ok(picked!.distance_m > 0);
  assert.ok(picked!.reasoning.includes('nearest available compatible boat'));
});

test('medical and fire require specialized units; no unit/location returns null', () => {
  assert.equal(pickNearestUnit(incident({ emergency_type: 'medical' }), [unit()]), null);
  assert.equal(pickNearestUnit(incident({ emergency_type: 'fire' }), [unit()]), null);
  assert.equal(pickNearestUnit(incident({ lat: null, lng: null }), [unit()]), null);
  assert.equal(pickNearestUnit(incident(), []), null);
  assert.equal(pickNearestUnit(incident(), [unit({ id: 'R-02' }),unit({ id: 'R-01' })])?.unit.id, 'R-01');
  const recommendations = recommendUnits(incident(),[unit(),unit({ id: 'R-02',lat: 12.97 })]);
  assert.ok(recommendations[0]!.reasoning.includes('nearest'));
  assert.ok(!recommendations[1]!.reasoning.includes('nearest'));
});

test('ETA uses distance/speed; linear movement stops at its destination', () => {
  assert.equal(estimateEtaSeconds(3000), 360);
  assert.equal(estimateEtaSeconds(0), 0);
  assert.throws(() => estimateEtaSeconds(10,0), RangeError);
  const from = { lat: 13, lng: 80 }; const to = { lat: 13.01, lng: 80 };
  const half = moveToward(from,to,haversineMeters(from,to)/2);
  assert.ok(Math.abs(half.lat-13.005)<1e-10);
  assert.equal(half.arrived,false);
  assert.deepEqual(moveToward(from,to,1e6), { ...to, arrived: true });
});
