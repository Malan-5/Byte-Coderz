# DisasterMesh

A Chennai crisis dispatch command center for PS-05. The implementation follows the requested seven phases and stops after each phase until you say **next**.

**Current delivery: Phases 1–4 complete.** The citizen reporting form and authenticated dispatcher command center are implemented. Local Supabase and Gemini connectivity have been verified. Phase 5 deployment is prepared; the linked Vercel project still needs Production environment variables and its Node version corrected to 22.x. See the [Phase 1 guide](docs/phase-1.md) and [Phase 2 guide](docs/phase-2.md) for the database, algorithms, routes, and API verification details.

```powershell
npm.cmd test
npm.cmd run build
```

## 1. Prerequisites and installation

Use Node.js 22.12 or newer within the 22.x line and npm. This computer has Node.js 22.15.1. Keep the same major version in Vercel. Vite's supported Node versions are documented [here](https://vite.dev/guide/).

Run these commands in **PowerShell**. Using `npm.cmd` avoids Windows PowerShell's npm.ps1 execution-policy issue.

```powershell
Set-Location 'C:\Users\tnjma\Documents\Vibe coding\disastermesh'
node --version
npm.cmd --version
npm.cmd ci
if (-not (Test-Path -LiteralPath '.env.local')) {
  Copy-Item -LiteralPath '.env.example' -Destination '.env.local'
}
npm.cmd run build
npm.cmd run dev
```

For the complete local application, configure `.env.local` and run `npm.cmd run dev:full`. Open `http://localhost:3000/report` for citizen reporting or `http://localhost:3000/command` for dispatcher login. The reporting page is public; the command center requires the private `DISPATCHER_PASSCODE` from `.env.local`.

`npm ci` installs the exact dependency versions in `package-lock.json`. The first installation used `npm.cmd install`; use `npm ci` on fresh checkouts. Dependencies for later phases are already included:

| Purpose | Packages |
| --- | --- |
| Interface | `react`, `react-dom`, `react-router-dom` |
| Map | `leaflet`, `react-leaflet`, `@types/leaflet` |
| Server database access | `@supabase/supabase-js` |
| Validation and signed sessions | `zod`, `jose` |
| Build and styles | `vite`, `@vitejs/plugin-react`, `typescript`, `tailwindcss`, `@tailwindcss/vite` |
| Serverless development | `vercel`, `@vercel/node` |
| Tests | `tsx` with Node's built-in test runner; development-only `@electric-sql/pglite` for SQL execution |

