# Hosting — MADEBYSSV Music Bot

Free-tier steps for Railway and Render. Railway is the better pick for a
music bot (stays awake); Render's free web service sleeps after inactivity.

## Before you start

You need three things (nothing else will make the bot work):

1. **Discord bot token** — Discord Developer Portal → your app → Bot →
   Reset Token. **Never paste the token in chat, in a ticket, or in a
   public repo.** Put it only in the hosting dashboard's variables.
2. **Your Discord user ID** as `MAIN_OWNER_ID` (Discord → Settings →
   Advanced → Developer Mode on → right-click your name → Copy User ID).
3. **A Lavalink server** — host, port and password (`LAVALINK_HOST`,
   `LAVALINK_PORT`, `LAVALINK_PASSWORD`). Self-host the Lavalink jar, or
   use a free hosted Lavalink node. Music does nothing without this.

## Railway (recommended)

1. Push this project to a GitHub repo (or use `railway init` / drag the
   folder into a Railway project). Do **not** commit a real `.env`.
2. Railway detects Node.js. `railway.json` already sets the start command:
   `node shard.js`.
3. **Variables** (Project → your service → Variables) — add at minimum:
   - `DISCORD_TOKEN`
   - `MAIN_OWNER_ID`
   - `LAVALINK_HOST`, `LAVALINK_PORT`, `LAVALINK_PASSWORD`
   - `LAVALINK_SECURE` (`true` if your Lavalink uses `wss://`, else `false`/`auto`)
   - Optional: `PREFIX` (default `+`), `OWNER_IDS`, `EMBED_COLOR`,
     `SUPPORT_SERVER`, `WEBSITE_URL`, `VOTE_URL`, `GENIUS_API_KEY`,
     `WEBHOOK_*`.
4. **Deploy.** Watch the logs: you should see `MADEBYSSV BOT — STARTING`,
   `[Commands] Loaded 160 commands`, `[Lavalink] Manager initialized` and
   `[LEO Music] Poru music engine initialized` (the last two only once
   Lavalink connects).
5. Railway's free trial gives limited credits — keep an eye on usage. The
   bot's keep-alive HTTP server listens on `$PORT` automatically.

## Render

1. Push the project to GitHub.
2. Render Dashboard → **New +** → **Web Service** → pick the repo.
   `render.yaml` already sets build (`npm install`) and start
   (`node shard.js`).
3. **Environment** → add the same variables as Railway above.
4. **Create Web Service.** Note: on Render's free plan the service spins
   down after ~15 minutes without HTTP traffic — the bot will go offline
   between uses. Use Railway if you want it always on.

## Any VPS / panel (Pterodactyl, etc.)

```bash
npm install
node shard.js        # or: node start.js  (installs deps first if missing)
```

Set the same env vars in the panel, or create a `.env` file next to
`config.js` (loaded automatically via `dotenv`). Panels normally provide an
env-var UI: use that.

## After it is online

1. In Discord, run `+ping` — the bot should answer.
2. Join a voice channel and run `+play <song name>` — music should start.
   If it errors, check the logs for `[Lavalink]` / `[LEO Music]` lines:
   host, port, password or TLS setting is wrong.
3. Run `+help` to see all 165 commands.
4. If owner commands (e.g. `+addowner`) refuse, `MAIN_OWNER_ID` is not
   your ID — fix the variable and redeploy.

## Updating

Pull/redeploy the new code, then redeploy the service. Runtime data
(`data/*.json`, `music/database/aerox_music.db`) lives on the host's disk
and is **not** part of the repo — on Railway/Render it is wiped on
redeploy unless you attach a persistent volume. That is expected: the bot
recreates empty state on first run.
