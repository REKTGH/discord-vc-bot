// noShowHandler.js — periodically checks for stated plans nobody ever
// followed through on. Called on a timer from index.js.
const planTracker = require('./planTracker');
const { recordResult } = require('./db');
const { formatClock } = require('./verdict');

async function checkForNoShows(client) {
  const expired = planTracker.takeExpired();

  for (const plan of expired) {
    recordResult({
      guildId: plan.guildId,
      userId: plan.userId,
      username: plan.username,
      targetTime: plan.targetTime,
      actualTime: null,
      diffSeconds: null,
      status: 'no_show',
      rawText: plan.rawText,
    });

    try {
      const guild = await client.guilds.fetch(plan.guildId).catch(() => null);
      const channel = guild && (await guild.channels.fetch(plan.textChannelId).catch(() => null));
      if (!channel || !channel.isTextBased()) continue;
      await channel.send(
        `👻 <@${plan.userId}> said they'd join around ${formatClock(plan.targetTime)} but never showed — no-show.`
      );
    } catch (err) {
      console.warn('Could not send no-show note:', err.message);
    }
  }
}

module.exports = { checkForNoShows };
