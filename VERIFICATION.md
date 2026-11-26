# VERIFICATION — MADEBYSSV Music Bot

Rebrand + cleanup of the Fox Arena source, verified 2026-11-26 on Node
v24.22.1. No real Discord token was used at any point; no real login was
attempted.

## Counts

| Check | Result |
| --- | --- |
| JS files in project (excl. `node_modules`) | 222 |
| Command files in `commands/` | 165 (was 166 — see Shards.js note) |
| Commands loaded by `handlers/CommandHandler` | **160 unique names** |
| Aliases loaded | 262 |
| Slash commands (commands with `.data`) | **145** |
| `node --check` on all 222 JS files | **all pass** |
| All `data/*.json` + `database/*.json` | parse OK, reset to empty schemas |

Command files by folder: customize 3, filter 8, fun 9, general 38,
information 10, moderation 13, music 38, playlist 12, security 1,
settings 31, voice 2 = 165.

### Why 160 loaded, not 165

- `commands/settings/Shards.js` was **deleted**: it was not a command at
  all, but a stray standalone `discord-hybrid-sharding` ClusterManager
  launcher requiring a nonexistent `./src/config`. It failed to load and
  would have spawned a second manager if required. Sharding is already
  handled by `shard.js` (discord.js `ShardingManager`).
- 5 command names exist in two files each; the loader's `Map.set`
  overwrites, so the last-loaded file wins (pre-existing source behaviour,
  kept as-is): `dev` (general/dev.js, settings/dev.js),
  `commandstats` (general/ownerlookup.js, settings/commandstats.js),
  `owners` (general/owners.js, settings/owners.js),
  `team` (general/team.js, settings/team.js),
  `announce` (settings/announce.js, settings/announcechannel.js).

## Tests run

1. **`npm install`** — exit 0, 202 packages (+ `dotenv` added after:
   `dotenv@18.0.10`). Only deprecation warnings for old transitive deps.
2. **`node --check`** — all 222 JS files pass.
3. **`node -e require('./config')`** with env set
   (`DISCORD_TOKEN`, `MAIN_OWNER_ID`, `OWNER_IDS`, `PREFIX=+`,
   `LAVALINK_HOST/PORT/PASSWORD`) — reads all values correctly.
   With no env: token `""`, prefix `"+"`, mainOwnerId `""`,
   ownerIds `[]`, lavalink host/password `""`.
4. **`node scripts/load-test.js`** — fake client
   `{commands: new Map(), aliases: new Map()}`: 160 commands, 262
   aliases, 145 slash commands, 0 load failures. With `MAIN_OWNER_ID`
   unset, `isMainOwner(any-id)` and `isOwner(any-id)` both return
   `false` (owner-only commands refuse).
5. **`node index.js` with `DISCORD_TOKEN` unset** — exits **code 1** with:
   `[Login Failed] DISCORD_TOKEN is not set. Copy .env.example to .env
   and add your bot token, or set DISCORD_TOKEN in your hosting dashboard.`
6. **`node index.js` with `DISCORD_TOKEN=INVALID_TOKEN_FOR_TEST_ONLY`**
   — exits **code 1** with: `[Login Failed] An invalid token was provided.`

## What changed

- **Rebrand:** "Fox Arena" / "FOX ARENA" → "MADEBYSSV" in all 222 JS
  files (user-facing strings, footers, help text, embeds, attachment
  filenames like `MADEBYSSV-card.png`, music node IDs
  `MADEBYSSV-1`, `MADEBYSSV-LEO-1`). `package.json` name
  `madebyssv-music-bot`. Credit line "Based on Fox Arena source by
  Navaniii" kept in `README-MADEBYSSV.md` only.
- **Presence:** removed the fake Twitch streaming presence
  (`twitch.tv/alexamusic`). Now a plain `Listening to MADEBYSSV Music`
  activity with live server/user/shard counts, refreshed every 5 min.
- **iOS spoof removed:** the `DefaultWebSocketManagerOptions` patch and
  the `ws.properties` `Discord iOS` identify block are gone from
  `index.js`. The bot identifies honestly as itself.
- **Prefix:** default is now `+` (`config.js`, `PREFIX` env). Verified
  `events/messageCreate.js` uses `Database.getPrefix(guildId) ||
  config.prefix || "."` — no hardcoded `",,"` remains anywhere.
