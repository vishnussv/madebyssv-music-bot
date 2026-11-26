// Load test: requires handlers/CommandHandler with a fake client and prints
// loaded command count + slash-command count. No Discord login, no network.
const { loadCommands } = require("../handlers/CommandHandler");

const client = { commands: new Map(), aliases: new Map() };
loadCommands(client);

let slash = 0;
const byCategory = {};
for (const cmd of client.commands.values()) {
  if (cmd.data && typeof cmd.data.toJSON === "function") slash++;
  const cat = cmd.category || "uncategorised";
  byCategory[cat] = (byCategory[cat] || 0) + 1;
}

console.log(`commands loaded: ${client.commands.size}`);
console.log(`aliases loaded: ${client.aliases.size}`);
console.log(`slash commands (with .data): ${slash}`);
console.log("by category:", JSON.stringify(byCategory, null, 2));

// Also verify config loads cleanly with env set, and owner gating refuses
// when MAIN_OWNER_ID is unset.
const config = require("../config");
console.log(`config.prefix: ${JSON.stringify(config.prefix)}`);
console.log(`config.mainOwnerId set: ${Boolean(config.mainOwnerId)}`);
console.log(`config.ownerIds: ${JSON.stringify(config.ownerIds)}`);
console.log(`config.token set: ${Boolean(config.token)}`);
console.log(`config.lavalink: ${JSON.stringify({ host: config.lavalink.host, port: config.lavalink.port, secureMode: config.lavalink.secureMode, passwordSet: Boolean(config.lavalink.password) })}`);

const { isMainOwner, isOwner } = require("../utils/OwnerAccess");
console.log(`isMainOwner("123456789012345678") with MAIN_OWNER_ID unset: ${isMainOwner("123456789012345678")}`);
console.log(`isOwner("123456789012345678") with MAIN_OWNER_ID unset: ${isOwner("123456789012345678")}`);
