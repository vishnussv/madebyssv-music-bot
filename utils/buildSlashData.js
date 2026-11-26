// Build the global slash-command payload.
// Discord allows at most 100 global chat-input commands per application.
// This bot has 145 unique slash names, so registering all of them made
// Discord reject the WHOLE batch with "Invalid Form Body" and 0 commands
// showed up in Discord (2026-11-26). This builder dedupes by name,
// validates each payload, and caps the batch at 100 in priority order
// (music first). The rest stay available as + prefix commands.
const fs = require("fs");
const path = require("path");

const SLASH_LIMIT = 100;

const SLASH_PRIORITY = [
  "music",
  "playlist",
  "filter",
  "voice",
  "fun",
  "information",
  "moderation",
  "customize",
  "general",
  "settings",
  "security",
];

// The last slots (after the 93 music/fun/info/mod/customize commands) go
// to the most-used public commands first, not to whichever owner command
// sorts first alphabetically.
const FILL_FIRST = [
  "stats",
  "support",
  "vote",
  "website",
  "leaderboard",
  "profile",
  "afk",
];

function buildSlashData(commandsPath) {
  const slashData = [];
  const skipped = [];
  const seenNames = new Set();

  const allCategories = fs
    .readdirSync(commandsPath)
    .filter((name) =>
      fs.statSync(path.join(commandsPath, name)).isDirectory()
    );
  const orderedCategories = [
    ...SLASH_PRIORITY.filter((c) => allCategories.includes(c)),
    ...allCategories.filter((c) => !SLASH_PRIORITY.includes(c)),
  ];

  for (const category of orderedCategories) {
    const categoryPath = path.join(commandsPath, category);
    const files = fs
      .readdirSync(categoryPath)
      .filter((file) => file.endsWith(".js"))
      .sort((a, b) => {
        const ra = FILL_FIRST.indexOf(a.replace(/\.js$/, ""));
        const rb = FILL_FIRST.indexOf(b.replace(/\.js$/, ""));
        if (ra === -1 && rb === -1) return a.localeCompare(b);
        if (ra === -1) return 1;
        if (rb === -1) return -1;
        return ra - rb;
      });

    for (const file of files) {
      try {
        const command = require(path.join(categoryPath, file));

        if (!command.data || typeof command.data.toJSON !== "function") {
          continue;
        }

        const json = command.data.toJSON();

        if (json.type !== 1) {
          skipped.push(
            `${json.name} (${category}/${file}): not a chat-input command`
          );
          continue;
        }

        if (seenNames.has(json.name)) {
          skipped.push(
            `${json.name} (${category}/${file}): duplicate name, first copy kept`
          );
          continue;
        }

        if (!/^[a-z0-9_-]{1,32}$/.test(json.name)) {
          skipped.push(
            `${json.name} (${category}/${file}): invalid slash name`
          );
          continue;
        }

        if (!json.description || json.description.length > 100) {
          skipped.push(
            `${json.name} (${category}/${file}): description missing or over 100 chars`
          );
          continue;
        }

        if (json.options && json.options.length > 25) {
          skipped.push(
            `${json.name} (${category}/${file}): over 25 options`
          );
          continue;
        }

        seenNames.add(json.name);

        if (slashData.length >= SLASH_LIMIT) {
          skipped.push(
            `${json.name} (${category}/${file}): over the 100 global slash limit, prefix-only`
          );
          continue;
        }

        slashData.push(json);
      } catch (err) {
        skipped.push(
          `${category}/${file}: failed to load (${err.message})`
        );
      }
    }
  }

  return { slashData, skipped, limit: SLASH_LIMIT };
}

module.exports = { buildSlashData, SLASH_LIMIT };
