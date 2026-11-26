# MADEBYSSV Music Bot

A full-featured Discord music bot for the MADEBYSSV brand — music, playlists,
filters, moderation helpers, fun, utility and owner tools. Prefix commands
(default `+`) and slash commands.

> Based on Fox Arena source by Navaniii — rebranded, cleaned of the previous
> owner's IDs and runtime data, and made fully environment-configured for
> MADEBYSSV. See [VERIFICATION.md](VERIFICATION.md) for the audit and test
> record.

## Commands — 165 total

| Category | Count | What it covers |
| --- | ---: | --- |
| music | 38 | play, pause, resume, skip, queue, loop, seek, volume, 24/7, favourites, lyrics, now-playing card |
| general | 38 | help, support, vote, profile, badges, leaderboard, giveaways, AFK, greet, stats, owner tools |
| settings | 31 | prefix, embed colour, no-prefix access, voice master, automod, dev/owner config, team |
| moderation | 13 | single-target moderation helpers (ban/kick/timeout/purge — one member or one channel at a time) |
| playlist | 12 | create, save, share, list and manage playlists |
| information | 10 | ping, userinfo, server info, invite, bot info |
| fun | 9 | 8ball, ship, joke and other fun commands |
| filter | 8 | audio filters (bassboost, nightcore, vaporwave, 8D, etc.) |
| customize | 3 | bot appearance / profile card customisation |
| voice | 2 | voice-channel tools (VC stats, VC roles) |
| security | 1 | anti-nuke status (defensive only — see below) |

Slash commands: the bot registers every command that ships slash metadata
(`.data`) globally on startup (see VERIFICATION.md for the exact count).

## Safety scope

This bot deliberately has **no** mass ban / mass kick / nuke / spam /
DM-all / raid features. Moderation is single-target only. The anti-nuke
system (`events/zplusSecurity.js`, `commands/security/automod.js`) is
**defensive only**: it watches the audit log for a single executor doing
rapid channel/role/webhook deletions and punishes that one executor. It was
kept as-is and not expanded.

## Setup

### 1. Create the Discord application

1. https://discord.com/developers/applications → **New Application**.
2. **Bot** → **Reset Token** → copy the token (keep it secret).
3. Enable **Privileged Gateway Intents**: Server Members, Message Content,
   Presence is not needed.
4. **OAuth2 → URL Generator**: scopes `bot` + `applications.commands`,
   permissions: Connect, Speak, Send Messages, Embed Links, Attach Files,
   Read Message History, Use External Emojis, Manage Messages,
   Manage Channels (VoiceMaster), Moderate Members. Invite the bot.

### 2. Configure

```bash
cp .env.example .env
# edit .env — at minimum DISCORD_TOKEN, MAIN_OWNER_ID, LAVALINK_*
```

| Variable | Required | Notes |
| --- | --- | --- |
| `DISCORD_TOKEN` | yes | Bot token from the Developer Portal |
| `MAIN_OWNER_ID` | yes | **Your** Discord user ID. Owner-only commands refuse when unset — nothing falls back to a previous owner |
| `OWNER_IDS` | no | Extra owner IDs, comma-separated |
| `LAVALINK_HOST` / `LAVALINK_PORT` / `LAVALINK_PASSWORD` | yes (for music) | Your Lavalink node |
| `LAVALINK_SECURE` | no | `true` / `false` / `auto` (default `auto`) |
| `PREFIX` | no | Default `+` (per-server `+setprefix` overrides) |
| `EMBED_COLOR` | no | Hex, default `00D4FF` |
| `SUPPORT_SERVER` / `WEBSITE_URL` / `VOTE_URL` | no | Links shown by `+support` etc. |
| `GENIUS_API_KEY` | no | Lyrics source for `+lyrics` |
| `WEBHOOK_*` | no | Discord webhook URLs for log channels |

### 3. Lavalink

Music needs a Lavalink server (v4). Options:

