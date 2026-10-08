# Phase 1: database and core logic

Complete files are in `sql/`, `shared/`, and `tests/`. This phase implements the algorithms and database transactions; HTTP endpoints and live provider calls arrive in Phase 2. The frontend remains the setup screen until Phases 3–4.

## Run the local checks

From PowerShell:

```powershell
Set-Location 'C:\Users\tnjma\Documents\Vibe coding\disastermesh'
npm.cmd ci
npm.cmd test
npm.cmd run build
```

`npm ci` is only needed on a fresh checkout or after dependencies change; dependencies are already installed in this workspace.

The test command runs the pure TypeScript tests and executes the actual SQL in a disposable in-memory Postgres runtime using the development-only `@electric-sql/pglite` package. It never reads `.env.local`, connects to Supabase, or changes cloud data. PGlite is not imported by the app or deployed API.

Optional focused commands:

```powershell
npm.cmd run test:logic
npm.cmd run test:db
```

## Install the database in Supabase

1. Open your Supabase project and choose **SQL Editor → New query**.
2. Open `sql/schema.sql` in your editor, copy the entire file into SQL Editor, and run it. This creates five tables, enums, indexes, RLS, and the transaction functions.
3. Open a second query, paste the entire `sql/seed.sql`, and run it. Its result should include:

   ```json
   { "status": "seeded", "incidents": 12, "reports": 17, "units": 14, "active_dispatches": 3 }
   ```

4. Run the entire `sql/verify.sql` in a third query. The checks are read-only. Switch between result sets to inspect the counts, Velachery incident, RLS status, function permissions, and aggregate consistency.

Expected fresh state:

| Check | Expected |
| --- | --- |
| Demo incidents | 12 |
| Demo reports | 17 |
| Demo units | 14 |
| En-route dispatches | 3 |
| Units available | 11 |
| Velachery | Open flood incident, High, 2 reports |
| Velachery coordinates | Approximately `12.9815, 80.2180` |
| RLS on app tables | Enabled on all five |
| Public policies on app tables | 0 |
| Mutation functions | `anon=false`, `authenticated=false`, `service_role=true` |
| Count/centroid inconsistency query | 0 rows |

All SQL is intended for this new DisasterMesh project. Re-running `schema.sql` preserves its tables and data; it is not a migration for unrelated existing tables. Re-running `seed.sql` returns `already_seeded` if demo data exists, preserving it. Seed timestamps are generated when seeding, so you will reset the demo immediately before the final live test to refresh its 60-minute grouping window.

The seed defines `seed_demo(boolean)` for the later authenticated reset route. `seed_demo(true)` deletes and recreates **demo-labelled** reports, incidents, units and dispatches. It preserves non-demo data and audit history, and refuses a reset if non-demo records reference demo entities. The HTTP route will additionally require a dispatcher session and `DEMO_MODE=true`; SQL Editor access is an administrator capability.

No Supabase SQL has been executed by the local tests. You must run the three SQL files above to install this phase in your cloud project.

## Files and responsibilities

| Complete file | Responsibility |
| --- | --- |
| `sql/schema.sql` | Tables, constraints, indexes, RLS, permissions, ingestion, dispatch, resolve and tick transactions |
| `sql/seed.sql` | Repeatable seed function and initial seed execution |
| `sql/verify.sql` | Read-only cloud setup verification |
| `shared/types.ts` | Shared request, entity, report, incident, unit and dispatch contracts |
| `shared/gazetteer.ts` | 21 Chennai localities, aliases, ambiguity detection |
| `shared/text.ts` | Small negation heuristic shared by extraction and scoring |
| `shared/entities.ts` | Deterministic entity extraction for LLM failure/timeout |
| `shared/geo.ts` | Haversine, coordinate validation, centroid, linear movement |
| `shared/scoring.ts` | Weighted rules, hybrid score, severity thresholds and reasoning |
| `shared/clustering.ts` | Compatibility, time/distance match, escalation and triage order |
| `shared/dispatch.ts` | Unit compatibility, ranked recommendations, nearest selection and ETA |
| `tests/fixtures.ts` | Test inputs and constructors; no credentials |
| `tests/logic.test.ts` | Algorithm boundaries, fallbacks and explainability checks |
| `tests/database.test.ts` | Executes the real schema/seed and validates database workflows and permissions |

## Explain the algorithms

**Distance.** Convert latitude/longitude differences to radians. Compute `a = sin²(dLat/2) + cos(lat1) × cos(lat2) × sin²(dLng/2)`. Distance is `2 × 6,371,000 × asin(sqrt(a))` metres. Clamp `a` to `[0,1]` to avoid floating-point errors. No geospatial library or PostGIS is used.

**Location lookup.** Normalize case and punctuation, then match whole locality aliases. One matched locality supplies its approximate centre. Multiple different localities are ambiguous and return no coordinate. Zero latitude/longitude are valid; missing coordinates are `null`. Gazetteer points represent a locality, not a confirmed building. The Phase 2 geocoder will apply the requested order: gazetteer, server-side Nominatim, supplied GPS, then unverified.

**Rule score.** Start at 10. Each keyword group contributes once even if repeated:

| Danger | Points |
| --- | --- |
| Not breathing / cannot breathe | 90 |
| Heart attack / cardiac arrest | 90 |
| Drowning | 85 |
| Unconscious | 80 |
| Collapse | 70 |
| Trapped | 60 |
| Fire | 60 |
| Bleeding | 55 |
| Rising water | 40 |
| Flood | 30 |
| Injury | 25 |

