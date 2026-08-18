// Sanity checks for the pieces that don't need a real Discord connection:
// verdict classification, plan tracking (including expiry), and the JSON
// leaderboard roundtrip. Run with: node test/core.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Use throwaway data files for this test run so it never touches real data.
const testDbPath = path.join(__dirname, '.tmp-test.json');
const testLivePath = path.join(__dirname, '.tmp-test-live.json');
for (const p of [testDbPath, `${testDbPath}.tmp`, testLivePath, `${testLivePath}.tmp`]) {
  if (fs.existsSync(p)) fs.unlinkSync(p);
}
process.env.DB_PATH = testDbPath;
process.env.LIVE_LEADERBOARD_PATH = testLivePath;
process.env.PLAN_EXPIRY_HOURS = '3';
process.env.GRACE_PERIOD_MINUTES = '2';

const { classify } = require('../src/verdict');
const planTracker = require('../src/planTracker');
const { recordResult, getLeaderboard } = require('../src/db');
const { buildLeaderboardEmbed } = require('../src/leaderboardView');
const liveLeaderboardStore = require('../src/liveLeaderboardStore');

let pass = 0, fail = 0;
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

console.log('=== verdict.classify ===');
ok('exactly on time', () => assert.strictEqual(classify(0).status, 'on_time'));
ok('1 min late is within grace -> on time', () => assert.strictEqual(classify(60 * 1000).status, 'on_time'));
ok('5 min late -> late', () => assert.strictEqual(classify(5 * 60 * 1000).status, 'late'));
ok('5 min early -> early', () => assert.strictEqual(classify(-5 * 60 * 1000).status, 'early'));
ok('late label includes minute count', () => assert.strictEqual(classify(7 * 60 * 1000).label, 'late by 7 min'));

console.log('\n=== planTracker ===');
ok('set then consume returns the plan', () => {
  planTracker.setPlan({ userId: 'u1', username: 'Dave', guildId: 'g1', textChannelId: 'c1', targetTime: new Date(), announcedAt: new Date(), rawText: 'joining at 9' });
  const plan = planTracker.consumePlan('g1', 'u1');
  assert.ok(plan);
  assert.strictEqual(plan.username, 'Dave');
});
ok('consuming twice returns null the second time', () => {
  planTracker.setPlan({ userId: 'u2', username: 'Sam', guildId: 'g1', textChannelId: 'c1', targetTime: new Date(), announcedAt: new Date(), rawText: 'omw' });
  planTracker.consumePlan('g1', 'u2');
  const second = planTracker.consumePlan('g1', 'u2');
  assert.strictEqual(second, null);
});
ok('plan past the no-show window (target 4h ago, window=3h) is dropped on join', () => {
  const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000);
  planTracker.setPlan({ userId: 'u3', username: 'Old', guildId: 'g1', textChannelId: 'c1', targetTime: fourHoursAgo, announcedAt: fourHoursAgo, rawText: 'joining at 9' });
  const plan = planTracker.consumePlan('g1', 'u3');
  assert.strictEqual(plan, null);
});
ok('plans are isolated per guild', () => {
  planTracker.setPlan({ userId: 'u1', username: 'Dave', guildId: 'g2', textChannelId: 'c1', targetTime: new Date(), announcedAt: new Date(), rawText: 'omw' });
  assert.strictEqual(planTracker.consumePlan('g1', 'u1'), null); // was already consumed from g1 above
  assert.ok(planTracker.consumePlan('g2', 'u1'));
});
ok('hasPlan reflects pending state', () => {
  assert.strictEqual(planTracker.hasPlan('g1', 'u4'), false);
  planTracker.setPlan({ userId: 'u4', username: 'Lee', guildId: 'g1', textChannelId: 'c1', targetTime: new Date(), announcedAt: new Date(), rawText: 'omw' });
  assert.strictEqual(planTracker.hasPlan('g1', 'u4'), true);
  planTracker.consumePlan('g1', 'u4');
  assert.strictEqual(planTracker.hasPlan('g1', 'u4'), false);
});
ok('cancelPlan removes a pending plan and returns it (or null if nothing was pending)', () => {
  const targetTime = new Date();
  planTracker.setPlan({ userId: 'u5', username: 'Kim', guildId: 'g1', textChannelId: 'c1', targetTime, announcedAt: new Date(), rawText: 'omw' });
  const cancelled = planTracker.cancelPlan('g1', 'u5');
  assert.ok(cancelled);
  assert.strictEqual(cancelled.username, 'Kim');
  assert.strictEqual(cancelled.targetTime, targetTime);
  assert.strictEqual(planTracker.hasPlan('g1', 'u5'), false);
  assert.strictEqual(planTracker.cancelPlan('g1', 'u5'), null); // nothing left to cancel
});
ok('cancelled plan never surfaces as a no-show', () => {
  const twentyHoursAgoTarget = new Date(Date.now() - 20 * 60 * 60 * 1000); // well past the 3h test window
  planTracker.setPlan({ userId: 'u6', username: 'Jo', guildId: 'g1', textChannelId: 'c1', targetTime: twentyHoursAgoTarget, announcedAt: twentyHoursAgoTarget, rawText: 'omw' });
  planTracker.cancelPlan('g1', 'u6');
  const expired = planTracker.takeExpired();
  assert.ok(!expired.some((p) => p.userId === 'u6'));
});
ok('takeExpired removes and returns only plans past the no-show window', () => {
  const longAgo = new Date(Date.now() - 10 * 60 * 60 * 1000); // past the 3h test window
  const justNow = new Date(); // well within the window
  planTracker.setPlan({ userId: 'expired-user', username: 'Ghost', guildId: 'g1', textChannelId: 'c1', targetTime: longAgo, announcedAt: longAgo, rawText: 'joining at 9' });
  planTracker.setPlan({ userId: 'fresh-user', username: 'Fresh', guildId: 'g1', textChannelId: 'c1', targetTime: justNow, announcedAt: justNow, rawText: 'omw' });

  const expired = planTracker.takeExpired();
  assert.ok(expired.some((p) => p.userId === 'expired-user'));
  assert.ok(!expired.some((p) => p.userId === 'fresh-user'));
  // expired plan is gone from pending; fresh one is still there
  assert.strictEqual(planTracker.hasPlan('g1', 'expired-user'), false);
  assert.strictEqual(planTracker.hasPlan('g1', 'fresh-user'), true);
  planTracker.cancelPlan('g1', 'fresh-user'); // tidy up for later tests
});

