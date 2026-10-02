# RouteMind — Emergency Response Route Planner

RouteMind helps a person or emergency responder find, and keep updating, a practical route during an emergency. It uses the device's **real location**, **real OpenStreetMap data**, live route options, reported road hazards, weather and an **agentic Emergency Route Agent** that explains every recommendation.

> **Safety notice:** RouteMind is a navigation and decision-support prototype. It does not replace emergency services, dispatch centers, or professional emergency responders. In a real emergency, contact your local emergency service. RouteMind does **not** contact emergency services, and it does not guarantee the fastest route or any response.

---

## Problem statement

General-purpose navigation optimises ordinary trips. In an emergency the questions are different: *which* hospital, fire station or police station can I reach soonest? Is the road blocked? What changed since I set off? RouteMind combines:

**emergency type + current location + destination + route options + reported hazards / closures + weather + distance + travel time**

and recommends a route with a plain-language reason. Where data is missing (most notably live traffic) it says so instead of guessing.

## Features

| Area | What it does |
|---|---|
| Real location | Browser Geolocation API (`getCurrentPosition` + `watchPosition`), accuracy circle, reverse-geocoded address, debug panel with raw lat/lng. No built-in default location. |
| Location fallback | If permission is denied, GPS is unavailable or times out: a clear message, then choose the location on the map or search for it. |
| Emergency types | Medical, Accident, Fire, Police, Other. The type selects the facility categories and the route-scoring profile. |
| Destinations | (A) nearest suitable facility chosen automatically, (B) pick from nearby facilities or search any place, (C) tap the map. |
| Nearby facilities | Hospitals, clinics, fire stations and police stations from OpenStreetMap, with name, type, distance, road ETA, address and a *Route here* button. Nothing is invented. |
| Routing | Real road routes with alternatives (OSRM or OpenRouteService), distance and ETA. |
| Emergency Route Engine | Deterministic, explainable scoring of every route (time, hazard delay, risk, emergency profile). Never simply "shortest". |
| Emergency Route Agent | A multi-step tool-calling workflow (location → facilities → routing → hazards → weather → traffic → evaluation → rerouting) with a visible step trace. Optional Claude-driven review with anti-hallucination guardrails. |
| Hazards | MongoDB `hazards` collection with type, severity, expiry and status; only active, unexpired hazards affect routing. Users can report hazards (stored as unverified reports). |
| Dynamic rerouting | While monitoring, the position is checked every few seconds: remaining distance, ETA, progress, off-route detection and hazards ahead. New blocking hazards trigger a **Route Update** and an automatic recalculation; leaving the route offers **Recalculate Route**. |
| Detours | When every route is blocked, the agent generates detour candidates (via-points on OSRM; avoid-polygons on OpenRouteService). |
| Simulation Mode | Clearly labelled developer mode: add simulated hazards, simulate a road block ahead, and move a simulated position along the route to test rerouting without travelling. |
| Dashboard / history | Live trip dashboard (location, destination, ETA, distance remaining, warnings, status, activity log); history of previous sessions with automatic expiry. |
| Resilience | Every failure (permission, GPS, routing, geocoding, facility search, rate limits, network, MongoDB) surfaces a specific message; no screen is left on "Loading…". |

## Technology stack

- **Frontend:** React 19, Vite 8, React Router 8, Leaflet + React Leaflet 5, plain CSS, `fetch`.
- **Backend:** Node.js (≥ 20), Express 5, MongoDB + Mongoose 9, Helmet, express-rate-limit, CORS.
- **AI:** Anthropic Claude API (`@anthropic-ai/sdk`, beta Tool Runner) — optional.
- **Map data & services:** OpenStreetMap tiles, OSRM / OpenRouteService routing, Nominatim geocoding, Overpass API facility search, Open-Meteo weather.

## Architecture

```text
Browser (React)                                   Backend (Express)                         External
───────────────                                   ─────────────────                         ────────
useGeolocation ──► LocationProvider               routes/index.js
 (watchPosition)       │                            │
                       ▼                            ├─ routeController ──► emergencyRouteAgent ─┬─► AgentToolbox tools:
EmergencyProvider ── POST /api/routes/calculate ───►│                                         │    getCurrentLocation ── locationService ──► Nominatim
 (trip state)     ── POST /api/routes/recalculate ─►│                                         │    searchEmergencyFacilities ─ facilityService ─► Overpass (→ Nominatim fallback)
 useRouteMonitor  ── POST /api/routes/monitor ─────►├─ routeMonitorService                    │    calculateRoute / getAlternativeRoutes ─ routingService ─► OSRM / ORS
                  ── POST /api/routes/ai-review ───►│                                         │    detectHazards ── hazardService ──► MongoDB
EmergencyMap (Leaflet) ◄── route geometry           ├─ hazardController ─► hazardService       │    getRoadConditions ── + weatherService ──► Open-Meteo
Pages: / /emergency /map /route                     ├─ emergencyController ─► facilityService  │    getTrafficInformation ── trafficService (no live feed)
       /dashboard /history /settings                └─ geoController ─► locationService        │    evaluateRoute ── emergencyRouteEngine (deterministic)
                                                                                               │    recalculateRoute ── detour generation
                                                                                               └─► reviewWithAI: Claude calls the same tools + guardrails
```

