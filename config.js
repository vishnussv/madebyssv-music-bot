// Load .env when running locally (hosting dashboards inject env vars directly;
// dotenv never overrides a variable that is already set).
try { require("dotenv").config(); } catch (_) {}

// ── MADEBYSSV Music Bot — configuration ──────────────────────────────────────
// Every secret / identity value comes from the environment. Nothing sensitive
// is hardcoded here. Copy .env.example to .env and fill it in, or set the
// variables in your hosting dashboard (Railway / Render).
//
//   DISCORD_TOKEN   Bot token from the Discord Developer Portal (required)
//   MAIN_OWNER_ID   Your Discord user ID — the only main owner (required for
//                   owner-only commands; with it unset those commands refuse)
//   OWNER_IDS       Extra owner user IDs, comma-separated (optional)
//   PREFIX          Command prefix, default "+"
//   EMBED_COLOR     Embed colour as hex, e.g. 00D4FF (default MADEBYSSV blue)
//   SUPPORT_SERVER / WEBSITE_URL / VOTE_URL   public links (optional)
//   LAVALINK_HOST / LAVALINK_PORT / LAVALINK_PASSWORD / LAVALINK_SECURE
//                   Lavalink node the music engines connect to (required for music)
//   LAVALINK_NODES  Optional extra nodes: "wss://host:443|pass,host:2333|pass"
//   GENIUS_API_KEY  Optional, for +lyrics
//   WEBHOOK_*       Optional Discord webhook URLs for log channels
// ─────────────────────────────────────────────────────────────────────────────

function parseOwnerIds(raw) {
  if (!raw) return [];
  return String(raw)
    .split(",")
    .map((v) => v.trim())
    .filter((v) => /^\d{15,25}$/.test(v));
}

function parseEmbedColor(raw, fallback) {
  if (!raw) return fallback;
  const hex = String(raw).trim().replace(/^#|^0x/i, "");
  const n = parseInt(hex, 16);
  return Number.isFinite(n) ? n : fallback;
}

const mainOwnerId = (process.env.MAIN_OWNER_ID || "").trim();

module.exports = {
  // Bot token — never commit a real token. Leave empty and the bot exits
  // at login with a clear error instead of crashing obscurely.
  token: process.env.DISCORD_TOKEN || "",

  // Default prefix. Per-server prefixes (set with +setprefix) override this.
  prefix: process.env.PREFIX || "+",

  // Main owner — only this ID can add/remove other owners via +addowner /
  // +removeowner. Empty string when unset: owner-only commands refuse
  // instead of falling back to any previous owner.
  mainOwnerId,

  // Regular bot owners — can use ownerOnly commands.
  ownerIds: parseOwnerIds(process.env.OWNER_IDS),

  // Backwards-compatible alias for the main owner.
  ownerId: mainOwnerId,

  embedColor: parseEmbedColor(process.env.EMBED_COLOR, 0x00d4ff),
  supportServer: process.env.SUPPORT_SERVER || "",
  website: process.env.WEBSITE_URL || "",
  voteUrl: process.env.VOTE_URL || "",

  // ── Webhook Logging — set each env var to a Discord webhook URL ──────────────
  // Leave blank to disable that log type. Falls back to WEBHOOK_DEFAULT.
  webhooks: {
    default: process.env.WEBHOOK_DEFAULT || process.env.LOG_WEBHOOK || "",
    commands: process.env.WEBHOOK_COMMANDS || "", // command usage logs
    music: process.env.WEBHOOK_MUSIC || "", // music events
    errors: process.env.WEBHOOK_ERRORS || "", // errors & exceptions
    joins: process.env.WEBHOOK_JOINS || "", // server join / leave
    owners: process.env.WEBHOOK_OWNERS || "", // owner actions (blacklist, addowner…)
    mainlogs: process.env.WEBHOOK_MAINLOGS || "", // main log channel (auto-blacklist, critical events)
  },

  lavalink: {
    // You can use a plain hostname, http(s)://, ws:// or wss:// here.
    // LAVALINK_SECURE accepts: true, false, or auto.
    host: process.env.LAVALINK_HOST || "",
    port: Number(process.env.LAVALINK_PORT) || 2333,
    password: process.env.LAVALINK_PASSWORD || "",
    secureMode: process.env.LAVALINK_SECURE || "auto",
  },

  geniusApiKey: process.env.GENIUS_API_KEY || "",
};