- **Self-host:** run the Lavalink jar on a VPS / Railway / Render — set
  `LAVALINK_HOST`, `LAVALINK_PORT` (default 2333), `LAVALINK_PASSWORD`.
- **Free hosted node:** use a public free Lavalink host — fill in the host,
  port, password and `LAVALINK_SECURE` exactly as that host documents.
- **Multiple nodes:** `LAVALINK_NODES="wss://host:443|pass,host:2333|pass"`.

The bot connects to Lavalink with **two engines** (both needed, see below).
If Lavalink is unreachable, the bot still starts; music commands report the
connection failure instead of crashing.

### 4. Run

```bash
npm install
npm start          # node shard.js (sharded; single shard on small bots)
# or: node index.js   (no sharding, for local testing)
```

Requires Node.js 18+ (tested on Node 24). `start.js` is an alternative
launcher that installs dependencies first if `node_modules` is missing.

## Two music engines — why both are live

| Engine | Used by | Lives on |
| --- | --- | --- |
| **lavalink-client** (`music/MusicManager.js`, `client.lavalink`) | 24/7 reconnect (`events/ready.js`), voice-state handling (`events/voiceStateUpdate.js`), raw gateway data (`events/raw.js`), settings (`commands/settings/config.js`) | Lavalink node(s) from `utils/lavalinkConfig.js` |
| **Poru** (`music/PoruEngine.js`, `client.poru`) | 28 of the 38 `commands/music/*` commands (`+play`, `+skip`, `+queue`, `+loop`, favourites, `+247`, …) plus the SQLite models in `music/database/` (favourites, playlists, 24/7 state) | Same Lavalink node(s) |

Neither was removed: the music commands use Poru, while the bot's
infrastructure (24/7 reconnect, voice-state recovery) uses lavalink-client.
Both connect to the same Lavalink node(s) and do not fight each other —
Poru owns playback for music commands, lavalink-client owns the 24/7
session and voice-state recovery.

## Data & privacy

- Runtime state lives in `data/*.json` (main DB: `data/MADEBYSSV.json`) and
  `database/*.json`, plus the Poru SQLite file
  `music/database/aerox_music.db` (created on first run). All ship empty.
- No token, webhook URL or Discord user ID is hardcoded anywhere in the
  source — everything is env-driven (see VERIFICATION.md).
- The bot identifies to Discord honestly as itself. The previous source
  spoofed "Discord iOS" mobile identify properties; that was removed.

## Live Dashboard API

A small HTTP API (`dashboard/api.js`, Node built-in `http` only) that a
separate static dashboard page uses to read bot status and control Poru
playback. It is **off by default** and starts only after the client is
ready.

**Railway / shared port (the fix for the dashboard not connecting):**
Railway only exposes the bot service's main port (`PORT`, 8080 on
Railway) publicly, so the API no longer listens on its own port 3001 in
production. `index.js` mounts it on the main keep-alive HTTP server
(`handleDashboardRequest()` in `dashboard/api.js`): every `/api/*`
request is delegated to the dashboard API, and every other path still
returns the keep-alive `{status:"ok", bot: …}` JSON. `DASHBOARD_PORT`
(3001) is now only for local standalone use — set
`DASHBOARD_SEPARATE_PORT=true` to use a separate port instead of the
shared one. `startDashboard()` / `createDashboardServer()` still work
standalone for local use.

| Variable | Default | Notes |
| --- | --- | --- |
| `DASHBOARD_ENABLED` | `false` | Set `true` to start the API |
| `DASHBOARD_PORT` | `3001` | Local standalone port only — **not used on Railway** |
| `DASHBOARD_SEPARATE_PORT` | `false` | `true` = own port 3001 (local only); absent/`false` = shared main port |
| `DASHBOARD_API_KEY` | _(empty)_ | **Required.** Long random key; the API refuses to answer without it, and the bot keeps running. Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Never commit it — anyone with this key can control music in any server the bot is in |

Every `/api/*` request must send header `X-Dashboard-Key: <key>` (wrong /
missing → `401`). CORS allows any origin, but only with that header.
No key or token is ever logged or returned; errors return a message only,
never a stack trace. Only shard 0 serves the API.