```text
routemind/
├── backend1/                 Express API (the backend; named backend1 in this repository)
│   ├── app.js, server.js     app factory / process entry point
│   ├── config/               env.js (all configuration), db.js (MongoDB connection)
│   ├── controllers/          emergency, route, hazard, geo, health
│   ├── middleware/           security (sanitisation, rate limits), errorHandler
│   ├── models/               EmergencyRequest, Hazard, RouteSession
│   ├── routes/index.js       REST routes
│   ├── services/             routingService, locationService, facilityService, hazardService,
│   │                         trafficService, weatherService, emergencyRouteEngine,
│   │                         agentToolbox, emergencyRouteAgent, aiGuardrails, routeMonitorService
│   ├── utils/                geo, validate, errors, httpClient, cache, format, logger, constants
│   └── tests/                node:test suites
├── frontend/routemind/       React app
│   └── src/
│       ├── components/       map/, panels/, layout/, common/
│       ├── context/          Settings, Location, Emergency providers
│       ├── hooks/            useGeolocation, useRouteMonitor, useReverseGeocode, useAsync
│       ├── pages/            Landing, Emergency, Map, Route, Dashboard, History, Settings
│       ├── services/         api.js (fetch wrapper), routemindApi.js
│       ├── constants/, utils/
│       └── App.jsx, main.jsx
├── .env.example
├── .gitignore
└── README.md
```

## How real location works

