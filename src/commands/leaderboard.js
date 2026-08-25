// /leaderboard — posts a one-off snapshot, ranked latest to least late.
// For a message that keeps itself updated, see /leaderboard-here.
//
// Defaults to the current calendar month, so standings start fresh each
// month and a bad week in March doesn't follow someone around forever.
// Nothing is ever deleted, so "All time" is always still there.
const { SlashCommandBuilder } = require('discord.js');
const { buildLeaderboardPayload } = require('../leaderboardView');

const data = new SlashCommandBuilder()
  .setName('leaderboard')
  .setDescription('Show voice chat lateness for this server, ranked latest to least late')
  .addStringOption((option) =>
    option
      .setName('scope')
      .setDescription('This month (default) or all time')
      .addChoices(
        { name: 'This month', value: 'month' },
        { name: 'All time', value: 'all' }
      )
  );

async function execute(interaction) {
  const scope = interaction.options.getString('scope') || 'month';
  await interaction.reply(buildLeaderboardPayload(interaction.guildId, { scope }));
}

module.exports = { data, execute };
