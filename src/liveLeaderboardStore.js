// liveLeaderboardStore.js — remembers which channel+message (per guild) holds
// the live leaderboard, so it can be edited in place instead of reposted.
// A tiny JSON file, kept deliberately separate from db.js's results data.
const fs = require('fs');
const path = require('path');
const config = require('./config');

const filePath = config.liveLeaderboardPath;

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

function get(guildId) {
  return loadAll()[guildId] || null;
}

function set(guildId, { channelId, messageId }) {
  const data = loadAll();
  data[guildId] = { channelId, messageId };
  saveAll(data);
}

module.exports = { get, set };
