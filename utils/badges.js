// ── Central Badge Registry ────────────────────────────────────────────────────
// Each badge: label, emoji (Discord custom emoji format), color, description
// All static badges are owner-granted. Custom badges are stored in DB.

const BADGES = {
  owner:      { label: "MADEBYSSV Owner",     emoji: "<:AlexaCrown:1543432949796704266>",          color: "#FFD700", description: "Owner of MADEBYSSV Bot" },
  developer:  { label: "MADEBYSSV Developer", emoji: "<:AlexDev:1543454890288873544>", color: "#00BFFF", description: "Member of the MADEBYSSV development team" },
  staff:      { label: "MADEBYSSV Staff",     emoji: "<:AlexaStaff:1543454950418555021>",           color: "#4169E1", description: "Official MADEBYSSV staff member" },
  premium:    { label: "Premium",         emoji: "<:Premium:1543453885149093898>",     color: "#A855F7", description: "MADEBYSSV Premium subscriber" },
  supporter:  { label: "Supporter",       emoji: "<:Alexasupporter:1543455077036064888>",       color: "#EC4899", description: "Supports MADEBYSSV's development" },
  partner:    { label: "Partner",         emoji: "<:AlexaPartner:1543455210943291492>",       color: "#06B6D4", description: "Official MADEBYSSV Partner" },
  vip:        { label: "VIP",             emoji: "<:VIP:1543454438151299193>",             color: "#F97316", description: "Very Important Person" },
  verified:   { label: "Verified",        emoji: "<:AlexaVerified:1543455282749775922>",         color: "#10B981", description: "Verified by the MADEBYSSV team" },
  tester:     { label: "Beta Tester",     emoji: "<:AlexaBetaTester:1543455393488052236>",          color: "#84CC16", description: "Helped test MADEBYSSV's features" },
  bug_hunter: { label: "Bug Hunter",      emoji: "<:AlexaBughunter:1543455512186585169>",          color: "#EF4444", description: "Found & reported bugs that improved MADEBYSSV" },
  og:         { label: "OG User",         emoji: "<:ogusers:1543454810685050971>",         color: "#F59E0B", description: "One of MADEBYSSV's earliest users" },
};

/** Merge static BADGES with custom badges stored in DB */
function getAllBadges() {
  try {
    const Database = require("../database/Database");
    const custom = Database.getCustomBadges();
    return { ...BADGES, ...custom };
  } catch {
    return { ...BADGES };
  }
}

/** Get a formatted badge string: emoji + label */
function formatBadge(key) {
  const all = getAllBadges();
  const b = all[key];
  return b ? `${b.emoji} **${b.label}**` : null;
}

/** Get all static badge keys */
function allBadgeKeys() {
  return Object.keys(BADGES);
}

/** Get all badge keys including custom ones */
function allBadgeKeysAll() {
  return Object.keys(getAllBadges());
}

module.exports = { BADGES, getAllBadges, formatBadge, allBadgeKeys, allBadgeKeysAll };
