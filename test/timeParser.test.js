// Plain-node test harness (no framework needed) for timeParser.js.
// Run with: node test/timeParser.test.js
const assert = require('assert');
const {
  parseJoinTime,
  parseBareNumberAmbiguity,
  hasCancelIntent,
  localYearMonth,
  localMonthStartUTC,
} = require('../src/timeParser');

const TZ = 'America/Los_Angeles';
let pass = 0, fail = 0;

// Generic assertion-based check, for tests that don't fit the parseJoinTime-
// specific check()/checkCancel() harnesses below.
function ok(desc, fn) {
  try {
    fn();
    console.log(`PASS  ${desc}`);
    pass++;
  } catch (e) {
    console.log(`FAIL  ${desc}\n      ${e.message}`);
    fail++;
  }
}

function localStr(date) {
  return date.toLocaleString('en-US', { timeZone: TZ, weekday: 'short', hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric' });
}

function check(desc, text, referenceDate, expectedLocalHHMM, expectedDayOffsetFromRef) {
  const result = parseJoinTime(text, { timezone: TZ, referenceDate });
  try {
    if (expectedLocalHHMM === null) {
      assert.strictEqual(result, null, `expected no match, got ${result && localStr(result.targetTime)}`);
    } else {
      assert.ok(result, 'expected a match but got null');
      const got = result.targetTime.toLocaleString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: false });
      assert.strictEqual(got, expectedLocalHHMM, `expected ${expectedLocalHHMM} LA, got ${got} LA (full: ${localStr(result.targetTime)})`);
    }
    console.log(`PASS  ${desc}`);
    pass++;
  } catch (e) {
    console.log(`FAIL  ${desc}\n      ${e.message}`);
    fail++;
  }
}

// Reference: Mon Aug 17 2026, 11:00 AM Los Angeles (PDT, UTC-7)
const morning = new Date('2026-08-17T18:00:00Z');
// Reference: Mon Aug 17 2026, 8:00 PM Los Angeles
const evening = new Date('2026-08-18T03:00:00Z');
// Reference: Mon Aug 17 2026, 11:50 PM Los Angeles (near midnight, day-rollover risk)
const lateNight = new Date('2026-08-18T06:50:00Z');

console.log('=== Explicit am/pm and relative durations ===');
check('explicit pm today', 'joining at 9pm', morning, '21:00');
check('explicit am tomorrow-ish stays today if future', 'joining at 2pm', morning, '14:00');
check('relative minutes with "in"', 'omw, be there in 10 min', morning, '11:10');
check('relative minutes shorthand no "in"', 'joining, 10 min', morning, '11:10');
check('relative "in an hour"', 'be there in an hour', morning, '12:00');
check('colon time with explicit pm', 'hopping on at 9:30pm', morning, '21:30');

console.log('\n=== Ambiguous bare-hour disambiguation (the tricky part) ===');
check('bare hour in the morning ref -> should mean tonight, not tomorrow AM', 'joining at 9', morning, '21:00');
check('bare hour in the evening ref, hour already passed as PM -> next occurrence', 'joining at 9', evening, '21:00'); // 8pm ref, 9pm still ahead same night
check('bare hour near midnight rolling to next day', 'joining at 1', lateNight, '01:00');

console.log('\n=== Messages that should NOT match ===');
check('no intent keyword', 'the meeting is at 9pm', morning, null);
check('intent keyword but no time', 'omw', morning, null);
check('unrelated number', 'random message about 9 apples', morning, null);
check('far future date mention ignored', 'joining next friday at 9pm', morning, null);

// Relative hours past MAX_FUTURE_HOURS (12) are ignored however the unit is
// written - a unit glued to the number ("13h") used to be re-snapped to the
// nearest clock hour, so it slipped past the bound as ~1 hour away.
check('on in 13 hours is out of range', 'on in 13 hours', morning, null);
check('on in 13h is out of range', 'on in 13h', morning, null);
check('on in 13hrs is out of range', 'on in 13hrs', morning, null);
check('be on in 13hours is out of range', 'be on in 13hours', morning, null);
check('on in 13.5 hours is out of range, not 13 minutes', 'on in 13.5 hours', morning, null);
check('in 2h is exactly two hours out', 'joining in 2h', morning, '13:00');
check('in 11h is still within range', 'on in 11h', morning, '22:00');
check('in 1h30m', 'on in 1h30m', morning, '12:30');
check('bot noise: pure emoji', '😀😀😀', morning, null);

