// Plain-node test harness (no framework needed) for timeParser.js.
// Run with: node test/timeParser.test.js
const assert = require('assert');
const { parseJoinTime, hasCancelIntent, localYearMonth, localMonthStartUTC } = require('../src/timeParser');

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
check('bot noise: pure emoji', '😀😀😀', morning, null);

console.log('\n=== "be on in N" and other bare-number-implies-minutes phrasing ===');
check('be on in 10, the requested example', 'be on in 10', morning, '11:10');
check('be on in 10 with trailing period', 'be on in 10.', morning, '11:10');
check('be on in 10 with trailing comma and more chat', 'be on in 10, brb', morning, '11:10');
check('on in 5', 'on in 5', morning, null); // "on in 5" alone has no join-intent keyword by itself
check('omw in 10 no unit', 'omw in 10', morning, '11:10');
check('explicit unit still works unchanged', 'omw in 10 minutes', morning, '11:10');
// Not a supported phrasing (chrono doesn't parse "10 more minutes" either) - the
// point of this case is confirming normalizeShorthand leaves it alone rather
// than mangling it into something wrong, not that it successfully resolves.
check('bare number mid-sentence NOT assumed as minutes (avoid corrupting real phrases)', 'omw, in 10 more minutes probably', morning, null);
check('single-digit trailing', 'be on in 5', morning, '11:05');

console.log('\n=== A message that\'s just a bare number ("30") implies minutes ===');
check('bare number alone, the requested example', '30', morning, '11:30');
check('bare single digit alone', '5', morning, '11:05');
check('bare number with trailing question mark', '30?', morning, '11:30');
check('bare number with trailing period', '5.', morning, '11:05');
check('bare number with surrounding whitespace', '  10  ', morning, '11:10');
check('zero is not a valid "in N minutes"', '0', morning, null);
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
