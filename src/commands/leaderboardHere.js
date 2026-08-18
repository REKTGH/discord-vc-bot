// /leaderboard-here — designates the current channel as the live,
// always-updated leaderboard for this server. Restricted to members who can
// manage the server, so a random member can't redirect it on a whim.
const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const store = require('../liveLeaderboardStore');
const { postNew, refresh } = require('../liveLeaderboard');

const data = new SlashCommandBuilder()
  .setName('leaderboard-here')
  .setDescription('Make this channel show a live, always-updated punctuality leaderboard')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

async function execute(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const tracked = store.get(interaction.guildId);
  if (tracked && tracked.channelId === interaction.channelId) {
    await refresh(interaction.client, interaction.guildId);
    await interaction.editReply('✅ Already live in this channel — refreshed it now.');
    return;
  }

  await postNew(interaction.channel, interaction.guildId);
  const movedNote = tracked ? ' The old live post in the previous channel will stop updating.' : '';
  await interaction.editReply(`✅ This channel now shows a live leaderboard that updates automatically.${movedNote}`);
}

module.exports = { data, execute };
