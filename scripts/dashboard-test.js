// Dashboard API test — no Discord login, no real token, no network.
// Loads dashboard/api.js with a mock client, starts it on an ephemeral
// port with a test key, and exercises every endpoint class with fetch.
// Exit 0 = all checks passed, 1 = any failed.
const { createDashboardServer, startDashboard } = require("../dashboard/api");

const TEST_KEY = "test-dashboard-key-do-not-use-in-production";
const GUILD_A = "111111111111111111";
const GUILD_B = "222222222222222222";

function mockGuild(id, name, memberCount) {
  return { id, name, memberCount, members: { me: { voice: { channelId: null } } } };
}

// Minimal Poru-shaped player for the mock guild.
function mockPlayer(guildId) {
  const queue = [];
  queue.size = 2; // Poru Queue is an Array subclass with a .size getter
  queue.add = (t) => queue.push(t);
  queue.clear = () => queue.splice(0);
  queue.shuffle = () => queue.reverse();
  return {
    guildId,
    voiceChannel: "333333333333333333",
    textChannel: "444444444444444444",
    currentTrack: {
      info: {
        title: "Test Song",
        author: "Test Artist",
        uri: "https://example.com/track",
        artworkUrl: "https://example.com/art.jpg",
        length: 180000,
        isStream: false,
        requester: { username: "tester" },
      },
    },
    position: 45000,
    volume: 80,
    loop: "NONE",
    autoplayEnabled: false,
    isPlaying: true,
    isPaused: false,
    isConnected: true,
    queue,
    pause: async (toggle) => { mockPlayerState.paused = toggle; mockPlayerState.isPaused = toggle; },
    skip: async () => { mockPlayerState.skipped = true; },
    setVolume: async (v) => { mockPlayerState.volume = v; },
    seekTo: async (p) => { mockPlayerState.position = p; },
    setLoop: (m) => { mockPlayerState.loop = m; },
    destroy: async () => { mockPlayerState.destroyed = true; },
  };
}
const mockPlayerState = {};

const mockClient = {
  user: { tag: "MADEBYSSV#0000" },
  isReady: () => true,
  shard: { count: 1, ids: [0] },
  guilds: {
    cache: new Map([
      [GUILD_A, mockGuild(GUILD_A, "Test Server A", 42)],
      [GUILD_B, mockGuild(GUILD_B, "Test Server B", 7)],
    ]),
  },
  commands: new Map([
    ["play", { name: "play", category: "Music", description: "Play a song" }],
    ["ping", { name: "ping", category: "information", description: "Ping" }],
    ["ban", { name: "ban", category: "moderation" }],
  ]),
  poru: {
    players: new Map([[GUILD_A, mockPlayer(GUILD_A)]]),
    nodes: new Map([["MADEBYSSV-LEO-1", { connected: true }]]),
    resolve: async () => ({ loadType: "track", tracks: [] }),
  },
  lavalink: { nodeManager: { nodes: new Map() }, getPlayer: () => null },
};

let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; console.log(`PASS ${name}`); }
  else { failed++; console.log(`FAIL ${name} ${detail}`); }
}

