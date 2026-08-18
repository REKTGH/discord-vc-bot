// /awards-here — designates this channel for the automatic monthly awards
// post: whoever was late the most times, racked up the most total minutes
// late, and cancelled the most, for the month that just ended. Restricted to
// members who can manage the server, same reasoning as /leaderboard-here and
// /log-here: it redirects bot output for the whole server.
const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const store = require('../awardsChannelStore');
const { currentYearMonth, previousCalendarMonth, monthKey, monthLabel, buildMonthlyAwardsEmbed } = require('../monthlyAwards');

const data = new SlashCommandBuilder()
  .setName('awards-here')
  .setDescription('Post automatic monthly punctuality awards (most late, most time late, most cancels) in this channel')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

async function execute(interaction) {
  const already = store.get(interaction.guildId);
  const isSameChannel = already && already.channelId === interaction.channelId;

  // Setting (or re-confirming) this channel also marks the *current* month
  // as already-announced, so the periodic check doesn't mistake "never set
  // up before" for "a month just rolled over" and fire an announcement
  // immediately - the real first automatic post happens the next time the
  // calendar month actually changes.
  store.set(interaction.guildId, { channelId: interaction.channelId, lastAnnouncedMonth: monthKey(currentYearMonth()) });

  const note = isSameChannel
    ? '✅ This is already your monthly awards channel — no change needed.'
    : "✅ Got it — I'll post punctuality awards here automatically at the start of each month, for the month that just ended.";
  await interaction.reply({ content: note, flags: MessageFlags.Ephemeral });

  // Preview the most recently completed month right away, so setting this up
  // doesn't feel like nothing happened until next month - clearly labeled as
  // a preview rather than implying a month just rolled over.
  const lastMonth = previousCalendarMonth(currentYearMonth());
  const embed = buildMonthlyAwardsEmbed(interaction.guildId, lastMonth);
  await interaction.followUp({
    content: `Here's a preview of ${monthLabel(lastMonth)} (the most recently completed month):`,
    embeds: [embed],
  });
}

module.exports = { data, execute };
