// MADEBYSSV identifies honestly as itself — no client spoofing.

const {
  Client, GatewayIntentBits, Partials, Collection, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, Options,
} = require("discord.js");
const { V2Builder, v2msg, v2eph, v2section } = require("./utils/V2Builder");
const fs     = require("fs");
const path   = require("path");
const config = require("./config");
const { loadCommands } = require("./handlers/CommandHandler");
const Database = require("./database/Database");

// ── Intents — no privileged intents by default ──────────────────────────────
// Discord rejects login with "Used disallowed intents" if the bot requests
// MessageContent / GuildMembers without those toggles enabled in the
// Developer Portal. This bot therefore starts with standard intents only,
// so it logs in on Railway with no portal change. Slash commands (145) and
// the live dashboard work on standard intents.
// Trade-off, stated honestly: prefix commands (+play etc.) need
// MessageContent, so they will NOT work until the owner enables
// Message Content Intent + Server Members Intent in the Portal AND sets
// ENABLE_PRIVILEGED_INTENTS=true in Railway Variables, then redeploys.
const PRIVILEGED_INTENTS = String(process.env.ENABLE_PRIVILEGED_INTENTS || "").toLowerCase() === "true";
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    ...(PRIVILEGED_INTENTS ? [GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers] : []),
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel, Partials.Message],
  // Cache limiting — reduces memory usage for large server counts
  makeCache: Options.cacheWithLimits({
    ...Options.defaultMakeCacheSettings,
    MessageManager: 50,
    UserManager: 200,
    GuildMemberManager: 200,
  }),
  sweepers: {
    ...Options.defaultSweeperSettings,
    messages: { interval: 300, lifetime: 1800 },
    users: { interval: 300, filter: () => user => !user.bot },
  },
});

// ── Emoji constants (sourced from utils/emojis.js) ────────────────────────────
const _allEmojis = require("./utils/emojis");
const { TXT: _emojiTXT } = _allEmojis;
client.emoji = { ..._emojiTXT, ..._allEmojis };

// ── Lily-style embed factory + Components V2 helpers ─────────────────────────
client.util = {
  embed: () => new EmbedBuilder(),
  v2:    (color) => new V2Builder(color),
  v2msg: (color, content) => v2msg(color, content),
  v2eph: (color, content) => v2eph(color, content),
};

// ── Per-guild embed color ─────────────────────────────────────────────────────
client.guildColors = new Map();
client.getColor = (guildId) => {
  if (!guildId) return config.embedColor;
  const stored = client.guildColors.get(guildId);
  if (stored === "random") return Math.floor(Math.random() * 0xFFFFFF);
  if (stored !== undefined && stored !== null) return Number(stored);
  return config.embedColor;
};

// Load saved guild colors
try {
  const allColors = Database.getAllEmbedColors();
  for (const [guildId, color] of Object.entries(allColors)) {
    client.guildColors.set(guildId, color);
  }
} catch (_) {}

// ── Commands ─────────────────────────────────────────────────────────────────
loadCommands(client);

// ── Events ───────────────────────────────────────────────────────────────────
const eventsPath = path.join(__dirname, "events");
for (const file of fs.readdirSync(eventsPath).filter(f => f.endsWith(".js"))) {
  const event = require(path.join(eventsPath, file));
  const handler = (...args) => event.execute(client, ...args);
  if (event.once) client.once(event.name, handler);
  else            client.on(event.name, handler);
}

// ── Shard events ─────────────────────────────────────────────────────────────
const WebhookLogger = require("./logger/WebhookLogger");

