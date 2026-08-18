// Sanity checks for the pieces that don't need a real Discord connection:
// verdict classification, plan tracking (including expiry), and the JSON
// leaderboard roundtrip. Run with: node test/core.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Use throwaway data files for this test run so it never touches real data.
const testDbPath = path.join(__dirname, '.tmp-test.json');
const testLivePath = path.join(__dirname, '.tmp-test-live.json');
const testLogChannelPath = path.join(__dirname, '.tmp-test-log-channel.json');
for (const p of [testDbPath, `${testDbPath}.tmp`, testLivePath, `${testLivePath}.tmp`, testLogChannelPath, `${testLogChannelPath}.tmp`]) {
  if (fs.existsSync(p)) fs.unlinkSync(p);
}
process.env.DB_PATH = testDbPath;
process.env.LIVE_LEADERBOARD_PATH = testLivePath;
process.env.LOG_CHANNEL_PATH = testLogChannelPath;
process.env.PLAN_EXPIRY_HOURS = '3';
process.env.GRACE_PERIOD_MINUTES = '2';

const { classify } = require('../src/verdict');
const planTracker = require('../src/planTracker');
const { recordResult, getLeaderboard } = require('../src/db');
const { buildLeaderboardPayload } = require('../src/leaderboardView');
const { renderLeaderboardPng, buildTableData, placementDisplay, formatAvgLateLabel, lateCountCell, ordinal } = require('../src/leaderboardImage');
const liveLeaderboardStore = require('../src/liveLeaderboardStore');
const logChannelStore = require('../src/logChannelStore');

