// index.js — entry point. Wires up the Discord client, registers slash
// commands, and starts listening. Run with `node src/index.js` (or `npm start`).
const http = require('http');
const { Client, GatewayIntentBits, Events, Collection, MessageFlags } = require('discord.js');
const config = require('./config');
const { handleMessage } = require('./messageHandler');
const { handleVoiceStateUpdate } = require('./voiceHandler');
const { checkForNoShows } = require('./noShowHandler');
const { checkAndAnnounceAll } = require('./monthlyAwards');

if (!config.token) {
  console.error(
    '\nMissing DISCORD_TOKEN.\n' +
      'Create a .env file in this folder (copy .env.example) and paste your bot token into it.\n' +
      'See README.md, step 3, for exactly where to get that token.\n'
  );
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

// --- slash commands ---
const commandFiles = [
  require('./commands/leaderboard'),
  require('./commands/leaderboardHere'),
  require('./commands/help'),
  require('./commands/cancel'),
  require('./commands/logHere'),
  require('./commands/awardsHere'),
];
client.commands = new Collection();
for (const cmd of commandFiles) client.commands.set(cmd.data.name, cmd);

async function registerCommandsForGuild(guild) {
  try {
    await guild.commands.set(commandFiles.map((c) => c.data.toJSON()));
  } catch (err) {
    console.warn(`Could not register commands for guild "${guild.name}":`, err.message);
  }
}

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
  console.log(`Timezone: ${config.timezone} | Grace period: ${config.gracePeriodMinutes}m | No-show window: ${config.planExpiryHours}h`);
  for (const guild of readyClient.guilds.cache.values()) {
    await registerCommandsForGuild(guild);
  }
  console.log(`Slash commands registered in ${readyClient.guilds.cache.size} server(s).`);
});

client.on(Events.GuildCreate, (guild) => {
  console.log(`Joined a new server: ${guild.name} — registering commands.`);
  registerCommandsForGuild(guild);
});

client.on(Events.MessageCreate, (message) => {
  handleMessage(message).catch((err) => console.error('Error handling message:', err));
});

client.on(Events.VoiceStateUpdate, (oldState, newState) => {
  handleVoiceStateUpdate(oldState, newState).catch((err) => console.error('Error handling voice state update:', err));
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const command = client.commands.get(interaction.commandName);
  if (!command) return;
  try {
    await command.execute(interaction);
  } catch (err) {
    console.error(`Error running /${interaction.commandName}:`, err);
    const payload = { content: 'Something went wrong running that command.', flags: MessageFlags.Ephemeral };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload).catch(() => {});
    } else {
      await interaction.reply(payload).catch(() => {});
    }
  }
});

// Periodically check for plans nobody followed through on (no-shows), and
// post a note about each one. Also keeps memory from growing unbounded.
setInterval(() => {
  checkForNoShows(client).catch((err) => console.error('Error checking for no-shows:', err));
}, 5 * 60 * 1000);

// Periodically check whether the calendar month has rolled over for any
// server that set up /awards-here, and post that month's awards exactly
// once if so. Doesn't need 5-minute precision like no-show checks do - an
// hourly check is still well within the same day the month actually turns
// over, so this stays on a separate, coarser timer.
setInterval(() => {
  checkAndAnnounceAll(client).catch((err) => console.error('Error checking monthly awards:', err));
}, 60 * 60 * 1000);

process.on('unhandledRejection', (err) => console.error('Unhandled promise rejection:', err));
process.on('uncaughtException', (err) => console.error('Uncaught exception:', err));

client.login(config.token).catch((err) => {
  console.error(
    '\nFailed to log in to Discord.\n' +
      'Most likely cause: DISCORD_TOKEN in your .env file is missing, wrong, or was reset.\n' +
      'Go back to the Discord Developer Portal -> your app -> Bot -> "Reset Token" to get a fresh one.\n' +
      `Underlying error: ${err.message}\n`
  );
  process.exit(1);
});

// Some free hosting platforms only keep a service "awake" while it's
// answering HTTP requests. This tiny server gives them (and an external
// uptime pinger, if you set one up — see README) something to hit.
// It's inert if nothing ever calls it.
const port = process.env.PORT;
if (port) {
  http
    .createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('Discord VC punctuality bot is running.\n');
    })
    .listen(port, () => console.log(`Keep-alive HTTP server listening on port ${port}`));
}