- **Owners/config via env only:** `config.js` reads `DISCORD_TOKEN`,
  `MAIN_OWNER_ID`, `OWNER_IDS` (comma-separated), `PREFIX`,
  `EMBED_COLOR`, `SUPPORT_SERVER`, `WEBSITE_URL`, `VOTE_URL`,
  `LAVALINK_HOST/PORT/PASSWORD/SECURE`, `GENIUS_API_KEY`, `WEBHOOK_*`.
  No Discord user ID is hardcoded anywhere in `.js`/`.json`. Also
  removed hardcoded old-owner fallbacks in `events/zplusSecurity.js`
  and `commands/general/dev.js` (both fell back to `1520624633995333702`)
  and hardened `utils/OwnerAccess.js` `isMainOwner()` to return `false`
  when no main owner is configured.
- **Runtime state reset:** all `data/*.json` and `database/*.json`
  emptied to their clean schemas (main DB `data/MADEBYSSV.json` with all
  keys `Database.js` expects, incl. `owners: []`, `mainOwnerId: null`).
  Orphaned files with no code readers and the previous owner's data
  deleted: `data/alexa-vc.json` (647 KB), `data/alexa-partners.json`,
  `data/alexa-team.json`, `data/alexa.json`, `data/zplus-security.json`.
  Data files renamed to match what the code actually reads:
  `madebyssv_react.json`, `madebyssv_system.json`,
  `madebyssv_tracker.json`, `database/madebyssv_control.json`, plus new
  empty `data/MADEBYSSV-vc.json` and `data/MADEBYSSV-partners.json`.
  Old note files (`FOX_ARENA_*.txt`, `PATCH_FILES.txt`,
  `LAVALINK-CONNECTIONS.txt`, `INSTALL.txt`, `README.txt`) deleted.
- **New files:** `.env.example`, `.gitignore`, `railway.json`,
  `render.yaml`, `Procfile` (`worker: node shard.js`),
  `README-MADEBYSSV.md`, `HOSTING.md`, `scripts/load-test.js`, this file.
  `dotenv` added as a dependency so a local `.env` works.
- **`commands/settings/Shards.js` deleted** (see Counts note above).

## What was deliberately NOT changed

- **Both music engines kept.** `commands/music/*`: 28 of 38 use Poru
  (`client.poru`); 0 use lavalink-client directly — but lavalink-client
  (`client.lavalink`) is used by `events/ready.js` (24/7 reconnect),
  `events/voiceStateUpdate.js`, `events/raw.js` and
  `commands/settings/config.js`. Both connect to the same Lavalink
  node(s); Poru owns playback, lavalink-client owns the 24/7 session and
  voice-state recovery. See README-MADEBYSSV.md.
- **Anti-nuke scope untouched.** `events/zplusSecurity.js` and
  `commands/security/automod.js` are defensive only (single executor
  from the audit log). Only branding strings and the hardcoded old-owner
  fallbacks were changed; no detection or punishment logic was altered,
  and no mass-action features were added anywhere.
- **Internal Discord identifiers left as-is** (renaming would break
  references or is invisible to users): custom-emoji names
  (`AlexaTick`, `AlexaCross`, `AlexaCrown`, … — the `<:Name:ID>` syntax
  points at the previous owner's server emoji objects by ID; they will
  render as plain text until Vishnu's own emojis are set up),
  component custom IDs (`alexa_help:*`, `alexa_afk_*`,
  `alexa_tracker_select`, `alexasuccess`/`alexacancel`), the
  `music/leoConfig.js` / `music/leoEvents.js` module filenames, and the
  `[LEO Music]` console log prefix (the Poru engine's own name).

## Still needed to go live (Vishnu must supply)

1. **Discord bot token** → `DISCORD_TOKEN`
2. **His Discord user ID** → `MAIN_OWNER_ID`
3. **Lavalink host + password** → `LAVALINK_HOST`, `LAVALINK_PORT`,
   `LAVALINK_PASSWORD` (and `LAVALINK_SECURE` if the node uses `wss://`)

Set them in the Railway/Render dashboard (see HOSTING.md) or a local
`.env` — never paste the token in chat.
