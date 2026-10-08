# Phase 2: serverless API

Phase 2 implements every server route and verifies the configured Supabase and Gemini services. The frontend remains the setup screen until Phases 3–4.

## Routes

| Route | Method | Authentication | Purpose |
| --- | --- | --- | --- |
| `/api/status` | GET | Public | Database reachability and non-secret provider configuration status |
| `/api/report` | POST | Public, same-origin browser request | Validate, analyze, geocode, score, cluster, persist and auto-dispatch |
| `/api/login` | POST | Passcode | Issue an 8-hour signed httpOnly dispatcher cookie |
| `/api/logout` | POST | Public, same-origin | Clear the dispatcher cookie |
| `/api/state` | GET | Dispatcher cookie | Incidents, reports without image blobs, units, dispatches, counters and recommendations |
| `/api/dispatch` | POST | Dispatcher cookie | Atomically dispatch nearest compatible available unit |
| `/api/resolve` | POST | Dispatcher cookie | Resolve an incident and start unit return |
| `/api/tick` | POST | Dispatcher cookie | Persist elapsed-time unit movement |
| `/api/seed` | POST | Dispatcher cookie + `DEMO_MODE=true` | Reset the simulated demo dataset |
| `/api/tiles` | GET | Public | Same-origin OpenStreetMap raster tile proxy |

The browser never receives a Supabase or LLM key. All application requests use relative `/api/*` URLs. Server helpers read environment variables only from `process.env`; Vite has no `VITE_*` configuration.

## Run locally

```powershell
Set-Location 'C:\Users\tnjma\Documents\Vibe coding\disastermesh'
npm.cmd run check:env
npm.cmd test
npm.cmd run build
npm.cmd run dev:full
```

Open `http://localhost:3000`. The `dev:full` command explicitly loads `.env.local` into the parent Vercel process because Vercel CLI 63 did not forward the existing local file automatically in this linked project. Vite exposes only names prefixed with `VITE_`; this project rejects those names and never defines server values in its client configuration.

In a second terminal, the following checks are available:

```powershell
# Read-only: live Supabase count/RPC plus one Gemini structured-output request
npm.cmd run verify:connections

# Mutating demo check: login, reset, report, retry, tick, resolve, tile, reset, logout
npm.cmd run verify:api
```

`verify:api` always attempts a final authenticated seed reset, leaving the predictable demo at 12 incidents, 17 reports and 14 units. It is intended only for the configured hackathon project with `DEMO_MODE=true`. Do not interrupt it during cleanup.

## Report body

```json
{
  "clientRequestId": "optional UUID generated once by the browser",
  "channel": "text",
  "text": "SOS! We are trapped in rising water in Velachery. 6 people including 2 children need rescue.",
  "transcript": "",
  "image": null,
  "manualLocation": "",
  "gps": null
}
```

`channel` accepts `text`, `voice`, or `image`. Voice uses the submitted transcript. Images must be JPEG, PNG, or WebP data URLs and are limited to 1.5 MB as encoded input. An image-channel request requires an image. At least one of text, transcript, or image is required. The client request ID makes retries idempotent.

The API decides `is_demo`; the browser cannot set it. When `DEMO_MODE=true`, real browser submissions join the seeded demo dataset, allowing the required Velachery live test. Set `DEMO_MODE=false` outside the hackathon demo.

## Pipeline and failure behavior

1. Validate and cap the JSON input before external calls.
2. Ask the selected server-side provider for a single structured analysis. An image is included in the same request, so its description and entities are produced together.
3. Validate model JSON with Zod. The request has an eight-second abort timer.
4. Merge deterministic fallback entities with valid model output. On timeout, provider error, or invalid JSON, continue with deterministic extraction/scoring.
5. Resolve location using the Chennai gazetteer, server-side Nominatim, browser GPS, then unverified status. Ambiguous gazetteer text is not guessed. Nominatim results must remain in the Chennai bounding region.
6. Calculate hybrid urgency and store the complete explanation, provider, model and latency. The deterministic severity category acts as a safety floor.
7. Call the atomic Postgres ingestion function. It selects or creates an incident, inserts the report, recomputes the centroid/count/severity, adds audit history, and auto-dispatches Critical incidents.
8. Return the stored report without its image blob, incident, cluster explanation, dispatch result and parsed analysis.

A provider outage is a degraded dependency, not a failed emergency submission. The API logs only provider/status/error metadata and stores `llm_status`; it never logs keys or raw images. Unknown locations persist but do not auto-dispatch based on a guessed coordinate.

## Authentication and request security

- The passcode is compared using fixed-size SHA-256 digests and `timingSafeEqual`.
- The signed HS256 session has issuer, audience, subject, role and an 8-hour expiry.
- Cookie flags: `HttpOnly`, `SameSite=Strict`, `Path=/`, and `Secure` on HTTPS.
- Login adds a fixed response delay and an in-memory per-instance attempt limit. This is demo protection; distributed production rate limiting would require a shared store or platform firewall.
- Browser mutation requests enforce configured Origin and reject `Sec-Fetch-Site: cross-site`.
- Dispatcher authorization is checked on the server for state, dispatch, resolve, tick and seed.
- State excludes `image_data_url` to avoid repeatedly sending large citizen images during 2.5-second polling.
- API errors return stable, non-secret messages. Detailed failures remain in server logs.

## Provider switching

`api/_lib/llm.ts` is the only provider-specific integration. `LLM_PROVIDER=gemini` uses Gemini `generateContent`, `responseMimeType: application/json`, and a JSON schema. The key is sent in the `x-goog-api-key` server header. `LLM_PROVIDER=openai` uses Chat Completions with strict `json_schema`; its key is sent in the server Authorization header. Both paths produce the same validated `LlmAnalysis` object.

## Verified result

The live read-only check returned:

```text
PASS Supabase: connected; incidents=12; dm_severity(75)=Critical
PASS LLM: provider=gemini; model=gemini-2.5-flash; status=used; type=medical; score=90
```

The end-to-end local API check against the live database passed status, anonymous rejection, login, seed/state, live Velachery merge, Critical classification, `R-01` dispatch, idempotent retry, tick, resolve, tile proxy, cleanup, and logout. Gemini returned a transient HTTP 503 during that later report call; the rule fallback completed the dispatch as designed. The separate Gemini structured-output check passed immediately before it.

## Phase boundary

Phase 3 will replace the setup screen with `/report`: text/voice/image input, browser geolocation, image compression/preview and the persisted result card. Say **next** after reviewing this phase.
