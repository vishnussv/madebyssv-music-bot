# VERIFICATION — Live Dashboard API

Verified 2026-11-26 on Node v24.22.1. No real Discord token was used at any
point; no real login was attempted.

## What was added

- `dashboard/api.js` — HTTP API using only Node's built-in `http` (no new
  dependencies). Started from `index.js` via `client.once("clientReady",
  () => startDashboard(client))`, after login/ready. Only shard 0 serves
  it. Port from `DASHBOARD_PORT` (default 3001), separate from the
  keep-alive server on `PORT` (default 3000).
- `scripts/dashboard-test.js` — mock-client harness (see below).
- `.env.example` — `DASHBOARD_ENABLED`, `DASHBOARD_PORT`,
  `DASHBOARD_API_KEY` (with key-generation + never-commit note).
- `README-MADEBYSSV.md` — "Live Dashboard API" section (endpoints, env,
  dashboard call examples).

## Player model (read from source before writing)

- Poru (`client.poru`) owns playback, exactly as `+play`/`+pause`/etc do:
  `players` is a `Map`, player has `voiceChannel`, `textChannel`,
  `currentTrack.info.{title,author,uri,artworkUrl,length,isStream}`,
  `position` (ms), `volume` (0–1000, 100 = normal), `loop`
  (`NONE`/`TRACK`/`QUEUE`), `isPlaying`, `isPaused`, `isConnected`,
  `autoplayEnabled`, and `queue` (Array subclass with `.add/.clear/
  .shuffle/.size`). Methods: `pause(bool)`, `skip()`, `seekTo(ms)`,
  `setVolume(n)`, `setLoop(mode)`, `destroy()`, `createConnection()`.
- `POST /api/player/play` reuses the `+play` resolve path verbatim:
  Poru `resolve()` with `ytsearch` unless the query is a URL, up to 3
  tries, playlist loads expand, tracks <45s and streams are skipped.
- `POST /api/player/247` reuses the existing 24/7 store:
  `Database.set247()` + the `enabled247` set from `utils/State.js`.
  Enable needs a voice channel (passed, the player's, or the stored one);
  disable only clears the stored entry — it does not destroy the player.
- Lavalink connectivity for `/api/status` is read from Poru nodes and
  lavalink-client `nodeManager.nodes` (either engine reporting a connected
  node counts as connected).

## Endpoints implemented

`GET /api/health`, `GET /api/status`, `GET /api/guilds`,
`GET /api/commands`, `GET /api/player`, `POST /api/player/play`,
`POST /api/player/pause`, `POST /api/player/resume`,
`POST /api/player/skip`, `POST /api/player/stop`,
`POST /api/player/volume`, `POST /api/player/seek`,
`POST /api/player/loop`, `POST /api/player/shuffle`,
`POST /api/player/247`. **No endpoint returns 501** — the 24/7 endpoint
is fully implemented via the existing store.

Auth: every `/api/*` request (including `/api/health`) requires header
`X-Dashboard-Key` matching `DASHBOARD_API_KEY` (timing-safe compare);
wrong/missing → 401 JSON. If the key is unset the API refuses to start
and the bot keeps running. CORS allows any origin with the key header;
`OPTIONS` preflight → 204. All handlers are try/catch; errors return
`{ok:false, error: message}` with 400/404/500 as appropriate — no stack
traces, no keys/tokens in logs (logs are method + path + status only).

## Tests run

1. `node --check dashboard/api.js index.js scripts/dashboard-test.js`
   — all pass.
2. `node scripts/dashboard-test.js` — mock client (2 guilds, 3 commands,
   1 Poru player with a connected node), ephemeral port, test key:
   **33 passed, 0 failed.** Covered: startDashboard refuses with no key
   and when disabled; health 401 without key / 401 wrong key / 200 with
   key; status (tag, 2 guilds, 3 commands, lavalinkConnected true);
   guilds (no user lists); commands; player 400 without guildId / 404
   without player / 200 with track + position + volume + repeatMode;
   pause/resume/skip/volume (999 → 400, 50 → 200)/seek (beyond duration
   → 400)/loop (bogus → 400, queue → 200)/shuffle; play without voice
   channel → 400 with the voiceChannelId message, without query → 400;
   247 enable without a known voice channel → 400 (no DB write), enable
   with the player's voice channel → 200, disable → 200; stop → 200;
   OPTIONS preflight → 204 with CORS; unknown routes → 404; invalid JSON
   → 400. The 247 enable/disable pair wrote then removed its test entry
   in the real data file — verified afterwards: `mode247` has 0 entries.
3. `node index.js` with `DISCORD_TOKEN` unset — exits with the existing
   clear `[Login Failed] DISCORD_TOKEN is not set…` message; the
   dashboard API never starts because login never reaches `clientReady`.
   (Exit code is 1, as in the main VERIFICATION.md.)
4. `node scripts/load-test.js` — re-run after the change: still
   160 commands loaded, 262 aliases, 145 slash commands.

## Still needed for a live dashboard

The dashboard page (built separately by the parent) must be given the
bot's public base URL (host + `DASHBOARD_PORT`, e.g.
`https://your-bot-host:3001`) and the same `DASHBOARD_API_KEY` value —
typed into the page / hosting config, never committed. The bot host must
expose the dashboard port publicly (Railway/Render: the API binds
`0.0.0.0`, but the platform must route that port). No real Discord login
was tested here — that needs Vishnu's token + Lavalink, as before.

