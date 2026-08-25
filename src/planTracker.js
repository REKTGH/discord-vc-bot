// planTracker.js — holds "I said I'd join at X" plans in memory between the
// chat message and the actual voice join. Deliberately in-memory (not the
// database): these are short-lived, and it keeps the hot path simple. See
// README "Known limitations" for what that trade-off means on restarts.
const config = require('./config');

// key: `${guildId}:${userId}` -> plan
const pending = new Map();

function key(guildId, userId) {
  return `${guildId}:${userId}`;
}

function setPlan(plan) {
  pending.set(key(plan.guildId, plan.userId), plan);
}

function hasPlan(guildId, userId) {
  return pending.has(key(guildId, userId));
}

// The most recent cancellation per user, kept only so an accidental one can be
// taken back (see restoreLastCancelled and /uncancel). "nvm" gets typed at a
// friend mid-conversation far more often than it gets typed at the bot, and
// before this the bot would silently eat a real plan and log a Cancels mark
// for it. Only the latest cancellation is kept: undo is for the mistake you
// just made, not an archive.
// key: `${guildId}:${userId}` -> { plan, recorded, cancelledAt }
const lastCancelled = new Map();

// Explicit cancellation (e.g. someone says "nevermind", or runs /cancel).
// Returns the removed plan if there was one pending, otherwise null.
//
// `recorded` says whether the caller also wrote a 'cancelled' row to the
// leaderboard for this. A chat "nvm" does (it counts as real flaking);
// /cancel deliberately doesn't (it's for correcting the bot). Remembering
// which it was is what lets /uncancel put the leaderboard back exactly as
// it found it, without guessing.
function cancelPlan(guildId, userId, { recorded = false } = {}) {
  const k = key(guildId, userId);
  const plan = pending.get(k);
  if (!plan) return null;
  pending.delete(k);
  lastCancelled.set(k, { plan, recorded, cancelledAt: Date.now() });
  return plan;
}

// Whether there's a cancellation this user could still take back.
function hasRestorableCancellation(guildId, userId) {
  const entry = lastCancelled.get(key(guildId, userId));
  return Boolean(entry) && !isPastNoShowWindow(entry.plan);
}

// Puts the most recently cancelled plan back as pending. Returns
// { plan, recorded } so the caller knows whether it also needs to remove the
// matching leaderboard row, or null if there's nothing to restore - including
// when the plan has since aged past the no-show window, where putting it back
// would only produce an instant no-show note.
function restoreLastCancelled(guildId, userId) {
  const k = key(guildId, userId);
  const entry = lastCancelled.get(k);
  if (!entry) return null;
  lastCancelled.delete(k);
  if (isPastNoShowWindow(entry.plan)) return null;
  pending.set(k, entry.plan);
  return { plan: entry.plan, recorded: entry.recorded };
}

function isPastNoShowWindow(plan, now = Date.now()) {
  const windowMs = config.planExpiryHours * 60 * 60 * 1000;
  return now - plan.targetTime.getTime() > windowMs;
}

// Removes and returns the plan if one exists and is still within the
// no-show window; otherwise null. Used when someone actually joins voice.
function consumePlan(guildId, userId) {
  const k = key(guildId, userId);
  const plan = pending.get(k);
  if (!plan) return null;
  pending.delete(k);
  if (isPastNoShowWindow(plan)) return null; // already past the no-show cutoff
  return plan;
}

// Removes and returns every plan that's past the no-show window (measured
// from the *stated join time*, not from when it was announced) so the caller
// can post a no-show note for each. Called periodically from index.js.
function takeExpired() {
  const now = Date.now();
  const expired = [];
  for (const [k, plan] of pending) {
    if (isPastNoShowWindow(plan, now)) {
      expired.push(plan);
      pending.delete(k);
    }
  }
  return expired;
}

function pendingCount() {
  return pending.size;
}

module.exports = {
  setPlan,
  hasPlan,
  cancelPlan,
  hasRestorableCancellation,
  restoreLastCancelled,
  consumePlan,
  takeExpired,
  pendingCount,
};
