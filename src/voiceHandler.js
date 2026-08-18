// voiceHandler.js — listens for people actually joining a voice channel,
// matches that against any pending plan for them, posts the verdict message,
// and logs it for /leaderboard. Posts in the channel where the plan was
// announced by default, or in a dedicated log channel instead if the server
// set one up with /log-here - see chooseTargetChannel below.
const planTracker = require('./planTracker');
const { recordResult } = require('./db');
const { classify, formatClock } = require('./verdict');
const liveLeaderboard = require('./liveLeaderboard');
const logChannelStore = require('./logChannelStore');

async function handleVoiceStateUpdate(oldState, newState) {
  const joinedAChannel = newState.channelId && oldState.channelId !== newState.channelId;
  if (!joinedAChannel) return;

  const plan = planTracker.consumePlan(newState.guild.id, newState.id);
  if (!plan) return;

  const actualTime = new Date();
  const diffMs = actualTime.getTime() - plan.targetTime.getTime();
  const verdict = classify(diffMs);

  recordResult({
    guildId: plan.guildId,
    userId: plan.userId,
    username: plan.username,
    targetTime: plan.targetTime,
    actualTime,
    diffSeconds: Math.round(diffMs / 1000),
    status: verdict.status,
    rawText: plan.rawText,
  });

  try {
    // /log-here redirects these messages to a dedicated channel. That's a
    // deliberate opt-in, so it also suppresses the ping notification (the
    // mention itself stays in the text - still clickable, just silent).
    // Without /log-here, this is unchanged from before: posts, and pings,
    // in the channel where the plan was announced.
    const logChannelId = logChannelStore.get(plan.guildId);
    const targetChannelId = logChannelId || plan.textChannelId;
    const channel = await newState.guild.channels.fetch(targetChannelId).catch(() => null);
    if (channel && channel.isTextBased()) {
      const member = newState.member ?? (await newState.guild.members.fetch(newState.id).catch(() => null));
      const mention = member ? `<@${member.id}>` : plan.username;

      const messageOptions = {
        content:
          `${verdict.emoji} ${mention} joined voice — **${verdict.label}** ` +
          `(said ${formatClock(plan.targetTime)}, joined ${formatClock(actualTime)})`,
      };
      if (logChannelId) messageOptions.allowedMentions = { users: [] };

      await channel.send(messageOptions);
    }
  } catch (err) {
    console.warn('Could not send voice-join verdict message:', err.message);
  }

  // Independent of whether the announcement above succeeded - keeps a
  // /leaderboard-here message (if this server set one up) current too.
  await liveLeaderboard.refresh(newState.client, plan.guildId);
}

module.exports = { handleVoiceStateUpdate };
