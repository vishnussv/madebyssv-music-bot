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
    this.channel = { id: "ch1" };
    this.options = { getString: () => null, data: [] };
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
  async editReply() {
    if (!this.deferred && !this.replied) {
      throw new Error("InteractionNotReplied");
    }
    this.calls.push("editReply");
    return { id: "msg1" };
  }
  async followUp() {
    if (!this.deferred && !this.replied) {
      throw new Error("InteractionNotReplied");
    }
    this.calls.push("followUp");
    return { id: "msg2" };
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

  if (failures.length) {
    console.log(`\n${failures.length} test(s) failed`);
    process.exit(1);
  }
  console.log("\nAll interaction-defer tests passed");
})().catch((err) => {
  console.error("Test crashed:", err);
  process.exit(1);
});