console.log('\n=== db (JSON file) leaderboard roundtrip ===');
ok('ranks latest (most late on average) first, least late (or early) last', () => {
  const now = new Date();
  // Dave: 2 records, barely late on average (15s)
  recordResult({ guildId: 'gTest', userId: 'dave', username: 'Dave', targetTime: now, actualTime: now, diffSeconds: 0, status: 'on_time', rawText: 'x' });
  recordResult({ guildId: 'gTest', userId: 'dave', username: 'Dave', targetTime: now, actualTime: now, diffSeconds: 30, status: 'on_time', rawText: 'x' });
  // Sam: 1 record, late by 10 min - should outrank Dave despite a "worse" on-time rate not being the point anymore
  recordResult({ guildId: 'gTest', userId: 'sam', username: 'Sam', targetTime: now, actualTime: now, diffSeconds: 600, status: 'late', rawText: 'x' });
  // Early Emma: consistently early - least late of the three, should rank last
  recordResult({ guildId: 'gTest', userId: 'emma', username: 'Early Emma', targetTime: now, actualTime: now, diffSeconds: -300, status: 'early', rawText: 'x' });

  const board = getLeaderboard('gTest', 10);
  assert.strictEqual(board.length, 3);
  assert.strictEqual(board[0].username, 'Sam'); // latest on average ranks first now
  assert.strictEqual(board[0].totalCount, 1);
  assert.strictEqual(board[1].username, 'Dave');
  assert.strictEqual(board[2].username, 'Early Emma'); // least late (most early) ranks last
});
ok('ties in average lateness are broken by whoever has more tracked joins', () => {
  const now = new Date();
  recordResult({ guildId: 'gTie', userId: 'once', username: 'Once', targetTime: now, actualTime: now, diffSeconds: 120, status: 'late', rawText: 'x' });
  recordResult({ guildId: 'gTie', userId: 'twice', username: 'Twice', targetTime: now, actualTime: now, diffSeconds: 120, status: 'late', rawText: 'x' });
  recordResult({ guildId: 'gTie', userId: 'twice', username: 'Twice', targetTime: now, actualTime: now, diffSeconds: 120, status: 'late', rawText: 'x' });

  const board = getLeaderboard('gTie', 10);
  assert.strictEqual(board[0].username, 'Twice'); // same avg lateness, more tracked joins wins the tiebreak
  assert.strictEqual(board[1].username, 'Once');
});
ok('leaderboard is isolated per guild', () => {
  const board = getLeaderboard('some-other-guild-with-no-data', 10);
  assert.strictEqual(board.length, 0);
});
ok('no-show records store without crashing and carry a no-show count', () => {
  const now = new Date();
  recordResult({ guildId: 'gNoShow', userId: 'dave', username: 'Dave', targetTime: now, actualTime: now, diffSeconds: 0, status: 'on_time', rawText: 'x' });
  recordResult({ guildId: 'gNoShow', userId: 'dave', username: 'Dave', targetTime: now, actualTime: null, diffSeconds: null, status: 'no_show', rawText: 'x' });

  const board = getLeaderboard('gNoShow', 10);
  assert.strictEqual(board.length, 1);
  assert.strictEqual(board[0].totalCount, 1); // no-show doesn't inflate "times tracked"
  assert.strictEqual(board[0].noShowCount, 1);
  assert.strictEqual(board[0].onTimeRate, 1); // no-show doesn't drag down the on-time rate either
});
ok('a user with only no-show records is excluded from ranking (nothing to rank on)', () => {
  const now = new Date();
  recordResult({ guildId: 'gOnlyNoShow', userId: 'ghost', username: 'Ghost', targetTime: now, actualTime: null, diffSeconds: null, status: 'no_show', rawText: 'x' });
  const board = getLeaderboard('gOnlyNoShow', 10);
  assert.strictEqual(board.length, 0);
});
ok('cancelled records store without crashing and carry a cancel count', () => {
  const now = new Date();
  recordResult({ guildId: 'gCancel', userId: 'dave', username: 'Dave', targetTime: now, actualTime: now, diffSeconds: 0, status: 'on_time', rawText: 'x' });
  recordResult({ guildId: 'gCancel', userId: 'dave', username: 'Dave', targetTime: now, actualTime: null, diffSeconds: null, status: 'cancelled', rawText: 'nvm' });

  const board = getLeaderboard('gCancel', 10);
  assert.strictEqual(board.length, 1);
  assert.strictEqual(board[0].totalCount, 1); // a cancellation doesn't inflate "times tracked"
  assert.strictEqual(board[0].cancelCount, 1);
  assert.strictEqual(board[0].onTimeRate, 1); // and doesn't drag down the on-time rate either
});
ok('a user with only cancelled records is excluded from ranking (nothing to rank on)', () => {
  const now = new Date();
  recordResult({ guildId: 'gOnlyCancel', userId: 'flaky', username: 'Flaky', targetTime: now, actualTime: null, diffSeconds: null, status: 'cancelled', rawText: 'nvm' });
  const board = getLeaderboard('gOnlyCancel', 10);
  assert.strictEqual(board.length, 0);
});

