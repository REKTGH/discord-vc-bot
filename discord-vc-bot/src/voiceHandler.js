// voiceHandler.js — listens for people actually joining a voice channel,
// matches that against any pending plan for them, posts the verdict back in
// the channel where they made the plan, and logs it for /leaderboard.
const planTracker = require('./planTracker');
const { recordResult } = require('./db');
const { classify, formatClock } = require('./verdict');

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
    const channel = await newState.guild.channels.fetch(plan.textChannelId).catch(() => null);
    if (!channel || !channel.isTextBased()) return;

    const member = newState.member ?? (await newState.guild.members.fetch(newState.id).catch(() => null));
    const mention = member ? `<@${member.id}>` : plan.username;

    await channel.send(
      `${verdict.emoji} ${mention} joined voice — **${verdict.label}** ` +
        `(said ${formatClock(plan.targetTime)}, joined ${formatClock(actualTime)})`
    );
  } catch (err) {
    console.warn('Could not send voice-join verdict message:', err.message);
  }
}

module.exports = { handleVoiceStateUpdate };
