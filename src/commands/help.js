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
        '• "vc in 5"\n' +
        '• just a bare number, like "30" (means "in 30 minutes")\n\n' +
        "If I understood you, I'll react with ⏰ on your message. When you actually join a voice channel, " +
        "I'll reply here with whether you were early, on time, or late — show up late enough and don't be " +
        "surprised if that reply gets a little passive-aggressive.\n\n" +
        `On time = within ${config.gracePeriodMinutes} minutes of what you said. ` +
        `Plans expire after ${config.planExpiryHours} hours if you never join.\n\n` +
        'Changed your mind, or did I get it wrong? Say "nevermind"/"nvm", or run `/cancel` — either erases your pending plan and skips the no-show note. Only "nevermind"/"nvm" counts as a cancellation on `/leaderboard`, though - `/cancel` is for fixing my mistakes, so it doesn\'t count against you.\n\n' +
        '`/leaderboard` — punctuality ranking for this server, latest to least late.\n' +
        '`/leaderboard-here` — turn this channel into a live, self-updating leaderboard (needs Manage Server permission).\n' +
        '`/cancel` — erase your own pending plan if I tracked something wrong.\n' +
        '`/log-here` — send voice-join messages to this channel instead, without pinging anyone (needs Manage Server permission).\n' +
        '`/awards-here` — post automatic monthly awards (most late, most time late, most cancels) in this channel at the start of each month (needs Manage Server permission).'
    )
    .setColor(0x5865f2);

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral }); // only the requester sees it
}

module.exports = { data, execute };
