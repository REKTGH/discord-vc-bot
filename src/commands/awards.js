// /awards — an on-demand snapshot of the most recently completed month's
// punctuality awards. Same relationship to /awards-here as /leaderboard has
// to /leaderboard-here: this is the one-off manual version, open to anyone
// (no Manage Server permission needed, since it doesn't change any setup),
// and it doesn't touch awardsChannelStore - running it never affects
// whether or when the automatic monthly post fires, and it works even if
// /awards-here was never set up at all.
const { SlashCommandBuilder } = require('discord.js');
const { currentYearMonth, previousCalendarMonth, buildMonthlyAwardsEmbed } = require('../monthlyAwards');

const data = new SlashCommandBuilder()
  .setName('awards')
  .setDescription('Show punctuality awards for the most recently completed month');

async function execute(interaction) {
  const embed = buildMonthlyAwardsEmbed(interaction.guildId, previousCalendarMonth(currentYearMonth()));
  await interaction.reply({ embeds: [embed] });
}

module.exports = { data, execute };
