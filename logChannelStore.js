// logChannelStore.js — remembers which channel (per guild) should receive
// voice-join verdict messages, set via /log-here. A tiny JSON file, kept
// separate from db.js's results data and from liveLeaderboardStore.js's data
// so none of the three can ever risk corrupting one another's format.
const fs = require('fs');
const path = require('path');
const config = require('./config');

const filePath = config.logChannelPath;

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

// Returns the channelId set for this guild, or null if none has been set.
function get(guildId) {
  return loadAll()[guildId] || null;
}

function set(guildId, channelId) {
  const data = loadAll();
  data[guildId] = channelId;
  saveAll(data);
}

module.exports = { get, set };
