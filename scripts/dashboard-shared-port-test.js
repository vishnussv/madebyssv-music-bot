// Shared-port dashboard test — no Discord login, no real token, no network.
// Verifies the Railway fix: the dashboard API shares the bot's main
// keep-alive HTTP server (one port), instead of listening on port 3001.
// The server below mirrors the dispatcher in index.js exactly: /api/*
// goes to handleDashboardRequest(), everything else gets the keep-alive
// JSON. Exit 0 = all checks passed, 1 = any failed.
const http = require("http");
const { handleDashboardRequest } = require("../dashboard/api");

const TEST_KEY = "test-dashboard-key-do-not-use-in-production";

const mockClient = {
  user: { tag: "MADEBYSSV#0000" },
  isReady: () => true,
  shard: { count: 1, ids: [0] },
  guilds: {
    cache: new Map([
      ["111111111111111111", { id: "111111111111111111", name: "Test Server A", memberCount: 42, members: { me: { voice: { channelId: null } } } }],
    ]),
  },
  commands: new Map([
    ["play", { name: "play", category: "Music", description: "Play a song" }],
  ]),
  poru: { players: new Map(), nodes: new Map([["MADEBYSSV-LEO-1", { connected: true }]]) },
  lavalink: { nodeManager: { nodes: new Map() }, getPlayer: () => null },
};

// Dispatcher copied from index.js (keep-alive server).
function createSharedServer() {
  return http.createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url || "/", "http://localhost").pathname;
      if (pathname.startsWith("/api/")) {
        if (String(process.env.DASHBOARD_ENABLED || "").toLowerCase() !== "true") {
          res.writeHead(404, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
          res.end(JSON.stringify({ ok: false, error: "Dashboard API is disabled" }));
          return;
        }
        const handled = await handleDashboardRequest(mockClient, process.env.DASHBOARD_API_KEY || "", req, res);
        if (!handled && !res.writableEnded && !res.headersSent) {
          res.writeHead(404, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
          res.end(JSON.stringify({ ok: false, error: "Not found" }));
        }
        return;
      }
    } catch (err) {
      if (res.headersSent || res.writableEnded) return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", bot: mockClient.user?.tag || "starting" }));
  });
}

let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; console.log(`PASS ${name}`); }
  else { failed++; console.log(`FAIL ${name} ${detail}`); }
}

async function main() {
  process.env.DASHBOARD_ENABLED = "true";
  process.env.DASHBOARD_API_KEY = TEST_KEY;
  const server = createSharedServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const H = { "X-Dashboard-Key": TEST_KEY, "Content-Type": "application/json" };
  try {
    let r = await fetch(`${base}/`);
    let j = await r.json();
    check("GET / -> keep-alive JSON on the shared port", r.status === 200 && j.status === "ok" && j.bot === "MADEBYSSV#0000");

    r = await fetch(`${base}/api/health`);
    check("GET /api/health no key -> 401 (shared port)", r.status === 401);

    r = await fetch(`${base}/api/health`, { headers: { "X-Dashboard-Key": "wrong-key" } });
    check("GET /api/health wrong key -> 401 (shared port)", r.status === 401);

    r = await fetch(`${base}/api/health`, { headers: H });
    j = await r.json();
    check("GET /api/health with key -> 200 ok (shared port)", r.status === 200 && j.ok === true && j.bot === "MADEBYSSV");

    r = await fetch(`${base}/api/status`, { headers: H });
    j = await r.json();
    check("GET /api/status with key -> 200 tag/guilds/commands (shared port)", r.status === 200 && j.tag === "MADEBYSSV#0000" && j.guildCount === 1 && j.commands === 1 && j.lavalinkConnected === true);

    r = await fetch(`${base}/api/status`, { method: "OPTIONS", headers: { Origin: "https://example.com", "Access-Control-Request-Method": "GET" } });
    check("OPTIONS /api/status preflight -> 204 with CORS (shared port)", r.status === 204 && r.headers.get("access-control-allow-origin") === "*");

    r = await fetch(`${base}/api/nope`, { headers: H });
    check("GET unknown /api route -> 404 (shared port)", r.status === 404);

    // Disabled mode: /api/* must not leak the keep-alive JSON.
    process.env.DASHBOARD_ENABLED = "false";
    r = await fetch(`${base}/api/health`, { headers: H });
    check("GET /api/health when DASHBOARD_ENABLED=false -> 404 disabled", r.status === 404);
    r = await fetch(`${base}/`);
    j = await r.json();
    check("GET / still keep-alive JSON when dashboard disabled", r.status === 200 && j.status === "ok");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  console.log(`\ndashboard-shared-port-test: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
