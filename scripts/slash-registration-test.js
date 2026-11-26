// Slash registration test: proves the payload Discord will receive is
// valid — at most 100 chat-input commands, unique names, valid names and
// descriptions — so the "Invalid Form Body" failure of 2026-11-26 cannot
// recur. No Discord login, no network.
const assert = require("node:assert");
const path = require("path");
const { buildSlashData, SLASH_LIMIT } = require("../utils/buildSlashData");

const { slashData, skipped } = buildSlashData(
  path.join(__dirname, "../commands")
);

console.log(`slash to register: ${slashData.length} (limit ${SLASH_LIMIT})`);
console.log(`skipped: ${skipped.length}`);

assert.ok(
  slashData.length > 0 && slashData.length <= SLASH_LIMIT,
  `expected 1..${SLASH_LIMIT} slash commands, got ${slashData.length}`
);

const names = slashData.map((c) => c.name);
assert.strictEqual(
  new Set(names).size,
  names.length,
  "duplicate slash names in payload"
);

for (const cmd of slashData) {
  assert.match(cmd.name, /^[a-z0-9_-]{1,32}$/, `bad name: ${cmd.name}`);
  assert.strictEqual(cmd.type, 1, `not chat-input: ${cmd.name}`);
  assert.ok(
    cmd.description && cmd.description.length <= 100,
    `bad description: ${cmd.name}`
  );
  assert.ok(
    !cmd.options || cmd.options.length <= 25,
    `too many options: ${cmd.name}`
  );
}

// Music must all be in: this is a music bot.
for (const must of ["play", "pause", "skip", "queue", "nowplaying", "247", "lyrics", "volume", "seek", "loop", "shuffle"]) {
  assert.ok(names.includes(must), `missing core music slash: /${must}`);
}

console.log("slash commands:", names.join(", "));
console.log("skipped (prefix-only):", skipped.join(" | "));
console.log("PASS: slash payload is within Discord's 100-command limit, unique and valid.");
