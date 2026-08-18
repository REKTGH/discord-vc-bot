// /log-here — designates the current channel as where voice-join verdict
// messages (early/on-time/late) get posted, instead of the channel where the
// plan was originally announced. Restricted to members who can manage the
// server, same reasoning as /leaderboard-here: it redirects bot output for
// everyone, so a random member shouldn't be able to move it on a whim.
const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const store = require('../logChannelStore');

const data = new SlashCommandBuilder()
  .setName('log-here')
  .setDescription('Send voice-join messages (early/on-time/late) to this channel instead, without pinging')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

async function execute(interaction) {
  const already = store.get(interaction.guildId) === interaction.channelId;
  store.set(interaction.guildId, interaction.channelId);

  const note = already
    ? '✅ This is already your log channel — no change needed.'
    : "✅ Got it — voice-join messages (early/on-time/late) will post here from now on. They'll still show who joined as a clickable mention, just without sending them a notification.";

  await interaction.reply({ content: note, flags: MessageFlags.Ephemeral });
}

module.exports = { data, execute };