console.log('\n=== leaderboardView.buildLeaderboardEmbed ===');
ok('empty leaderboard shows a "no data yet" description', () => {
  const embed = buildLeaderboardEmbed('gEmptyView');
  assert.match(embed.data.description, /No data yet/);
});
ok('non-empty leaderboard lists usernames and percentages', () => {
  const now = new Date();
  recordResult({ guildId: 'gView', userId: 'dave', username: 'Dave', targetTime: now, actualTime: now, diffSeconds: 0, status: 'on_time', rawText: 'x' });
  const embed = buildLeaderboardEmbed('gView');
  assert.match(embed.data.description, /Dave/);
  assert.match(embed.data.description, /100% on-time/);
});
ok('cancelled count shows up in the leaderboard line when present', () => {
  const now = new Date();
  recordResult({ guildId: 'gViewCancel', userId: 'flip', username: 'Flip', targetTime: now, actualTime: now, diffSeconds: 0, status: 'on_time', rawText: 'x' });
  recordResult({ guildId: 'gViewCancel', userId: 'flip', username: 'Flip', targetTime: now, actualTime: null, diffSeconds: null, status: 'cancelled', rawText: 'nvm' });
  const embed = buildLeaderboardEmbed('gViewCancel');
  assert.match(embed.data.description, /🚫 1 cancelled/);
});
ok('live:true adds a footer; a plain snapshot has none', () => {
  const liveEmbed = buildLeaderboardEmbed('gView', { live: true });
  const snapshotEmbed = buildLeaderboardEmbed('gView');
  assert.ok(liveEmbed.data.footer, 'expected a footer on the live embed');
  assert.strictEqual(snapshotEmbed.data.footer, undefined);
});

console.log('\n=== liveLeaderboardStore ===');
ok('get on an unset guild returns null', () => {
  assert.strictEqual(liveLeaderboardStore.get('gNeverSet'), null);
});
ok('set then get roundtrips channelId/messageId', () => {
  liveLeaderboardStore.set('gLive', { channelId: 'chan1', messageId: 'msg1' });
  const tracked = liveLeaderboardStore.get('gLive');
  assert.deepStrictEqual(tracked, { channelId: 'chan1', messageId: 'msg1' });
});
ok('setting again for the same guild overwrites (moves) the tracked location', () => {
  liveLeaderboardStore.set('gLive', { channelId: 'chan2', messageId: 'msg2' });
  const tracked = liveLeaderboardStore.get('gLive');
  assert.deepStrictEqual(tracked, { channelId: 'chan2', messageId: 'msg2' });
});
ok('tracking is isolated per guild', () => {
  liveLeaderboardStore.set('gLiveOther', { channelId: 'chanX', messageId: 'msgX' });
  assert.deepStrictEqual(liveLeaderboardStore.get('gLive'), { channelId: 'chan2', messageId: 'msg2' });
  assert.deepStrictEqual(liveLeaderboardStore.get('gLiveOther'), { channelId: 'chanX', messageId: 'msgX' });
});

console.log(`\n${pass} passed, ${fail} failed`);
for (const p of [testDbPath, `${testDbPath}.tmp`, testLivePath, `${testLivePath}.tmp`]) {
  if (fs.existsSync(p)) fs.unlinkSync(p);
}
process.exit(fail > 0 ? 1 : 0);