// ── Live dashboard API — SHARED PORT ────────────────────────────────────────
// The dashboard API is served on the bot's main keep-alive HTTP server
// (below, process.env.PORT — the only port Railway exposes publicly), so
// /api/* is reachable at the same public URL as the bot service. It is
// disabled unless DASHBOARD_ENABLED=true, and refuses to answer without
// DASHBOARD_API_KEY. Only shard 0 serves it.
// Set DASHBOARD_SEPARATE_PORT=true to instead start the API on its own
// port (DASHBOARD_PORT, default 3001) — local use only; Railway cannot
// reach that port from a browser.
const { handleDashboardRequest, startDashboard } = require("./dashboard/api");
client.once("clientReady", () => {
  try {
    if (String(process.env.DASHBOARD_SEPARATE_PORT || "").toLowerCase() === "true") {
      startDashboard(client);
    } else if (String(process.env.DASHBOARD_ENABLED || "").toLowerCase() === "true" && process.env.DASHBOARD_API_KEY) {
      console.log("[Dashboard] Live dashboard API shared on the main server (key required) — /api/* on the same public URL as the bot.");
    } else if (String(process.env.DASHBOARD_ENABLED || "").toLowerCase() === "true") {
      console.error("[Dashboard] DASHBOARD_API_KEY is not set — dashboard API will NOT start. Set a long random key in your env; the bot keeps running without the dashboard.");
    }
  } catch (err) {
    console.error("[Dashboard] Failed to start:", err.message);
  }
});
client.on("shardReady",        (shardId)        => WebhookLogger.shardReady(shardId, client.guilds.cache.size).catch(() => {}));
client.on("shardDisconnect",   (event, shardId) => WebhookLogger.shardDisconnect(shardId, event?.code).catch(() => {}));
client.on("shardReconnecting", (shardId)        => WebhookLogger.shardReconnecting(shardId).catch(() => {}));
client.on("shardError",        (error, shardId) => WebhookLogger.shardError(shardId, error?.message).catch(() => {}));

// ── Error handling ───────────────────────────────────────────────────────────
client.on("error",   err => console.error("[Client Error]", err));
client.on("warn",    msg => console.warn("[Client Warn]", msg));
process.on("unhandledRejection", err => console.error("[Unhandled Rejection]", err));

// ── Graceful shutdown — DM main owner ────────────────────────────────────────
async function handleShutdown(signal) {
  console.log(`[Shutdown] Received ${signal}, shutting down...`);
  try {
    const owner = await client.users.fetch(config.mainOwnerId).catch(() => null);
    if (owner && client.isReady()) {
      const { cross, rightsort } = client.emoji;
      await owner.send(
        client.util.v2msg(0xED4245,
          `${cross} **MADEBYSSV is Going Offline**\n\n`
          + `${rightsort} **Signal:** \`${signal}\`\n`
          + `${rightsort} **Servers:** \`${client.guilds.cache.size}\`\n`
          + `-# The bot is shutting down — restart it to bring it back online`,
        ),
      ).catch(() => {});
    }
  } catch (_) {}
  process.exit(0);
}

process.on("SIGTERM", () => handleShutdown("SIGTERM"));
process.on("SIGINT",  () => handleShutdown("SIGINT"));

// ── Keep-alive HTTP server (Replit needs an open port) ───────────────────────
// This is also the dashboard API server: Railway only exposes this one
// port (process.env.PORT) publicly, so /api/* requests are delegated to
// the dashboard handler below and everything else gets the keep-alive JSON.
const http = require("http");
const PORT = process.env.PORT || 3000;
const server = http.createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url || "/", "http://localhost").pathname;
    if (pathname.startsWith("/api/")) {
      if (String(process.env.DASHBOARD_ENABLED || "").toLowerCase() !== "true") {
        res.writeHead(404, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
        res.end(JSON.stringify({ ok: false, error: "Dashboard API is disabled" }));
        return;
      }
      // handleDashboardRequest answers (including 401 when the key is
      // missing/wrong, and OPTIONS preflight) and returns true; it
      // returns false only for non-/api paths, which cannot happen here.
      const handled = await handleDashboardRequest(client, process.env.DASHBOARD_API_KEY || "", req, res);
      if (!handled && !res.writableEnded && !res.headersSent) {
        res.writeHead(404, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
        res.end(JSON.stringify({ ok: false, error: "Not found" }));
      }
      return;
    }
  } catch (err) {
    if (res.headersSent || res.writableEnded) return;
    // Fall through to the keep-alive JSON below on unexpected errors.
  }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ status: "ok", bot: client.user?.tag || "starting" }));
});
server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.warn(`[HTTP] Port ${PORT} in use, retrying in 3s...`);
    setTimeout(() => server.listen(PORT), 3000);
  } else {
    console.error("[HTTP] Server error:", err.message);
  }
});
server.listen(PORT, () => console.log(`[HTTP] Keep-alive server on port ${PORT}`));

// ── Login ────────────────────────────────────────────────────────────────────
console.log("╔══════════════════════════════════╗");
console.log("║      MADEBYSSV BOT — STARTING        ║");
console.log("╚══════════════════════════════════╝");

if (!config.token) {
  console.error("[Login Failed] DISCORD_TOKEN is not set. Copy .env.example to .env and add your bot token, or set DISCORD_TOKEN in your hosting dashboard.");
  process.exit(1);
}

client.login(config.token).catch(err => {
  console.error("[Login Failed]", err.message);
  process.exit(1);
});
