// ── MADEBYSSV Live Dashboard API ─────────────────────────────────────────────
// Small HTTP API (Node built-in `http` only, no new dependencies) that lets a
// separate static dashboard page read bot status and control Poru playback.
//
// Security:
//  - Every /api/* request must send header `X-Dashboard-Key` matching the
//    DASHBOARD_API_KEY env var. Wrong / missing key -> 401.
//  - If DASHBOARD_API_KEY is unset, the API refuses to start at all — the bot
//    keeps running normally. The key is never logged and never returned.
//  - CORS allows any origin, but only with the key header, so a key leaked
//    into a page is the only way in — keep the key secret, rotate it if
//    shared. This API has no Discord-user auth: anyone with the key can
//    control music in any guild the bot is in. Do not publish the key.
//  - No stack traces are returned, no tokens/keys are logged (only
//    method + path + status).
//
// Wiring: index.js calls startDashboard(client) once on `clientReady`.
// The API is disabled unless DASHBOARD_ENABLED=true. Default port 3001 —
// separate from the keep-alive server on PORT (default 3000) in index.js.
//
// Player model: Poru owns playback (client.poru, same as +play/+pause/etc).
// lavalink-client (client.lavalink) is only used to report Lavalink
// connectivity. Volume is passed straight through to Poru/Lavalink, where
// 100 is normal volume (the +volume command uses 1-100); the API accepts
// 0-200, matching the dashboard slider.

const http = require("http");
const crypto = require("crypto");

const config = require("../config");

// Lazy: Database / State are only needed for the 24/7 endpoint. Requiring
// them here is safe (no circular dependency: neither requires dashboard/).
let Database = null;
let enabled247 = null;
try {
  Database = require("../database/Database");
  ({ enabled247 } = require("../utils/State"));
} catch (_) {
  Database = null;
  enabled247 = null;
}

const DEFAULT_PORT = 3001;
const MAX_BODY_BYTES = 64 * 1024;
const LOOP_MAP = { off: "NONE", track: "TRACK", queue: "QUEUE" };
const LOOP_REVERSE = { NONE: "off", TRACK: "track", QUEUE: "queue" };

// ── helpers ─────────────────────────────────────────────────────────────────

function isGuildId(value) {
  return typeof value === "string" && /^\d{15,25}$/.test(value);
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "X-Dashboard-Key, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  });
  res.end(body);
  return status;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (!raw) return resolve({});
      try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          return reject(new Error("Request body must be a JSON object"));
        }
        resolve(parsed);
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function keysEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || !a || !b) return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  try {
    return crypto.timingSafeEqual(ab, bb);
  } catch {
    return false;
  }
}

function lavalinkConnected(client) {
  try {
    // Poru nodes
    const poruNodes = client?.poru?.nodes;
    if (poruNodes && typeof poruNodes.values === "function") {
      for (const node of poruNodes.values()) {
        if (node?.connected === true || node?.isConnected === true) return true;
        if (typeof node?.state === "string" && node.state.toLowerCase() === "connected") return true;
      }
    }
    if (poruNodes && typeof poruNodes === "object") {
      for (const node of Object.values(poruNodes)) {
        if (node?.connected === true || node?.isConnected === true) return true;
      }
    }
    // lavalink-client nodes
    const llNodes = client?.lavalink?.nodeManager?.nodes;
    if (llNodes && typeof llNodes.values === "function") {
      for (const node of llNodes.values()) {
        if (node?.connected === true || node?.state === "connected") return true;
        if (node?.isConnected === true) return true;
      }
    }
  } catch (_) {
    return false;
  }
  return false;
}

function getPoruPlayer(client, guildId) {
  try {
    return client?.poru?.players?.get?.(guildId) || null;
  } catch {
    return null;
  }
}

function serializeTrack(track) {
  if (!track || !track.info) return null;
  const info = track.info;
  return {
    title: info.title || "Unknown",
    author: info.author || "Unknown",
    uri: info.uri || null,
    artworkUrl: info.artworkUrl || info.artworkURL || info.image || null,
    durationMs: Number(info.length || 0),
    isStream: Boolean(info.isStream),
    requester:
      typeof info.requester === "string"
        ? info.requester
        : info.requester?.username || info.requester?.tag || null,
  };
}

function queueTracks(player, limit = 20) {
  const q = player?.queue;
  if (!q) return [];
  const arr = Array.isArray(q) ? q : Array.from(q);
  return arr.slice(0, limit).map(serializeTrack).filter(Boolean);
}

