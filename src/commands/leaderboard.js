// /leaderboard — posts a one-off snapshot of who's most punctual right now.
// For a message that keeps itself updated, see /leaderboard-here.
const { SlashCommandBuilder } = require('discord.js');
const { buildLeaderboardEmbed } = require('../leaderboardView');

const data = new SlashCommandBuilder()
  .setName('leaderboard')
  .setDescription("Show who's most on-time for voice chat in this server");

async function execute(interaction) {
  const embed = buildLeaderboardEmbed(interaction.guildId);
  await interaction.reply({ embeds: [embed] });
}

module.exports = { data, execute };
