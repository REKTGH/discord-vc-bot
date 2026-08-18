// liveLeaderboard.js — keeps a single leaderboard message up to date in
// whichever channel a server designated via /leaderboard-here.
const store = require('./liveLeaderboardStore');
const { buildLeaderboardPayload } = require('./leaderboardView');

// Posts a fresh live leaderboard message in `channel` and starts tracking it.
async function postNew(channel, guildId) {
  const message = await channel.send(buildLeaderboardPayload(guildId, { live: true }));
  store.set(guildId, { channelId: channel.id, messageId: message.id });
  return message;
}

// Call after anything that changes a guild's leaderboard data (a voice-join
// verdict or a no-show). Does nothing if that guild hasn't set up a live
// leaderboard channel. If the tracked message is gone, self-heals by posting
// a new one rather than failing silently forever.
async function refresh(client, guildId) {
  const tracked = store.get(guildId);
  if (!tracked) return;

  try {
    const channel = await client.channels.fetch(tracked.channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) return;

    const message = await channel.messages.fetch(tracked.messageId).catch(() => null);
    if (!message) {
      await postNew(channel, guildId);
      return;
    }

    // `attachments: []` is required here, not optional. discord.js keeps ALL
    // of a message's existing attachments on edit unless told otherwise, so
    // omitting this would stack a brand new leaderboard image on top of the
    // old one every single refresh instead of replacing it.
    await message.edit({ ...buildLeaderboardPayload(guildId, { live: true }), attachments: [] });
  } catch (err) {
    console.warn(`Could not refresh live leaderboard for guild ${guildId}:`, err.message);
  }
}

module.exports = { postNew, refresh };
