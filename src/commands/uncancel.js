// /uncancel — takes back the cancellation you just made, for when a
// "nvm"/"nevermind" in chat was aimed at a friend rather than at the bot.
//
// This is the counterpart to the "nvm" handling in messageHandler.js. That
// detection can't tell "nvm, not joining after all" from "nvm, I found it" -
// both are just the word "nvm" typed while a plan happens to be pending - so
// it will sometimes eat a plan that was never actually called off, and log a
// Cancels mark against the person for it. Rather than making the detection
// timid (which would miss real cancellations), the fix is to make it cheap to
// undo.
//
// Restores the plan AND removes the leaderboard row, but only when there was
// one: a cancellation that came from /cancel never wrote a row in the first
// place (see cancel.js), and planTracker remembers which kind it was so this
// doesn't have to guess.
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const planTracker = require('../planTracker');
const { removeLastResult } = require('../db');
const { formatClock } = require('../verdict');
const liveLeaderboard = require('../liveLeaderboard');

const data = new SlashCommandBuilder()
  .setName('uncancel')
  .setDescription('Undo an accidental "nvm" and put your join plan back');

async function execute(interaction) {
  const restored = planTracker.restoreLastCancelled(interaction.guildId, interaction.user.id);

  if (!restored) {
    await interaction.reply({
      content:
        "I don't have a recent cancellation of yours to undo. This only works on the last plan you " +
        'called off, and only while that plan would still be live.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Only a chat "nvm" writes a Cancels row; /cancel doesn't. Undo whichever
  // actually happened so the leaderboard ends up exactly as it started.
  let removedRow = false;
  if (restored.recorded) {
    removedRow = removeLastResult(interaction.guildId, interaction.user.id, 'cancelled');
    if (removedRow) await liveLeaderboard.refresh(interaction.client, interaction.guildId);
  }

  const tail = removedRow ? " and took the cancellation back off the leaderboard." : '.';
  await interaction.reply({
    content: `↩️ Put your plan back — I've got you down for around ${formatClock(restored.plan.targetTime)}${tail}`,
    flags: MessageFlags.Ephemeral,
  });
}

module.exports = { data, execute };
