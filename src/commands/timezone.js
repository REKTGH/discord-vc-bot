// /timezone — lets each person tell the bot where they are, so "at 9" from
// them means 9 o'clock in *their* timezone instead of BOT_TIMEZONE.
//
// Only reading plans needs this. Times the bot posts back are Discord
// timestamp tags (see formatClock in verdict.js), which every viewer's app
// already shows in their own local time with no setup at all.
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const config = require('../config');
const userTimezoneStore = require('../userTimezoneStore');

const RESET_VALUE = 'reset';

// Offered first when the box is still empty, so most people never have to
// know what an IANA zone name is.
const COMMON_ZONES = [
  'America/Los_Angeles', 'America/Denver', 'America/Phoenix', 'America/Chicago',
  'America/New_York', 'America/Anchorage', 'Pacific/Honolulu', 'America/Toronto',
  'America/Sao_Paulo', 'Europe/London', 'Europe/Paris', 'Europe/Berlin',
  'Asia/Kolkata', 'Asia/Singapore', 'Asia/Manila', 'Asia/Tokyo', 'Australia/Sydney',
];

// Node 18+ ships the full zone list; older runtimes fall back to the short
// list above rather than failing.
const ALL_ZONES = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : COMMON_ZONES;

const data = new SlashCommandBuilder()
  .setName('timezone')
  .setDescription('Set your timezone, so "at 9" means 9 o\'clock where you are')
  .addStringOption((option) =>
    option
      .setName('zone')
      .setDescription('Start typing a city, e.g. "New York" or "London". Leave empty to see your current one.')
      .setAutocomplete(true)
  );

function localClockIn(zone) {
  return new Date().toLocaleString('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit' });
}

function describe(zone) {
  return `**${zone}** (it's ${localClockIn(zone)} there now)`;
}

async function autocomplete(interaction) {
  const typed = interaction.options.getFocused().trim().toLowerCase().replace(/\s+/g, '_');
  const matches = typed
    ? ALL_ZONES.filter((z) => z.toLowerCase().includes(typed))
    : COMMON_ZONES;

  // Someone typing "est" or "pacific" gets the zone that alias means, even
  // though it isn't a substring of any zone name.
  const aliased = userTimezoneStore.normalizeZone(typed);
  const zones = aliased && !matches.includes(aliased) ? [aliased, ...matches] : matches;

  const choices = zones.slice(0, 24).map((z) => ({ name: `${z} — ${localClockIn(z)} now`, value: z }));
  choices.push({ name: `Reset to the server default (${config.timezone})`, value: RESET_VALUE });
  await interaction.respond(choices);
}

async function execute(interaction) {
  const input = interaction.options.getString('zone');
  const userId = interaction.user.id;

  if (!input) {
    const current = userTimezoneStore.get(userId);
    await interaction.reply({
      content: current
        ? `Your timezone is ${describe(current)}. Run \`/timezone\` with a new zone to change it.`
        : `You haven't set a timezone, so I'm reading your times in the server default, ${describe(config.timezone)}. ` +
          'Run `/timezone` and pick yours if that\'s wrong.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (input === RESET_VALUE) {
    userTimezoneStore.clear(userId);
    await interaction.reply({
      content: `Done — I'm back to reading your times in the server default, ${describe(config.timezone)}.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const zone = userTimezoneStore.normalizeZone(input);
  if (!zone) {
    await interaction.reply({
      content: `I don't recognise "${input}" as a timezone. Start typing a city and pick one of the suggestions, e.g. \`America/New_York\`.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  userTimezoneStore.set(userId, zone);
  await interaction.reply({
    content:
      `Got it — your timezone is ${describe(zone)}. When you say "at 9", I'll read it as 9 o'clock your time. ` +
      'Times I post are already shown in everyone\'s own local time.',
    flags: MessageFlags.Ephemeral,
  });
}

module.exports = { data, execute, autocomplete };
