// verdict.js — turns a "target vs actual" time difference into the
// early/on-time/late classification used in chat replies and the leaderboard.
const config = require('./config');
const { pickRoastLine } = require('./roastLines');

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
    return { status: 'early', emoji: '🟢', label: `early by ${Math.abs(diffMinutes)} min` };
  }
  return { status: 'on_time', emoji: '✅', label: 'on time' };
}

function formatClock(date) {
  return date.toLocaleString('en-US', {
    timeZone: config.timezone,
    hour: 'numeric',
    minute: '2-digit',
  });
}

// Builds the chat message posted right after someone joins voice with a
// pending plan. Once someone's late by config.roastThresholdMinutes or more,
// this swaps the plain "late by N min" phrasing for a random passive-
// aggressive line (see roastLines.js) as the headline - the exact label and
// said/joined clock times are kept too, just moved into a trailing
// parenthetical instead of being the whole message.
function buildVerdictMessage(verdict, { mention, targetTime, actualTime }) {
  const info = `said ${formatClock(targetTime)}, joined ${formatClock(actualTime)}`;
  if (verdict.status === 'late' && verdict.diffMinutes >= config.roastThresholdMinutes) {
    const roast = pickRoastLine(verdict.diffMinutes);
    return `${verdict.emoji} ${mention} ${roast} (**${verdict.label}** — ${info})`;
  }
  return `${verdict.emoji} ${mention} joined voice — **${verdict.label}** (${info})`;
}

module.exports = { classify, formatClock, buildVerdictMessage };
