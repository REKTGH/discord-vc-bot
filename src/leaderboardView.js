// leaderboardView.js — builds the leaderboard embed. One shared place so
// /leaderboard, /leaderboard-here, and the live-updating message can't drift
// out of sync with each other.
const { EmbedBuilder } = require('discord.js');
const { getLeaderboard } = require('./db');

/**
 * @param {string} guildId
 * @param {object} opts
 * @param {boolean} opts.live - true for the auto-updating message, which gets
 *   a footer explaining it refreshes itself (a plain /leaderboard snapshot doesn't).
 */
function buildLeaderboardEmbed(guildId, { live = false } = {}) {
  const rows = getLeaderboard(guildId, 10);

  const embed = new EmbedBuilder().setTitle('⏱️ Voice Chat Punctuality Leaderboard').setColor(0x5865f2);

  if (!rows.length) {
    embed.setDescription(
      'No data yet! Once people announce plans in chat (like "joining at 9") and then join voice, punctuality will start showing up here.'
    );
  } else {
    const lines = rows.map((row, i) => {
      const pct = Math.round((row.onTimeCount / row.totalCount) * 100);
      const avgMin = Math.round(row.avgDiffSeconds / 60);
      const avgLabel = avgMin === 0 ? 'avg on time' : avgMin > 0 ? `avg ${avgMin}m late` : `avg ${Math.abs(avgMin)}m early`;  
      const medal = ['🥇', '🥈', '🥉'][i] || `${i + 1}.`;
      const noShowLabel = row.noShowCount > 0 ? `, 👻 ${row.noShowCount} no-show${row.noShowCount === 1 ? '' : 's'}` : '';
      return `${i + 1}. **${row.username}** — ${avgLabel} (${pct}% on-time, ${row.totalCount} tracked${noShowLabel})`;
    });
    embed.setDescription(`*Ranked latest → least late*\n${lines.join('\n')}`);
  }

  if (live) {
    embed.setFooter({ text: 'Live — updates automatically as people join voice chat.' }).setTimestamp();
  }

  return embed;
}

module.exports = { buildLeaderboardEmbed };
