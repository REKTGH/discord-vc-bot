// leaderboardImage.js — renders the leaderboard table as an actual PNG image,
// instead of hand-padded monospace text inside a code block.
//
// Why: Discord's own clients don't render code-block text the same way
// everywhere. On desktop, long lines get a horizontal scrollbar; on mobile,
// they wrap instead - which breaks a multi-column table's alignment
// completely (confirmed firsthand from a real screenshot: the box-drawing
// borders didn't render at all, and every row wrapped across multiple
// lines). Medal emoji have the same cross-client problem (see the git
// history of leaderboardView.js for the older, text-based caveats this
// replaces). A raster image sidesteps all of it: whatever pixels get drawn
// here are exactly what every client displays, phone or desktop, no
// exceptions - there's no font, no monospace grid, and no wrapping to go
// wrong once it's a picture.
//
// Trade-off worth knowing about: this is drawn for Discord's DARK theme
// specifically - light text, a dark-friendly grid line color, and a
// transparent background so it blends into the embed. Bots have no way to
// detect an individual viewer's client theme, so one static image can't
// perfectly serve both light and dark mode - dark mode was picked because
// that's what David's own screenshots showed. A light-mode viewer would see
// this table's light text sitting on their light theme's embed background,
// which will read worse than for a dark-mode viewer.
//
// Medals are drawn as plain circles + a numeral (not the 🥇/🥈/🥉 unicode
// glyphs) on purpose: color emoji require a color-emoji font to be
// installed wherever this code runs, and a bare server (like Render's free
// tier) usually doesn't have one - the emoji would silently render as a
// blank box. Drawing our own circle guarantees it always looks the same,
// everywhere, regardless of what fonts the host happens to have.
//
// Split into two layers on purpose: buildTableData() below is plain data -
// which row gets which column values, and whether it's a medal or an
// ordinal - and is unit tested directly. renderLeaderboardPng() is the
// pixel-drawing layer built on top of it; that part is only really checkable
// by rendering an example and looking at it (done by hand each time this
// file changes), the same way the old ASCII-art table was sanity-checked.
const { GlobalFonts, createCanvas } = require('@napi-rs/canvas');
const path = require('path');

let fontsRegistered = false;
function ensureFontsRegistered() {
  if (fontsRegistered) return;
  // Bundled in assets/fonts/ (Inter, SIL Open Font License - see the LICENSE
  // file alongside them) rather than relying on the host machine to have any
  // particular font installed. Registered under our own family names so
  // there's no chance of colliding with - or silently falling back to -
  // whatever fonts (if any) happen to already be on the server.
  GlobalFonts.registerFromPath(path.join(__dirname, '../assets/fonts/Inter-Regular.woff2'), 'VC Bot Sans');
  GlobalFonts.registerFromPath(path.join(__dirname, '../assets/fonts/Inter-Bold.woff2'), 'VC Bot Sans Bold');
  fontsRegistered = true;
}

const FONT_SIZE = 20;
const HEADER_FONT = `700 ${FONT_SIZE}px "VC Bot Sans Bold"`;
const BODY_FONT = `${FONT_SIZE}px "VC Bot Sans"`;
const MEDAL_FONT = `700 ${FONT_SIZE - 2}px "VC Bot Sans Bold"`;

const CELL_PAD_X = 16;
const ROW_HEIGHT = 46;
const HEADER_HEIGHT = 46;
const MAX_USERNAME_WIDTH_PX = 210; // truncate long names by measured pixel width, not character count
const MEDAL_COUNT = 3; // top 3 placements get a medal; 4th on gets a plain ordinal

const TEXT_COLOR = '#e3e5e8'; // Discord dark-theme primary text color
const HEADER_COLOR = '#ffffff';
const GRID_COLOR = '#4e5058'; // Discord dark-theme divider gray
const MEDAL_COLORS = ['#fbbf24', '#c7ccd1', '#cd7f32']; // gold, silver, bronze
const MEDAL_TEXT_COLOR = '#1e1f22';

const HEADERS = ['', '', 'Late', 'Avg Time Late', 'Cancels', 'No Show'];

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

// Top-3 placements (index 0-2) get a medal; 4th place and beyond (index 3+)
// fall back to plain ordinal text - same rule the old text-table used.
function placementDisplay(index) {
  return index < MEDAL_COUNT ? { type: 'medal', rank: index + 1 } : { type: 'ordinal', text: ordinal(index + 1) };
}

// "5" tracked late joins -> "5x" - short, and no singular/plural to track.
function lateCountCell(n) {
  return `${n}x`;
}

// Same average that drives the ranking itself (across every tracked join,
// not just the late ones) - kept as the one displayed so the table is
// self-consistent with why a row is placed where it is.
function formatAvgLateLabel(avgDiffSeconds) {
  const avgMin = Math.round(avgDiffSeconds / 60);
  if (avgMin === 0) return 'on time';
  const n = Math.abs(avgMin);
  return avgMin > 0 ? `${n} min. late` : `${n} min. early`;
}

function truncateNameForWidth(ctx, name) {
  ctx.font = BODY_FONT;
  if (ctx.measureText(name).width <= MAX_USERNAME_WIDTH_PX) return name;
  let truncated = name;
  while (truncated.length > 1 && ctx.measureText(`${truncated}…`).width > MAX_USERNAME_WIDTH_PX) {
    truncated = truncated.slice(0, -1);
  }
  return `${truncated}…`;
}

