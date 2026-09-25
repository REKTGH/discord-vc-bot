// userTimezoneStore.js — remembers each person's own timezone, set via
// /timezone, so "at 9" is read as 9 o'clock where *they* are rather than in
// BOT_TIMEZONE. Keyed by user, not by server: where someone lives doesn't
// change between servers. A tiny JSON file, kept separate from every other
// data file for the same reason logChannelStore.js is.
//
// Unlike the channel stores, this is consulted on every chat message, so the
// file is read once and then kept in memory; writes go to both.
const fs = require('fs');
const path = require('path');
const config = require('./config');

const filePath = config.userTimezonePath;
let cache = null;

function loadAll() {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    cache = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn(`Could not read ${filePath} (${err.message}); starting fresh.`);
    cache = {};
  }
  return cache;
}

function saveAll(data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data));
  fs.renameSync(tmpPath, filePath);
  cache = data;
}

// Plain-English names people actually type, mapped to a real zone. Only
// consulted when what they typed isn't already a valid zone name.
const ALIASES = {
  pacific: 'America/Los_Angeles', pt: 'America/Los_Angeles', pst: 'America/Los_Angeles', pdt: 'America/Los_Angeles',
  mountain: 'America/Denver', mt: 'America/Denver', mst: 'America/Denver', mdt: 'America/Denver',
  arizona: 'America/Phoenix',
  central: 'America/Chicago', ct: 'America/Chicago', cst: 'America/Chicago', cdt: 'America/Chicago',
  eastern: 'America/New_York', et: 'America/New_York', est: 'America/New_York', edt: 'America/New_York',
  alaska: 'America/Anchorage', hawaii: 'Pacific/Honolulu',
  uk: 'Europe/London', gmt: 'Europe/London', bst: 'Europe/London',
  cet: 'Europe/Paris', cest: 'Europe/Paris',
  utc: 'UTC',
};

// Turns whatever someone typed ("America/New_York", "america/new york",
// "EST") into the canonical zone name, or null if it isn't one.
function normalizeZone(input) {
  if (!input) return null;
  const trimmed = input.trim();
  const alias = ALIASES[trimmed.toLowerCase()];
  const candidate = alias || trimmed.replace(/\s+/g, '_');
  try {
    // Intl accepts zone names case-insensitively and reports the canonical
    // spelling back, which is exactly the validation + cleanup needed here.
    return new Intl.DateTimeFormat('en-US', { timeZone: candidate }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

// The zone this person has set, or null if they never have.
function get(userId) {
  return loadAll()[userId] || null;
}

// The zone to read this person's messages in: their own if set, otherwise
// the server-wide BOT_TIMEZONE.
function resolve(userId) {
  return get(userId) || config.timezone;
}

function set(userId, zone) {
  saveAll({ ...loadAll(), [userId]: zone });
}

function clear(userId) {
  const data = { ...loadAll() };
  delete data[userId];
  saveAll(data);
}

module.exports = { get, resolve, set, clear, normalizeZone };