Children add 15; elderly, pregnant and disabled groups each add 12. An explicit count of 2–4 people adds 3, 5–9 adds 8, and 10+ adds 15. Food/water shortage adds 5, so supplies alone remain Low; shortages never reduce an actual life-threat score. Cap the total at 100.

**Negation and extraction.** The fallback recognizes nearby English negation such as “no fire” or “nobody is trapped,” while preserving the full danger phrase “not breathing.” It does not understand arbitrary languages, sarcasm, quoted reports or complex grammar. Gazetteer aliases include some Tamil names, but the fallback urgency vocabulary is English. Explicit totals take priority: “6 people including 2 children” means 6. If only subgroups are listed, use the largest stated group rather than inventing a summed total; absent counts stay null.

**Hybrid score.** With a valid model result, use `round(0.7 × ruleScore + 0.3 × llmScore)`. Preserve at least the lower boundary of the rule-derived severity, preventing the model from downgrading that category. Without a usable model response, use the rule score alone. Thresholds: Low `0–24`, Medium `25–49`, High `50–74`, Critical `75–100`. The reasoning JSON keeps keyword hits, negated keywords, modifiers, raw rule score, model output/status, weights, safety floor, final score and severity. The provider helper and eight-second timeout will be implemented in Phase 2.

**Grouping.** Search open incidents in the same demo/non-demo dataset. Match if distance is at most 300 m, the most recent report is at most 60 minutes old, and the emergency type is compatible. Equal types match; flood and trapped may match each other. `other` is not a wildcard. Select the closest candidate, breaking equal-distance ties by ID. The incident retains its initial emergency type. Recompute its centroid from every report's coordinates, not an average of old and new centroids.

**Escalation.** Take the highest individual report severity and add one tier when the incident has three or more reports. Never downgrade the incident. Recompute this against the original report severities on every merge, so a fourth low report does not promote an already promoted incident again. Model/report severity and cluster severity remain separately visible in stored data.

**Dispatch.** Filter to available, unassigned units in the same dataset before ranking by Haversine distance. Medical uses ambulances; fire uses fire engines; flood/trapped use boats or NDRF teams; collapse/other use NDRF or general rescue. Equal-distance ties use unit ID. ETA is `ceil(distanceMetres / (30 × 1000 / 3600))` seconds. This is a straight-line simulation estimate, not a road-routing ETA. An unknown incident location or lack of a suitable unit returns an explicit status while retaining the report.

**Movement.** Multiply elapsed time since the unit's persisted `last_moved_at` by the assumed speed. Demo movement is accelerated 15× so it is visible during the presentation; ETA remains the unaccelerated estimate. Move proportionally along the straight line to the incident centroid. Arrival changes `en_route` to `on_scene`. Resolve closes the incident and changes its assigned unit to `returning`; reaching the stored station makes it `available`. Positions, status changes, dispatch timestamps and audit events persist in Postgres. Repeated ticks use the updated timestamp, so opening a second dispatcher tab does not apply the same elapsed interval twice.

## Database safety and API handoff

Each mutation runs inside a single Postgres function call and takes the same [transaction advisory lock](https://www.postgresql.org/docs/current/explicit-locking.html). For this small demo, serializing short writes also protects the case where two arrivals both see no existing incident. Network/LLM calls will finish before entering the transaction.

Partial unique indexes enforce one unfinished dispatch per unit and one en-route/on-scene dispatch per incident. A unique `client_request_id` makes report retries idempotent. Reusing a request ID returns its original report and current incident state, with no extra report or dispatch. An invalid report rolls back its newly created incident too.

Functions use `SECURITY INVOKER`, an empty search path, qualified object names, and explicit server-only execution grants. Tables have [RLS enabled](https://supabase.com/docs/guides/database/postgres/row-level-security) with no public policies. We explicitly revoke the [default public function execution permission](https://supabase.com/docs/guides/database/functions). Dispatcher passcode/cookie checks remain the responsibility of the Phase 2 API; the shared algorithms are not an authentication mechanism.

The SQL distance, compatibility, grouping and reservation logic runs next to the writes so matching remains atomic. Equivalent TypeScript helpers support recommendations, explanatory UI and isolated testing. Tests compare SQL and TypeScript distances, severity thresholds, all emergency compatibility combinations and all emergency/unit compatibility combinations.

Local tests verify unique reservation constraints and idempotency, but PGlite uses a single connection. They are not a multi-connection cloud concurrency stress test. Live Supabase connectivity and deployed API behavior are verified in later phases.

## Sample live-test input

```text
SOS! We are trapped in rising water in Velachery.
6 people including 2 children need rescue.
```

On a fresh seed, the deterministic path extracts Velachery, flood, 6 people and children. Its rule score is 100 (Critical). It merges into the two-report Velachery incident at approximately 0 m from the seed centroid, bringing the count to 3. Available boat `R-01` is the nearest compatible unit, approximately 0.6 km away, and becomes `en_route`. Its ETA is about 72 seconds at the assumed speed. A functioning LLM may change the numeric score, but the rule severity floor preserves Critical and flood/trapped remain compatible.

This complete scenario already runs in `tests/database.test.ts`. Citizen submission from a browser is implemented in Phase 3 after the Phase 2 API.

## Phase boundary

After the SQL verification succeeds in Supabase, say **next** for Phase 2. It will implement the `/api/*` routes, provider helper, geocoding, input validation, dispatcher authentication and error handling. No Phase 2 HTTP routes have been added in this phase.
