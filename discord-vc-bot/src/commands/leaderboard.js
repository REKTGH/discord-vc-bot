// /leaderboard — shows who's most punctual in this server, ranked by
// on-time rate then by average lateness.
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getLeaderboard } = require('../db');

const data = new SlashCommandBuilder()
  .setName('leaderboard')
  .setDescription("Show who's most on-time for voice chat in this server");

async function execute(interaction) {
  const rows = getLeaderboard(interaction.guildId, 10);

  if (!rows.length) {
    await interaction.reply(
      "No data yet! Once people announce plans in chat (like \"joining at 9\") and then join voice, I'll start tracking punctuality here."
    );
    return;
  }

  const lines = rows.map((row, i) => {
    const pct = Math.round((row.onTimeCount / row.totalCount) * 100);
    const avgMin = Math.round(row.avgDiffSeconds / 60);
    const avgLabel = avgMin === 0 ? 'avg on time' : avgMin > 0 ? `avg ${avgMin}m late` : `avg ${Math.abs(avgMin)}m early`;
    const medal = ['🥇', '🥈', '🥉'][i] || `${i + 1}.`;
    const noShowLabel = row.noShowCount > 0 ? `, 👻 ${row.noShowCount} no-show${row.noShowCount === 1 ? '' : 's'}` : '';
    return `${medal} **${row.username}** — ${pct}% on-time (${avgLabel}, ${row.totalCount} tracked${noShowLabel})`;
  });

  const embed = new EmbedBuilder()
    .setTitle('⏱️ Voice Chat Punctuality Leaderboard')
    .setDescription(lines.join('\n'))
    .setColor(0x5865f2);

  await interaction.reply({ embeds: [embed] });
}

module.exports = { data, execute };