console.log('\n=== "be on in N" and other bare-number-implies-minutes phrasing ===');
check('be on in 10, the requested example', 'be on in 10', morning, '11:10');
check('be on in 10 with trailing period', 'be on in 10.', morning, '11:10');
check('be on in 10 with trailing comma and more chat', 'be on in 10, brb', morning, '11:10');
// "on in N" / "on at N" became a real intent phrase in v17 - this deliberately
// used to expect null. The trade-off (an unrelated "the movie was on at 10"
// now matches too) was an explicit, accepted call - see INTENT_PATTERNS.
check('on in 5', 'on in 5', morning, '11:05');
check('omw in 10 no unit', 'omw in 10', morning, '11:10');
check('explicit unit still works unchanged', 'omw in 10 minutes', morning, '11:10');
// Not a supported phrasing (chrono doesn't parse "10 more minutes" either) - the
// point of this case is confirming normalizeShorthand leaves it alone rather
// than mangling it into something wrong, not that it successfully resolves.
check('bare number mid-sentence NOT assumed as minutes (avoid corrupting real phrases)', 'omw, in 10 more minutes probably', morning, null);
check('single-digit trailing', 'be on in 5', morning, '11:05');

console.log('\n=== A message that\'s just a bare number ("30") implies minutes ===');
check('bare number alone, the requested example', '30', morning, '11:30');
check('bare number with trailing question mark', '30?', morning, '11:30');
check('bare number with surrounding whitespace', '  45  ', morning, '11:45');
check('zero is not a valid "in N minutes"', '0', morning, null);
// A bare number small enough to also be a clock hour is ambiguous ("5" could
// be 5 minutes or 5 o'clock), so as of v17 parseJoinTime deliberately declines
// to guess and returns null - the bot asks instead. These three used to assert
// the silent minutes reading. See parseBareNumberAmbiguity coverage below.
check('bare single digit alone is ambiguous - not resolved silently', '5', morning, null);
check('bare number with trailing period, still ambiguous', '5.', morning, null);
check('bare 10 is ambiguous (10 minutes vs 10 o clock)', '  10  ', morning, null);
check('12 is the largest ambiguous bare number', '12', morning, null);
check('13 is past a clock hour, so it resolves straight to minutes', '13', morning, '11:13');
check('number far outside the plausible-minutes range is ignored', '9999', morning, null);
check('year-like number is ignored (exceeds the bound)', '2026', morning, null);
check('number embedded in an unrelated sentence still needs a real intent phrase', 'we scored 30 points', morning, null);
check('number plus extra words is not "bare" - falls back to normal intent rules', '30 dollars', morning, null);

console.log('\n=== hasCancelIntent ===');
function checkCancel(desc, text, expected) {
  try {
    assert.strictEqual(hasCancelIntent(text), expected);
    console.log(`PASS  ${desc}`);
    pass++;
  } catch (e) {
    console.log(`FAIL  ${desc}\n      ${e.message}`);
    fail++;
  }
}
checkCancel('"nevermind" alone', 'nevermind', true);
checkCancel('"nvm" short form', 'nvm', true);
checkCancel('"never mind" two words', 'never mind guys', true);
checkCancel('mixed case', 'NVM', true);
checkCancel('unrelated message', 'joining at 9', false);
checkCancel('empty string', '', false);

console.log('\n=== localYearMonth / localMonthStartUTC (used by the monthly awards feature) ===');
ok('localYearMonth reads the calendar month in the target timezone, not UTC', () => {
  assert.deepStrictEqual(localYearMonth(new Date('2026-08-15T12:00:00Z'), TZ), { year: 2026, month: 8 });
});
ok('localYearMonth: a UTC instant just after midnight can still be the previous day/month locally', () => {
  // Sept 1, 3am UTC = Aug 31, 8pm in LA (PDT, UTC-7) - still August locally.
  assert.deepStrictEqual(localYearMonth(new Date('2026-09-01T03:00:00Z'), TZ), { year: 2026, month: 8 });
});
ok('localYearMonth: December/January year boundary wraps correctly', () => {
  // Jan 1, 3am UTC = Dec 31, 7pm in LA (PST, UTC-8) the year before.
  assert.deepStrictEqual(localYearMonth(new Date('2027-01-01T03:00:00Z'), TZ), { year: 2026, month: 12 });
});
ok('localMonthStartUTC resolves local midnight on the 1st, honoring DST (PDT in August)', () => {
  // Aug 1 2026 midnight Pacific (PDT, UTC-7) = 07:00 UTC the same day.
  assert.strictEqual(localMonthStartUTC(2026, 8, TZ), Date.UTC(2026, 7, 1, 7, 0, 0));
});
ok('localMonthStartUTC honors standard time (PST) for a winter month', () => {
  // Jan 1 2026 midnight Pacific (PST, UTC-8) = 08:00 UTC the same day.
  assert.strictEqual(localMonthStartUTC(2026, 1, TZ), Date.UTC(2026, 0, 1, 8, 0, 0));
});

