// /cancel — erases your own currently-pending join plan, for when the bot
// tracked something it shouldn't have (a misheard time, a false-positive
// bare-number match, etc.) without needing to remember the "nevermind"/"nvm"
// chat phrase. Only touches a plan that's still pending - once you've
// actually joined voice, or it's already turned into a no-show note, there's
// nothing left here to cancel. Deliberately does NOT count toward the
// leaderboard's cancellation tally - that's reserved for "nvm" in chat (see
// messageHandler.js), since /cancel is usually fixing a bot mistake rather
// than the person actually flaking on a plan.
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const planTracker = require('../planTracker');
const { formatClock } = require('../verdict');

const data = new SlashCommandBuilder()
  .setName('cancel')
  .setDescription('Erase your currently pending join plan, if the bot tracked something wrong');

async function execute(interaction) {
  const plan = planTracker.cancelPlan(interaction.guildId, interaction.user.id);

  if (!plan) {
    await interaction.reply({
      content: "You don't have a pending join plan right now — nothing to cancel.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.reply({
    content: `✅ Cancelled. I had you down for around ${formatClock(plan.targetTime)} — no no-show note will be posted for it.`,
    flags: MessageFlags.Ephemeral,
  });
}

module.exports = { data, execute };