async function main() {
  // startDashboard must refuse without a key, and when disabled.
  delete process.env.DASHBOARD_API_KEY;
  process.env.DASHBOARD_ENABLED = "true";
  check("startDashboard refuses with no DASHBOARD_API_KEY", startDashboard(mockClient) === null);
  process.env.DASHBOARD_ENABLED = "false";
  process.env.DASHBOARD_API_KEY = TEST_KEY;
  check("startDashboard refuses when DASHBOARD_ENABLED is not true", startDashboard(mockClient) === null);
  delete process.env.DASHBOARD_ENABLED;
  delete process.env.DASHBOARD_API_KEY;

  const server = createDashboardServer(mockClient, { apiKey: TEST_KEY });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const H = { "X-Dashboard-Key": TEST_KEY, "Content-Type": "application/json" };
  const get = (p, headers) => fetch(`${base}${p}`, { headers });
  const post = (p, body, headers = H) =>
    fetch(`${base}${p}`, { method: "POST", headers, body: JSON.stringify(body) });

  try {
    let r = await get("/api/health");
    check("GET /api/health no key -> 401", r.status === 401);
    r = await get("/api/health", { "X-Dashboard-Key": "wrong-key" });
    check("GET /api/health wrong key -> 401", r.status === 401);
    r = await get("/api/health", H);
    let j = await r.json();
    check("GET /api/health with key -> 200 ok", r.status === 200 && j.ok === true && j.bot === "MADEBYSSV");

    r = await get("/api/status", H); j = await r.json();
    check("GET /api/status -> tag/guilds/commands/lavalink", r.status === 200 && j.tag === "MADEBYSSV#0000" && j.guildCount === 2 && j.commands === 3 && j.lavalinkConnected === true && j.prefix === "+");

    r = await get("/api/guilds", H); j = await r.json();
    check("GET /api/guilds -> 2 guilds, no user lists", r.status === 200 && Array.isArray(j) && j.length === 2 && j[0].name === "Test Server A" && !("members" in j[0]) && j[0].playing === true);

    r = await get("/api/commands", H); j = await r.json();
    check("GET /api/commands -> 3 commands with category/description", r.status === 200 && j.length === 3 && j.some((c) => c.name === "play" && c.category === "Music"));

    r = await get("/api/player", H);
    check("GET /api/player no guildId -> 400", r.status === 400);
    r = await get(`/api/player?guildId=${GUILD_B}`, H);
    check("GET /api/player no player -> 404", r.status === 404);
    r = await get(`/api/player?guildId=${GUILD_A}`, H); j = await r.json();
    check("GET /api/player with player -> current track + queue", r.status === 200 && j.player.current.title === "Test Song" && j.player.volume === 80 && j.player.repeatMode === "off" && j.player.positionMs === 45000);

    r = await post("/api/player/pause", { guildId: GUILD_B });
    check("POST /api/player/pause no player -> 404", r.status === 404);
    r = await post("/api/player/pause", { guildId: GUILD_A }); j = await r.json();
    check("POST /api/player/pause -> 200 paused", r.status === 200 && j.paused === true);
    r = await post("/api/player/resume", { guildId: GUILD_A }); j = await r.json();
    check("POST /api/player/resume -> 200", r.status === 200 && j.paused === false);
    r = await post("/api/player/skip", { guildId: GUILD_A });
    check("POST /api/player/skip -> 200", r.status === 200);
    r = await post("/api/player/volume", { guildId: GUILD_A, volume: 999 });
    check("POST /api/player/volume 999 -> 400", r.status === 400);
    r = await post("/api/player/volume", { guildId: GUILD_A, volume: 50 }); j = await r.json();
    check("POST /api/player/volume 50 -> 200", r.status === 200 && j.volume === 50);
    r = await post("/api/player/seek", { guildId: GUILD_A, positionMs: 60000 });
    check("POST /api/player/seek -> 200", r.status === 200);
    r = await post("/api/player/seek", { guildId: GUILD_A, positionMs: 999999999 });
    check("POST /api/player/seek beyond duration -> 400", r.status === 400);
    r = await post("/api/player/loop", { guildId: GUILD_A, mode: "bogus" });
    check("POST /api/player/loop bogus -> 400", r.status === 400);
    r = await post("/api/player/loop", { guildId: GUILD_A, mode: "queue" }); j = await r.json();
    check("POST /api/player/loop queue -> 200", r.status === 200 && j.repeatMode === "queue");
    r = await post("/api/player/shuffle", { guildId: GUILD_A });
    check("POST /api/player/shuffle -> 200", r.status === 200);
    r = await post("/api/player/play", { guildId: GUILD_B, query: "test song" });
    j = await r.json();
    check("POST /api/player/play no voice channel -> 400 with voiceChannelId message", r.status === 400 && /voiceChannelId/.test(j.error || ""));
    r = await post("/api/player/play", { guildId: GUILD_A });
    check("POST /api/player/play no query -> 400", r.status === 400);
    r = await post("/api/player/247", { guildId: GUILD_B, enabled: true });
    j = await r.json();
    check("POST /api/player/247 enable no voiceChannelId known -> 400 (no DB write)", r.status === 400);
    r = await post("/api/player/247", { guildId: GUILD_A, enabled: true }); j = await r.json();
    check("POST /api/player/247 enable with player voice channel -> 200", r.status === 200 && j.enabled === true && j.voiceChannelId === "333333333333333333");
    r = await post("/api/player/247", { guildId: GUILD_A, enabled: false }); j = await r.json();
    check("POST /api/player/247 disable -> 200 (cleans up the test entry)", r.status === 200 && j.enabled === false);
    r = await post("/api/player/247", { guildId: GUILD_A, enabled: "yes" });
    check("POST /api/player/247 enabled not boolean -> 400", r.status === 400);
    r = await post("/api/player/stop", { guildId: GUILD_A }); j = await r.json();
    check("POST /api/player/stop -> 200 stopped", r.status === 200 && j.stopped === true);

    r = await fetch(`${base}/api/status`, { method: "OPTIONS", headers: { Origin: "https://example.com", "Access-Control-Request-Method": "GET" } });
    check("OPTIONS preflight -> 204 with CORS", r.status === 204 && r.headers.get("access-control-allow-origin") === "*");
    r = await get("/api/nope", H);
    check("GET unknown /api route -> 404", r.status === 404);
    r = await get("/other", H);
    check("GET non-/api path -> 404", r.status === 404);
    r = await fetch(`${base}/api/player/pause`, { method: "POST", headers: H, body: "{not json" });
    check("POST invalid JSON -> 400", r.status === 400);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  console.log(`\ndashboard-test: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