console.log('\n=== v17: new intent phrases ("getting on", "game in/at", "on in/at") ===');
check('getting on at an hour', 'getting on at 9', morning, '21:00');
check('getting on in N minutes', 'getting on in 10', morning, '11:10');
check('gettin on, dropped g', 'gettin on in 10', morning, '11:10');
check('game in N minutes', 'game in 10', morning, '11:10');
check('game at an hour', 'game at 9', morning, '21:00');
check('on at an hour', 'on at 9', morning, '21:00');
check('"getting on" with no time at all is still not a plan', 'getting on', morning, null);
// The accepted cost of the unguarded "on in/at" phrase - documented, not a bug.
check('KNOWN trade-off: an unrelated "on at" sentence now matches', 'the movie was on at 9', morning, '21:00');

console.log('\n=== v17: a message that is just a clock time ("10:30", "10pm") ===');
check('bare HH:MM resolves to the next occurrence of that time', '10:30', morning, '22:30');
check('bare HH:MM in the morning ref that has not passed yet', '11:30', morning, '11:30');
check('bare hour with pm', '10pm', morning, '22:00');
check('bare hour with a space before pm', '10 pm', morning, '22:00');
check('bare hour with am', '11am', lateNight, '11:00');
check('bare HH:MM with meridiem', '10:30 pm', morning, '22:30');
check('bare clock time with trailing punctuation', '10:30!', morning, '22:30');
check('nonsense clock time is rejected, not coerced', '99:99', morning, null);
check('a bare HH:MM is a clock time, never minutes', '1:05', morning, '13:05');

console.log('\n=== v17: ambiguous bare numbers are surfaced, not guessed ===');
ok('parseBareNumberAmbiguity offers both readings for a bare "10"', () => {
  const r = parseBareNumberAmbiguity('10', { timezone: TZ, referenceDate: morning });
  assert.ok(r, 'expected an ambiguity result');
  assert.strictEqual(r.value, 10);
  const mins = r.minutes.targetTime.toLocaleString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: false });
  const clock = r.clock.targetTime.toLocaleString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: false });
  assert.strictEqual(mins, '11:10', 'minutes reading should be 10 minutes from the 11:00 reference');
  assert.strictEqual(clock, '22:00', 'clock reading should be the next 10 o clock');
});
ok('parseBareNumberAmbiguity ignores numbers too large to be a clock hour', () => {
  assert.strictEqual(parseBareNumberAmbiguity('30', { timezone: TZ, referenceDate: morning }), null);
});
ok('parseBareNumberAmbiguity ignores anything that is not a lone number', () => {
  assert.strictEqual(parseBareNumberAmbiguity('vc at 10', { timezone: TZ, referenceDate: morning }), null);
  assert.strictEqual(parseBareNumberAmbiguity('10:30', { timezone: TZ, referenceDate: morning }), null);
  assert.strictEqual(parseBareNumberAmbiguity('', { timezone: TZ, referenceDate: morning }), null);
});
ok('parseBareNumberAmbiguity handles trailing punctuation and whitespace like the parser does', () => {
  assert.ok(parseBareNumberAmbiguity('  10.  ', { timezone: TZ, referenceDate: morning }));
});
ok('the two readings are genuinely different times (otherwise there is nothing to ask)', () => {
  const r = parseBareNumberAmbiguity('9', { timezone: TZ, referenceDate: morning });
  assert.notStrictEqual(r.minutes.targetTime.getTime(), r.clock.targetTime.getTime());
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
