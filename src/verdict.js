// verdict.js — turns a "target vs actual" time difference into the
// early/on-time/late classification used in chat replies and the leaderboard.
const config = require('./config');

/**
 * @param {number} diffMs - actualJoinTime - targetTime, in milliseconds.
 *   Positive = joined after the stated time (late). Negative = early.
 */
function classify(diffMs) {
  const graceMs = config.gracePeriodMinutes * 60 * 1000;
  const diffMinutes = Math.round(diffMs / 60000);

  if (diffMs > graceMs) {
    return { status: 'late', emoji: '🔴', label: `late by ${diffMinutes} min` };
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

module.exports = { classify, formatClock };
