const {
  Collection,
  MessageFlags
} = require("discord.js");

const VoiceMasterInteractions = require("../utils/VoiceMasterInteractions");

module.exports = {
  name: "interactionCreate",

  async execute(client, interaction) {
    try {
      // VoiceMaster buttons + modals
      if (
        (interaction.isButton() || interaction.isModalSubmit()) &&
        typeof interaction.customId === "string" &&
        (interaction.customId.startsWith("vm:") || interaction.customId.startsWith("vm_modal:"))
      ) {
        return VoiceMasterInteractions.handle(client, interaction);
      }

      /*
       * ============================================================
       * COMPONENT INTERACTIONS
       * ============================================================
       *
       * Help system ke interactions:
       * alexa_help:...
       *
       * Inko yahan handle MAT karo.
       * events/helpInteractions.js inhe handle karega.
       */
      if (interaction.isMessageComponent()) {
        if (
          typeof interaction.customId === "string" &&
          interaction.customId.startsWith("alexa_help:")
        ) {
          return;
        }
      }

      /*
       * ============================================================
       * AUTOCOMPLETE
       * ============================================================
       */
      if (interaction.isAutocomplete()) {
        const commandName = interaction.commandName;

        const command = client.commands?.get(commandName);

        if (!command) {
          try {
            return await interaction.respond([]);
          } catch {
            return;
          }
        }

        if (typeof command.autocomplete !== "function") {
          try {
            return await interaction.respond([]);
          } catch {
            return;
          }
        }

        try {
          if (command.__madebyssvPoruMusic) {
            return await command.autocomplete(interaction);
          }
          return await command.autocomplete({
            client,
            interaction
          });
        } catch (error) {
          console.error(
            `[Autocomplete] ${commandName}`,
            error
          );

          try {
            if (!interaction.responded) {
              await interaction.respond([]);
            }
          } catch {}

          return;
        }
      }

      /*
       * ============================================================
       * SLASH COMMANDS
       * ============================================================
       */
      if (interaction.isChatInputCommand()) {
        const commandName = interaction.commandName;

        const command = client.commands?.get(commandName);

        if (!command) {
          console.warn(
            `[Interaction] Slash command not found: /${commandName}`
          );

          if (!interaction.replied && !interaction.deferred) {
            try {
              await interaction.reply({
                content: "This command is no longer available.",
                flags: MessageFlags.Ephemeral

              });
            } catch {}
          }

          return;
        }

        /*
         * ----------------------------------------------------------
         * HELP COMMAND
         * ----------------------------------------------------------
         *
         * Help V2 message ko directly reply karega.
         * Isliye yahan deferReply nahi karna.
         *
         * Poru music commands (commands/music/*) bhi yahan defer
         * nahi karte: wo real Interaction object lete hain aur apna
         * khud ka defer/reply lifecycle handle karte hain (neeche
         * execute section dekho). Yahan defer karne se unka
         * interaction.reply() InteractionAlreadyReplied se fail
         * hota hai — /247 aur /autoplay isi liye error de rahe the.
         * Baaki (non-Poru) commands ke liye defer yahin hota hai,
         * kyunki unka message adapter deferred state ko khud
         * handle karta hai.
         */
        const isHelpCommand =
          commandName === "help" ||
          command.name === "help";

        if (!isHelpCommand && !command.noDefer && !command.__madebyssvPoruMusic) {
          try {
            await interaction.deferReply();
          } catch (error) {
            console.error(
              `[Interaction] Failed to defer /${commandName}`,
              error
            );

            return;
          }
        }

        /*
         * ----------------------------------------------------------
         * SLASH OPTIONS -> ARGS
         * ----------------------------------------------------------
         */
        let args = [];

        try {
          if (typeof command.getSlashArgs === "function") {
            args = await command.getSlashArgs(interaction);
          } else {
            args = buildSlashArgs(interaction);
          }
        } catch (error) {
          console.error(
            `[Interaction] Failed to build args for /${commandName}`,
            error
          );

          args = buildSlashArgs(interaction);
        }

        /*
         * ----------------------------------------------------------
         * EXECUTE
         * ----------------------------------------------------------
         */
        try {
          if (command.__madebyssvPoruMusic) {
            // LEO/AeroX music commands expect the real Interaction object.
            // They handle their own defer/reply lifecycle.
            await command.execute(interaction);
          } else {
            const message = createInteractionMessage(
              client,
              interaction,
              args
            );

            await command.execute({
              client,
              message,
              args,
              interaction
            });
          }
        } catch (error) {
          console.error(
            `[Interaction] /${commandName}`,
            error
          );

          await handleInteractionError(
            interaction,
            error
          );
        }

        return;
      }

      /*
       * ============================================================
       * BUTTONS / SELECT MENUS / OTHER COMPONENTS
       * ============================================================
       *
       * Help ke alawa baaki component interactions yahan aa sakte hain.
       * Agar kisi command/event ne custom interaction handler banaya
       * hua hai to usko apne event file se handle karne diya jayega.
       */
      if (interaction.isButton()) {
        return;
      }

      if (interaction.isStringSelectMenu()) {
        return;
      }

      if (interaction.isUserSelectMenu()) {
        return;
      }

      if (interaction.isRoleSelectMenu()) {
        return;
      }

      if (interaction.isChannelSelectMenu()) {
        return;
      }

      if (interaction.isMentionableSelectMenu()) {
        return;
      }
    } catch (error) {
      console.error(
        "[InteractionCreate] Unhandled error:",
        error
      );

      await handleInteractionError(
        interaction,
        error
      );
    }
  }
};


