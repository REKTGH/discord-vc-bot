// timeParser.js
//
// Turns a normal chat message like "omw, joining in 10 min" or "be there at 9"
// into an actual target Date, in the server's configured timezone.
//
// Why this file is more careful than you might expect: bare hour mentions like
// "at 9" are genuinely ambiguous (9 AM or 9 PM?), and getting the timezone math
// wrong silently produces "you were 12 hours late" nonsense. Both cases are
// handled explicitly below and covered by test/timeParser.test.js.

const chrono = require('chrono-node');

// Phrases that signal "I'm telling you when I'll join voice chat".
// A message needs at least one of these AND a parseable time before we track it,
// so we don't fire on unrelated messages that merely contain a number.
const INTENT_PATTERNS = [
  /\bomw\b/i,
  /\bon my way\b/i,
  /\bjoin(?:ing)?\b/i,
  /\bhop(?:ping)?\s*on\b/i,
  /\bpull(?:ing)?\s*up\b/i,
  /\bbe there\b/i,
  /\bbe on\b/i,
  /\bheading (?:over|on|in|out)?\b/i,
  /\bcoming\b(?!\s+from)/i,
  /\b(vc|voice\s*chat|voice\s*call)\b/i,
];

// Phrases that call off a plan that was already stated ("nvm, joining at 9" is
// handled separately as a plan update - this is for a standalone "nevermind").
const CANCEL_PATTERNS = [/\bnevermind\b/i, /\bnever mind\b/i, /\bnvm\b/i];

function hasCancelIntent(text) {
  return !!text && CANCEL_PATTERNS.some((re) => re.test(text));
}

// Ignore/ discard plans further out than this, or further in the past than this -
// these are almost certainly unrelated mentions of a number/time, not a VC plan.
const MAX_FUTURE_HOURS = 12;
const MAX_PAST_MINUTES = 2;

function hasJoinIntent(text) {
  return INTENT_PATTERNS.some((re) => re.test(text));
}

// This bot is for "I'm joining VC right now / in a few minutes" plans, not
// scheduling. Explicit weekday mentions ("next Friday") are out of scope and
// chrono's weekday resolution can interact oddly with a same-message time-of-day
// ("next friday at 9pm"), so bail out early rather than risk a wrong-day match.
const WEEKDAY_MENTION = /\b(next|this|last)?\s*(mon|tues?|wednes|thurs?|fri|sat(?:ur)?|sun)(day)?\b/i;

function mentionsWeekday(text) {
  return WEEKDAY_MENTION.test(text);
}

// "10 min" / "10 mins" / "5m" without a leading "in"/"at" -> "in 10 minutes",
// so chrono treats it as a relative time instead of failing to match at all.
function normalizeShorthand(text) {
  let out = text.replace(
    /\b(\d{1,3})\s*(m|min|mins|minute|minutes)\b/gi,
    (match, num, _unit, offset, str) => {
      const before = str.slice(0, offset).trimEnd();
      if (/\b(in|at)$/i.test(before)) return match;
      return `in ${num} minutes`;
    }
  );

  // Bare "in 10" with nothing but punctuation (or the end of the message)
  // after the number - assume minutes, the near-universal casual meaning
  // ("be on in 10" == "in 10 minutes"). Anchored to end-of-clause so this
  // doesn't touch something like "in 10 more minutes" or "in 10 years".
  out = out.replace(
    /\bin\s+(\d{1,3})\b(?=\s*(?:[,.!?;]|$))/gi,
    (_match, num) => `in ${num} minutes`
  );

  return out;
}

// Minutes to add to a UTC instant to get the local wall-clock time in `timeZone`.
// e.g. Los Angeles in summer (PDT, UTC-7) -> -420.
function getTimezoneOffsetMinutes(timeZone, date) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = {};
  for (const p of dtf.formatToParts(date)) {
    if (p.type !== 'literal') parts[p.type] = p.value;
  }
  const asUTC = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return Math.round((asUTC - date.getTime()) / 60000);
}

