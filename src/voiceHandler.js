// voiceHandler.js — listens for people actually joining a voice channel,
// matches that against any pending plan for them, posts the verdict message,
// and logs it for /leaderboard. Posts in the channel where the plan was
// announced by default, or in a dedicated log channel instead if the server
// set one up with /log-here - see chooseVerdictRouting below. Roast-worthy
// lateness is the one exception: it always stays in the announcement
// channel, /log-here or not - see chooseVerdictRouting's comment.
const planTracker = require('./planTracker');
const { recordResult } = require('./db');
const { classify, isRoastWorthy, buildVerdictMessage } = require('./verdict');
const liveLeaderboard = require('./liveLeaderboard');
const logChannelStore = require('./logChannelStore');

// Decides where a voice-join verdict message should go, and whether its ping
// should be suppressed. Pulled out as its own pure function (rather than
// inlined below) specifically so this branching is unit-testable without a
// live Discord connection - see test/core.test.js.
//
// Roast-worthy lateness (see verdict.isRoastWorthy) is deliberately carved
// out of the /log-here redirect: the whole point of a roast is being seen
// live by the group, so it always posts (and pings, normally) in the
// channel the plan was announced in, even on a server that's otherwise
// routing every verdict message to a quiet log channel. Every other verdict
// - on time, early, or late but under the roast threshold - is unaffected
// and still redirects/goes silent exactly as /log-here promises.
function chooseVerdictRouting(verdict, { logChannelId, announceChannelId }) {
  const redirectToLog = Boolean(logChannelId) && !isRoastWorthy(verdict);
  return {
    channelId: redirectToLog ? logChannelId : announceChannelId,
    suppressPing: redirectToLog,
  };
}

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
    const logChannelId = logChannelStore.get(plan.guildId);
    const { channelId: targetChannelId, suppressPing } = chooseVerdictRouting(verdict, {
      logChannelId,
      announceChannelId: plan.textChannelId,
    });
    const channel = await newState.guild.channels.fetch(targetChannelId).catch(() => null);
    if (channel && channel.isTextBased()) {
      const member = newState.member ?? (await newState.guild.members.fetch(newState.id).catch(() => null));
      const mention = member ? `<@${member.id}>` : plan.username;

      const messageOptions = {
        content: buildVerdictMessage(verdict, { mention, targetTime: plan.targetTime, actualTime }),
      };
      if (suppressPing) messageOptions.allowedMentions = { users: [] };

      await channel.send(messageOptions);
    }
  } catch (err) {
    console.warn('Could not send voice-join verdict message:', err.message);
  }

  // Independent of whether the announcement above succeeded - keeps a
  // /leaderboard-here message (if this server set one up) current too.
  await liveLeaderboard.refresh(newState.client, plan.guildId);
}

module.exports = { handleVoiceStateUpdate, chooseVerdictRouting };