The LLM helper uses server-side `fetch`; no provider SDK is required. React 19 and React Leaflet 5 are paired. Tailwind uses its [official Vite plugin](https://tailwindcss.com/docs/installation/using-vite), so a legacy PostCSS or Tailwind configuration file is unnecessary.

## 2. Folder structure

```text
disastermesh/
├── api/                     Complete Vercel routes
│   └── _lib/                Server-only database, session, LLM, geocode and HTTP helpers
├── shared/                  Complete algorithms, gazetteer, extraction and types
├── sql/                     Complete schema, seed and verification SQL
├── tests/                   Algorithm and database workflow tests
├── docs/                    Phase-specific setup, route and algorithm guides
├── public/
│   └── favicon.svg
├── scripts/
│   └── check-env.mjs        Checks configuration format without printing secrets
├── src/
│   ├── components/         Reusable interface elements in Phases 3–4
│   ├── hooks/              Polling and speech hooks in Phases 3–4
│   ├── lib/                Same-origin API client in Phase 3
│   ├── pages/              Citizen and dispatcher screens in Phases 3–4
│   ├── App.tsx             Routes for /report and /command
│   ├── main.tsx
│   └── styles.css
├── .env.example            Blank server configuration template, safe to commit
├── .env.local              Your local configuration, ignored by Git
├── .gitignore
├── .nvmrc
├── .vercelignore            Excludes local secrets from CLI uploads
├── index.html
├── package.json
├── package-lock.json
├── tsconfig.json
├── vercel.json
├── vite.config.ts
└── README.md
```

The API and UI folders reserved for later phases are intentionally empty; there are no stub handlers or pretend data flows. In Git, empty directories do not appear until their complete files are added.

Phases 1–4 are implemented:

```text
Phase 1 (delivered; see docs/phase-1.md for the complete file list)
  sql/schema.sql            Tables, enums, indexes, RLS, atomic mutation functions
  sql/seed.sql              Approximately 12 incidents and 14 response units
  sql/verify.sql            Read-only checks for the cloud installation
  shared/types.ts           Request, incident, report and unit types
  shared/gazetteer.ts       Chennai locality coordinates and aliases
  shared/entities.ts       Deterministic fallback entity extraction
  shared/geo.ts             Haversine distance and centroid calculations
  shared/scoring.ts         Explainable rule/hybrid scoring
  shared/clustering.ts      Distance, time and type compatibility
  shared/dispatch.ts        Nearest available compatible unit
  tests/logic.test.ts       Boundary and safety cases for the algorithms
  tests/database.test.ts    Runs actual SQL, dispatch lifecycle and permission checks

Phase 2 (delivered; see docs/phase-2.md)
  api/_lib/llm.ts           Single provider helper, JSON validation, 8 s timeout
  api/_lib/db.ts            Service-role Supabase client, never imported by src/
  api/_lib/auth.ts          Passcode and httpOnly signed-cookie authentication
  api/_lib/geocode.ts       Gazetteer, Nominatim, GPS, unverified fallback
  api/_lib/http.ts          Validation, same-origin checks and HTTP errors
  api/login.ts             POST: establish dispatcher session
  api/logout.ts            POST: clear dispatcher session
  api/state.ts             GET: authenticated live state and system status
  api/report.ts            POST: public citizen report ingestion
  api/dispatch.ts          POST: authenticated manual dispatch
  api/resolve.ts           POST: authenticated resolution and return journey
  api/tick.ts              POST: authenticated, DB-coordinated simulation tick
  api/seed.ts              POST: authenticated demo initialization/reset
  api/tiles.ts             GET: same-origin OSM raster tile proxy
  api/status.ts            GET: public dependency status

Phase 3 (citizen reporting)
  src/pages/ReportPage.tsx  Text, voice transcript, image, GPS/manual location, result summary

Phase 4 (dispatcher command center)
  src/pages/CommandPage.tsx Authenticated triage, Leaflet map, dispatch/resolve, live unit tracking
  src/pages/command.css     Responsive operations layout
```

## 3. Server environment variables

Edit `.env.local` in your editor. Do not send credentials in chat, put them in source files, or prefix them with `VITE_`. Vite's client code must not import anything from `api/`. The browser will call relative `/api/*` URLs.

| Variable | Value / purpose |
| --- | --- |
| `SUPABASE_URL` | The Supabase project's HTTPS URL |
| `SUPABASE_SERVICE_ROLE_KEY` | The privileged `service_role` key from the project's API settings; server only |
| `DISPATCHER_PASSCODE` | A private passcode of at least 12 characters |
| `JWT_SECRET` | An independent secret generated from at least 32 random bytes |
| `LLM_PROVIDER` | `gemini` (default) or `openai` |
| `GEMINI_API_KEY` | Required to use Gemini; leave blank when using the other provider |
| `GEMINI_MODEL` | Default `gemini-2.5-flash`; choose an available vision/structured-output model in your account |
| `OPENAI_API_KEY` | Required when `LLM_PROVIDER=openai`; otherwise blank |
| `OPENAI_MODEL` | Set to your available vision/JSON-capable model when selecting OpenAI |
| `APP_ORIGIN` | `http://localhost:3000` locally; the exact HTTPS deployment origin in Vercel |
| `OSM_CONTACT_EMAIL` | Monitored contact address identifying server requests to OSM/Nominatim |
| `DEMO_MODE` | `true` for this hackathon demo; enables authenticated seed/reset in Phase 2 |

Generate the JWT secret **locally** and paste it into `.env.local`. This prints a newly generated secret in your terminal; do not include the output in screenshots or commits:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Then run:

```powershell
npm.cmd run check:env
```

This checks formatting only. Blank credentials cause a nonzero exit, as expected before setup. An absent LLM key produces a warning: text scoring will have a rule fallback in Phase 2, but image understanding needs a working provider. Real database and LLM connectivity will be verified after the API implementation. The checker never prints supplied values.

## 4. Supabase setup

1. Create a project in the [Supabase dashboard](https://supabase.com/dashboard). Select a region close to Chennai when available and save the database password privately. The application uses the API URL/key, not the database password.
2. Obtain the project's URL from its Connect dialog or API settings. Set `SUPABASE_URL` locally.
3. In the API keys settings, locate the legacy `service_role` key and set `SUPABASE_SERVICE_ROLE_KEY`. Do not use the `anon` key or a browser quickstart. The requested implementation uses the service-role credential exclusively on the server. Supabase also offers new server secret keys; its [key documentation](https://supabase.com/docs/guides/getting-started/api-keys) explains their role and the legacy-key transition.
4. Run the complete `sql/schema.sql` in SQL Editor, then `sql/seed.sql`, then `sql/verify.sql`. The [Phase 1 guide](docs/phase-1.md) describes the expected results. RLS is enabled with no public policies, and mutation functions are restricted to the server's role.
5. No Storage bucket is required for the initial implementation: compressed image base64 will be stored with the report in Postgres. The API will impose a payload limit below Vercel's request limit.

Local tests do not install SQL in the cloud. Run the SQL files in your own Supabase project using the instructions above. The environment format checker does not verify cloud connectivity.

## 5. LLM setup

For the default provider, create a key in [Google AI Studio](https://aistudio.google.com/apikey), set `GEMINI_API_KEY`, and confirm the selected model is accessible to that account. The documented [Gemini 2.5 Flash model](https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash) supports image input and structured outputs. Model selection stays in the server environment so it can be changed without editing the UI.

The helper enforces an 8-second LLM budget and validates returned JSON. A failed, invalid, or timed-out model response leaves deterministic extraction/scoring available and records the fallback in report reasoning.

## 6. Vercel setup and local backend development

The project uses standard [Vite on Vercel](https://vercel.com/docs/frameworks/frontend/vite) with TypeScript functions in root-level `api/`.

The local folder is linked to the Vercel project `disastermesh`. To link a fresh checkout, run:

```powershell
npm.cmd run vercel -- login
npm.cmd run vercel -- link
```

Choose your own scope, create or select **disastermesh**, and use the current directory (`./`) as the project root. These commands link the local project; production deployment belongs to Phase 5.

In Vercel Project Settings:

- Framework: **Vite**.
- Root directory: the directory containing `package.json` (use `disastermesh` only if the Git repository contains the parent folder).
- Node.js: **22.x**. The currently linked project reports Node 24.x; change its Project Settings before deployment to match `package.json` and `.nvmrc`.
- Install: `npm ci`.
- Build: `npm run build`.
- Output: `dist`.
- Development command: use the checked-in `vercel.json` setting.
- Add every required value from `.env.local` to the appropriate [Vercel environments](https://vercel.com/docs/environment-variables), including Production and Preview as needed. Do this in Vercel Project Settings or type each value directly into the Vercel CLI prompt; never paste secrets into chat, source, or a `VITE_` variable. Production currently has no variables configured. Set `APP_ORIGIN` to the exact HTTPS domain assigned to the deployment; use the Preview URL for Preview environments.
- Keep Production/Preview credentials out of client-prefixed variables. Environment changes require a new deployment to take effect.

After configuring the Vercel Node version and server variables, deploy from the repository root:

```powershell
npm.cmd run check:env
npm.cmd test
npm.cmd run build
npm.cmd run check:build-secrets
npm.cmd run vercel -- --prod
```

The currently configured Git remote is `origin` on GitHub. Review `git status` and the staged diff before committing/pushing; `.env.local` and `.vercel/` are ignored. Never force-push. Once deployed, open `/api/status`, `/report`, and `/command` on the production domain, then sign in and run the live demo checklist below. Keep the Vercel deployment URL and any access details private until you choose to share them.

After Phase 2, start the API and frontend together:

```powershell
npm.cmd run dev:full
```

Open `http://localhost:3000`. [`vercel dev`](https://vercel.com/docs/cli/dev) runs the frontend and local serverless functions under one origin and loads the local environment. Plain `npm run dev` and `npm run preview` serve the frontend only; they cannot run `api/*.ts` functions. Do not configure Vercel's Development Command to `dev:full` because that would start Vercel recursively.

The SPA rewrites match `/report` and `/command` explicitly, leaving `/api/*` untouched. Authentication will be enforced on server routes, including state, dispatch, tick, resolve, and seed; a client route alone is not an access-control boundary.

## 7. Architecture and implementation decisions

```text
Browser: /report or /command
  | same-origin /api/* requests; dispatcher state and movement tick every 2 s
  v
Vercel TypeScript functions
  |-- server session validation and input validation
  |-- vision/entity extraction with deterministic fallback
  |-- gazetteer -> server geocoder -> browser GPS -> unverified
  |-- hand-written scoring, Haversine, clustering, unit selection
  |-- Supabase service-role client -> durable Postgres records
  `-- /api/tiles -> OpenStreetMap (no browser request to a third-party API)
```

- An unverified location will remain unverified; it will not silently become a Chennai coordinate or trigger a geographically guessed dispatch.
- Reports within 300 m and 60 minutes merge only with compatible open incidents. A merge records its distance and uses the mean of all report coordinates for the centroid. Seed timestamps are relative to the time of reset so the Velachery demo can still merge.
- Database transactions/conditional updates will protect incident updates and unit reservations from concurrent requests. A stale browser list cannot dispatch an unavailable unit, and auto-dispatch must not assign a second unit to an already served incident.
- Movement uses elapsed time and a DB-coordinated tick, rather than increasing speed when multiple dispatcher tabs are open. Positions, dispatches, report actions, and audit entries persist in Postgres.
- An authenticated session is required for seeding/reset, which additionally requires `DEMO_MODE=true`. Reset is for simulated demo data only.
- Tiles will use the same-origin proxy to meet the strict browser networking requirement. Keep visible OpenStreetMap attribution, identify the application, and honor upstream caching headers per the [OSM tile policy](https://operations.osmfoundation.org/policies/tiles/). No offline bulk download or prefetching.
- Browser speech recognition and geolocation use native browser permission prompts. The Web Speech API's recognition service may itself use the browser vendor's service; application JavaScript makes no credentialed third-party API calls. A typed-transcript fallback will always be available.

## 8. Phase 5 verification and security checklist

```powershell
npm.cmd run check
npm.cmd run build
npm.cmd run check:env
npm.cmd run verify:connections
npm.cmd run check:secrets
npm.cmd run check:build-secrets
npm.cmd test
npm.cmd run build
```

`check:env` checks formatting only. `verify:connections` makes read-only Supabase and LLM checks. `check:secrets` scans staged files only, so stage only the intended changes before using it; `check:build-secrets` compares locally configured secret values against generated deployment bundles without printing the values. Confirm `.env.local` is ignored with `git check-ignore .env.local` and verify that the browser bundle contains no service-role key, LLM key, dispatcher passcode, or JWT secret. Never run a secret grep that prints the matched value.

Before calling the deployment ready, verify the deployed `/api/status` reports the database connected; `/command` rejects anonymous `/api/state`; dispatcher login sets an HttpOnly, SameSite cookie; the live queue and map load; dispatch reserves one available compatible unit; Resolve sends the unit back; and a citizen Velachery SOS merges with the seeded cluster. The automated API verification script resets demo data and creates a test SOS; run `npm.cmd run verify:api` only when it is acceptable to reset the demo dataset.

Verified locally on 8 October 2026: environment format passed; Supabase connected with 12 incidents; Gemini structured output succeeded; `npm test` passed all 38 tests; production build passed; the build secret scan found none of the six configured secret values in 2,815 generated client/function files. The linked Vercel project has no Production environment variables yet, and its Node version must be changed from 24.x to 22.x. A production deploy has therefore not been attempted.

Dependency audit: `npm audit --omit=dev` reported zero vulnerabilities. The full audit still reports 33 advisories in Vercel development tooling (8 moderate, 24 high, 1 critical), including its transitive archive/parser packages. A compatible `npm audit fix` did not resolve them. This is not a clean full dependency audit; avoid treating a passing build as security certification. Recheck supported Vercel tool updates before the final deployment review rather than applying an untested forced downgrade.

## 9. Explain this in Q&A

- **How do you calculate distance?** Haversine converts latitude/longitude differences into the great-circle distance on Earth, using a 6,371 km mean radius. This is more accurate than treating degrees as flat meters and is short enough to implement and explain directly.
- **How are duplicate reports grouped?** A report joins the nearest open, compatible incident only when its coordinates are within 300 m and the incident's latest report is no older than 60 minutes. The database repeats the check inside a locked transaction so simultaneous reports cannot create inconsistent clusters. A merge recomputes the centroid from every report coordinate.
- **How is urgency decided?** Weighted emergency phrases add to a transparent rule score; vulnerable groups and the number of people add explicit modifiers. When the configured model responds within 8 seconds with valid structured JSON, the score is 70% rules and 30% model. The final score cannot fall below the rule-derived severity floor. Failures use the rule score alone, and the reasoning is stored with the report.
- **How is a unit chosen?** Filter to units that are available, unassigned, in the same demo/production dataset, and compatible with the emergency. Calculate Haversine distance for each candidate and choose the nearest; the database verifies availability again while reserving the unit. ETA assumes 30 km/h.
- **How does tracking work without sensors?** The browser asks the authenticated server to tick every 2 seconds. A database transaction moves each en-route unit toward its incident and each returning unit toward its station based on elapsed time, then persists its coordinates/status. Demo movement is accelerated for a short live presentation.
- **Why is the Supabase service key safe?** Only Vercel serverless functions import the server database helper. The browser calls same-origin `/api/*` routes; tables have RLS enabled with no public policies. Dispatcher access is a server-checked passcode exchanged for a signed HttpOnly cookie.
- **What if the language model is unavailable?** Rule-based extraction/scoring remains available for text and transcript reports. The report stores the LLM status and scoring evidence. Image understanding requires a configured vision-capable provider.

Phase 1 and Phase 2 detail is in [docs/phase-1.md](docs/phase-1.md) and [docs/phase-2.md](docs/phase-2.md). Phase 6 is the rehearsed three-minute demo script and judge Q&A.