// Build the UTC instant for a specific wall-clock hour:minute, `dayOffset` days
// from referenceDate's local calendar day in `timeZone`. Re-derives the DST
// offset at the guessed instant so day-of-transition edge cases stay correct.
function buildLocalDate(timeZone, referenceDate, dayOffset, hour, minute) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const parts = {};
  for (const p of dtf.formatToParts(referenceDate)) {
    if (p.type !== 'literal') parts[p.type] = p.value;
  }
  const wallUTC = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  wallUTC.setUTCDate(wallUTC.getUTCDate() + dayOffset);
  const y = wallUTC.getUTCFullYear();
  const m = wallUTC.getUTCMonth() + 1;
  const d = wallUTC.getUTCDate();

  const approxOffset = getTimezoneOffsetMinutes(timeZone, referenceDate);
  let guessUTC = Date.UTC(y, m - 1, d, hour, minute) - approxOffset * 60000;
  const refinedOffset = getTimezoneOffsetMinutes(timeZone, new Date(guessUTC));
  guessUTC = Date.UTC(y, m - 1, d, hour, minute) - refinedOffset * 60000;
  return new Date(guessUTC);
}

// For an hour mentioned without am/pm ("at 9"), find the soonest occurrence of
// that clock hour that isn't already in the past - could be AM or PM, today or
// tomorrow. "at 9" said at 8pm should mean "9pm tonight", not "9am tomorrow".
function closestFutureHourCandidate(hour, minute, timeZone, referenceDate) {
  const baseHour = hour % 12;
  const candidates = [];
  for (const dayOffset of [0, 1]) {
    for (const h of [baseHour, baseHour + 12]) {
      candidates.push(buildLocalDate(timeZone, referenceDate, dayOffset, h, minute));
    }
  }
  candidates.sort((a, b) => a.getTime() - b.getTime());
  const cutoff = referenceDate.getTime() - MAX_PAST_MINUTES * 60000;
  return candidates.find((d) => d.getTime() >= cutoff) ?? candidates[0];
}

/**
 * @param {string} text - raw message content
 * @param {object} opts
 * @param {string} opts.timezone - IANA zone, e.g. "America/Los_Angeles"
 * @param {Date} opts.referenceDate - "now" (injectable for tests)
 * @returns {{ targetTime: Date, matchedText: string } | null}
 */
function parseJoinTime(text, { timezone = 'America/Los_Angeles', referenceDate = new Date() } = {}) {
  if (!text || !hasJoinIntent(text)) return null;
  if (mentionsWeekday(text)) return null;

  const normalized = normalizeShorthand(text);
  const offsetMin = getTimezoneOffsetMinutes(timezone, referenceDate);
  const results = chrono.parse(normalized, { instant: referenceDate, timezone: offsetMin }, { forwardDate: true });
  if (!results.length) return null;

  const r = results[0];
  const hour = r.start.get('hour');
  if (hour === null) return null;
  const minute = r.start.get('minute') ?? 0;

  let target = r.start.date();

  const isDurationPhrase = /\b(minute|minutes|min|mins|hour|hours|hr|hrs|second|seconds|sec|secs)\b/i.test(r.text);
  const hasMeridiemText = /\b(am|pm|a\.m\.|p\.m\.)\b/i.test(r.text);
  if (!hasMeridiemText && !isDurationPhrase) {
    target = closestFutureHourCandidate(hour, minute, timezone, referenceDate);
  }

  const diffMs = target.getTime() - referenceDate.getTime();
  const diffHours = diffMs / 3600000;
  if (diffHours > MAX_FUTURE_HOURS) return null;
  if (diffMs < -MAX_PAST_MINUTES * 60000) return null;

  return { targetTime: target, matchedText: r.text };
}

module.exports = {
  parseJoinTime,
  hasJoinIntent,
  hasCancelIntent,
  getTimezoneOffsetMinutes,
  normalizeShorthand,
};
