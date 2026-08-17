// /help — explains how to talk to the bot, since its main interaction is
// "just chat normally" rather than a command, which is easy to be unsure about.
const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const config = require('../config');

const data = new SlashCommandBuilder()
  .setName('help')
  .setDescription('How to use the voice chat punctuality bot');

async function execute(interaction) {
  const embed = new EmbedBuilder()
    .setTitle('⏰ How this bot works')
    .setDescription(
      "You don't need a command to use this — just chat normally about when you'll join voice chat. " +
        "I'm listening for phrases like:\n" +
        '• "omw, joining in 10 min"\n' +
        '• "be there at 9"\n' +
        '• "hopping on at 9:30pm"\n' +
        '• "vc in 5"\n\n' +
        "If I understood you, I'll react with ⏰ on your message. When you actually join a voice channel, " +
        "I'll reply here with whether you were early, on time, or late.\n\n" +
        `On time = within ${config.gracePeriodMinutes} minutes of what you said. ` +
        `Plans expire after ${config.planExpiryHours} hours if you never join.\n\n` +
        'Use `/leaderboard` to see everyone\'s punctuality ranking for this server.'
    )
    .setColor(0x5865f2);

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral }); // only the requester sees it
}

module.exports = { data, execute };