function queueCount(player) {
  const q = player?.queue;
  if (!q) return 0;
  if (typeof q.size === "number") return q.size;
  if (typeof q.length === "number") return q.length;
  return 0;
}

function repeatModeOf(player) {
  const raw = String(player?.loop ?? player?.repeatMode ?? "NONE").toUpperCase();
  return LOOP_REVERSE[raw] || "off";
}

function serializePlayer(client, guildId, player) {
  const current = player.currentTrack ? serializeTrack(player.currentTrack) : null;
  return {
    guildId,
    playing: Boolean(player.isPlaying && !player.isPaused),
    paused: Boolean(player.isPaused),
    connected: Boolean(player.isConnected),
    current,
    positionMs: Number(player.position || 0),
    durationMs: Number(player.currentTrack?.info?.length || 0),
    volume: Number(player.volume ?? 100),
    repeatMode: repeatModeOf(player),
    autoplay: Boolean(player.autoplayEnabled),
    queueCount: queueCount(player),
    queue: queueTracks(player, 20),
    voiceChannelId: player.voiceChannel || player.voiceChannelId || null,
    textChannelId: player.textChannel || player.textChannelId || null,
  };
}

// Same resolve path as commands/music/play.js: Poru resolve, up to 3 tries,
// playlist loads expand, tracks shorter than 45s / streams are skipped.
async function resolveMusic(client, query) {
  const leoConfig = require("../music/leoConfig");
  if (!client?.poru?.resolve) throw new Error("Music resolver is unavailable.");
  const source = /^https?:\/\//i.test(query)
    ? undefined
    : leoConfig?.MUSIC?.DEFAULT_PLATFORM || "ytsearch";
  let last;
  for (let i = 0; i < 3; i++) {
    try {
      const result = await client.poru.resolve({ query, source, requester: { username: "MADEBYSSV Dashboard" } });
      if (!result || typeof result !== "object") throw new Error("Invalid music response.");
      return result;
    } catch (err) {
      last = err;
      if (i < 2) await new Promise((r) => setTimeout(r, 900 * (i + 1)));
    }
  }
  throw last || new Error("Music resolve failed.");
}

function playable(track) {
  return track?.info && !track.info.isStream && Number(track.info.length || 0) >= 45000;
}

// ── route handlers ──────────────────────────────────────────────────────────

async function handleHealth(client, _body, _params) {
  return {
    status: 200,
    body: {
      ok: true,
      bot: "MADEBYSSV",
      uptimeSeconds: Math.floor(process.uptime()),
      ready: Boolean(client?.user) && (typeof client.isReady === "function" ? client.isReady() : true),
    },
  };
}

async function handleStatus(client) {
  const guilds = client?.guilds?.cache;
  const guildList = guilds && typeof guilds.values === "function" ? [...guilds.values()] : [];
  const userCount = guildList.reduce((n, g) => n + Number(g?.memberCount || 0), 0);
  return {
    status: 200,
    body: {
      ok: true,
      tag: client?.user?.tag || null,
      ready: Boolean(client?.user) && (typeof client.isReady === "function" ? client.isReady() : true),
      guildCount: guildList.length,
      userCount,
      shardCount: client?.shard?.count ?? 1,
      commands: client?.commands?.size ?? 0,
      uptimeSeconds: Math.floor(process.uptime()),
      lavalinkConnected: lavalinkConnected(client),
      prefix: config.prefix || "+",
    },
  };
}

async function handleGuilds(client) {
  const guilds = client?.guilds?.cache;
  const list = guilds && typeof guilds.values === "function" ? [...guilds.values()] : [];
  return {
    status: 200,
    body: list.map((g) => {
      const poru = getPoruPlayer(client, g.id);
      const lavalinkPlayer = client?.lavalink?.getPlayer?.(g.id) || null;
      const voiceChannelId =
        poru?.voiceChannel ||
        lavalinkPlayer?.voiceChannelId ||
        g?.members?.me?.voice?.channelId ||
        null;
      return {
        id: g.id,
        name: g.name || "Unknown",
        memberCount: Number(g.memberCount || 0),
        voiceChannelId,
        playing: Boolean(poru?.isPlaying && !poru?.isPaused) || Boolean(poru?.currentTrack),
      };
    }),
  };
}