/* =================================================================
 * SLASH ARG BUILDER
 * ================================================================= */

function buildSlashArgs(interaction) {
  const args = [];

  if (!interaction.options) {
    return args;
  }

  for (const option of interaction.options.data ?? []) {
    if (!option) continue;

    /*
     * Nested subcommand/group handling
     */
    if (
      option.type === 1 ||
      option.type === 2
    ) {
      continue;
    }

    if (
      option.value !== undefined &&
      option.value !== null
    ) {
      args.push(String(option.value));
    }
  }

  return args;
}


/* =================================================================
 * INTERACTION MESSAGE ADAPTER
 * ================================================================= */

function createInteractionMessage(
  client,
  interaction,
  args
) {
  const author = interaction.user;

  const message = {
    id: interaction.id,

    interaction,

    client,

    author,

    user: author,

    member: interaction.member,

    guild: interaction.guild,

    guildId: interaction.guildId,

    channel: interaction.channel,

    channelId: interaction.channelId,

    args,

    content:
      interaction.commandName
        ? `/${interaction.commandName}${args.length ? ` ${args.join(" ")}` : ""}`
        : "",

    createdTimestamp: Date.now(),
    /*
     * --------------------------------------------------------------
     * mentions
     * --------------------------------------------------------------
     *
     * Slash commands have no Message.mentions: prefix commands read
     * message.mentions.members / .users / .roles / .channels, and the
     * adapter used to leave mentions undefined, so EVERY such command
     * crashed on slash with:
     *   TypeError: Cannot read properties of undefined
     *     (reading 'members')
     * e.g. /hug in the live Railway logs at 2026-11-26 10:05:20 PST,
     * and the same crash in /pat, /slap, /avatar, /ship, /kick,
     * /ban, /mute, /warn, /lock, /unlock, /roleinfo, /channelinfo
     * and more. Build the same shape from the interaction's
     * resolved options so all of them work unchanged.
     */
    mentions: buildInteractionMentions(interaction),

    /*
     * --------------------------------------------------------------
     * reply()
     * --------------------------------------------------------------
     */
    reply: async (payload) => {
      if (
        interaction.replied ||
        interaction.deferred
      ) {
        return interaction.editReply(payload);
      }

      return interaction.reply(payload);
    },

    /*
     * --------------------------------------------------------------
     * editReply()
     * --------------------------------------------------------------
     */
    editReply: async (payload) => {
      return interaction.editReply(payload);
    },

    /*
     * --------------------------------------------------------------
     * followUp()
     * --------------------------------------------------------------
     */
    followUp: async (payload) => {
      return interaction.followUp(payload);
    },

    /*
     * --------------------------------------------------------------
     * react()
     * --------------------------------------------------------------
     */
    react: async (...args) => {
      if (
        interaction.message &&
        typeof interaction.message.react === "function"
      ) {
        return interaction.message.react(...args);
      }

      return null;
    },

    /*
     * --------------------------------------------------------------
     * delete()
     * --------------------------------------------------------------
     */
    delete: async () => {
      if (
        interaction.message &&
        typeof interaction.message.delete === "function"
      ) {
        return interaction.message.delete();
      }

      if (
        interaction.replied ||
        interaction.deferred
      ) {
        return interaction.deleteReply();
      }

      return null;
    }
  };

  return message;
}


