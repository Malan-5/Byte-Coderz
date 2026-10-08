import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { COMPATIBLE_UNITS, pickNearestUnit } from '../shared/dispatch';
import { compatibleEmergencies } from '../shared/clustering';
import { lookupGazetteer } from '../shared/gazetteer';
import { haversineMeters, meanCoordinates } from '../shared/geo';
import { severityFromScore } from '../shared/scoring';
import { EMERGENCY_TYPES } from '../shared/types';
import type { Coordinates, Dispatch, Incident, PreparedReport, Report, Unit, UnitType } from '../shared/types';
import { DEMO_SOS, preparedReport } from './fixtures';

interface IngestResult {
  replayed: boolean;
  report: Report;
  incident: Incident;
  cluster_explanation: string;
  dispatch_result: { status: string; dispatch?: Dispatch } | null;
}

test('Postgres schema, seed, permissions and atomic workflows', { timeout: 120_000 }, async (t) => {
  // Test-only in-memory Postgres. This never reads .env.local or accesses Supabase.
  const db = new PGlite();
  t.after(async () => { await db.close(); });
  const schema = await readFile(new URL('../sql/schema.sql', import.meta.url), 'utf8');
  const seed = await readFile(new URL('../sql/seed.sql', import.meta.url), 'utf8');
  try {
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
    await db.exec(schema);
    await db.exec(seed);
  } catch (error) {
    throw new Error(`SQL initialization failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  async function ingest(report: PreparedReport = preparedReport()): Promise<IngestResult> {
    const result = await db.query<{ result: IngestResult }>('select public.ingest_report($1::jsonb) as result', [JSON.stringify(report)]);
    return result.rows[0]!.result;
  }
  async function reset() { await db.query('select public.seed_demo(true)'); }
  async function counts() {
    return (await db.query<{ incidents: number; reports: number; units: number; dispatches: number }>(`
      select (select count(*)::int from incidents where is_demo) as incidents,
        (select count(*)::int from reports where is_demo) as reports,
        (select count(*)::int from units where is_demo) as units,
        (select count(*)::int from dispatches where is_demo and status='en_route') as dispatches
    `)).rows[0]!;
  }

  await t.test('schema reruns without losing data; seed reruns without resetting', async () => {
    await db.exec(schema);
    await db.exec(seed);
    await db.exec(await readFile(new URL('../sql/verify.sql', import.meta.url), 'utf8'));
    assert.deepEqual(await counts(), { incidents: 12, reports: 17, units: 14, dispatches: 3 });
    const incidents = (await db.query<Incident>('select * from incidents where is_demo')).rows;
    const velachery = incidents.find((entry) => entry.location_label === 'Velachery')!;
    assert.equal(velachery.severity, 'High');
    assert.equal(velachery.report_count, 2);
    for (const entry of incidents) {
      const locality = lookupGazetteer(entry.location_label)!;
      assert.ok(Math.abs(entry.lat!-locality.lat) < 1e-9);
      assert.ok(Math.abs(entry.lng!-locality.lng) < 1e-9);
      const timestamp = new Date(entry.last_report_at).valueOf();
      assert.ok(Date.now()-timestamp < 60_000, 'Seed reports must have fresh timestamps');
    }
  });

  await t.test('SQL and TypeScript agree on distances, thresholds and type compatibility', async () => {
    const cases: [Coordinates,Coordinates][] = [
      [{ lat: 0,lng: 0 },{ lat: 0,lng: 1 }],
      [{ lat: 12.9815,lng: 80.218 },{ lat: 13.0012,lng: 80.2565 }],
      [{ lat: 0,lng: 0 },{ lat: 0,lng: 180 }],
    ];
    for (const [a,b] of cases) {
      const sql = await db.query<{ distance: number }>('select dm_haversine_m($1,$2,$3,$4) as distance',[a.lat,a.lng,b.lat,b.lng]);
      assert.ok(Math.abs(sql.rows[0]!.distance-haversineMeters(a,b)) < 1e-7);
    }
    const thresholds = await db.query<{ score: number; severity: string }>('select score,dm_severity(score) as severity from generate_series(0,100) as score');
    for (const row of thresholds.rows) assert.equal(row.severity,severityFromScore(row.score));
    const kinds: UnitType[] = ['ambulance','fire_engine','rescue_boat','ndrf_team','general_rescue'];
    for (const a of EMERGENCY_TYPES) {
      for (const b of EMERGENCY_TYPES) {
        const row = (await db.query<{ matches: boolean }>('select dm_types_compatible($1,$2) as matches',[a,b])).rows[0]!;
        assert.equal(row.matches,compatibleEmergencies(a,b));
      }
      for (const kind of kinds) {
        const row = (await db.query<{ matches: boolean }>('select dm_unit_compatible($1,$2) as matches',[a,kind])).rows[0]!;
        assert.equal(row.matches,COMPATIBLE_UNITS[a].includes(kind));
      }
    }
  });

  await t.test('live demo SOS merges into Velachery and reserves the nearest boat', async () => {
    await reset();
    const before = (await db.query<Incident>("select * from incidents where is_demo and location_label='Velachery'")).rows[0]!;
    const units = (await db.query<Unit>('select * from units')).rows;
    const recommended = pickNearestUnit(before,units)!;
    const result = await ingest();
    assert.equal(result.report.cluster_outcome,'merged');
    assert.equal(result.incident.id,before.id);
    assert.equal(result.incident.report_count,3);
    assert.equal(result.incident.severity,'Critical');
    assert.ok(result.report.match_distance_m! < 300);
    assert.ok(result.cluster_explanation.includes('3 reports'));
    assert.equal(result.dispatch_result?.status,'dispatched');
    assert.equal(result.dispatch_result?.dispatch?.unit_id,recommended.unit.id);
    assert.equal(result.dispatch_result?.dispatch?.unit_id,'R-01');
    const reports = (await db.query<Coordinates>('select lat,lng from reports where incident_id=$1',[before.id])).rows;
    const centroid = meanCoordinates(reports);
    assert.ok(Math.abs(result.incident.lat!-centroid.lat) < 1e-10);
    assert.ok(Math.abs(result.incident.lng!-centroid.lng) < 1e-10);
    assert.equal((await db.query<Unit>("select * from units where id='R-01'")).rows[0]!.status,'en_route');
  });

  await t.test('idempotent retries cannot add duplicate reports or duplicate dispatches', async () => {
    await reset();
    const payload = preparedReport();
    const first = await ingest(payload);
    const retry = await ingest(payload);
    assert.equal(retry.replayed,true);
    assert.equal(retry.report.id,first.report.id);
    assert.equal(retry.incident.report_count,3);
    assert.equal(retry.cluster_explanation,first.cluster_explanation);
    assert.equal(retry.dispatch_result?.dispatch?.id,first.dispatch_result?.dispatch?.id);
    const manual = await db.query<{ result: { status: string } }>('select dispatch_incident($1,false) as result',[first.incident.id]);
    assert.equal(manual.rows[0]!.result.status,'already_assigned');
    assert.equal((await counts()).dispatches,4);
  });

  await t.test('third report applies one escalation; fourth low report does not escalate again', async () => {
    await reset();
    const low = preparedReport('Assistance requested in Avadi.',{ final_score: 30 });
    let result = await ingest(low);
    assert.equal(result.incident.severity,'Medium');
    result = await ingest(preparedReport(low.raw_text,{ final_score: 30 }));
    assert.equal(result.incident.severity,'Medium');
    result = await ingest(preparedReport(low.raw_text,{ final_score: 10 }));
    assert.equal(result.incident.severity,'High');
    result = await ingest(preparedReport(low.raw_text,{ final_score: 10 }));
    assert.equal(result.incident.severity,'High');
    assert.equal(result.incident.report_count,4);
  });

  await t.test('unknown locations persist without merging or geographically guessing a unit', async () => {
    await reset();
    const result = await ingest(preparedReport('A person is unconscious at an unknown street.'));
    assert.equal(result.incident.lat,null);
    assert.equal(result.report.location_source,'unverified');
    assert.equal(result.dispatch_result?.status,'location_unverified');
    const second = await ingest(preparedReport('A person is unconscious at an unknown street.'));
    assert.notEqual(second.incident.id,result.incident.id);
    assert.equal(second.report.cluster_outcome,'new');
  });

  await t.test('old, resolved and incompatible incidents cannot absorb a new report', async () => {
    await reset();
    await db.exec("update incidents set last_report_at=now()-interval '61 minutes' where location_label='Velachery'");
    assert.equal((await ingest()).report.cluster_outcome,'new');
    await reset();
    await db.exec("select resolve_incident(id) from incidents where location_label='Velachery'");
    assert.equal((await ingest()).report.cluster_outcome,'new');
    await reset();
    assert.equal((await ingest(preparedReport('Fire and trapped residents in Velachery!'))).report.cluster_outcome,'new');
  });

  await t.test('no compatible available unit still leaves the report durably stored', async () => {
    await reset();
    // There are no non-demo units, and demo units must not serve a real incident.
    const result = await ingest(preparedReport(DEMO_SOS,{ is_demo: false }));
    assert.equal(result.report.cluster_outcome,'new');
    assert.equal(result.dispatch_result?.status,'no_compatible_unit');
    assert.equal(result.incident.report_count,1);
    const stored = await db.query('select id from reports where id=$1',[result.report.id]);
    assert.equal(stored.rows.length,1);
  });

  await t.test('partial unique indexes prevent double booking even on direct insert', async () => {
    await reset();
    const result = await ingest();
    await assert.rejects(() => db.query(`
      insert into dispatches (incident_id,unit_id,distance_m,eta_seconds,reasoning,is_demo)
      values ($1,'R-01',100,12,'duplicate reservation',true)
    `,[result.incident.id]), (error: unknown) => (error as { code?: string }).code === '23505');
  });

  await t.test('elapsed-time tick, arrival, resolution, return and reavailability persist', async () => {
    await reset();
    const result = await ingest();
    const before = (await db.query<Unit>("select * from units where id='R-01'")).rows[0]!;
    await db.exec("update units set last_moved_at=clock_timestamp()-interval '1 second' where id='R-01'");
    await db.exec('select tick_simulation(15)');
    const moving = (await db.query<Unit>("select * from units where id='R-01'")).rows[0]!;
    assert.equal(moving.status,'en_route');
    assert.ok(haversineMeters(before,moving)>0);
    assert.ok(haversineMeters(moving,result.incident as Coordinates)<haversineMeters(before,result.incident as Coordinates));
    await db.exec("update units set last_moved_at=clock_timestamp()-interval '1 hour' where status='en_route'; select tick_simulation(15)");
    assert.equal((await db.query<Unit>("select * from units where id='R-01'")).rows[0]!.status,'on_scene');
    await db.query('select resolve_incident($1)',[result.incident.id]);
    assert.equal((await db.query<Unit>("select * from units where id='R-01'")).rows[0]!.status,'returning');
    const again = (await db.query<{ result: { status: string } }>('select resolve_incident($1) as result',[result.incident.id])).rows[0]!.result;
    assert.equal(again.status,'already_resolved');
    await db.exec("update units set last_moved_at=clock_timestamp()-interval '1 hour' where status='returning'; select tick_simulation(15)");
    const home = (await db.query<Unit>("select * from units where id='R-01'")).rows[0]!;
    assert.equal(home.status,'available');
    assert.equal(home.current_incident_id,null);
    assert.equal(home.lat,home.station_lat);
    assert.equal(home.lng,home.station_lng);
    const dispatch = (await db.query<Dispatch>('select * from dispatches where id=$1',[result.dispatch_result!.dispatch!.id])).rows[0]!;
    assert.equal(dispatch.status,'completed');
    assert.ok(dispatch.arrived_at && dispatch.returning_at && dispatch.completed_at);
  });

  await t.test('invalid reports roll back their new incident too', async () => {
    await reset();
    const before = await counts();
    await assert.rejects(() => ingest(preparedReport('Help in Porur',{ lat: 91 })), (error: unknown) => (error as { code?: string }).code === '23514');
    await assert.rejects(() => ingest(preparedReport('',{ raw_text: '', lat: null, lng: null, location_source: 'unverified' })));
    assert.deepEqual(await counts(),before);
  });

  await t.test('RLS enabled on all five tables, zero policies, no public RPC execution', async () => {
    const tables = (await db.query<{ relname: string; relrowsecurity: boolean }>(`
      select relname,relrowsecurity from pg_class where relnamespace='public'::regnamespace
      and relname in ('reports','incidents','units','dispatches','audit_log')
    `)).rows;
    assert.equal(tables.length,5);
    assert.ok(tables.every((row) => row.relrowsecurity));
    assert.equal((await db.query('select * from pg_policies where schemaname=\'public\'')).rows.length,0);
    for (const signature of ['ingest_report(jsonb)','dispatch_incident(uuid,boolean)','resolve_incident(uuid)','tick_simulation(double precision)','seed_demo(boolean)']) {
      const privileges = (await db.query<{ anon: boolean; authenticated: boolean; server: boolean }>(`
        select has_function_privilege('anon',$1,'execute') as anon,
          has_function_privilege('authenticated',$1,'execute') as authenticated,
          has_function_privilege('service_role',$1,'execute') as server
      `,[signature])).rows[0]!;
      assert.deepEqual(privileges,{ anon: false, authenticated: false, server: true });
    }
    await db.exec('set role anon');
    try {
      await assert.rejects(() => db.query('select * from reports'),(error: unknown) => (error as { code?: string }).code === '42501');
      await assert.rejects(() => db.query('select seed_demo(true)'),(error: unknown) => (error as { code?: string }).code === '42501');
    } finally { await db.exec('reset role'); }
  });

  await t.test('service_role can execute the workflow and demo reset preserves real records', async () => {
    await db.exec('set role service_role');
    try {
      const real = await ingest(preparedReport('Supply request in Avadi.',{ is_demo: false, final_score: 15 }));
      const demo = await ingest();
      assert.ok(demo.report.id);
      await reset();
      assert.deepEqual(await counts(),{ incidents: 12,reports: 17,units: 14,dispatches: 3 });
      assert.equal((await db.query('select id from reports where id=$1',[real.report.id])).rows.length,1);
      assert.equal((await db.query('select id from incidents where id=$1',[real.incident.id])).rows.length,1);
      assert.ok((await db.query("select id from audit_log where action='demo.reset'")).rows.length > 0);
    } finally { await db.exec('reset role'); }
  });
});
