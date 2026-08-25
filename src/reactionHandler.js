// reactionHandler.js — lets a stated plan cover more than one person.
//
// When the bot spots a plan (or someone runs /track) it marks that message
// with a clock reaction. Anyone else who taps that same reaction is saying
// "me too" and gets tracked against the same stated time, with their own
// verdict and their own no-show note. Taking the reaction back opts them out
// again, with no cancellation held against them - opting out of someone
// else's plan isn't flaking on your own.
//
// Following the pattern used across this codebase, the actual decision -
// should this reaction enroll anyone, and against what - lives in the pure,
// exported decideReactionAction() below, separate from the Discord I/O, so
// the branching can be unit tested without a live connection.
const planTracker = require('./planTracker');

// The reaction the bot adds to a plan, and the one people tap to join it.
// Must stay in step with the reaction messageHandler.js adds on a detected
// plan - that same mark is what makes a plan joinable.
const WATCH_EMOJI = '⏰';

// The two answers offered when a bare number could mean either thing, e.g.
// "10" -> in 10 minutes, or at 10 o'clock. Both are deliberately different
// from WATCH_EMOJI so answering a question can never be confused with joining
// a plan - and so that once answered, the bot can add WATCH_EMOJI to the same
// message and it becomes joinable like any other plan.
const MINUTES_EMOJI = '⏳';
const CLOCK_EMOJI = '🕐';

/**
 * Pure decision layer for answering a "minutes or o'clock?" prompt.
 *
 * Only the person who typed the ambiguous message can answer it - otherwise
 * anyone passing by could decide what someone else meant.
 *
 * @returns {{action: 'ignore'|'resolve', reason: string, targetTime?: Date, reading?: string}}
 */
function decideAmbiguityAnswer({ emojiName, isBot, question, userId }) {
  if (isBot) return { action: 'ignore', reason: 'bot reaction' };
  if (!question) return { action: 'ignore', reason: 'no question on this message' };
  if (question.userId !== userId) return { action: 'ignore', reason: 'only the author can answer' };

  if (emojiName === MINUTES_EMOJI) {
    return { action: 'resolve', reason: 'answered: minutes', targetTime: question.minutesTarget, reading: 'minutes' };
  }
  if (emojiName === CLOCK_EMOJI) {
    return { action: 'resolve', reason: "answered: o'clock", targetTime: question.clockTarget, reading: 'clock' };
  }
  return { action: 'ignore', reason: 'not one of the offered answers' };
}

/**
 * Pure decision layer: given a reaction event, work out what should happen.
 *
 * @param {object} input
 * @param {string} input.emojiName - the emoji as Discord reports it
 * @param {boolean} input.isBot - whether the reacting user is a bot
 * @param {object|null} input.planMessage - the remembered plan for this message, if any
 * @param {object|null} input.existingPlan - the reactor's own currently pending plan, if any
 * @param {string} input.userId - the reacting user
 * @returns {{action: 'ignore'|'enroll'|'withdraw', reason: string, targetTime?: Date}}
 */
function decideReactionAction({ emojiName, isBot, planMessage, existingPlan, userId }, { removing = false } = {}) {
  // The bot's own seed reaction is what makes a plan joinable in the first
  // place, so it must never be read as the bot enrolling itself.
  if (isBot) return { action: 'ignore', reason: 'bot reaction' };
  if (emojiName !== WATCH_EMOJI) return { action: 'ignore', reason: 'not the watch emoji' };
  if (!planMessage) return { action: 'ignore', reason: 'not a tracked plan message' };

  // Whoever stated the plan is already tracked by the normal path. Letting
  // their own reaction re-enroll them would just overwrite their plan with an
  // identical copy, and un-reacting would cancel a plan they never opted into
  // by reaction - so the author is left alone in both directions.
  if (planMessage.ownerId === userId) return { action: 'ignore', reason: 'plan author is already tracked' };

  if (removing) {
    // Only withdraw a plan that actually came from this message. Someone who
    // stated their own plan after opting in should keep it.
    if (!existingPlan || existingPlan.sourceMessageId !== planMessage.messageId) {
      return { action: 'ignore', reason: 'no plan from this message to withdraw' };
    }
    return { action: 'withdraw', reason: 'reaction removed' };
  }

  return { action: 'enroll', reason: 'joined a shared plan', targetTime: planMessage.targetTime };
}