**Endpoints** (all JSON; `GET /api/player` and all `POST`s take
`guildId`; a missing player is `404`, bad input is `400`):

- `GET /api/health` — `{ok, bot, uptimeSeconds, ready}`
- `GET /api/status` — tag, guild/user/shard counts, commands loaded, uptime, `lavalinkConnected`, prefix
- `GET /api/guilds` — servers the bot is in: `{id, name, memberCount, voiceChannelId, playing}` (no user lists)
- `GET /api/commands` — `{name, category, description}` from the loaded commands (160)
- `GET /api/player?guildId=…` — current track, position, paused, volume, repeatMode, autoplay, queue (first 20)
- `POST /api/player/play` `{guildId, query, voiceChannelId?, textChannelId?}` — resolves and queues via the same Poru path as `+play` (playlists expand, tracks <45s / streams skipped). If the bot is not in voice and no `voiceChannelId` is given → `400 "Join a voice channel first / pass voiceChannelId"`
- `POST /api/player/pause|resume|skip|stop` `{guildId}`
- `POST /api/player/volume` `{guildId, volume 0–200}` (100 = normal, passed to Poru/Lavalink)
- `POST /api/player/seek` `{guildId, positionMs}`
- `POST /api/player/loop` `{guildId, mode: off|track|queue}`
- `POST /api/player/shuffle` `{guildId}`
- `POST /api/player/247` `{guildId, enabled, voiceChannelId?, textChannelId?}` — reuses the existing 24/7 store (`Database.set247` + `enabled247`); enable needs a voice channel (player's, stored, or passed). No endpoint is faked: nothing returns `501`.

**How the dashboard calls it — Railway (shared port):**

```bash
# Base URL is the bot service's Railway public domain — NO port, NO /api suffix.
# e.g. https://madebyssv-music-bot-production.up.railway.app
curl -H "X-Dashboard-Key: $DASHBOARD_API_KEY" https://<railway-domain>/api/status
curl -H "X-Dashboard-Key: $DASHBOARD_API_KEY" "https://<railway-domain>/api/player?guildId=123456789012345678"
curl -X POST -H "X-Dashboard-Key: $DASHBOARD_API_KEY" -H "Content-Type: application/json" \
  -d '{"guildId":"123456789012345678","query":"lofi beats"}' \
  https://<railway-domain>/api/player/play
```

**Connect the dashboard page (4 steps):**

1. Open the MADEBYSSV Music Bot Dashboard page.
2. Enter the Railway public domain URL (no trailing slash, no `/api` suffix — e.g. `https://madebyssv-music-bot-production.up.railway.app`).
3. Enter the `DASHBOARD_API_KEY` from Railway Variables (copy it from Railway, never paste it in chat).
4. Connect. The page then calls `<that URL>/api/status`, `/api/guilds`, `/api/player`, etc. with header `X-Dashboard-Key: <key>`.

Locally, the same API is also available standalone on port 3001
(`DASHBOARD_SEPARATE_PORT=true`, or `createDashboardServer()`), at
`http://localhost:3001/api/status`.

The dashboard itself is a static page — it cannot control Discord without
this API running and reachable. See `dashboard/VERIFICATION.md` for the
test record.

## Hosting

See [HOSTING.md](HOSTING.md) for Railway and Render free-tier steps.

## Files

- `index.js` — client, events, login (entry for `node index.js`)
- `shard.js` — ShardingManager (entry for `npm start`)
- `start.js` — install-if-needed launcher, then starts `shard.js`
- `config.js` — env-only configuration
- `handlers/CommandHandler.js` — loads all 165 command files
- `events/` — ready, messageCreate (prefix), interactionCreate, voice, security
- `music/` — MusicManager (lavalink-client) + PoruEngine (Poru)
- `database/Database.js` — JSON store behind `data/MADEBYSSV.json`
- `VERIFICATION.md` — audit + test record for this build