// PNG signature (8 bytes) + IHDR chunk length/type (8 bytes) precede the
// width/height fields in every PNG file - see the PNG spec's IHDR layout.
// Reading just those lets the tests below check image dimensions without
// pulling in a PNG-decoding dependency.
function readPngDimensions(buf) {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

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

console.log('\n=== leaderboardImage: pure formatting/data helpers ===');
ok('lateCountCell shortens a count to "Nx"', () => {
  assert.strictEqual(lateCountCell(0), '0x');
  assert.strictEqual(lateCountCell(5), '5x');
});
ok('formatAvgLateLabel covers on-time, late, and early', () => {
  assert.strictEqual(formatAvgLateLabel(0), 'on time');
  assert.strictEqual(formatAvgLateLabel(600), '10 min. late');
  assert.strictEqual(formatAvgLateLabel(-300), '5 min. early');
});
ok('ordinal follows English rules, including the 11th-13th exceptions', () => {
  assert.strictEqual(ordinal(1), '1st');
  assert.strictEqual(ordinal(2), '2nd');
  assert.strictEqual(ordinal(3), '3rd');
  assert.strictEqual(ordinal(4), '4th');
  assert.strictEqual(ordinal(11), '11th');
  assert.strictEqual(ordinal(12), '12th');
  assert.strictEqual(ordinal(13), '13th');
  assert.strictEqual(ordinal(21), '21st');
});
ok('placementDisplay: top 3 are medals by rank, 4th on is a plain ordinal', () => {
  assert.deepStrictEqual(placementDisplay(0), { type: 'medal', rank: 1 });
  assert.deepStrictEqual(placementDisplay(1), { type: 'medal', rank: 2 });
  assert.deepStrictEqual(placementDisplay(2), { type: 'medal', rank: 3 });
  assert.deepStrictEqual(placementDisplay(3), { type: 'ordinal', text: '4th' });
  assert.deepStrictEqual(placementDisplay(9), { type: 'ordinal', text: '10th' });
});
ok('buildTableData: headers are in the same order as the columns they label', () => {
  const now = new Date();
  recordResult({ guildId: 'gTableHeaders', userId: 'dave', username: 'Dave', targetTime: now, actualTime: now, diffSeconds: 0, status: 'on_time', rawText: 'x' });
  const table = buildTableData(getLeaderboard('gTableHeaders', 10));
  assert.deepStrictEqual(table.headers, ['', '', 'Late', 'Avg Time Late', 'Cancels', 'No Show']);
});
ok('buildTableData: tardy count, average lateness, cancels, and no-shows each map to their own column', () => {
  const now = new Date();
  recordResult({ guildId: 'gTableStats', userId: 'flip', username: 'Flip', targetTime: now, actualTime: new Date(now.getTime() + 10 * 60000), diffSeconds: 600, status: 'late', rawText: 'x' });
  recordResult({ guildId: 'gTableStats', userId: 'flip', username: 'Flip', targetTime: now, actualTime: null, diffSeconds: null, status: 'cancelled', rawText: 'nvm' });
  recordResult({ guildId: 'gTableStats', userId: 'flip', username: 'Flip', targetTime: now, actualTime: null, diffSeconds: null, status: 'no_show', rawText: 'x' });

  const table = buildTableData(getLeaderboard('gTableStats', 10));
  assert.strictEqual(table.rows.length, 1);
  assert.deepStrictEqual(table.rows[0].placement, { type: 'medal', rank: 1 });
  assert.strictEqual(table.rows[0].name, 'Flip');
  // 1 late join (averaging 10 min late), 1 cancellation, 1 no-show - each its own column
  assert.deepStrictEqual(table.rows[0].cells, ['1x', '10 min. late', '1', '1']);
});
ok('buildTableData: top 3 placements get medals in rank order, 4th place and beyond fall back to plain ordinals', () => {
  const now = new Date();
  // Strictly decreasing lateness so ranking order is deterministic.
  ['Gold', 'Silver', 'Bronze', 'Fourth'].forEach((name, idx) => {
    const mins = 40 - idx * 10;
    recordResult({ guildId: 'gTableMedals', userId: name, username: name, targetTime: now, actualTime: new Date(now.getTime() + mins * 60000), diffSeconds: mins * 60, status: 'late', rawText: 'x' });
  });
  const table = buildTableData(getLeaderboard('gTableMedals', 10));
  assert.deepStrictEqual(table.rows.map((r) => r.placement), [
    { type: 'medal', rank: 1 },
    { type: 'medal', rank: 2 },
    { type: 'medal', rank: 3 },
    { type: 'ordinal', text: '4th' },
  ]);
  assert.deepStrictEqual(table.rows.map((r) => r.name), ['Gold', 'Silver', 'Bronze', 'Fourth']);
});
ok('buildTableData: long usernames are truncated with an ellipsis rather than left full-length', () => {
  const now = new Date();
  const longName = 'ThisUsernameIsWayTooLongForATable';
  recordResult({ guildId: 'gTableLongName', userId: 'longy', username: longName, targetTime: now, actualTime: now, diffSeconds: 0, status: 'on_time', rawText: 'x' });
  const table = buildTableData(getLeaderboard('gTableLongName', 10));
  assert.notStrictEqual(table.rows[0].name, longName);
  assert.ok(table.rows[0].name.length < longName.length);
  assert.match(table.rows[0].name, /…$/);
});

console.log('\n=== leaderboardImage.renderLeaderboardPng ===');
ok('renders a non-empty PNG that gets taller as rows are added, at the same width', () => {
  const now = new Date();
  recordResult({ guildId: 'gPngOne', userId: 'a', username: 'A', targetTime: now, actualTime: now, diffSeconds: 0, status: 'on_time', rawText: 'x' });
  const onePng = renderLeaderboardPng(getLeaderboard('gPngOne', 10));

  recordResult({ guildId: 'gPngTwo', userId: 'a', username: 'A', targetTime: now, actualTime: now, diffSeconds: 0, status: 'on_time', rawText: 'x' });
  recordResult({ guildId: 'gPngTwo', userId: 'b', username: 'A', targetTime: now, actualTime: new Date(now.getTime() + 60000), diffSeconds: 60, status: 'late', rawText: 'x' });
  const twoPng = renderLeaderboardPng(getLeaderboard('gPngTwo', 10));

  assert.ok(Buffer.isBuffer(onePng) && onePng.length > 0);
  const oneDims = readPngDimensions(onePng);
  const twoDims = readPngDimensions(twoPng);
  assert.strictEqual(oneDims.width, twoDims.width); // same column content width -> same width regardless of row count
  assert.ok(twoDims.height > oneDims.height, 'expected a second row to make the image taller');
});
ok('a longer username produces a wider image than a short one', () => {
  const now = new Date();
  recordResult({ guildId: 'gPngShortName', userId: 'a', username: 'A', targetTime: now, actualTime: now, diffSeconds: 0, status: 'on_time', rawText: 'x' });
  recordResult({ guildId: 'gPngLongName', userId: 'a', username: 'MediumLengthName', targetTime: now, actualTime: now, diffSeconds: 0, status: 'on_time', rawText: 'x' });
  const shortPng = renderLeaderboardPng(getLeaderboard('gPngShortName', 10));
  const longPng = renderLeaderboardPng(getLeaderboard('gPngLongName', 10));
  assert.ok(readPngDimensions(longPng).width > readPngDimensions(shortPng).width);
});
ok('truncation caps how much an extremely long username can widen the image', () => {
  const now = new Date();
  recordResult({ guildId: 'gPngCapped', userId: 'a', username: 'ReasonablyLongButNotCrazyName', targetTime: now, actualTime: now, diffSeconds: 0, status: 'on_time', rawText: 'x' });
  recordResult({ guildId: 'gPngExtreme', userId: 'a', username: 'X'.repeat(200), targetTime: now, actualTime: now, diffSeconds: 0, status: 'on_time', rawText: 'x' });
  const cappedPng = renderLeaderboardPng(getLeaderboard('gPngCapped', 10));
  const extremePng = renderLeaderboardPng(getLeaderboard('gPngExtreme', 10));
  const diff = readPngDimensions(extremePng).width - readPngDimensions(cappedPng).width;
  assert.ok(diff < 40, `expected truncation to cap width growth, but a 200-char name was ${diff}px wider`);
});

console.log('\n=== leaderboardView.buildLeaderboardPayload ===');
ok('empty leaderboard has a "no data yet" description and no attached image', () => {
  const payload = buildLeaderboardPayload('gEmptyView');
  assert.match(payload.embeds[0].data.description, /No data yet/);
  assert.strictEqual(payload.files.length, 0);
});
ok('non-empty leaderboard attaches one leaderboard.png and points the embed image at it', () => {
  const now = new Date();
  recordResult({ guildId: 'gView', userId: 'dave', username: 'Dave', targetTime: now, actualTime: now, diffSeconds: 0, status: 'on_time', rawText: 'x' });
  const payload = buildLeaderboardPayload('gView');
  assert.match(payload.embeds[0].data.description, /Ranked latest/);
  assert.strictEqual(payload.files.length, 1);
  assert.strictEqual(payload.files[0].name, 'leaderboard.png');
  assert.strictEqual(payload.embeds[0].data.image.url, 'attachment://leaderboard.png');
});
ok('live:true adds a footer; a plain snapshot has none', () => {
  const livePayload = buildLeaderboardPayload('gView', { live: true });
  const snapshotPayload = buildLeaderboardPayload('gView');
  assert.ok(livePayload.embeds[0].data.footer, 'expected a footer on the live embed');
  assert.strictEqual(snapshotPayload.embeds[0].data.footer, undefined);
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

console.log('\n=== logChannelStore ===');
ok('get on an unset guild returns null', () => {
  assert.strictEqual(logChannelStore.get('gNeverSetLog'), null);
});
ok('set then get roundtrips the channelId', () => {
  logChannelStore.set('gLog', 'chan1');
  assert.strictEqual(logChannelStore.get('gLog'), 'chan1');
});
ok('setting again for the same guild overwrites (moves) the log channel', () => {
  logChannelStore.set('gLog', 'chan2');
  assert.strictEqual(logChannelStore.get('gLog'), 'chan2');
});
ok('tracking is isolated per guild', () => {
  logChannelStore.set('gLogOther', 'chanX');
  assert.strictEqual(logChannelStore.get('gLog'), 'chan2');
  assert.strictEqual(logChannelStore.get('gLogOther'), 'chanX');
});

console.log(`\n${pass} passed, ${fail} failed`);
for (const p of [testDbPath, `${testDbPath}.tmp`, testLivePath, `${testLivePath}.tmp`, testLogChannelPath, `${testLogChannelPath}.tmp`]) {
  if (fs.existsSync(p)) fs.unlinkSync(p);
}
process.exit(fail > 0 ? 1 : 0);
