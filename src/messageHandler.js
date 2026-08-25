// messageHandler.js — listens to chat messages, looks for "I'm joining VC at
// some point" statements, and remembers them as a pending plan. Also handles
// someone calling off a plan they already stated ("nevermind").
const config = require('./config');
const { parseJoinTime, parseBareNumberAmbiguity, hasCancelIntent } = require('./timeParser');
const planTracker = require('./planTracker');
const { recordResult } = require('./db');
const liveLeaderboard = require('./liveLeaderboard');
const { WATCH_EMOJI, MINUTES_EMOJI, CLOCK_EMOJI } = require('./reactionHandler');

async function react(message, emoji) {
  try {
    await message.react(emoji);
  } catch (err) {
    console.warn('Could not react to message (missing permission?):', err.message);
  }
}

async function handleMessage(message) {
  if (message.author.bot) return;
  if (!message.guild) return; // ignore DMs
  if (config.allowedChannelIds.length && !config.allowedChannelIds.includes(message.channelId)) return;

  const parsed = parseJoinTime(message.content, { timezone: config.timezone, referenceDate: new Date() });

  if (parsed) {
    const username = message.member?.displayName || message.author.username;
    planTracker.setPlan({
      userId: message.author.id,
      username,
      guildId: message.guild.id,
      textChannelId: message.channelId,
      targetTime: parsed.targetTime,
      announcedAt: new Date(),
      rawText: message.content,
    });

    // Remembering the message is what lets other people join this same plan
    // by tapping the clock below - see reactionHandler.js.
    planTracker.rememberPlanMessage(message.id, {
      guildId: message.guild.id,
      textChannelId: message.channelId,
      targetTime: parsed.targetTime,
      ownerId: message.author.id,
      rawText: message.content,
    });

    // Quiet confirmation so a non-technical user can see the bot understood,
    // without spamming the channel with a full message for every plan. The
    // same mark doubles as the "me too" button for everyone else.
    await react(message, WATCH_EMOJI);
    return;
  }

  // No plan parsed - but a message that's just a small number ("10") could be
  // either "in 10 minutes" or "at 10 o'clock", and guessing gets it wrong
  // often enough to be worth one tap. Offer both and let them pick; nothing is
  // tracked until they do. See reactionHandler.decideAmbiguityAnswer.
  const ambiguous = parseBareNumberAmbiguity(message.content, {
    timezone: config.timezone,
    referenceDate: new Date(),
  });
  if (ambiguous) {
    // Only one plausible reading left (the o'clock one fell outside the
    // tracking window), so there's nothing worth asking about - just take it.
    if (!ambiguous.clock) {
      const username = message.member?.displayName || message.author.username;
      planTracker.setPlan({
        userId: message.author.id,
        username,
        guildId: message.guild.id,
        textChannelId: message.channelId,
        targetTime: ambiguous.minutes.targetTime,
        announcedAt: new Date(),
        rawText: message.content,
      });
      planTracker.rememberPlanMessage(message.id, {
        guildId: message.guild.id,
        textChannelId: message.channelId,
        targetTime: ambiguous.minutes.targetTime,
        ownerId: message.author.id,
        rawText: message.content,
      });
      await react(message, WATCH_EMOJI);
      return;
    }

    planTracker.rememberAmbiguityQuestion(message.id, {
      guildId: message.guild.id,
      userId: message.author.id,
      textChannelId: message.channelId,
      minutesTarget: ambiguous.minutes.targetTime,
      clockTarget: ambiguous.clock.targetTime,
      rawText: message.content,
    });
    await react(message, MINUTES_EMOJI);
    await react(message, CLOCK_EMOJI);
    return;
  }

  // No new plan in this message. If they already had one pending and this
  // looks like "nevermind"/"nvm", cancel it quietly - no no-show note later.
  if (hasCancelIntent(message.content) && planTracker.hasPlan(message.guild.id, message.author.id)) {
    // recorded: true — a chat "nvm" counts as real flaking and does write a
    // 'cancelled' row below, unlike /cancel. /uncancel uses this to know it
    // must remove that row again if this turns out to have been an accident.
    const cancelled = planTracker.cancelPlan(message.guild.id, message.author.id, { recorded: true });
    if (cancelled) {
      recordResult({
        guildId: message.guild.id,
        userId: message.author.id,
        username: cancelled.username,
        targetTime: cancelled.targetTime,
        actualTime: null,
        diffSeconds: null,
        status: 'cancelled',
        rawText: cancelled.rawText,
      });
      await liveLeaderboard.refresh(message.client, message.guild.id);
    }
    await react(message, '🚫');
  }
}

module.exports = { handleMessage };
