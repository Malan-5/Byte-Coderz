# DisasterMesh

A Chennai crisis dispatch command center for PS-05. The implementation follows the requested seven phases and stops after each phase until you say **next**.

**Current delivery: Phase 1.** The SQL schema, seed data, Chennai gazetteer, shared algorithms, and local database/algorithm tests are implemented. Follow the [Phase 1 guide](docs/phase-1.md) to run tests and install the SQL in Supabase. HTTP APIs arrive in Phase 2; the browser still shows the Phase 0 setup screen until the UI phases.

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

Open `http://localhost:5173`. Expected: the DisasterMesh setup screen, styled with Tailwind, marked **Setup mode · Phase 0**. Stop the dev server with Ctrl+C. No credentials are needed to build this phase.

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

The LLM helper will use server-side `fetch`; no provider SDK is required. React 19 and React Leaflet 5 are paired. Tailwind uses its [official Vite plugin](https://tailwindcss.com/docs/installation/using-vite), so a legacy PostCSS or Tailwind configuration file is unnecessary.

## 2. Folder structure

```text
disastermesh/
├── api/                     Vercel routes, implemented in Phase 2
│   └── _lib/                Server-only database, session, LLM and HTTP helpers
├── shared/                  Complete algorithms, gazetteer, extraction and types
├── sql/                     Complete schema, seed and verification SQL
├── tests/                   Algorithm and database workflow tests
├── docs/phase-1.md          Phase 1 setup, commands and algorithm explanations
├── public/
│   └── favicon.svg
├── scripts/
│   └── check-env.mjs        Checks configuration format without printing secrets
├── src/
│   ├── components/         Reusable interface elements in Phases 3–4
│   ├── hooks/              Polling and speech hooks in Phases 3–4
│   ├── lib/                Same-origin API client in Phase 3
│   ├── pages/              Citizen and dispatcher screens in Phases 3–4
│   ├── App.tsx             Runnable Phase 0 setup screen
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

Phase 1 files are complete; Phase 2 files below are planned:

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

Phase 2
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

The eventual helper will enforce an 8-second LLM budget and validate returned JSON. A failed, invalid, or timed-out model response will leave deterministic extraction/scoring available and record the fallback in report reasoning.

## 6. Vercel setup and local backend development

The project uses standard [Vite on Vercel](https://vercel.com/docs/frameworks/frontend/vite) with TypeScript functions in root-level `api/`.

When you are ready to connect your account, run:

```powershell
npm.cmd run vercel -- login
npm.cmd run vercel -- link
```

Choose your own scope, create or select **disastermesh**, and use the current directory (`./`) as the project root. These commands link the local project; production deployment belongs to Phase 5.

In Vercel Project Settings:

- Framework: **Vite**.
- Root directory: the directory containing `package.json` (use `disastermesh` only if the Git repository contains the parent folder).
- Node.js: **22.x**.
- Install: `npm ci`.
- Build: `npm run build`.
- Output: `dist`.
- Development command: use the checked-in `vercel.json` setting.
- Add the table's server variables to the appropriate [Vercel environments](https://vercel.com/docs/environment-variables). Set Production `APP_ORIGIN` to the stable production domain; set Preview separately to its actual origin when testing previews.
- Keep Production/Preview credentials out of client-prefixed variables. Environment changes require a new deployment to take effect.

After Phase 2, start the API and frontend together:

```powershell
npm.cmd run dev:full
```

Open `http://localhost:3000`. [`vercel dev`](https://vercel.com/docs/cli/dev) runs the frontend and local serverless functions under one origin and loads the local environment. Plain `npm run dev` and `npm run preview` serve the frontend only; they cannot run `api/*.ts` functions. Do not configure Vercel's Development Command to `dev:full` because that would start Vercel recursively.

The SPA rewrites match `/report` and `/command` explicitly, leaving `/api/*` untouched. Authentication will be enforced on server routes, including state, dispatch, tick, resolve, and seed; a client route alone is not an access-control boundary.

## 7. Architecture and implementation decisions

```text
Browser: /report or /command
  | same-origin /api/* requests; state polling every 2.5 s
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

## 8. Quick Phase 0 verification

```powershell
npm.cmd run check
npm.cmd run build
npm.cmd run preview
```

Open `http://localhost:4173`. Confirm the setup page renders at narrow and desktop widths. There are no fake reports, dispatch buttons, or live-state indicators in this phase. The production files are in `dist/`.

Run `npm.cmd run check:env` after adding your own values. It should report valid configuration format (and possibly the deliberate missing-LLM-key warning). Do not treat that output as a cloud connectivity test.

Verification performed on this scaffold: TypeScript and the production build passed; the local production preview returned HTTP 200 for its page and JavaScript; Git ignores `.env`, `.env.local`, and `.env.production`; no server secret names or common key prefixes were found in `dist/`. No actual credentials were supplied, so live cloud connectivity and secret-value scanning are deferred until those exist.

Dependency audit: `npm audit --omit=dev` reported zero vulnerabilities. The full audit still reports 33 advisories in Vercel development tooling (8 moderate, 24 high, 1 critical), including its transitive archive/parser packages. A compatible `npm audit fix` did not resolve them. This is not a clean full dependency audit; avoid treating a passing build as security certification. Recheck supported Vercel tool updates before the final deployment review rather than applying an untested forced downgrade.

Phase 1 is delivered in [docs/phase-1.md](docs/phase-1.md). After installing and verifying its SQL in Supabase, say **next** for Phase 2 APIs. Phases 3–4 build the workflows; Phase 5 deploys and verifies security; Phase 6 rehearses the three-minute demo.
