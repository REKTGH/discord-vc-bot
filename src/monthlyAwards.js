// monthlyAwards.js — the automatic monthly "awards" post: whoever was late
// the most times, whoever racked up the most total minutes late, and
// whoever cancelled ("nevermind"/"nvm") the most, each as their own
// independent winner. Deliberately separate from /leaderboard's ranking
// (which sorts by average lateness across all time) - this is about raw
// monthly totals instead, reset every calendar month.
//
// Posted automatically once a month, in whichever channel a server sets up
// with /awards-here - see checkAndAnnounceAll(), called on a timer from
// index.js the same way noShowHandler.js's check is.
const { EmbedBuilder } = require('discord.js');
const config = require('./config');
const { getMonthlyAwards } = require('./db');
const { localYearMonth, localMonthStartUTC } = require('./timeParser');
const awardsChannelStore = require('./awardsChannelStore');

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// "Right now," as a calendar { year, month } in BOT_TIMEZONE.
function currentYearMonth() {
  return localYearMonth(new Date(), config.timezone);
}

function previousCalendarMonth({ year, month }) {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

function nextCalendarMonth({ year, month }) {
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}

// A sortable/comparable "YYYY-MM" string - used as the stored marker for
// "which month did we last announce" (see awardsChannelStore.js).
function monthKey({ year, month }) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function monthLabel({ year, month }) {
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

// "6" cancellations/late joins -> "6x" - same shorthand convention as the
// main leaderboard's Late/Cancels columns.
function formatCount(n) {
  return `${n}x`;
}

function formatTotalLateDuration(totalSeconds) {
  const totalMinutes = Math.round(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes} min. total`;
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  return mins === 0 ? `${hours} hr total` : `${hours} hr ${mins} min. total`;
}

function awardLine(emoji, label, winner, formatValue, emptyText) {
  return winner ? `${emoji} **${label}:** ${winner.username} — ${formatValue(winner.value)}` : `${emoji} **${label}:** ${emptyText}`;
}

/**
 * @param {string} guildId
 * @param {{year: number, month: number}} yearMonth - 1-indexed month, the one being awarded
 */
function buildMonthlyAwardsEmbed(guildId, yearMonth) {
  const next = nextCalendarMonth(yearMonth);
  const startMs = localMonthStartUTC(yearMonth.year, yearMonth.month, config.timezone);
  const endMs = localMonthStartUTC(next.year, next.month, config.timezone);
  const awards = getMonthlyAwards(guildId, { startMs, endMs });

  const embed = new EmbedBuilder().setTitle(`🏆 ${monthLabel(yearMonth)} Awards 🏆`).setColor(0xf1c40f);

  // Deliberately checked against totalRecords, not "did any category have a
  // winner" - a month where everyone was perfectly on time and nobody
  // cancelled has real records but zero winners, and that's a good month
  // worth celebrating (see the per-category empty text below), not an empty
  // one. Only a guild with literally nothing tracked gets this fallback.
  if (awards.totalRecords === 0) {
    embed.setDescription('No tracked activity that month — nothing to award.');
    return embed;
  }

  embed.setDescription(
    [
      awardLine('⏰', 'Most Late', awards.mostLate, formatCount, 'Nobody was late! 🎉'),
      awardLine('⏱️', 'Most Time Late', awards.mostTimeLate, formatTotalLateDuration, 'Nobody racked up late minutes! 🎉'),
      awardLine('🚫', 'Most Cancels', awards.mostCancels, formatCount, 'Nobody cancelled! 🎉'),
    ].join('\n')
  );
  return embed;
}

// Called on a timer from index.js. For every guild that's set up
// /awards-here, checks whether the calendar month (in BOT_TIMEZONE) has
// rolled over since the last announcement there, and if so posts the month
// that just ended, exactly once. A no-op for any guild that's already
// caught up, so it's safe to call as often as you like.
async function checkAndAnnounceAll(client) {
  for (const guild of client.guilds.cache.values()) {
    await checkAndAnnounceForGuild(client, guild.id).catch((err) =>
      console.warn(`Could not check/announce monthly awards for guild ${guild.id}:`, err.message)
    );
  }
}

async function checkAndAnnounceForGuild(client, guildId) {
  const tracked = awardsChannelStore.get(guildId);
  if (!tracked || !tracked.channelId) return;

  const currentKey = monthKey(currentYearMonth());
  if (tracked.lastAnnouncedMonth === currentKey) return; // already caught up

  const channel = await client.channels.fetch(tracked.channelId).catch(() => null);
  if (channel && channel.isTextBased()) {
    const embed = buildMonthlyAwardsEmbed(guildId, previousCalendarMonth(currentYearMonth()));
    await channel.send({ embeds: [embed] }).catch((err) => console.warn(`Could not post monthly awards for guild ${guildId}:`, err.message));
  }
  // Advance regardless of whether the post above succeeded (e.g. the channel
  // got deleted meanwhile) - otherwise one failure would retry forever
  // instead of just missing a single month, the same "best effort" tradeoff
  // the rest of this bot already makes (see noShowHandler.js).
  awardsChannelStore.set(guildId, { lastAnnouncedMonth: currentKey });
}

module.exports = {
  currentYearMonth,
  previousCalendarMonth,
  nextCalendarMonth,
  monthKey,
  monthLabel,
  formatTotalLateDuration,
  buildMonthlyAwardsEmbed,
  checkAndAnnounceAll,
  checkAndAnnounceForGuild,
};
