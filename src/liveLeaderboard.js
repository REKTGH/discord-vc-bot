// liveLeaderboard.js — keeps a single leaderboard message up to date in
// whichever channel a server designated via /leaderboard-here.
//
// The standings are per calendar month, so this message doesn't live forever.
// When the month turns over, the current message is finalised in place (one
// last edit, footer dropped) and left in the channel as that month's record,
// and a fresh live message is posted below it for the new month. Nothing is
// deleted, in the channel or in results.json.
const store = require('./liveLeaderboardStore');
const config = require('./config');
const { buildLeaderboardPayload } = require('./leaderboardView');
const { localYearMonth } = require('./timeParser');

function monthKey({ year, month }) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function currentMonth() {
  return localYearMonth(new Date(), config.timezone);
}

function parseMonthKey(key) {
  const [year, month] = String(key).split('-').map(Number);
  return { year, month };
}

// Posts a fresh live leaderboard message in `channel` and starts tracking it.
async function postNew(channel, guildId) {
  const month = currentMonth();
  const message = await channel.send(buildLeaderboardPayload(guildId, { live: true, yearMonth: month }));
  store.set(guildId, { channelId: channel.id, messageId: message.id, yearMonth: monthKey(month) });
  return message;
}

// Rewrites last month's message one final time so it shows that month's
// completed standings, and drops the "live" footer - it isn't live any more,
// it's a record. Deliberately does NOT delete it: keeping each month's final
// table in the channel is the whole point of starting a new one.
async function finalisePreviousMonth(channel, guildId, previousKey) {
  const message = await channel.messages.fetch(previousKey.messageId).catch(() => null);
  if (!message) return;
  await message
    .edit({
      ...buildLeaderboardPayload(guildId, { live: false, yearMonth: previousKey.month }),
      attachments: [],
    })
    .catch((err) => console.warn(`Could not finalise last month's leaderboard for ${guildId}:`, err.message));
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

    const month = currentMonth();
    const nowKey = monthKey(month);
    // An entry stored before monthly standings existed has no yearMonth. Treat
    // it as belonging to the current month so upgrading doesn't spuriously
    // roll over and post a duplicate on the first refresh after a deploy.
    const trackedKey = tracked.yearMonth || nowKey;

    if (trackedKey !== nowKey) {
      await finalisePreviousMonth(channel, guildId, {
        messageId: tracked.messageId,
        month: parseMonthKey(trackedKey),
      });
      await postNew(channel, guildId);
      return;
    }

    const message = await channel.messages.fetch(tracked.messageId).catch(() => null);
    if (!message) {
      await postNew(channel, guildId);
      return;
    }

    // `attachments: []` is required here, not optional. discord.js keeps ALL
    // of a message's existing attachments on edit unless told otherwise, so
    // omitting this would stack a brand new leaderboard image on top of the
    // old one every single refresh instead of replacing it.
    await message.edit({
      ...buildLeaderboardPayload(guildId, { live: true, yearMonth: month }),
      attachments: [],
    });
  } catch (err) {
    console.warn(`Could not refresh live leaderboard for guild ${guildId}:`, err.message);
  }
}

// Refresh only runs when something changes the data (a voice join, a
// no-show). That's fine mid-month, but it means a quiet 1st of the month
// would leave last month's board sitting there looking current until someone
// finally joined voice. This runs on the same hourly timer as the monthly
// awards check and rolls over any guild whose month has turned, whether or
// not anybody has done anything yet. Mirrors monthlyAwards.checkAndAnnounceAll.
async function checkForMonthRolloverAll(client) {
  for (const guild of client.guilds.cache.values()) {
    const tracked = store.get(guild.id);
    if (!tracked || !tracked.yearMonth) continue;
    if (tracked.yearMonth === monthKey(currentMonth())) continue;
    await refresh(client, guild.id).catch((err) =>
      console.warn(`Could not roll over the live leaderboard for guild ${guild.id}:`, err.message)
    );
  }
}

module.exports = { postNew, refresh, checkForMonthRolloverAll, monthKey, parseMonthKey };
