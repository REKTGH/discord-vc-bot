// db.js — leaderboard storage, as a plain JSON file.
//
// Why not a real database: this bot's write volume is tiny (one record per
// voice join), and a JSON file needs zero native compilation - which matters
// a lot for a project a first-time coder needs to `npm install` on their own
// machine and again on a free host with no help from you. One less thing
// that can fail.
const fs = require('fs');
const path = require('path');
const config = require('./config');

const filePath = config.dbPath;

function loadAll() {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    if (err.code === 'ENOENT') return []; // no file yet - first run
    console.warn(`Could not read ${filePath} (${err.message}); starting fresh. The file may be corrupted.`);
    return [];
  }
}

function saveAll(records) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  // Write to a temp file then rename, so a crash mid-write can't corrupt the real file.
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(records));
  fs.renameSync(tmpPath, filePath);
}

// `result.status` is one of 'on_time' | 'early' | 'late' | 'no_show' | 'cancelled'.
// For a no-show or a cancellation there's no actual join, so actualTime/diffSeconds are null.
function recordResult(result) {
  const records = loadAll();
  records.push({
    guildId: result.guildId,
    userId: result.userId,
    username: result.username,
    targetTime: result.targetTime.getTime(),
    actualTime: result.actualTime ? result.actualTime.getTime() : null,
    diffSeconds: result.diffSeconds ?? null,
    status: result.status,
    rawText: result.rawText || null,
    createdAt: Date.now(),
  });
  saveAll(records);
}

// Aggregated per-user stats for a guild, ranked for /leaderboard:
// latest average lateness first, down to least late (earliest) last.
// Ties broken by whoever has more tracked joins (more data behind the number).
// No-shows and cancellations don't count toward the average (there's no "how
// late" to average in - they never showed, or called it off beforehand) but
// are each tallied separately and shown alongside the ranking.
function getLeaderboard(guildId, limit = 10) {
  const records = loadAll().filter((r) => r.guildId === guildId);

  const byUser = new Map();
  function statsFor(r) {
    if (!byUser.has(r.userId)) {
      byUser.set(r.userId, { userId: r.userId, username: r.username, totalCount: 0, onTimeCount: 0, diffSecondsSum: 0, noShowCount: 0, cancelCount: 0 });
    }
    const stats = byUser.get(r.userId);
    stats.username = r.username; // keep most-recent display name
    return stats;
  }

  for (const r of records) {
    if (r.status === 'no_show') {
      statsFor(r).noShowCount += 1;
      continue;
    }
    if (r.status === 'cancelled') {
      statsFor(r).cancelCount += 1;
      continue;
    }
    const stats = statsFor(r);
    stats.totalCount += 1;
    stats.diffSecondsSum += r.diffSeconds;
    if (r.status === 'on_time') stats.onTimeCount += 1;
  }

  return [...byUser.values()]
    .filter((s) => s.totalCount > 0) // exclude users with only no-show records - nothing to rank on
    .map((s) => ({ ...s, avgDiffSeconds: s.diffSecondsSum / s.totalCount, onTimeRate: s.onTimeCount / s.totalCount }))
    .sort((a, b) => b.avgDiffSeconds - a.avgDiffSeconds || b.totalCount - a.totalCount)
    .slice(0, limit);
}

module.exports = { recordResult, getLeaderboard };
