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
