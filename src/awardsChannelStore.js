// awardsChannelStore.js — remembers, per guild, which channel gets the
// automatic monthly awards post (set via /awards-here) and which month was
// last announced there (so the periodic check in index.js posts each month
// exactly once instead of re-posting on every check). A tiny JSON file, kept
// separate from db.js/liveLeaderboardStore.js/logChannelStore.js's data so
// none of them can ever risk corrupting one another's format.
const fs = require('fs');
const path = require('path');
const config = require('./config');

const filePath = config.awardsChannelPath;

function loadAll() {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    console.warn(`Could not read ${filePath} (${err.message}); starting fresh.`);
    return {};
  }
}

function saveAll(data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data));
  fs.renameSync(tmpPath, filePath);
}

// Returns { channelId, lastAnnouncedMonth } for this guild, or null if
// /awards-here has never been run there. lastAnnouncedMonth is a "YYYY-MM"
// string, or null if no automatic post has gone out yet.
function get(guildId) {
  return loadAll()[guildId] || null;
}

// Sets the channel for this guild. Leaves lastAnnouncedMonth untouched if
// already set (so re-running /awards-here in the same channel doesn't reset
// which months have already been announced); pass `lastAnnouncedMonth`
// explicitly to initialize/overwrite it (the command does this on first setup
// so the very next periodic check doesn't mistake "never announced" for "a
// month just rolled over").
function set(guildId, { channelId, lastAnnouncedMonth } = {}) {
  const data = loadAll();
  const existing = data[guildId] || { channelId: null, lastAnnouncedMonth: null };
  data[guildId] = {
    channelId: channelId !== undefined ? channelId : existing.channelId,
    lastAnnouncedMonth: lastAnnouncedMonth !== undefined ? lastAnnouncedMonth : existing.lastAnnouncedMonth,
  };
  saveAll(data);
}

module.exports = { get, set };
