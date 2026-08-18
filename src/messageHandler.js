// messageHandler.js — listens to chat messages, looks for "I'm joining VC at
// some point" statements, and remembers them as a pending plan. Also handles
// someone calling off a plan they already stated ("nevermind").
const config = require('./config');
const { parseJoinTime, hasCancelIntent } = require('./timeParser');
const planTracker = require('./planTracker');
const { recordResult } = require('./db');
const liveLeaderboard = require('./liveLeaderboard');

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

    // Quiet confirmation so a non-technical user can see the bot understood,
    // without spamming the channel with a full message for every plan.
    await react(message, '⏰');
    return;
  }

  // No new plan in this message. If they already had one pending and this
  // looks like "nevermind"/"nvm", cancel it quietly - no no-show note later.
  if (hasCancelIntent(message.content) && planTracker.hasPlan(message.guild.id, message.author.id)) {
    const cancelled = planTracker.cancelPlan(message.guild.id, message.author.id);
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
