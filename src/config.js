// config.js — all the knobs live here, read from environment variables
// (set in your .env file). Nothing else in the project should read
// process.env directly, so this is the one place to look when tuning behavior.
require('dotenv').config();

function parseIntEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

const config = {
  token: process.env.DISCORD_TOKEN,

  // IANA timezone used to interpret "at 9pm" style messages and to display
  // times back to the channel. One timezone for the whole bot/server — good
  // enough for a friend group in one place; see README for how to change it.
  timezone: process.env.BOT_TIMEZONE || 'America/Los_Angeles',

  // +/- this many minutes counts as "on time" rather than early/late.
  gracePeriodMinutes: parseIntEnv('GRACE_PERIOD_MINUTES', 2),

  // Minutes late (or more) before the voice-join reply swaps its plain
  // "late by N min" text for a random passive-aggressive line instead (see
  // src/roastLines.js). The exact lateness/times are kept either way, just
  // moved into a parenthetical once the roast takes over as the headline.
  roastThresholdMinutes: parseIntEnv('ROAST_THRESHOLD_MINUTES', 30),

  // A stated plan (e.g. "joining at 9") is marked a no-show if the person
  // hasn't joined voice within this many hours *after* their stated time.
  // Also keeps old/stale plans from matching a join that happens much later
  // for an unrelated reason.
  planExpiryHours: parseIntEnv('PLAN_EXPIRY_HOURS', 12),

  // How far ahead a stated time is allowed to be before the bot decides it
  // is not a "joining soon" plan at all and ignores it. This is the parsing
  // limit, not the no-show limit: "vc in 20 hours" past this is treated as
  // an unrelated mention of a number, not a plan. Raise it if your group
  // genuinely announces plans further out than this.
  maxFutureHours: parseIntEnv('MAX_FUTURE_HOURS', 12),

  // Minutes early (or more) before the voice-join reply calls someone out
  // for turning up absurdly early, the mirror image of roastThresholdMinutes
  // below. Showing up an hour before you said you would is its own kind of
  // not-keeping-your-word, so it gets its own line pool (src/roastLines.js).
  earlyScoldThresholdMinutes: parseIntEnv('EARLY_SCOLD_THRESHOLD_MINUTES', 60),

  // Optional: restrict message scanning to specific text channels.
  // Comma-separated channel IDs. Leave blank in .env to scan every channel.
  allowedChannelIds: (process.env.ALLOWED_CHANNEL_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  // JSON file used for leaderboard history. Kept relative to the project
  // root so it works the same locally and on most hosts.
  dbPath: process.env.DB_PATH || require('path').join(__dirname, '..', 'data', 'results.json'),

  // JSON file that remembers which channel+message holds each server's live,
  // always-updated leaderboard (set via /leaderboard-here). Separate from
  // dbPath on purpose, so this never risks touching the results data format.
  liveLeaderboardPath:
    process.env.LIVE_LEADERBOARD_PATH || require('path').join(__dirname, '..', 'data', 'live-leaderboard.json'),

  // JSON file that remembers which channel holds each server's voice-join
  // log (set via /log-here). Separate file for the same reason as above.
  logChannelPath: process.env.LOG_CHANNEL_PATH || require('path').join(__dirname, '..', 'data', 'log-channel.json'),

  // JSON file that remembers which channel gets each server's automatic
  // monthly awards post (set via /awards-here), and which month was last
  // announced there. Separate file for the same reason as above.
  awardsChannelPath:
    process.env.AWARDS_CHANNEL_PATH || require('path').join(__dirname, '..', 'data', 'awards-channel.json'),
};

module.exports = config;
