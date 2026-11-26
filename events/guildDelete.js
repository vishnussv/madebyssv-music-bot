const { AuditLogEvent, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { V2Builder } = require("../utils/V2Builder");
const { BTN } = require("../utils/emojis");
const WebhookLogger = require("../logger/WebhookLogger");
const config = require("../config");

const BANNER  = "https://cdn.discordapp.com/attachments/1505512336394420254/1505600691920441495/file_00000000d3d07206ad99a07a64200c87.png?ex=6a0b3769&is=6a09e5e9&hm=464fda8592131557f4d8ae94f6ac3b7943da26b58c34c85a14d21b2d7146bb1d&";
const INVITE  = "https://discord.com/oauth2/authorize?client_id=1539476447012585522&permissions=8&integration_type=0&scope=bot";
const SUPPORT = "https://discord.gg/RkPfcY6aQk";
const WEBSITE = config.website || "https://alexabot.vercel.app";

function buildLeavePayload(guildName, memberCount) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel("Re-invite MADEBYSSV")
      .setURL(INVITE)
      .setStyle(ButtonStyle.Link)
      .setEmoji(BTN.link_invite),
    new ButtonBuilder()
      .setLabel("Support Server")
      .setURL(SUPPORT)
      .setStyle(ButtonStyle.Link)
      .setEmoji(BTN.link_support),
    new ButtonBuilder()
      .setLabel("Website")
      .setURL(WEBSITE)
      .setStyle(ButtonStyle.Link)
      .setEmoji(BTN.link_website),
  );

  const text =
    `#  __ MADEBYSSV Has Been Removed__\n\n`
    + `  **Server:** ${guildName} (\`${memberCount}\`)\n\n`
    + `  __**We'd Love to Know Why**__\n`
    + `> Had an issue? Our support team can resolve it quickly.\n`
    + `> Something wasn't working? Let us know and we'll fix it.\n`
    + `> Missing a feature? Drop a suggestion — we're always improving.\n`
    + `> Changed your mind? You're always welcome to add us back.\n\n`
    + `  **Re-invite MADEBYSSV:** [Click Here](${INVITE})\n`
    + ` **Get Support:** [Join our server](${SUPPORT})`;

  return new V2Builder()
    .text(text)
    .sep()
    .media(BANNER)
    .sep()
    .row(row)
    .build();
}

module.exports = {
  name: "guildDelete",
  once: false,
  async execute(client, guild) {
    console.log(`[Guild] Left: ${guild.name} (${guild.id})`);
    WebhookLogger.guildLeave(guild.name, guild.id);

    const memberCount = guild.memberCount ?? "Unknown";
    const payload     = buildLeavePayload(guild.name, memberCount);

    // Try to find who kicked/removed the bot from the audit log
    let remover = null;
    try {
      const kickLogs = await guild.fetchAuditLogs({ type: AuditLogEvent.MemberKick, limit: 10 });
      const entry    = kickLogs.entries.find(e => e.target?.id === client.user.id);
      if (entry) remover = entry.executor;
    } catch {}

    // DM remover first (if different from owner)
    if (remover && remover.id !== guild.ownerId) {
      await remover.send(payload).catch(() => {});
    }

    // Always DM the server owner
    const owner = await client.users.fetch(guild.ownerId).catch(() => null);
    if (owner) {
      await owner.send(payload).catch(() => {});
    }
  },
};