1. *Start Emergency Route* asks for location permission (on a user tap, which browsers prefer). If the browser already granted permission, RouteMind starts silently.
2. `getCurrentPosition()` gets a quick first fix, then `watchPosition()` follows the device (high-accuracy GPS by default; configurable in Settings).
3. The position is drawn with an accuracy circle and reverse-geocoded through the backend (throttled to respect Nominatim's 1 request/second policy).
4. The same coordinates are sent to the backend for facility search, routing and monitoring.
5. **Errors:** permission denied → *"Location permission is required for live emergency navigation."* plus *Choose location on map* / *Enter your location*; position unavailable, timeout, unsupported browser and non-HTTPS origins each have their own message. A weak signal keeps the last fix and says so.
6. Browsers only expose geolocation on **secure origins** (HTTPS or `localhost`). To test on a phone use `npm run dev:https` (see below).

Location priority: simulated position (Simulation Mode only, labelled) → live GPS → manually chosen location.

## How routing works

1. `POST /api/routes/calculate` with `{ emergencyType, origin, destination? }`. Without a destination the agent picks the nearest suitable facility.
2. The routing service fetches the route **and alternatives** (OSRM by default; OpenRouteService with a key).
3. Active hazards within the routes' bounding box are matched to each route (each hazard has an impact radius: 60–250 m by severity).
4. The engine scores each route:
   ```
   score = adjustedDuration × timeWeight + Σ severityPoints × 30 s × riskWeight + km × 3 s
   adjustedDuration = routing-engine duration + Σ estimated hazard delays × emergency-type multiplier
   ```
   Routes passing a *blocking* hazard (any Road Block; Critical hazards; High flooding/fire) are not viable. Each emergency type has its own profile (for example, fire weighs construction, flooding and congestion more because of large appliances).
5. If every route is blocked, the agent generates detours and re-evaluates. If none avoids the blockage, RouteMind says so and recommends no route.
6. Facility ETAs use the routing provider's table/matrix endpoint.

## How the Emergency Route Agent works

**Deterministic workflow (always on, `planRoute`).** The agent calls its tools in an auditable order, and each call is recorded in a trace shown on the *Route* page:

| Tool | Backed by |
|---|---|
| Location Tool — `getCurrentLocation()` | coordinate validation + Nominatim reverse geocoding |
| Facility Search Tool — `searchEmergencyFacilities()` | Overpass API (Nominatim fallback) + routing table for ETAs |
| Facility selection | fastest by road; prefers hospitals over clinics (≤ 5 min) and OSM-tagged emergency departments (≤ 3 min) for medical/accident |
| Routing Tool — `calculateRoute()` / `getAlternativeRoutes()` | OSRM / OpenRouteService |
| Hazard Tool — `detectHazards()` | MongoDB hazards matched to route geometry |
| `getRoadConditions()` | hazards + Open-Meteo weather risk |
| Traffic Tool — `getTrafficInformation()` | reports *no live traffic*; surfaces user-reported congestion |
| Route Evaluation Tool — `evaluateRoute()` | Emergency Route Engine |
| Rerouting Tool — `recalculateRoute()` | detour generation around blocking hazards |

Distances, coordinates, validation and hazard detection are always computed by backend code, never by the LLM.

**AI review (optional, `POST /api/routes/ai-review`, needs `AI_API_KEY`).** Claude (`claude-opus-5-5` by default, via the SDK Tool Runner) receives the same tools, decides which to call, reasons over their output and must finish with `submit_recommendation`. Guardrails:

- It may only choose a route the engine marked **viable**; anything else is rejected back to the model.
- Its explanation is checked against tool data: route labels must exist, mentioned hazard types must have been reported, every km/min figure must match the data, and no traffic condition may be claimed while live traffic is unavailable.
- If the check fails, the AI times out, refuses or isn't configured, RouteMind shows the deterministic engine explanation and says why.
- Server-side refusal fallback (`fallbacks: "default"`) is enabled on the API request.

Navigation never waits on the LLM: the deterministic agent produces the route; the AI review is a second opinion on demand.

## Dynamic rerouting and monitoring

While monitoring (*Start route monitoring*), the client sends `{ route geometry, position, accuracy }` to `POST /api/routes/monitor` every 5–30 s (configurable). The backend returns remaining distance, ETA (proportional to the routing estimate), progress, distance from the route and hazards ahead, with a status of:

- `on-route`
- `off-route` → *"You appear to have left the planned route."* + **Recalculate Route**. The threshold (default 60 m) widens automatically when GPS accuracy is poor.
- `reroute-recommended` → a newly reported **blocking** hazard ahead → *"⚠️ Route Update — A road condition affecting your current route has been detected."* → automatic recalculation from the current position (can be switched to manual in Settings).
- `arrived` → the trip is marked completed.

Non-blocking hazards ahead are shown as warnings. Positions sent for monitoring are **not stored**.

## Simulation Mode

For development and demos only. Enable it in **Settings → Developer**.

- A striped **SIMULATION MODE — DEMO / SIMULATION DATA** banner is shown on every page.
- **Map → Hazards** tab: *Add simulated hazard* (tap the map), *Simulate road block ahead* (on the current route), *Place simulated position*, *Advance 250 m / 1 km* along the route, *Use real position*.
- Simulated hazards are stored with `source: "simulation"`, drawn with dashed purple outlines and a **SIM** tag, labelled `[SIMULATED]` in every warning and explanation, and **only affect routing while Simulation Mode is on**. They are never presented as real incidents.

Typical test: Fire Emergency → nearest fire station → Start route monitoring → *Simulate road block ahead* → within one monitoring interval the Route Update appears and the agent switches to an alternative or detour.

## API configuration

| Service | Used for | Key needed | Notes |
|---|---|---|---|
| OSRM public server (`router.project-osrm.org`) | routes, alternatives, facility ETAs | No | Demo server, fair-use only; no avoid-areas, so detours use via-points. Self-host OSRM for production. |
| OpenRouteService | same, plus avoid-polygons around hazards | `ROUTING_API_KEY` | Set `ROUTING_PROVIDER=openrouteservice`. |
| Nominatim | reverse geocoding, place search, facility fallback | No (optional `GEOCODING_API_KEY` for LocationIQ-style hosts) | 1 request/s, identifying `OSM_USER_AGENT` required by the usage policy. |
| Overpass API | facility search (hospital, clinic, fire_station, police) | No | Public instances are often overloaded; RouteMind hedges across mirrors and falls back to Nominatim after 6 s, labelling the result *"may be incomplete"*. |
| Open-Meteo | weather risk (rain, visibility, wind, storms) | No | Area-level weather, not road-level. |
| Claude API | optional AI route review | `AI_API_KEY` | Disabled when unset. |
| OSM tile server | map tiles | No | Fine for development; use a tile provider for production (`VITE_TILE_URL`). |

**Live traffic:** none of the configured providers offers live traffic, so RouteMind reports *"Live traffic data is unavailable. Route recommendation is based on available map and route information."* User-reported *Traffic Congestion* hazards are used instead. A commercial traffic API (TomTom, HERE, Google) can be added in `services/trafficService.js`.

## Environment variables

All backend variables are documented in [`.env.example`](.env.example). None is required for a local run.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `5000` | API port |
| `MONGO_URI` | `mongodb://127.0.0.1:27017/routemind` | MongoDB connection |
| `CORS_ORIGIN` | `http://localhost:5173,https://localhost:5173` | Allowed browser origins |
| `OSM_USER_AGENT`, `NOMINATIM_EMAIL` | placeholder | Identification required by OSM services; **set your contact** |
| `ROUTING_PROVIDER`, `ROUTING_API_KEY` | `osrm`, — | Routing provider and key |
| `GEOCODING_BASE_URL`, `GEOCODING_API_KEY` | Nominatim, — | Geocoder |
| `OVERPASS_URLS`, `OVERPASS_TIMEOUT_MS` | 3 public mirrors, 25 s | Facility search |
| `WEATHER_ENABLED` | `true` | Open-Meteo weather risk |
| `AI_API_KEY`, `AI_MODEL`, `AI_EFFORT` | —, `claude-opus-5-5`, `low` | AI route review |
| `HISTORY_RETENTION_DAYS`, `ROUTE_SESSION_RETENTION_DAYS` | `30`, `7` | Automatic deletion (MongoDB TTL indexes) |

Frontend (optional, [`frontend/routemind/.env.example`](frontend/routemind/.env.example)): `VITE_API_PROXY_TARGET`, `VITE_API_BASE_URL`, `VITE_TILE_URL`, `VITE_TILE_ATTRIBUTION`. The frontend contains **no** third-party API keys.

## Installation

Prerequisites: Node.js ≥ 20 (tested on 24), npm, MongoDB ≥ 6 running locally (or a `MONGO_URI`). RouteMind still routes without MongoDB, but history and hazard reports are disabled.

```bash
# backend
cd backend1
npm install
cp ../.env.example ../.env    # optional; edit OSM_USER_AGENT and keys

# frontend
cd ../frontend/routemind
npm install
```

## Running the backend

```bash
cd backend1
npm run dev      # node --watch, http://localhost:5000
# or
npm start
curl http://localhost:5000/api/health
```

## Running the frontend

```bash
cd frontend/routemind
npm run dev          # http://localhost:5173 — /api is proxied to the backend
```

**On a phone (real GPS):** browsers require HTTPS for geolocation.

```bash
npm run dev:https    # serves https://<your-LAN-IP>:5173 with a self-signed certificate
```

Open the printed *Network* URL on the phone (same Wi-Fi), accept the certificate warning, then allow location access.

**Production build:** `npm run build` → `dist/`. Serve it behind a reverse proxy that forwards `/api` to the backend (or set `VITE_API_BASE_URL` and `CORS_ORIGIN`), always over HTTPS.

## REST API

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | Service status (DB, routing provider, AI, weather, traffic, retention) |
| GET | `/api/emergency/facilities?lat&lng&type[&categories][&radius]` | Nearby facilities with road distance/ETA |
| POST | `/api/emergency/request` | Create an emergency request |
| GET / PATCH / DELETE | `/api/emergency/:id` | Read / update status or chosen route / delete |
| GET | `/api/emergency/history[?limit]` | Previous sessions + retention note |
| POST | `/api/routes/calculate` | Run the Emergency Route Agent |
| POST | `/api/routes/recalculate` | Recalculate from the current position (`reason`) |
| POST | `/api/routes/monitor` | One monitoring check |
| POST | `/api/routes/ai-review` | Claude review over the agent's tools |
| GET / POST | `/api/hazards` | List (`includeSimulated`, `includeInactive`) / create |
| PUT / DELETE | `/api/hazards/:id` | Update (e.g. `status: "resolved"`) / delete |
| GET | `/api/geo/reverse?lat&lng`, `/api/geo/search?q[&lat&lng]` | Geocoding |

Errors are always `{"error": {"code", "message"[, "service"]}}`, with codes such as `VALIDATION_ERROR`, `NO_ROUTE`, `RATE_LIMITED`, `TIMEOUT`, `NETWORK`, `UPSTREAM_ERROR` and `DB_UNAVAILABLE`.

## Data stored and privacy

| Collection | Contents | Retention |
|---|---|---|
| `emergencyRequests` | emergency type, origin/destination **rounded to 4 decimals (~11 m)** and addresses, chosen route summary, ETA, distance, warnings, status | deleted automatically after `HISTORY_RETENTION_DAYS` (30) |
| `routeSessions` | selected route geometry, engine evaluation, agent trace, AI review summary, events (no coordinates) | deleted after `ROUTE_SESSION_RETENTION_DAYS` (7) |
| `hazards` | hazard reports | default lifetime 4 h (user-selectable); expired hazards are ignored by routing |
| `users` | **not implemented**: RouteMind has no accounts yet (see Future improvements) | — |

Live GPS positions sent during monitoring are **never stored**, and coordinates are never written to server logs. History entries can be deleted from the History page. The active trip is kept in the browser's `sessionStorage` (cleared when the browser session ends); settings in `localStorage`.

## Security

Helmet headers, a CORS allow-list, JSON body size limit, per-route rate limits (routing 40/min, AI 6/min, monitoring 120/min, writes 30/min), recursive stripping of `$`/`.` keys plus Mongoose `sanitizeFilter`, explicit validation of every input (coordinates, enums, lengths, ObjectIds, polylines), generic 500 responses without stack traces, and API keys only in server environment variables.

## Testing

```bash
cd backend1 && npm test             # 39 tests (node:test + supertest)
cd frontend/routemind && npm run lint && npm run build
```

Backend suites: engine scoring and decisions, hazard impact, geometry, AI guardrails, facility fallback race, HTTP API validation / injection / error format / monitoring (no DB or network needed), and hazard + emergency-request persistence against a temporary `routemind_test` database (skipped automatically if MongoDB is unreachable).

Manually and with browser automation (headless Chrome with emulated geolocation) against the live public services, the following were verified:

| # | Scenario | Result |
|---|---|---|
| 1 | Location permission granted | GPS position, accuracy, reverse-geocoded address shown; used for routing |
| 2 | Permission denied | required message shown; "nearest" disabled until a manual location is chosen |
| 3 | Location unavailable / GPS timeout | specific messages + manual fallbacks |
| 4 | Manual location | chosen on map / via search; routes from it |
| 5–7 | Hospital, fire station, police station destinations | real OSM facilities with road ETAs; routes calculated |
| 8–9 | Route calculation, alternatives | OSRM routes + alternatives displayed and selectable |
| 10–11 | Hazard detection, recalculation | simulated road block ahead → Route Update → detour; off-route → Recalculate Route |
| 12 | API failure | Overpass outage → Nominatim fallback (labelled); routing/geocoding errors shown with retry |
| 13 | MongoDB failure | routing continues with "not saved" + "hazards could not be checked" warnings; history/hazards return 503 with message |
| 14–15 | Mobile (390 × 844) and desktop (1366 × 860) layouts | verified |

Real-device GPS on a physical phone should be checked with `npm run dev:https`. That run involves real movement and is outside what automated tests cover.

## Limitations

- **No live traffic.** ETAs come from the routing engine's static road-speed profiles. Congestion is known only from user reports.
- **Hazards are user-reported or simulated.** No official incident or road-closure feed is integrated, and reports are unverified.
- **Public demo services:** the OSRM demo server, Nominatim and Overpass have usage limits and no SLA; Overpass is often overloaded. Use self-hosted or commercial endpoints for anything beyond a prototype.
- **OSRM cannot avoid areas.** Detours are approximated with via-points; OpenRouteService gives cleaner avoidance.
- **Facility data quality depends on OpenStreetMap:** missing names, missing `emergency=yes` tags, or closed facilities may appear. The Nominatim fallback returns at most 40 results per category.
- **Routing is for cars.** No emergency-vehicle privileges (wrong-way travel, signal pre-emption) are modelled.
- **Weather** is area-level (origin and destination), not per road segment.
- **Monitoring is polling-based** (no WebSockets) and runs only while the page is open. Browsers may pause background tabs.
- **No authentication**: anyone with access to the server can report or delete hazards. Add accounts before any shared deployment.
- **The AI review needs an Anthropic API key** and adds latency and cost; the deterministic engine never depends on it.

## Future improvements

The architecture leaves room for these; none is implemented:

- Responder accounts (a `users` collection with hashed passwords) and an ambulance fleet dashboard
- Hospital bed / ED availability feeds; fire-station dispatch and police coordination integrations
- Real-time traffic (TomTom / HERE / Google) behind `trafficService`
- Official road-closure, flood and road-camera feeds behind `hazardService`
- Per-segment weather and flood detection
- WebSocket push for hazards and route updates
- Integration with emergency-service systems; SMS notifications
- Voice navigation and multilingual instructions
- PWA / offline emergency interface with cached facilities

## Attribution

Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors (ODbL). Routing by OSRM / OpenRouteService. Weather by [Open-Meteo](https://open-meteo.com).
