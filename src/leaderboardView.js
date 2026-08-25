// leaderboardView.js — builds the leaderboard message payload. One shared
// place so /leaderboard, /leaderboard-here, and the live-updating message
// can't drift out of sync with each other.
//
// The table itself is rendered as a PNG (see leaderboardImage.js) and
// attached to the message; the embed just carries the title, the short
// "ranked latest to least late" description, and (for the live message) the
// auto-refresh footer, with the image slotted in via Discord's
// `attachment://` embed-image convention.
const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const config = require('./config');
const { getLeaderboard } = require('./db');
const { renderLeaderboardPng } = require('./leaderboardImage');
const { localYearMonth, localMonthRange } = require('./timeParser');

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function monthLabel({ year, month }) {
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

const IMAGE_FILENAME = 'leaderboard.png';

/**
 * @param {string} guildId
 * @param {object} opts
 * @param {boolean} opts.live - true for the auto-updating message, which gets
 *   a footer explaining it refreshes itself (a plain /leaderboard snapshot doesn't).
 * @param {'month'|'all'} opts.scope - 'month' (the default) counts only this
 *   calendar month, so the standings start fresh each month; 'all' counts
 *   everything ever recorded. Nothing is deleted either way - the monthly
 *   view just narrows what it reads.
 * @param {{year: number, month: number}|null} opts.yearMonth - which month to
 *   show when scope is 'month'. Defaults to the current one; passing it
 *   explicitly is what lets the live message keep rendering the month it was
 *   posted for, instead of silently jumping to the new one mid-refresh.
 * @returns {{embeds: EmbedBuilder[], files: AttachmentBuilder[]}} ready to
 *   spread into interaction.reply() / channel.send() / message.edit().
 */
function buildLeaderboardPayload(guildId, { live = false, scope = 'month', yearMonth = null } = {}) {
  const month = yearMonth || localYearMonth(new Date(), config.timezone);
  const monthly = scope !== 'all';
  const range = monthly ? localMonthRange(month, config.timezone) : null;
  const rows = getLeaderboard(guildId, 10, range);

  const title = monthly
    ? `⏱️ Punctuality Leaderboard — ${monthLabel(month)}`
    : '⏱️ Punctuality Leaderboard — All Time';
  const embed = new EmbedBuilder().setTitle(title).setColor(0x5865f2);
  const files = [];

  if (!rows.length) {
    embed.setDescription(
      monthly
        ? `Nothing tracked yet in ${monthLabel(month)}. Announce a plan in chat (like "joining at 9") and then ` +
          'join voice, and it\'ll start filling up. Past months are still available with `/leaderboard scope: All time`.'
        : 'No data yet! Once people announce plans in chat (like "joining at 9") and then join voice, punctuality will start showing up here.'
    );
  } else {
    embed
      .setDescription(monthly ? '*Ranked latest → least late — this month only*' : '*Ranked latest → least late — all time*')
      .setImage(`attachment://${IMAGE_FILENAME}`);
    const png = renderLeaderboardPng(rows);
    files.push(new AttachmentBuilder(png, { name: IMAGE_FILENAME }));
  }

  if (live) {
    embed
      .setFooter({
        text: monthly
          ? `Live — updates as people join voice. Resets at the start of each month.`
          : 'Live — updates automatically as people join voice chat.',
      })
      .setTimestamp();
  }

  return { embeds: [embed], files };
}

module.exports = { buildLeaderboardPayload };
