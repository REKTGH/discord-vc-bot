// /track — states a join plan on purpose, and opens it up for other people
// to join too.
//
// The bot already picks plans up from normal chat with no command needed, so
// this exists for the two cases that path can't cover: pinning down a time
// the parser didn't catch, and deliberately starting a group plan that others
// opt into. The posted message is public (not ephemeral) precisely because
// other people need to be able to tap its clock reaction to be tracked
// against the same time - see reactionHandler.js.
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const config = require('../config');
const { parseJoinTime } = require('../timeParser');
const planTracker = require('../planTracker');
const { formatClock } = require('../verdict');
const { WATCH_EMOJI } = require('../reactionHandler');

const data = new SlashCommandBuilder()
  .setName('track')
  .setDescription('Start a tracked join plan others can opt into with a reaction')
  .addStringOption((option) =>
    option
      .setName('when')
      .setDescription('When you\'re joining, e.g. "in 10", "at 9", "10:30", "9pm"')
      .setRequired(true)
  );

async function execute(interaction) {
  const when = interaction.options.getString('when');

  // Run the raw input through the same parser chat messages go through, so
  // /track and a typed plan can never disagree about what a time means. The
  // intent phrase is prepended because the parser requires one, and choosing
  // to run this command IS the intent.
  const parsed = parseJoinTime(`joining ${when}`, {
    timezone: config.timezone,
    referenceDate: new Date(),
  });

  if (!parsed) {
    await interaction.reply({
      content:
        `I couldn't read "${when}" as a time. Try something like \`in 10\`, \`at 9\`, \`10:30\`, or \`9pm\` ` +
        `— and note I only track plans up to ${config.maxFutureHours} hours ahead.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const username = interaction.member?.displayName || interaction.user.username;
  planTracker.setPlan({
    userId: interaction.user.id,
    username,
    guildId: interaction.guildId,
    textChannelId: interaction.channelId,
    targetTime: parsed.targetTime,
    announcedAt: new Date(),
    rawText: `/track ${when}`,
  });

  await interaction.reply({
    content:
      `${WATCH_EMOJI} <@${interaction.user.id}> is joining voice around **${formatClock(parsed.targetTime)}**.\n` +
      `React with ${WATCH_EMOJI} to be held to the same time.`,
    allowedMentions: { users: [] },
  });

  // The posted reply is the thing people react to, so it - not the command -
  // is what has to be remembered as the joinable plan.
  const sent = await interaction.fetchReply();
  planTracker.rememberPlanMessage(sent.id, {
    guildId: interaction.guildId,
    textChannelId: interaction.channelId,
    targetTime: parsed.targetTime,
    ownerId: interaction.user.id,
    rawText: `/track ${when}`,
  });

  try {
    await sent.react(WATCH_EMOJI);
  } catch (err) {
    console.warn('Could not seed the /track reaction (missing permission?):', err.message);
  }
}

module.exports = { data, execute };