---

## Shared-port fix — 2026-11-26 (Railway connect fix)

**Problem:** the dashboard API listened on its own port 3001, but Railway
only exposes the main `PORT` (8080) publicly, so the static dashboard page
could not reach port 3001 from a browser.

**Fix:**
- `dashboard/api.js` — extracted the whole `/api/*` router, auth
  (`X-Dashboard-Key` only, timing-safe), CORS and JSON handling into
  `handleDashboardRequest(client, apiKey, req, res)`, which returns `true`
  if it responded and `false` for non-`/api/*` paths. `createDashboardServer`
  and `startDashboard` still work standalone (own port `DASHBOARD_PORT`,
  default 3001); `startDashboard(client, {sharedServer})` now also
  registers the handler on a caller-owned server instead of listening.
- `index.js` — the keep-alive HTTP server (main `PORT`) now delegates
  any `/api/*` request to `handleDashboardRequest()` when
  `DASHBOARD_ENABLED=true` (missing/wrong key → 401, as before; disabled
  → 404 "Dashboard API is disabled"); every other path still returns the
  keep-alive `{status:"ok", bot: tag}` JSON. On `clientReady` it logs the
  shared-mode line instead of starting a separate server, unless
  `DASHBOARD_SEPARATE_PORT=true` (local only). No change to login,
  intents (privileged intents only when `ENABLE_PRIVILEGED_INTENTS=true`),
  or command loading.
- `.env.example` / `README-MADEBYSSV.md` — documented the shared port:
  on Railway the API is at the **same public URL as the bot service**,
  e.g. `https://<railway-domain>/api/status`, no port 3001; plus the
  4-step dashboard connect instructions (Railway domain, no trailing
  slash, no `/api` suffix; `DASHBOARD_API_KEY` copied from Railway
  Variables, never pasted in chat).

**Tests run (Node v24.22.1, no real token, no real login):**
1. `node --check index.js dashboard/api.js scripts/dashboard-shared-port-test.js` — all pass.
2. `node scripts/load-test.js` — still **160 commands, 262 aliases, 145 slash**.
3. `node scripts/dashboard-test.js` — still **33 passed, 0 failed** (standalone server unchanged).
4. `node scripts/dashboard-shared-port-test.js` (NEW) — mock client, keep-alive-style
   shared server on an ephemeral port: **9 passed, 0 failed** — `GET /` →
   keep-alive JSON; `GET /api/health` no key → 401, wrong key → 401,
   with key → 200; `GET /api/status` with key → 200 (tag, 1 guild,
   1 command, lavalinkConnected true); OPTIONS preflight → 204 CORS;
   unknown `/api` route → 404; `DASHBOARD_ENABLED=false` → `/api/health`
   404 disabled while `GET /` still returns keep-alive JSON.
5. `node index.js` with `DISCORD_TOKEN` unset — exit **1** with the clear
   `[Login Failed] DISCORD_TOKEN is not set…` message.

**Still needed for a live dashboard:** redeploy this build to Railway
(the parent deploys), generate a Railway public domain for the service
if it has none, then connect the dashboard page with that domain URL
(no port, no `/api` suffix) + the `DASHBOARD_API_KEY` from Railway
Variables. No live Discord login was tested here.
