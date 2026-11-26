/**
 * Regression test for the /247 + /autoplay InteractionAlreadyReplied bug.
 *
 * Root cause: events/interactionCreate.js deferred EVERY slash command
 * with interaction.deferReply() before running it, but the Poru music
 * commands (commands/music/*) handle their own defer/reply lifecycle
 * and call interaction.reply() first. reply() on an already-deferred
 * interaction throws InteractionAlreadyReplied, so /247, /autoplay
 * (and every other music command that replies first) failed with the
 * generic "An error occurred while executing this command." reply.
 *
 * Fix: the handler skips its deferReply for __madebyssvPoruMusic
 * commands. Non-Poru commands still get the handler defer, because
 * their message adapter routes reply() -> editReply() when deferred.
 *
 * Run: node scripts/interaction-defer-test.js  (exit 0 = pass)
 */
"use strict";

const path = require("path");

// Stub the 24/7 DB model before the real /247 command loads it.
const modelPath = require.resolve(
  "../music/database/models/GuildTwentyFourSeven"
);
require.cache[modelPath] = {
  exports: {
    findOne: async () => null,
    upsert: async () => {},
    destroy: async () => {},
  },
};

const interactionCreate = require("../events/interactionCreate");
const cmd247 = require("../commands/music/247");
const cmdAutoplay = require("../commands/music/autoplay");
const cmdAfk = require("../commands/general/afk");
const cmdHug = require("../commands/fun/hug");

// /afk must opt out of the handler defer (see its noDefer comment): its
// first response is showModal() (/afk set) or interaction.reply()
// (status / remove / already-AFK set), both of which throw on an
// already-deferred interaction.
if (cmdAfk.noDefer !== true) {
  throw new Error("afk command must set noDefer: true");
}

// Keep the real /afk "set" flow side-effect free: no stored AFK record.
const Database = require("../database/Database");
if (Database && typeof Database.getAfk === "function") {
  Database.getAfk = () => null;
}

// CommandHandler marks every commands/music/* command with this flag.
cmd247.__madebyssvPoruMusic = true;
cmdAutoplay.__madebyssvPoruMusic = true;

function alreadyRepliedError() {
  const err = new Error(
    "The reply to this interaction has already been sent or deferred."
  );
  err.code = "InteractionAlreadyReplied";
  return err;
}

class FakeInteraction {
  constructor(commandName) {
    this.commandName = commandName;
    this.deferred = false;
    this.replied = false;
    this.calls = [];
    this.user = { id: "user1", username: "tester" };
    this.member = {
      permissions: { has: () => true },
      voice: { channel: { id: "vc1" } },
    };
    this.guild = { id: "guild1", channels: { cache: new Map() } };
    this.guildId = "guild1";
    this.channel = { id: "ch1" };
    this.options = {
      getString: () => null,
      getSubcommand: () => "set",
      data: [],
    };
  }
  isChatInputCommand() { return true; }
  isButton() { return false; }
  isModalSubmit() { return false; }
  isMessageComponent() { return false; }
  isAutocomplete() { return false; }
  async deferReply() {
    if (this.deferred || this.replied) throw alreadyRepliedError();
    this.deferred = true;
    this.calls.push("deferReply");
  }
  async reply() {
    if (this.deferred || this.replied) throw alreadyRepliedError();
    this.replied = true;
    this.calls.push("reply");
    return {
      id: "msg1",
      createMessageComponentCollector: () => ({ on: () => {} }),
    };
  }
  async editReply(payload) {
    if (!this.deferred && !this.replied) {
      throw new Error("InteractionNotReplied");
    }
    this.lastPayload = payload; this.calls.push("editReply");
    return { id: "msg1" };
  }
  async followUp() {
    if (!this.deferred && !this.replied) {
      throw new Error("InteractionNotReplied");
    }
    this.calls.push("followUp");
    return { id: "msg2" };
  }
  async showModal() {
    if (this.deferred || this.replied) throw alreadyRepliedError();
    this.calls.push("showModal");
  }
  async awaitModalSubmit() {
    // No modal submission in the test: the setup flow just ends.
    return null;
  }
  async fetchReply() {
    return { id: "msg1" };
  }
}

// A non-Poru command, using the message adapter like the other categories.
const fakePing = {
  name: "ping",
  async execute({ message }) {
    await message.reply({ content: "pong" });
  },
};

// A Poru-style command that defers itself first, like /play.
const fakePlayLike = {
  name: "playlike",
  __madebyssvPoruMusic: true,
  async execute(interaction) {
    await interaction.deferReply();
    await interaction.editReply({ content: "playing" });
  },
};

const failures = [];
function check(name, cond, detail) {
  if (cond) {
    console.log(`PASS ${name}`);
  } else {
    console.log(`FAIL ${name} — ${detail}`);
    failures.push(name);
  }
}

async function runCase(label, client, commandName, makeInteraction) {
  const interaction = makeInteraction();
  // Real discord.js interactions carry the client (interaction.client).
  interaction.client = client;
  const errors = [];
  const origError = console.error;
  console.error = (...args) => errors.push(args.join(" "));
  try {
    await interactionCreate.execute(client, interaction);
  } finally {
    console.error = origError;
  }
  return { interaction, errors };
}

