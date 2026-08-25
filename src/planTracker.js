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

// Reads the pending plan without removing it, unlike consumePlan. Used when
// something needs to inspect a plan and leave it in place - e.g. working out
// whether someone's current plan came from the shared-plan reaction they just
// took back (see reactionHandler.js).
function peekPlan(guildId, userId) {
  return pending.get(key(guildId, userId)) ?? null;
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
  forgetStalePlanMessages(now);
  return expired;
}

function pendingCount() {
  return pending.size;
}

// --- shared plans: one stated time, several people tracked against it ---
//
// When someone announces a plan (or runs /track), the bot marks that message
// with a clock reaction. Anyone else who adds the same reaction is opting in
// to be held to the same time. That means remembering which chat message
// announced which plan, so a reaction arriving later can be traced back to a
// target time. Same in-memory, short-lived reasoning as `pending` above.
//
// key: messageId -> { guildId, textChannelId, targetTime, ownerId, rawText, createdAt }
const planMessages = new Map();

function rememberPlanMessage(messageId, info) {
  planMessages.set(messageId, { ...info, createdAt: Date.now() });
}

function getPlanMessage(messageId) {
  return planMessages.get(messageId) ?? null;
}

// Drops plan messages whose time is far enough past that nobody could still
// meaningfully opt in. Called from takeExpired so the two age out together
// and this map can't grow without bound on a busy server.
function forgetStalePlanMessages(now = Date.now()) {
  const windowMs = config.planExpiryHours * 60 * 60 * 1000;
  for (const [messageId, info] of planMessages) {
    if (now - info.targetTime.getTime() > windowMs) planMessages.delete(messageId);
  }
  for (const [messageId, q] of ambiguityQuestions) {
    // Both readings are gone by the time the later of the two has aged out.
    const latest = Math.max(q.minutesTarget.getTime(), q.clockTarget.getTime());
    if (now - latest > windowMs) ambiguityQuestions.delete(messageId);
  }
}

// --- unanswered "did you mean minutes or o'clock?" prompts ---
//
// A bare "10" could mean either, so instead of guessing the bot asks by
// putting both options on the message as reactions. Until the author picks
// one there is no plan yet - just this question, waiting.
//
// key: messageId -> { guildId, userId, textChannelId, minutesTarget, clockTarget, rawText }
const ambiguityQuestions = new Map();

function rememberAmbiguityQuestion(messageId, info) {
  ambiguityQuestions.set(messageId, { ...info, askedAt: Date.now() });
}

function getAmbiguityQuestion(messageId) {
  return ambiguityQuestions.get(messageId) ?? null;
}

function forgetAmbiguityQuestion(messageId) {
  return ambiguityQuestions.delete(messageId);
}

module.exports = {
  setPlan,
  hasPlan,
  peekPlan,
  cancelPlan,
  hasRestorableCancellation,
  restoreLastCancelled,
  consumePlan,
  takeExpired,
  pendingCount,
  rememberPlanMessage,
  getPlanMessage,
  forgetStalePlanMessages,
  rememberAmbiguityQuestion,
  getAmbiguityQuestion,
  forgetAmbiguityQuestion,
};
