// leaderboardView.js — builds the leaderboard embed. One shared place so
// /leaderboard, /leaderboard-here, and the live-updating message can't drift
// out of sync with each other.
//
// Rendered as a plain monospace table inside a code block (rather than
// Discord embed "fields", which only ever sit 3-per-row and don't line up
// cleanly for 6 columns) so everything actually lines up under its header.
//
// Top-3 placements use medal emoji per David's request. Caveat worth keeping
// in mind: emoji don't reliably occupy a fixed character width across every
// Discord client/font, so hand-padded monospace alignment for those rows is
// a best-effort, not a guarantee - it pads using JS string length, which for
// these particular emoji happens to match how wide they usually render (about
// 2 character-cells), but "usually" isn't "always". If it ever looks visibly
// off in practice, that's this tradeoff showing up - switching back to plain
// ordinals (see `ordinal()` below, still used for 4th place and beyond) is
// the fix.
const { EmbedBuilder } = require('discord.js');
const { getLeaderboard } = require('./db');

const MAX_USERNAME_WIDTH = 16;
const COLUMN_GAP = '  ';
const MEDALS = ['🥇', '🥈', '🥉'];

function ordinal(n) {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

// Medal for top 3 placements, falling back to a plain ordinal from 4th on.
function placementLabel(index) {
  return MEDALS[index] || ordinal(index + 1);
}

function truncateName(name) {
  return name.length > MAX_USERNAME_WIDTH ? `${name.slice(0, MAX_USERNAME_WIDTH - 1)}…` : name;
}

function pluralize(n, unit) {
  return `${n} ${unit}${n === 1 ? '' : 's'}`;
}

// Same average that drives the ranking itself (across every tracked join,
// not just the late ones) - kept as the one displayed so the table is
// self-consistent with why a row is placed where it is.
function formatAvgLateLabel(avgDiffSeconds) {
  const avgMin = Math.round(avgDiffSeconds / 60);
  if (avgMin === 0) return 'on time';
  return avgMin > 0 ? `${pluralize(avgMin, 'minute')} late` : `${pluralize(Math.abs(avgMin), 'minute')} early`;
}

function padRow(cells, widths) {
  return cells.map((cell, i) => cell.padEnd(widths[i])).join(COLUMN_GAP).trimEnd();
}

// headers[0] and headers[1] (placement, user) are intentionally '' - hidden
// labels, but they still reserve column width so "Late" etc. line up with
// the data underneath them rather than the placement/name columns.
function buildTable(headers, rows) {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  return [padRow(headers, widths), ...rows.map((r) => padRow(r, widths))].join('\n');
}

/**
 * @param {string} guildId
 * @param {object} opts
 * @param {boolean} opts.live - true for the auto-updating message, which gets
 *   a footer explaining it refreshes itself (a plain /leaderboard snapshot doesn't).
 */
function buildLeaderboardEmbed(guildId, { live = false } = {}) {
  const rows = getLeaderboard(guildId, 10);

  const embed = new EmbedBuilder().setTitle('⏱️ Voice Chat Punctuality Leaderboard').setColor(0x5865f2);

  if (!rows.length) {
    embed.setDescription(
      'No data yet! Once people announce plans in chat (like "joining at 9") and then join voice, punctuality will start showing up here.'
    );
  } else {
    const headers = ['', '', 'Late', 'Avg Time Late', 'Cancels', 'No Show'];
    const tableRows = rows.map((row, i) => [
      placementLabel(i),
      truncateName(row.username),
      pluralize(row.lateCount, 'time'),
      formatAvgLateLabel(row.avgDiffSeconds),
      String(row.cancelCount),
      String(row.noShowCount),
    ]);
    const table = buildTable(headers, tableRows);
    embed.setDescription(`*Ranked latest → least late*\n\`\`\`\n${table}\n\`\`\``);
  }

  if (live) {
    embed.setFooter({ text: 'Live — updates automatically as people join voice chat.' }).setTimestamp();
  }

  return embed;
}

module.exports = { buildLeaderboardEmbed };