// Resolves the partials Discord sends for reactions on messages the bot
// hasn't cached (anything from before the current process started, which on a
// restart is every older message). Without this the emoji can arrive as null.
async function resolvePartial(reaction) {
  if (reaction.partial) await reaction.fetch();
  if (reaction.message.partial) await reaction.message.fetch();
  return reaction;
}

// Turns an answered question into a real, tracked plan. The message then
// picks up the normal clock mark, so a plan that started out ambiguous ends
// up exactly like any other - joinable by everyone else in the usual way.
async function resolveAmbiguity(reaction, user, question, answer, messageId, guildId) {
  planTracker.forgetAmbiguityQuestion(messageId);

  const member = await reaction.message.guild.members.fetch(user.id).catch(() => null);
  planTracker.setPlan({
    userId: user.id,
    username: member?.displayName || user.username,
    guildId,
    textChannelId: question.textChannelId,
    targetTime: answer.targetTime,
    announcedAt: new Date(),
    rawText: question.rawText,
  });

  planTracker.rememberPlanMessage(messageId, {
    guildId,
    textChannelId: question.textChannelId,
    targetTime: answer.targetTime,
    ownerId: user.id,
    rawText: question.rawText,
  });

  try {
    // Clear the two options so the message doesn't keep offering a choice
    // that's already been made, then mark it as a normal tracked plan.
    await reaction.message.reactions.cache.get(MINUTES_EMOJI)?.remove().catch(() => {});
    await reaction.message.reactions.cache.get(CLOCK_EMOJI)?.remove().catch(() => {});
    await reaction.message.react(WATCH_EMOJI);
  } catch (err) {
    console.warn('Could not tidy up after an answered time question:', err.message);
  }
}

async function handleReactionChange(reaction, user, { removing }) {
  if (user.bot) return;

  try {
    await resolvePartial(reaction);
  } catch (err) {
    console.warn('Could not resolve a partial reaction:', err.message);
    return;
  }

  const messageId = reaction.message.id;
  const guildId = reaction.message.guildId;
  if (!guildId) return; // DMs have no shared plans

  // An unanswered "minutes or o'clock?" prompt takes precedence: until it's
  // answered there is no plan on this message for anyone to join. Only adding
  // a reaction answers it - un-reacting is treated as changing your mind, not
  // as an answer, so the question simply stays open.
  const question = planTracker.getAmbiguityQuestion(messageId);
  if (question && !removing) {
    const answer = decideAmbiguityAnswer({
      emojiName: reaction.emoji.name,
      isBot: user.bot,
      question,
      userId: user.id,
    });
    if (answer.action === 'resolve') await resolveAmbiguity(reaction, user, question, answer, messageId, guildId);
    return;
  }
  if (question) return;

  const planMessage = planTracker.getPlanMessage(messageId);

  const existingPlan = planTracker.peekPlan(guildId, user.id);

  const decision = decideReactionAction(
    {
      emojiName: reaction.emoji.name,
      isBot: user.bot,
      planMessage: planMessage && { ...planMessage, messageId },
      existingPlan,
      userId: user.id,
    },
    { removing }
  );

  if (decision.action === 'ignore') return;

  if (decision.action === 'withdraw') {
    // recorded:false — opting out of someone else's plan is not flaking, so
    // it must not land on the leaderboard's Cancels column.
    planTracker.cancelPlan(guildId, user.id, { recorded: false });
    return;
  }

  const member = await reaction.message.guild.members.fetch(user.id).catch(() => null);
  planTracker.setPlan({
    userId: user.id,
    username: member?.displayName || user.username,
    guildId,
    textChannelId: reaction.message.channelId,
    targetTime: decision.targetTime,
    announcedAt: new Date(),
    rawText: `joined a shared plan (${planMessage.rawText || 'via reaction'})`,
    sourceMessageId: messageId,
  });
}

function handleReactionAdd(reaction, user) {
  return handleReactionChange(reaction, user, { removing: false });
}

function handleReactionRemove(reaction, user) {
  return handleReactionChange(reaction, user, { removing: true });
}

module.exports = {
  WATCH_EMOJI,
  MINUTES_EMOJI,
  CLOCK_EMOJI,
  decideReactionAction,
  decideAmbiguityAnswer,
  handleReactionAdd,
  handleReactionRemove,
};