async function handleCommands(client) {
  const cmds = client?.commands;
  const list = cmds && typeof cmds.values === "function" ? [...cmds.values()] : [];
  const out = list
    .map((cmd) => ({
      name: String(cmd?.name || cmd?.data?.name || "").toLowerCase(),
      category: String(cmd?.category || "uncategorised"),
      description: String(cmd?.description || cmd?.data?.description || ""),
    }))
    .filter((c) => c.name)
    .sort((a, b) => (a.category === b.category ? a.name.localeCompare(b.name) : a.category.localeCompare(b.category)));
  return { status: 200, body: out };
}

function requireGuild(client, guildId) {
  if (!isGuildId(guildId)) return { error: "guildId is required and must be a Discord guild ID", status: 400 };
  const guild = client?.guilds?.cache?.get?.(guildId);
  if (!guild) return { error: "Guild not found — the bot is not in this server", status: 404 };
  return { guild };
}

async function handlePlayer(client, _body, params) {
  const guildId = params.get("guildId");
  const checked = requireGuild(client, guildId);
  if (checked.error) return { status: checked.status, body: { ok: false, error: checked.error } };
  const player = getPoruPlayer(client, guildId);
  if (!player) return { status: 404, body: { ok: false, error: "No player for this guild — nothing is playing" } };
  return { status: 200, body: { ok: true, player: serializePlayer(client, guildId, player) } };
}

async function handlePlay(client, body) {
  const guildId = body.guildId;
  const checked = requireGuild(client, guildId);
  if (checked.error) return { status: checked.status, body: { ok: false, error: checked.error } };
  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (!query || query.length > 500) {
    return { status: 400, body: { ok: false, error: "query is required (song name or URL, max 500 characters)" } };
  }
  if (!client?.poru) return { status: 503, body: { ok: false, error: "Music engine unavailable — Poru is not initialised" } };

  let player = getPoruPlayer(client, guildId);
  const voiceChannelId =
    (typeof body.voiceChannelId === "string" && body.voiceChannelId.trim()) || player?.voiceChannel || null;
  if (!player && !voiceChannelId) {
    return {
      status: 400,
      body: {
        ok: false,
        error: "Join a voice channel first / pass voiceChannelId — the bot is not in a voice channel in this server",
      },
    };
  }
  const textChannelId =
    (typeof body.textChannelId === "string" && body.textChannelId.trim()) ||
    player?.textChannel ||
    voiceChannelId;

  let result;
  try {
    result = await resolveMusic(client, query);
  } catch (err) {
    return { status: 500, body: { ok: false, error: err?.message || "Music search failed" } };
  }
  if (result.loadType === "empty" || !result.tracks?.length) {
    return { status: 404, body: { ok: false, error: "No results found for that query" } };
  }
  if (result.loadType === "error") {
    return { status: 500, body: { ok: false, error: `Failed to load: ${result.exception?.message || "Unknown error"}` } };
  }
  const isPlaylist = result.loadType === "playlist" || result.loadType === "PLAYLIST_LOADED";
  const tracks = (isPlaylist ? result.tracks : [result.tracks[0]]).filter(playable);
  if (!tracks.length) {
    return { status: 404, body: { ok: false, error: "No playable tracks found (tracks under 45s and live streams are skipped)" } };
  }

  try {
    if (!player) {
      player = client.poru.createConnection({
        guildId,
        voiceChannel: voiceChannelId,
        textChannel: textChannelId,
        deaf: true,
      });
    } else if (textChannelId && typeof player.setTextChannel === "function") {
      player.setTextChannel(textChannelId);
    }
  } catch (err) {
    return { status: 500, body: { ok: false, error: err?.message || "Could not connect to the voice channel" } };
  }

  if (player.autoplayEnabled === undefined) player.autoplayEnabled = false;
  for (const track of tracks) {
    if (track.info) track.info.requester = { username: "MADEBYSSV Dashboard" };
    player.queue.add(track);
  }
  const wasIdle = !player.isPlaying && !player.currentTrack;
  if (wasIdle && player.isConnected) {
    try {
      await player.play();
    } catch (err) {
      return { status: 500, body: { ok: false, error: err?.message || "Could not start playback" } };
    }
  }
  return {
    status: 200,
    body: {
      ok: true,
      added: tracks.length,
      isPlaylist,
      track: serializeTrack(tracks[0]),
      player: serializePlayer(client, guildId, player),
    },
  };
}

function playerAction(fn) {
  return async (client, body) => {
    const guildId = body.guildId;
    const checked = requireGuild(client, guildId);
    if (checked.error) return { status: checked.status, body: { ok: false, error: checked.error } };
    const player = getPoruPlayer(client, guildId);
    if (!player) return { status: 404, body: { ok: false, error: "No player for this guild — nothing is playing" } };
    try {
      const extra = (await fn(player, body)) || {};
      return { status: 200, body: { ok: true, player: serializePlayer(client, guildId, player), ...extra } };
    } catch (err) {
      const code = err?.status === 400 ? 400 : 500;
      return { status: code, body: { ok: false, error: err?.message || "Player action failed" } };
    }
  };
}