(async () => {
  // 1. Real /247 through the real handler: must reply, not throw.
  {
    const client = {
      commands: new Map([["247", cmd247]]),
      poru: { players: new Map() },
    };
    const { interaction, errors } = await runCase(
      "/247", client, "247", () => new FakeInteraction("247")
    );
    check(
      "/247 replies without handler defer",
      interaction.calls.join(",") === "reply" && errors.length === 0,
      `calls=${interaction.calls.join(",")} errors=${errors.join(" | ")}`
    );
  }

  // 2. Real /autoplay (no player -> early "No music" reply at old line 25).
  {
    const client = {
      commands: new Map([["autoplay", cmdAutoplay]]),
      poru: { players: new Map() },
    };
    const { interaction, errors } = await runCase(
      "/autoplay", client, "autoplay", () => new FakeInteraction("autoplay")
    );
    check(
      "/autoplay replies without handler defer",
      interaction.calls.join(",") === "reply" && errors.length === 0,
      `calls=${interaction.calls.join(",")} errors=${errors.join(" | ")}`
    );
  }

  // 3. Poru command that defers itself (like /play): still works.
  {
    const client = {
      commands: new Map([["playlike", fakePlayLike]]),
      poru: { players: new Map() },
    };
    const { interaction, errors } = await runCase(
      "playlike", client, "playlike", () => new FakeInteraction("playlike")
    );
    check(
      "self-deferring music command works",
      interaction.calls.join(",") === "deferReply,editReply" && errors.length === 0,
      `calls=${interaction.calls.join(",")} errors=${errors.join(" | ")}`
    );
  }

  // 4. Non-Poru command: handler still defers, adapter routes to editReply.
  {
    const client = {
      commands: new Map([["ping", fakePing]]),
      poru: { players: new Map() },
    };
    const { interaction, errors } = await runCase(
      "ping", client, "ping", () => new FakeInteraction("ping")
    );
    check(
      "non-Poru command still gets handler defer + adapter editReply",
      interaction.calls.join(",") === "deferReply,editReply" && errors.length === 0,
      `calls=${interaction.calls.join(",")} errors=${errors.join(" | ")}`
    );
  }

  // 5. Real /afk set through the real handler: must reach showModal
  // without the handler deferring first.
  {
    const client = {
      commands: new Map([["afk", cmdAfk]]),
      poru: { players: new Map() },
    };
    const { interaction, errors } = await runCase(
      "/afk set", client, "afk", () => new FakeInteraction("afk")
    );
    check(
      "/afk set reaches showModal without handler defer",
      interaction.calls.join(",") === "showModal" && errors.length === 0,
      `calls=${interaction.calls.join(",")} errors=${errors.join(" | ")}`
    );
  }

  // 6. Control: the same /afk command WITHOUT noDefer must fail, proving
  // this test catches the bug if the flag is ever dropped.
  {
    const afkNoFlag = { ...cmdAfk };
    delete afkNoFlag.noDefer;
    const client = {
      commands: new Map([["afk", afkNoFlag]]),
      poru: { players: new Map() },
    };
    const { interaction, errors } = await runCase(
      "/afk set (no flag)", client, "afk", () => new FakeInteraction("afk")
    );
    check(
      "/afk set without noDefer fails as before (control)",
      interaction.calls.includes("deferReply") && errors.length > 0,
      `calls=${interaction.calls.join(",")} errors=${errors.join(" | ")}`
    );
  }

  {
  const client = {
    commands: new Map([["hug", cmdHug]]),
    emoji: { rightsort: "»", cross: "✕" },
    getColor: () => 0x00d4ff,
    util: { v2msg: (color, text) => ({ content: text }) },
  };
  const { interaction, errors } = await runCase("hug with user option", client, "hug", () => {
    const i = new FakeInteraction("hug");
    i.options.data = [{ name: "user", type: 6, value: "user2" }];
    i.options.getUser = () => ({ id: "user2", username: "friend" });
    i.options.getMember = () => ({ id: "user2", displayName: "Friend", user: { id: "user2", username: "friend" } });
    return i;
  });
  check(
    "hug with user option builds mentions and replies",
    interaction.calls.join(",") === "deferReply,editReply" &&
      errors.length === 0 &&
      JSON.stringify(interaction.lastPayload || {}).includes("Friend"),
    "calls=" + interaction.calls.join(",") + " errors=" + errors.join(" | ") + " payload=" + JSON.stringify(interaction.lastPayload)
  );
}

{
  const client = {
    commands: new Map([["hug", cmdHug]]),
    emoji: { rightsort: "»", cross: "✕" },
    getColor: () => 0x00d4ff,
    util: { v2msg: (color, text) => ({ content: text }) },
  };
  const { interaction, errors } = await runCase("hug without user option", client, "hug", () => {
    const i = new FakeInteraction("hug");
    i.options.data = [];
    return i;
  });
  check(
    "hug without user option asks to mention someone without crashing",
    interaction.calls.join(",") === "deferReply,editReply" &&
      errors.length === 0 &&
      JSON.stringify(interaction.lastPayload || {}).includes("Mention someone"),
    "calls=" + interaction.calls.join(",") + " errors=" + errors.join(" | ") + " payload=" + JSON.stringify(interaction.lastPayload)
  );
}

if (failures.length) {
    console.log(`\n${failures.length} test(s) failed`);
    process.exit(1);
  }
  console.log("\nAll interaction-defer tests passed");
})().catch((err) => {
  console.error("Test crashed:", err);
  process.exit(1);
});