/* =================================================================
 * INTERACTION MENTIONS
 * =================================================================
 *
 * Build a Message.mentions-shaped object for the adapter from the
 * slash interaction's resolved options, so prefix-style commands
 * keep working unchanged when run as slash commands.
 *
 * - members / users: discord.js Collections, so .first(), .size,
 *   .values(), .keys() and .has(id) all behave like the real thing.
 *   Insertion order follows the slash options' order, so /ship's
 *   [...members.values()][1] still means "the second user".
 * - roles / channels: same, from role / channel options.
 * - everyone: slash commands never mention @everyone here.
 *
 * If an option cannot be resolved (member left, uncached), that
 * entry is simply absent and the command falls back to its own
 * "mention someone" reply instead of crashing.
 */
function buildInteractionMentions(interaction) {
  const users = new Collection();
  const members = new Collection();
  const roles = new Collection();
  const channels = new Collection();

  const options = interaction.options;

  if (options && Array.isArray(options.data)) {
    const walk = (opts) => {
      for (const opt of opts ?? []) {
        if (!opt) continue;

        // Subcommand / subcommand group: recurse into its options.
        if (opt.type === 1 || opt.type === 2) {
          walk(opt.options);
          continue;
        }

        try {
          if (opt.type === 6) {
            // User option.
            const user = options.getUser?.(opt.name) ?? null;
            if (user) users.set(user.id, user);

            let member = null;
            try {
              member = options.getMember?.(opt.name) ?? null;
            } catch {}
            if (
              !member &&
              user &&
              interaction.guild?.members?.cache
            ) {
              member =
                interaction.guild.members.cache.get(user.id) ?? null;
            }
            if (member) members.set(member.id, member);
          } else if (opt.type === 8) {
            // Role option.
            const role = options.getRole?.(opt.name) ?? null;
            if (role) roles.set(role.id, role);
          } else if (opt.type === 7) {
            // Channel option.
            const channel = options.getChannel?.(opt.name) ?? null;
            if (channel) channels.set(channel.id, channel);
          } else if (opt.type === 9) {
            // Mentionable option: a User or a Role.
            const mentionable =
              options.getMentionable?.(opt.name) ?? null;
            if (mentionable) {
              if (mentionable.user) {
                users.set(mentionable.user.id, mentionable.user);
                const member =
                  interaction.guild?.members?.cache?.get(
                    mentionable.user.id
                  ) ?? null;
                if (member) members.set(member.id, member);
              } else {
                roles.set(mentionable.id, mentionable);
              }
            }
          }
        } catch {}
      }
    };

    walk(options.data);
  }

  return {
    members,
    users,
    roles,
    channels,
    everyone: false,
    repliedUser: null,
  };
}

/* =================================================================
 * ERROR HANDLER
 * ================================================================= */

async function handleInteractionError(
  interaction,
  error
) {
  const errorMessage =
    "An error occurred while executing this command.";

  console.error(error);

  try {
    /*
     * Already acknowledged
     */
    if (
      interaction.deferred ||
      interaction.replied
    ) {
      await interaction.editReply({
        content: errorMessage
      });

      return;
    }

    /*
     * Not acknowledged yet
     */
    await interaction.reply({
      content: errorMessage,
      flags: MessageFlags.Ephemeral
    });
  } catch (replyError) {
    console.error(
      "[InteractionCreate] Failed to send error response:",
      replyError
    );
  }
}