const handlePause = playerAction(async (player) => {
  await player.pause(true);
  return { paused: true };
});

const handleResume = playerAction(async (player) => {
  await player.pause(false);
  return { paused: false };
});

const handleSkip = playerAction(async (player) => {
  if (!player.currentTrack) {
    const err = new Error("No track to skip");
    err.status = 400;
    throw err;
  }
  await player.skip();
  return { skipped: true };
});

const handleStop = playerAction(async (player) => {
  if (player.queue && typeof player.queue.clear === "function") player.queue.clear();
  await player.destroy();
  return { stopped: true, player: null };
});

const handleVolume = playerAction(async (player, body) => {
  const volume = body.volume;
  if (typeof volume !== "number" || !Number.isFinite(volume) || volume < 0 || volume > 200) {
    const err = new Error("volume must be a number between 0 and 200");
    err.status = 400;
    throw err;
  }
  await player.setVolume(Math.round(volume));
  return { volume: Math.round(volume) };
});

const handleSeek = playerAction(async (player, body) => {
  const positionMs = body.positionMs;
  if (typeof positionMs !== "number" || !Number.isFinite(positionMs) || positionMs < 0) {
    const err = new Error("positionMs must be a number >= 0 (milliseconds)");
    err.status = 400;
    throw err;
  }
  const duration = Number(player.currentTrack?.info?.length || 0);
  if (duration > 0 && positionMs >= duration) {
    const err = new Error("Cannot seek beyond track duration");
    err.status = 400;
    throw err;
  }
  await player.seekTo(Math.round(positionMs));
  return { positionMs: Math.round(positionMs) };
});

const handleLoop = playerAction(async (player, body) => {
  const mode = typeof body.mode === "string" ? body.mode.toLowerCase() : "";
  if (!LOOP_MAP[mode]) {
    const err = new Error("mode must be off, track or queue");
    err.status = 400;
    throw err;
  }
  player.setLoop(LOOP_MAP[mode]);
  return { repeatMode: mode };
});

const handleShuffle = playerAction(async (player) => {
  if (queueCount(player) < 2) {
    const err = new Error("Not enough tracks in the queue to shuffle");
    err.status = 400;
    throw err;
  }
  player.queue.shuffle();
  return { shuffled: true };
});

async function handle247(client, body) {
  const guildId = body.guildId;
  const checked = requireGuild(client, guildId);
  if (checked.error) return { status: checked.status, body: { ok: false, error: checked.error } };
  if (typeof body.enabled !== "boolean") {
    return { status: 400, body: { ok: false, error: "enabled must be true or false" } };
  }
  if (!Database) return { status: 501, body: { ok: false, error: "24/7 state store is unavailable" } };
  try {
    if (body.enabled) {
      const player = getPoruPlayer(client, guildId);
      let stored = { voiceChannelId: null, textChannelId: null };
      try {
        stored = Database.get247ChannelIds(guildId) || stored;
      } catch (_) {}
      const voiceChannelId =
        (typeof body.voiceChannelId === "string" && body.voiceChannelId.trim()) ||
        player?.voiceChannel ||
        stored.voiceChannelId ||
        null;
      if (!voiceChannelId) {
        return {
          status: 400,
          body: { ok: false, error: "pass voiceChannelId to enable 24/7 — no voice channel is known for this server" },
        };
      }
      const textChannelId =
        (typeof body.textChannelId === "string" && body.textChannelId.trim()) ||
        player?.textChannel ||
        stored.textChannelId ||
        voiceChannelId;
      Database.set247(guildId, true, voiceChannelId, textChannelId);
      if (enabled247) enabled247.add(guildId);
      return { status: 200, body: { ok: true, guildId, enabled: true, voiceChannelId, textChannelId } };
    }
    Database.set247(guildId, false);
    if (enabled247) enabled247.delete(guildId);
    return { status: 200, body: { ok: true, guildId, enabled: false } };
  } catch (err) {
    return { status: 500, body: { ok: false, error: err?.message || "24/7 update failed" } };
  }
}

// ── router ──────────────────────────────────────────────────────────────────

