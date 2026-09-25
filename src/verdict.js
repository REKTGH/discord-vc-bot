// verdict.js — turns a "target vs actual" time difference into the
// early/on-time/late classification used in chat replies and the leaderboard.
const config = require('./config');
const { pickRoastLine, pickEarlyScoldLine } = require('./roastLines');

/**
 * @param {number} diffMs - actualJoinTime - targetTime, in milliseconds.
 *   Positive = joined after the stated time (late). Negative = early.
 */
function classify(diffMs) {
  const graceMs = config.gracePeriodMinutes * 60 * 1000;
  const diffMinutes = Math.round(diffMs / 60000);

  if (diffMs > graceMs) {
    // diffMinutes is exposed here (and only here) so callers can decide
    // whether someone's late enough to earn a roast line - see
    // buildVerdictMessage and config.roastThresholdMinutes below.
    return { status: 'late', emoji: '🔴', label: `late by ${diffMinutes} min`, diffMinutes };
  }
  if (diffMs < -graceMs) {
    // earlyMinutes mirrors diffMinutes above (always positive), so callers can
    // check how early someone was - see isEarlyScoldWorthy below.
    const earlyMinutes = Math.abs(diffMinutes);
    return { status: 'early', emoji: '🟢', label: `early by ${earlyMinutes} min`, earlyMinutes };
  }
  return { status: 'on_time', emoji: '✅', label: 'on time' };
}

// A Discord timestamp tag rather than a formatted string: each viewer's own
// Discord app renders it as a clock time in *their* timezone, so a plan read
// in New York and in Los Angeles shows the right local time to both.
function formatClock(date) {
  return `<t:${Math.floor(date.getTime() / 1000)}:t>`;
}

// Whether this verdict is late enough to earn a roast line rather than the
// plain phrasing. Exported (not just used internally by buildVerdictMessage
// below) because voiceHandler.js also needs this same check to decide where
// the message should be posted - see chooseVerdictRouting in voiceHandler.js.
function isRoastWorthy(verdict) {
  return verdict.status === 'late' && verdict.diffMinutes >= config.roastThresholdMinutes;
}

// The mirror image: turning up absurdly early is also a failure to keep to the
// time you yourself stated, so it earns a callout of its own rather than
// passing as a good deed. Same shape as isRoastWorthy so both can be treated
// as "this one deserves to be seen" by chooseVerdictRouting in voiceHandler.js.
function isEarlyScoldWorthy(verdict) {
  return verdict.status === 'early' && verdict.earlyMinutes >= config.earlyScoldThresholdMinutes;
}

// Whether a verdict is pointed enough that it should always be seen by the
// group, rather than being quietly redirected into a /log-here channel. Both
// the late roast and the early scold qualify - a callout nobody sees defeats
// the point of having one.
function isCalloutWorthy(verdict) {
  return isRoastWorthy(verdict) || isEarlyScoldWorthy(verdict);
}

// Builds the chat message posted right after someone joins voice with a
// pending plan. Once someone's late by config.roastThresholdMinutes or more,
// this swaps the plain "late by N min" phrasing for a random passive-
// aggressive line (see roastLines.js) as the headline - the exact label and
// said/joined clock times are kept too, just moved into a trailing
// parenthetical instead of being the whole message.
function buildVerdictMessage(verdict, { mention, targetTime, actualTime }) {
  const info = `said ${formatClock(targetTime)}, joined ${formatClock(actualTime)}`;
  if (isRoastWorthy(verdict)) {
    const roast = pickRoastLine(verdict.diffMinutes);
    return `${verdict.emoji} ${mention} ${roast} (**${verdict.label}** — ${info})`;
  }
  if (isEarlyScoldWorthy(verdict)) {
    const scold = pickEarlyScoldLine(verdict.earlyMinutes);
    return `${verdict.emoji} ${mention} ${scold} (**${verdict.label}** — ${info})`;
  }
  return `${verdict.emoji} ${mention} joined voice — **${verdict.label}** (${info})`;
}

module.exports = {
  classify,
  formatClock,
  isRoastWorthy,
  isEarlyScoldWorthy,
  isCalloutWorthy,
  buildVerdictMessage,
};
