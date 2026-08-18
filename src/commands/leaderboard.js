// /leaderboard — posts a one-off snapshot, ranked latest to least late.
// For a message that keeps itself updated, see /leaderboard-here.
const { SlashCommandBuilder } = require('discord.js');
const { buildLeaderboardPayload } = require('../leaderboardView');

const data = new SlashCommandBuilder()
  .setName('leaderboard')
  .setDescription('Show voice chat lateness for this server, ranked latest to least late');

async function execute(interaction) {
  await interaction.reply(buildLeaderboardPayload(interaction.guildId));
}

module.exports = { data, execute };