const ROUTES = [
  ["GET", /^\/api\/health$/, handleHealth],
  ["GET", /^\/api\/status$/, handleStatus],
  ["GET", /^\/api\/guilds$/, handleGuilds],
  ["GET", /^\/api\/commands$/, handleCommands],
  ["GET", /^\/api\/player$/, handlePlayer],
  ["POST", /^\/api\/player\/play$/, handlePlay],
  ["POST", /^\/api\/player\/pause$/, handlePause],
  ["POST", /^\/api\/player\/resume$/, handleResume],
  ["POST", /^\/api\/player\/skip$/, handleSkip],
  ["POST", /^\/api\/player\/stop$/, handleStop],
  ["POST", /^\/api\/player\/volume$/, handleVolume],
  ["POST", /^\/api\/player\/seek$/, handleSeek],
  ["POST", /^\/api\/player\/loop$/, handleLoop],
  ["POST", /^\/api\/player\/shuffle$/, handleShuffle],
  ["POST", /^\/api\/player\/247$/, handle247],
];

function createDashboardServer(client, options = {}) {
  const apiKey = options.apiKey || "";
  const server = http.createServer(async (req, res) => {
    const started = Date.now();
    let status = 200;
    try {
      const url = new URL(req.url || "/", "http://localhost");
      const pathname = url.pathname;

      // CORS preflight — no key needed, it carries no data.
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "X-Dashboard-Key, Content-Type",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        });
        res.end();
        status = 204;
        return;
      }

      if (!pathname.startsWith("/api/")) {
        status = sendJson(res, 404, { ok: false, error: "Not found" });
        return;
      }

      // Auth on every /api/* route, including /api/health.
      if (!keysEqual(req.headers["x-dashboard-key"], apiKey)) {
        status = sendJson(res, 401, { ok: false, error: "Unauthorized — missing or wrong X-Dashboard-Key header" });
        return;
      }

      const route = ROUTES.find(([method, re]) => method === req.method && re.test(pathname));
      if (!route) {
        status = sendJson(res, 404, { ok: false, error: "Unknown endpoint" });
        return;
      }

      let body = {};
      if (req.method === "POST") {
        try {
          body = await readBody(req);
        } catch (err) {
          status = sendJson(res, 400, { ok: false, error: err.message });
          return;
        }
      }

      try {
        const result = await route[2](client, body, url.searchParams);
        status = sendJson(res, result.status, result.body);
      } catch (err) {
        // playerAction validation errors carry a .status (400); everything
        // else is a 500 with the message only — never a stack trace.
        const code = err?.status === 400 ? 400 : 500;
        status = sendJson(res, code, { ok: false, error: err?.message || "Internal error" });
      }
    } catch (err) {
      try {
        status = sendJson(res, 500, { ok: false, error: err?.message || "Internal error" });
      } catch (_) {
        status = 500;
      }
    } finally {
      // Log only method + path + status — never keys, tokens or bodies.
      try {
        console.log(`[Dashboard] ${req.method} ${new URL(req.url || "/", "http://localhost").pathname} ${status} ${Date.now() - started}ms`);
      } catch (_) {}
    }
  });
  return server;
}

function startDashboard(client, options = {}) {
  // Only the first shard serves the dashboard (shard.js spawns index.js
  // once per shard; without this every shard would fight over the port).
  try {
    if (client?.shard && Array.isArray(client.shard.ids) && !client.shard.ids.includes(0)) {
      return null;
    }
  } catch (_) {}

  const enabled = String(process.env.DASHBOARD_ENABLED ?? options.enabled ?? "").toLowerCase() === "true";
  if (!enabled) {
    console.log("[Dashboard] Disabled — set DASHBOARD_ENABLED=true to start the dashboard API.");
    return null;
  }

  const apiKey = process.env.DASHBOARD_API_KEY || options.apiKey || "";
  if (!apiKey) {
    console.error("[Dashboard] DASHBOARD_API_KEY is not set — dashboard API will NOT start. Set a long random key in your env; the bot keeps running without the dashboard.");
    return null;
  }

  let port = Number(process.env.DASHBOARD_PORT ?? options.port ?? DEFAULT_PORT);
  if (!Number.isFinite(port) || port <= 0 || port > 65535) port = DEFAULT_PORT;

  const server = createDashboardServer(client, { apiKey });
  server.on("error", (err) => {
    console.error(`[Dashboard] Server error on port ${port}:`, err.message);
  });
  server.listen(port, "0.0.0.0", () => {
    console.log(`[Dashboard] Live dashboard API on http://0.0.0.0:${port} (key required)`);
  });
  return server;
}

module.exports = { startDashboard, createDashboardServer };
