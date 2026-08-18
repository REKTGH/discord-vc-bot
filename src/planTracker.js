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

// Explicit cancellation (e.g. someone says "nevermind", or runs /cancel).
// Returns the removed plan if there was one pending, otherwise null.
function cancelPlan(guildId, userId) {
  const k = key(guildId, userId);
  const plan = pending.get(k);
  if (!plan) return null;
  pending.delete(k);
  return plan;
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

module.exports = { setPlan, hasPlan, cancelPlan, consumePlan, takeExpired, pendingCount };