/**
 * Maps leaderboard rows to exactly what the table should show, with no
 * canvas/drawing involved beyond measuring text for truncation. Kept
 * separate from renderLeaderboardPng so the data mapping (which field goes
 * in which column, who gets a medal) can be unit tested directly.
 * @param {object[]} rows - non-empty result of db.getLeaderboard()
 */
function buildTableData(rows) {
  const scratch = createCanvas(1, 1).getContext('2d');
  return {
    headers: HEADERS,
    rows: rows.map((r, i) => ({
      placement: placementDisplay(i),
      name: truncateNameForWidth(scratch, r.username),
      cells: [lateCountCell(r.lateCount), formatAvgLateLabel(r.avgDiffSeconds), String(r.cancelCount), String(r.noShowCount)],
    })),
  };
}

function drawCellText(ctx, text, xStart, xEnd, y, align) {
  if (align === 'left') {
    ctx.textAlign = 'left';
    ctx.fillText(text, xStart + CELL_PAD_X, y);
  } else {
    ctx.textAlign = 'center';
    ctx.fillText(text, xStart + (xEnd - xStart) / 2, y);
  }
}

function drawPlacement(ctx, placement, xStart, xEnd, y) {
  const cx = xStart + (xEnd - xStart) / 2;
  if (placement.type === 'medal') {
    const r = (ROW_HEIGHT - 18) / 2;
    ctx.beginPath();
    ctx.arc(cx, y, r, 0, Math.PI * 2);
    ctx.fillStyle = MEDAL_COLORS[placement.rank - 1];
    ctx.fill();
    ctx.font = MEDAL_FONT;
    ctx.fillStyle = MEDAL_TEXT_COLOR;
    ctx.textAlign = 'center';
    ctx.fillText(String(placement.rank), cx, y + 1);
  } else {
    ctx.font = BODY_FONT;
    ctx.fillStyle = TEXT_COLOR;
    ctx.textAlign = 'center';
    ctx.fillText(placement.text, cx, y);
  }
}

/**
 * Renders the leaderboard table as a PNG image buffer.
 * @param {object[]} rows - non-empty result of db.getLeaderboard()
 * @returns {Buffer}
 */
function renderLeaderboardPng(rows) {
  ensureFontsRegistered();
  const table = buildTableData(rows);

  const textCols = [
    { header: table.headers[1], cells: table.rows.map((r) => r.name), align: 'left' },
    { header: table.headers[2], cells: table.rows.map((r) => r.cells[0]), align: 'center' },
    { header: table.headers[3], cells: table.rows.map((r) => r.cells[1]), align: 'center' },
    { header: table.headers[4], cells: table.rows.map((r) => r.cells[2]), align: 'center' },
    { header: table.headers[5], cells: table.rows.map((r) => r.cells[3]), align: 'center' },
  ];

  const scratch = createCanvas(1, 1).getContext('2d');
  // Placement column is drawn as a circle/ordinal, not measured text - it
  // gets a fixed width derived from the row height (a medal reads best in a
  // roughly square cell) rather than from any string's pixel width.
  const placementColWidth = ROW_HEIGHT - 10;
  const colWidths = [placementColWidth, ...textCols.map((col) => {
    scratch.font = HEADER_FONT;
    let max = scratch.measureText(col.header).width;
    scratch.font = BODY_FONT;
    for (const cell of col.cells) max = Math.max(max, scratch.measureText(cell).width);
    return Math.ceil(max) + CELL_PAD_X * 2;
  })];

  const colX = [0];
  for (const w of colWidths) colX.push(colX[colX.length - 1] + w);

  const width = colX[colX.length - 1] + 1; // +1 so the final grid line isn't clipped
  const height = HEADER_HEIGHT + rows.length * ROW_HEIGHT + 1;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.textBaseline = 'middle';
  // Canvas starts fully transparent - deliberately left unfilled, see the
  // file-level comment above on why (blends into the embed's own background).

  ctx.strokeStyle = GRID_COLOR;
  ctx.lineWidth = 1;
  for (const x of colX) {
    ctx.beginPath();
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, height);
    ctx.stroke();
  }
  for (let i = 0; i <= rows.length + 1; i++) {
    const y = i === 0 ? 0 : HEADER_HEIGHT + (i - 1) * ROW_HEIGHT;
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(width, y + 0.5);
    ctx.stroke();
  }

  ctx.font = HEADER_FONT;
  ctx.fillStyle = HEADER_COLOR;
  textCols.forEach((col, i) => {
    drawCellText(ctx, col.header, colX[i + 1], colX[i + 2], HEADER_HEIGHT / 2, col.align);
  });

  table.rows.forEach((row, i) => {
    const rowMidY = HEADER_HEIGHT + i * ROW_HEIGHT + ROW_HEIGHT / 2;

    drawPlacement(ctx, row.placement, colX[0], colX[1], rowMidY);

    ctx.font = BODY_FONT;
    ctx.fillStyle = TEXT_COLOR;
    textCols.forEach((col, ci) => {
      drawCellText(ctx, col.cells[i], colX[ci + 1], colX[ci + 2], rowMidY, col.align);
    });
  });

  return canvas.toBuffer('image/png');
}

module.exports = { renderLeaderboardPng, buildTableData, placementDisplay, formatAvgLateLabel, lateCountCell, ordinal };
