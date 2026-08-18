// leaderboardView.js — builds the leaderboard message payload. One shared
// place so /leaderboard, /leaderboard-here, and the live-updating message
// can't drift out of sync with each other.
//
// The table itself is rendered as a PNG (see leaderboardImage.js) and
// attached to the message; the embed just carries the title, the short
// "ranked latest to least late" description, and (for the live message) the
// auto-refresh footer, with the image slotted in via Discord's
// `attachment://` embed-image convention.
const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { getLeaderboard } = require('./db');
const { renderLeaderboardPng } = require('./leaderboardImage');

const IMAGE_FILENAME = 'leaderboard.png';

/**
 * @param {string} guildId
 * @param {object} opts
 * @param {boolean} opts.live - true for the auto-updating message, which gets
 *   a footer explaining it refreshes itself (a plain /leaderboard snapshot doesn't).
 * @returns {{embeds: EmbedBuilder[], files: AttachmentBuilder[]}} ready to
 *   spread into interaction.reply() / channel.send() / message.edit().
 */
function buildLeaderboardPayload(guildId, { live = false } = {}) {
  const rows = getLeaderboard(guildId, 10);

  const embed = new EmbedBuilder().setTitle('⏱️ Voice Chat Punctuality Leaderboard').setColor(0x5865f2);
  const files = [];

  if (!rows.length) {
    embed.setDescription(
      'No data yet! Once people announce plans in chat (like "joining at 9") and then join voice, punctuality will start showing up here.'
    );
  } else {
    embed.setDescription('*Ranked latest → least late*').setImage(`attachment://${IMAGE_FILENAME}`);
    const png = renderLeaderboardPng(rows);
    files.push(new AttachmentBuilder(png, { name: IMAGE_FILENAME }));
  }

  if (live) {
    embed.setFooter({ text: 'Live — updates automatically as people join voice chat.' }).setTimestamp();
  }

  return { embeds: [embed], files };
}

module.exports = { buildLeaderboardPayload };
