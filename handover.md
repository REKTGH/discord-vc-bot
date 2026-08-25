# Handover Spec — Discord Voice-Chat Punctuality Bot

**Purpose of this document:** this project moved from a conversational build process into Claude Code. Everything below reflects the actual state of the code as of **v17, 2026-08-25** — read section 3 before changing anything that looks like an odd choice; most of them are deliberate and were arrived at by hitting a real problem first.

> **v17 changed a lot of what v16 described.** Hosting moved to an Oracle Cloud instance (Render is not used and its constraints no longer apply), the project is now under real git, and six features shipped. Section 6 at the bottom is the v17 delta — read it before trusting any specific claim above it.

**Owner:** David (non-coder — the README at the repo root is written for him, not for a developer, and should stay that way). **Status:** live in production on an Oracle Cloud Always Free instance, run by systemd as the `bot` unit, updated by `git pull`. **Tests:** 203 passing, 0 failing (`npm test`).

---

## 1. Project Overview

A Discord bot for a friend group's voice-chat server that:

1. Reads normal chat messages and detects when someone states a plan to join voice soon (natural language — "omw, joining in 10 min", "be there at 9", "vc in 5", or just a bare "30").
2. Watches for that person actually joining a voice channel, and classifies the result: early, on time, or late (with a configurable grace period).
3. Replies in-channel with the verdict — and if someone shows up *very* late, replies with a random passive-aggressive line instead of a plain one.
4. If someone never joins at all, posts a no-show note after a configurable window.
5. Tracks everything to a leaderboard (`/leaderboard`, or a live self-updating `/leaderboard-here` message), rendered as an image so it looks identical on every Discord client.
6. Posts monthly "awards" (most-late / most-time-late / most-cancels) either on demand (`/awards`) or automatically once a month (`/awards-here`).

No slash command is required for the core loop — the bot is driven entirely by natural chat. Slash commands exist for setup/configuration and for on-demand snapshots.

This is version **v16** of an iterative build — see section 3 for why things are built the way they are, and section 4 for what's still open. A parallel, more granular version-by-version build log (v1–v16, written after each shipped feature) lives outside this repo in the Claude Project this bot was built in ("Discord Bot" project, doc `claude/bot-build-notes.md`) — worth pulling into context if a future session has access to it and wants the blow-by-blow history behind any decision below.

---

## 2. What's Been Built

### 2.1 Stack

- Node.js ≥18, plain JavaScript (no TypeScript, no build step, no framework).
- [discord.js](https://discord.js.org) `^14.27.0` — the Discord API client.
- [chrono-node](https://github.com/wanasit/chrono) `^2.10.1` — natural-language date parsing (heavily wrapped/constrained — see 3.4).
- [`@napi-rs/canvas`](https://github.com/Brooooooklyn/canvas) `^1.0.6` — renders the leaderboard as a PNG.
- `dotenv` `^17.4.2` — loads `.env`.
- Storage: flat JSON files on disk (no database — see 3.1). No other runtime dependencies.

### 2.2 Directory layout

```
discord-vc-bot/
├── src/
│   ├── index.js                 # entry point — client setup, event wiring, timers
│   ├── config.js                # all env vars read here, nowhere else
│   ├── messageHandler.js        # MessageCreate listener → plan detection / nvm-cancel
│   ├── voiceHandler.js          # VoiceStateUpdate listener → verdict + routing
│   ├── noShowHandler.js         # timer: posts no-show notes for expired plans
│   ├── verdict.js               # early/on-time/late classification + reply text
│   ├── roastLines.js            # the passive-aggressive line pool
│   ├── timeParser.js            # natural-language time parsing + timezone math
│   ├── planTracker.js           # in-memory pending-plan store
│   ├── db.js                    # results.json — leaderboard + monthly-awards data
│   ├── leaderboardImage.js      # renders the leaderboard table as a PNG
│   ├── leaderboardView.js       # shared embed+image payload builder
│   ├── liveLeaderboard.js       # self-updating leaderboard message (post/refresh)
│   ├── liveLeaderboardStore.js  # JSON: guild → live-leaderboard channel+message
│   ├── logChannelStore.js       # JSON: guild → /log-here channel
│   ├── awardsChannelStore.js    # JSON: guild → /awards-here channel + last-announced month
│   ├── monthlyAwards.js         # monthly awards aggregation, embed, auto-post check
│   └── commands/
│       ├── leaderboard.js       # /leaderboard
│       ├── leaderboardHere.js   # /leaderboard-here
│       ├── help.js              # /help
│       ├── cancel.js            # /cancel
│       ├── logHere.js           # /log-here
│       ├── awards.js            # /awards
│       └── awardsHere.js        # /awards-here
├── test/
│   ├── core.test.js             # 77 checks
│   └── timeParser.test.js       # 43 checks
├── assets/fonts/                # bundled Inter font (woff2) + SIL OFL license
├── docs/example-leaderboard.png # composited example for the README
├── data/                        # results.json + the three store JSONs (gitignored)
├── .env.example
├── .gitignore
├── package.json
└── README.md                    # the actual end-user setup guide (non-coder audience)
```

### 2.3 Core flow, file by file

**`timeParser.js`** — `parseJoinTime(text, {timezone, referenceDate})` is the heart of plan detection. A message must match an intent-phrase regex list (`omw`, `on my way`, `join(ing)`, `hop(ping) on`, `pull(ing) up`, `be there`, `be on`, `heading...`, `coming`, `vc`/`voice chat`/`voice call`) **and** contain a parseable time before anything is tracked — this two-part gate is what keeps the bot from firing on unrelated messages. Layers on top of chrono-node: bare-hour AM/PM disambiguation (`closestFutureHourCandidate` — "at 9" resolves to whichever future occurrence, AM or PM, hasn't already passed), a bare-number-alone shorthand ("30" → "in 30 minutes", bounded 1–180 minutes, whole-message match only), explicit weekday-mention rejection, and future/past sanity bounds (12h future / 2min past). Also exports `hasCancelIntent` (nevermind/nvm detection) and the timezone-correct calendar-month helpers `localYearMonth`/`localMonthStartUTC` used by monthly awards.

**`messageHandler.js`** — `handleMessage(message)`. Runs `parseJoinTime`; on a match, stores the plan via `planTracker.setPlan()` and reacts ⏰. If no new plan matched but the message has cancel-intent and a plan is pending, cancels it, records a `cancelled` result (counts on the leaderboard), reacts 🚫.

**`planTracker.js`** — in-memory `Map<"guildId:userId", plan>`. `setPlan`, `hasPlan`, `cancelPlan`, `consumePlan` (called on actual voice join — returns `null` if the plan is already past the no-show window), `takeExpired` (called by the no-show timer).

**`verdict.js`** — `classify(diffMs)` → `{status: 'on_time'|'late'|'early', emoji, label, diffMinutes (late only)}`. `isRoastWorthy(verdict)` — `status === 'late' && diffMinutes >= config.roastThresholdMinutes`. `buildVerdictMessage(verdict, {mention, targetTime, actualTime})` — single source of truth for the join-reply text; swaps in a roast line from `roastLines.js` when `isRoastWorthy`, otherwise the plain "**late by N min**" phrasing. `formatClock(date)`.

**`roastLines.js`** — `ROAST_LINES` (30 strings; a line may contain the literal token `{minutes}`, substituted with the actual lateness) and `pickRoastLine(minutes)`.

**`voiceHandler.js`** — `handleVoiceStateUpdate(oldState, newState)`, the `VoiceStateUpdate` listener. Consumes the pending plan, classifies it, records it via `db.recordResult`, decides where the message goes via `chooseVerdictRouting(verdict, {logChannelId, announceChannelId})` (pure, exported, unit-tested — see 3.3), sends it, then calls `liveLeaderboard.refresh()`.

**`noShowHandler.js`** — `checkForNoShows(client)`, run every 5 minutes from `index.js`. Posts a 👻 note for every plan `planTracker.takeExpired()` returns, records a `no_show` result, refreshes the live leaderboard. Always posts in the original announcement channel — **never** affected by `/log-here`.

**`db.js`** — flat-file JSON storage (`data/results.json`, atomic write via temp-file-then-rename). `recordResult(result)` appends one record. `getLeaderboard(guildId, limit)` aggregates per user and ranks latest→least-late (ties broken by tracked-join count). `getMonthlyAwards(guildId, {startMs, endMs})` aggregates `mostLate`/`mostTimeLate`/`mostCancels` (each `null` if nobody qualifies) plus `totalRecords` for a millisecond range.

**`leaderboardImage.js`** — the PNG renderer (`@napi-rs/canvas`). `buildTableData(rows)` is the pure data-mapping layer (headers, per-row column values, medal/ordinal assignment, name truncation by *measured pixel width*) — unit tested directly. `renderLeaderboardPng(rows)` is the pixel-drawing layer on top of it. Registers a bundled Inter font (`assets/fonts/*.woff2`) once per process. Medals are hand-drawn circles + a numeral, not emoji glyphs.

**`leaderboardView.js`** — `buildLeaderboardPayload(guildId, {live})` → `{embeds, files}`, the one shared builder used by `/leaderboard`, `/leaderboard-here`, and the live refresh, so they can't drift out of sync.

**`liveLeaderboard.js`** — `postNew(channel, guildId)`, `refresh(client, guildId)`. Edits the tracked message in place; **`attachments: []` is required on that edit call** (see 3.3 — do not remove it). Self-heals (reposts) if the tracked message was deleted.

**`monthlyAwards.js`** — `currentYearMonth`, `previousCalendarMonth`, `nextCalendarMonth`, `monthKey`, `monthLabel`, `formatTotalLateDuration`, `buildMonthlyAwardsEmbed(guildId, yearMonth)`, `checkAndAnnounceAll(client)` (run hourly from `index.js`), `checkAndAnnounceForGuild(client, guildId)` (no-op unless the calendar month has rolled over since the last post there; always advances the stored marker even if the send fails, so one failure doesn't retry forever).

**Three parallel store files** (`liveLeaderboardStore.js`, `logChannelStore.js`, `awardsChannelStore.js`) — identical pattern: a tiny per-guild JSON key→value map, `get`/`set`, atomic write. Deliberately three separate files/formats rather than one shared "settings" file, so none can corrupt another's format.

**`index.js`** — client setup (intents: `Guilds`, `GuildMessages`, `MessageContent`, `GuildVoiceStates`), per-guild slash command registration (on ready, and on `GuildCreate`), event wiring, two timers (5 min no-show check, 60 min monthly-awards check), and an inert `http` keep-alive server gated on `process.env.PORT` (only relevant for Render's free tier — see 3.5).

### 2.4 Slash commands

| Command | Permission | What it does |
|---|---|---|
| `/leaderboard` | everyone | One-off leaderboard snapshot (image). |
| `/leaderboard-here` | Manage Server | Makes the current channel a self-updating leaderboard message. |
| `/help` | everyone | Ephemeral how-to-use embed. |
| `/cancel` | everyone | Erases your own pending plan; does **not** count as a Cancels-column cancellation (see 3.4). |
| `/log-here` | Manage Server | Redirects voice-join verdict messages to this channel, silently — except roasts (see 3.4). |
| `/awards` | everyone | On-demand: posts last completed month's awards right now. Doesn't touch `/awards-here`'s state. |
| `/awards-here` | Manage Server | Sets up the automatic monthly awards post in this channel; immediately previews last month too. |

### 2.5 Tests

`npm test` runs `test/timeParser.test.js` (43 checks) then `test/core.test.js` (77 checks) — 120 total, plain Node `assert`, no framework, run with plain `node`. See 3.3 for what is and isn't covered and why.

---

## 3. Technical Choices — and the Why

Read this before "cleaning up" or "modernizing" anything below — most of it was arrived at by hitting a real failure first, not by guessing.

### 3.1 No database, no build step, no framework

Storage is flat JSON files, not SQLite/Postgres/etc. **Why:** SQLite (and most embedded DB options) need native compilation on install, which failed in clean-environment testing early in this project — a real risk for a first-time coder running `npm install` on their own machine, and again on a free host with nobody there to debug a native build failure. JSON has zero install-time risk, and write volume here is trivial (one record per voice join). The same "avoid native compile steps" reasoning is why `@napi-rs/canvas` (ships prebuilt binaries) was picked over `node-canvas` (needs Cairo compiled) or `puppeteer` (needs a bundled Chromium — heavy and slow on a free host) for the leaderboard image.

Plain JS with no TypeScript and no build step, for the same reason: `npm install && npm start` needs to be the entire toolchain. Every JSON write goes through a write-to-`.tmp`-then-rename pattern so a crash mid-write can't corrupt the real file.

### 3.2 Leaderboard rendered as an image, not text

This went through two earlier approaches that both broke on a real device before landing here: a packed prose line, then a hand-aligned monospace/box-drawing table. The box-drawing table failed completely on Discord mobile — no borders rendered, and every row wrapped across multiple lines, because Discord's mobile client doesn't give code blocks the same horizontal-scroll treatment desktop does. **A rasterized PNG is pixel-identical on every client, guaranteed** — there's no font, monospace grid, or text-wrap left to vary once it's a picture. Column widths are measured in actual pixels (`ctx.measureText`), not character counts.

Consequences worth knowing, not bugs:
- The image is drawn for **dark theme only** (light text, transparent background) — a bot cannot detect an individual viewer's client theme. Dark mode was picked because that's what the project owner's own screenshots showed. A light-theme viewer will see light text on their light background. This is documented in the README's Known Limitations, not something to "fix" — there is no fix available without client-side rendering, which Discord embeds don't support.
- Medals are hand-drawn circles + a numeral, not 🥇/🥈/🥉 emoji — confirmed empirically that color emoji render as a blank/tofu box via canvas on a bare server with no color-emoji font installed.
- The font (Inter, SIL OFL) is bundled in `assets/fonts/` and registered at runtime rather than relying on the host having any font installed at all.

### 3.3 Architecture: pure functions pulled out of Discord I/O

Recurring pattern across the codebase: whenever a piece of branching logic could be tested without a live Discord connection, it's pulled into its own exported, pure function, separate from the code that actually talks to Discord. Examples: `buildTableData()` (data mapping) vs. `renderLeaderboardPng()` (pixel drawing); `buildVerdictMessage()` and `isRoastWorthy()` (what to say) vs. `handleVoiceStateUpdate()` (Discord I/O); `chooseVerdictRouting()` (where to send it, and whether to suppress the ping) vs. the actual `channel.send()` call; `buildLeaderboardPayload()` shared by all three leaderboard surfaces so they can't drift apart.

This is why `test/core.test.js` covers `db.js`, `verdict.js`, `roastLines.js`, `voiceHandler.chooseVerdictRouting`, `leaderboardImage.js`'s data layer, `leaderboardView.js`, `monthlyAwards.js`, and the three store files directly — but **no command file in `src/commands/` has a dedicated test**, and neither does `handleVoiceStateUpdate` itself, `liveLeaderboard.js`'s actual send/edit calls, or `noShowHandler.js`. That's deliberate: those need a real Discord `interaction`/`client`/`channel` object, so they're verified by hand (running the bot, or hand-rendering an example) instead of automated. If you add a command file and it "has no tests," that's consistent with every other command file, not an oversight to fix by mocking discord.js.

One specific fix worth flagging so it's never re-broken: `message.edit({files, ...})` in discord.js **keeps every existing attachment unless you explicitly pass `attachments: []`.** `liveLeaderboard.js`'s refresh call includes this; removing it as "apparently redundant" would silently stack a new leaderboard image on top of the old one on every single voice-join, forever. Confirmed against discord.js's own API docs before shipping, not assumed.

### 3.4 Feature-specific decisions

- **`/cancel` vs. "nevermind"/"nvm" in chat**: both erase a pending plan and suppress the later no-show note, but only a chat "nevermind"/"nvm" counts toward the leaderboard's **Cancels** column and monthly awards' Most Cancels. `/cancel` is meant for correcting a bot mistake (e.g. a false-positive bare-number match), not for tallying real flaking — treating them the same would penalize someone for the bot's own error.
- **Weekday mentions ("next Friday at 9pm") are ignored on purpose.** This bot is scoped to "joining very soon," not scheduling — and chrono's weekday resolution can interact oddly with a same-message time-of-day, risking a wrong-day match. Not a missing feature.
- **The bare-number shorthand ("30" alone → "in 30 minutes") is deliberately narrow**: only fires when the *entire* message is the number (plus optional trailing punctuation), bounded to 1–180. This avoids false-positiving on an unrelated number ("we scored 30 points", a price, a year). It's the most heavily tested single behavior in the suite for exactly this reason — it's an easy heuristic to accidentally loosen.
- **Roast lines (v14) bypass `/log-here`'s redirect (v16), everything else doesn't.** `/log-here` silently redirects on-time/early/slightly-late verdict messages to a dedicated channel. A roast (≥`ROAST_THRESHOLD_MINUTES` late) is the one exception — it always posts, and pings, in the original announcement channel, because a roast nobody sees defeats the point. This was a deliberate, explicitly-requested correction after v14 initially routed roasts through the redirect too. The split lives in `voiceHandler.chooseVerdictRouting()`, backed by `verdict.isRoastWorthy()` — both are unit tested for exactly this branch.
- **`/awards` (on-demand) never touches `awardsChannelStore` or `lastAnnouncedMonth`.** It calls the same read-only `buildMonthlyAwardsEmbed()` the automatic post uses, but running it can never delay, skip, or double-fire the automatic monthly post. This deliberately mirrors the existing `/leaderboard` (on-demand) vs. `/leaderboard-here` (persistent) relationship rather than inventing new behavior.
- **`getMonthlyAwards()`'s `totalRecords` field.** A "perfect month" (real activity, but nobody qualifies for any award — nobody late, nobody cancelled) must read as a small celebration, not as "nothing happened." This was a real bug caught by a test before shipping: the original check was "did any category have a winner," which couldn't tell a perfect month apart from a guild with zero tracked activity all month. Fixed by adding `totalRecords` and checking that instead. Don't revert to the "any category has a winner" check.
- **Ties in monthly awards are broken alphabetically by username** — simple and deterministic, not meant to be "meaningful." Real ties are rare and there's no principled way to prefer one person over another.
- **In-memory plan tracking (`planTracker.js`), never persisted.** Plans are short-lived by design (stated → joined, usually within minutes to a few hours), so this keeps the hot path simple. A restart losing an in-flight plan is an accepted, documented trade-off — the leaderboard *history* is safely persisted to `results.json`; only the ephemeral "waiting to see if they show up" state is not.
- **Per-guild slash command registration**, not global (`guild.commands.set(...)` in `index.js`, called per guild on ready and on join). Guild-scoped registration propagates immediately; Discord's global command registration can take up to an hour to appear — a meaningful difference for a non-coder trying to verify setup worked.

### 3.5 Hosting & deployment

The README's Part 4 documents two paths, both from the same GitHub repo:
- **Render (recommended default, $0, no card):** free tier sleeps after 15 minutes without incoming HTTP traffic, which is why `index.js` runs a trivial `http` server (gated on `process.env.PORT`) purely so an external uptime pinger (UptimeRobot or similar) has something to hit every few minutes to prevent sleep. **No persistent disk** — `results.json`, `live-leaderboard.json`, `log-channel.json`, and `awards-channel.json` all reset on every redeploy. This is a known, accepted trade-off for "a fun casual leaderboard among friends," documented in the README, not a bug.
- **Railway (documented alternative):** small cost after a $5 trial credit, supports a persistent volume, no sleep workaround needed. Recommended only if history surviving redeploys actually matters to the owner.

Either way, the repo must be uploaded to GitHub **flat** — `src/`, `test/`, `package.json` directly at repo root, *not* nested inside a `discord-vc-bot/` folder. This nesting mistake happened at least once early in the project (dragging the folder itself into GitHub's uploader instead of its contents) and is the subject of the still-open issue in section 4.1.

### 3.6 Security

`.env` (holding `DISCORD_TOKEN`) is `.gitignore`'d and has never been committed or shipped in any delivered zip — only `.env.example` (blank template) is ever distributed. This rule has been maintained without exception across the entire project and must continue to be: **never commit, zip, or otherwise transmit the real `.env` file.**

---

## 4. Known Bugs & Open Issues

### 4.1 Unresolved — needs verification, not just a code fix

- **Render deployment status is genuinely unconfirmed.** A Render deploy log screenshot once showed `Error: Cannot find module '/opt/render/project/src/src/index.js'`. This was diagnosed as the classic GitHub-folder-nesting mistake (or an incomplete upload) recurring — the doubled `src/src` in that path is actually the *expected, correct* resolution when Render's Root Directory is blank and the repo is flat, so seeing it there means the repo's actual uploaded content was incomplete or misplaced, not that Root Directory needs changing. **The owner was asked to confirm the fix and never did.** Before assuming any version of this bot is live and working, check: (1) does the GitHub repo have `src/`, `test/`, `package.json` directly at its root, and (2) do Render's logs show `Logged in as...` and `Slash commands registered in N server(s).`

### 4.2 Documented, deliberate limitations (not bugs — see section 3 for why each exists)

- Restarting the bot loses any in-progress (announced-but-not-yet-joined) plan.
- One `BOT_TIMEZONE` for the whole server — not designed for a server spread across timezones.
- Any voice channel counts as "joining" — the bot doesn't check which one was named.
- Natural-language parsing is tuned against false positives, so it occasionally misses an unusually-phrased plan.
- No-show notes can land up to ~5 minutes after `PLAN_EXPIRY_HOURS` actually elapses (5-minute check interval).
- On Render's free tier, `/leaderboard-here`, `/log-here`, and `/awards-here` all need to be re-run after every redeploy (their stored channel gets wiped along with everything else). For `/awards-here` specifically, the automatic post can only fire if the bot stays running continuously across an actual month boundary — frequent redeploys could mean it never gets the chance.
- The leaderboard image is dark-theme-only (see 3.2).
- Roast lines are one shared pool for everyone past the threshold — no per-person opt-out, and the tone isn't configurable beyond hand-editing `src/roastLines.js`.
- There's no command to turn `/log-here` back off once set (only to move it to a different channel).

### 4.3 Open questions — flagged to the project owner, never explicitly resolved

- Whether the leaderboard's **Avg Time Late** column should be a *late-only* average instead of the current overall average across every tracked join (ambiguous in the original spec, open since v8).
- Whether the roast tone and the default 30-minute `ROAST_THRESHOLD_MINUTES` actually fit the owner's server in practice — flagged in the README, never confirmed either way.
- Whether the dark-theme-only leaderboard image reads acceptably for the owner's actual server members, or whether any of them use Discord light mode.

None of the above block moving into Claude Code — they're just decisions nobody has confirmed yet, so don't "fix" them by guessing an answer; ask.

---

## 5. Immediate Next Steps

- [ ] Set this project up under real git (it has been hand-uploaded to GitHub via the web "upload files" flow so far, not committed with git) — clone or init the repo, confirm `.gitignore` is respected, make a clean baseline commit.
- [ ] Run `npm install && npm test` in the new environment before changing anything, to confirm all 120 tests still pass unmodified.
- [ ] Verify the live Render deployment is actually healthy: confirm the GitHub repo is flat at its root (`src/`, `test/`, `package.json` directly there, not nested), confirm Render's **Root Directory** setting is blank to match, and confirm the deploy logs show `Logged in as...` and slash commands registered (see 4.1).
- [ ] Confirm the bot's Discord role has the **Attach Files** permission granted on the live server (**Server Settings → Roles →** bot's role) — required since v12 for the leaderboard image; a bot invited before that version won't have it yet.
- [ ] Confirm `/leaderboard-here`, `/log-here`, and `/awards-here` are currently configured on the live server the way the owner expects — Render's free tier wipes all three on every redeploy, so any redeploy since they were last set up means they need to be re-run.
- [ ] Get explicit sign-off from the project owner on the open questions in 4.3 (Avg Time Late semantics, roast tone/threshold, dark-theme legibility) before changing any of that behavior.
- [ ] Decide whether to stay on Render's free tier (data resets on every redeploy — currently accepted) or move to Railway (small cost, persistent volume) now that real development tooling is in play.
- [ ] If picking up new feature work, check in with the owner first rather than assuming priority — past requests have arrived one at a time, conversationally, not as a backlog.

---

## 6. v17 Delta (2026-08-25)

Everything in sections 1–5 above was written at v16. Where this section disagrees with them, **this section is right.**

### 6.1 Hosting moved to Oracle Cloud — Render is gone

The bot runs on an **Oracle Cloud Always Free** Ubuntu instance, as a systemd unit named `bot`, deployed by `git clone` + `git pull`. The owner's own crib sheet is `Update README.txt` (untracked on purpose — it holds the host IP and SSH key name, which don't belong in a public repo).

Everyday loop: `ssh` in → `cd` to the bot folder → `git pull origin main` → `sudo systemctl restart bot`. Logs: `sudo journalctl -f -u bot`.

**This invalidates a lot of v16's section 3.5, 4.1 and 4.2:**
- There is **no ephemeral disk**. `results.json` and the three store JSONs survive restarts and deploys. `/leaderboard-here`, `/log-here` and `/awards-here` are set once and stay set. The v16 advice to re-run them after every deploy is obsolete.
- The `PORT`-gated HTTP keep-alive in `index.js` stays **inert** (nothing sets `PORT`). No uptime pinger. It's kept only so the code still works on a sleeping host if it's ever moved.
- The v16 §4.1 "unconfirmed Render deployment / `src/src` nesting" issue is **closed** — it was specific to Render's build and cannot occur from a git clone. The repo is confirmed flat at its root.

### 6.2 Now under real git

Previously maintained by hand through GitHub's web upload flow. It's now a normal clone of `github.com/REKTGH/discord-vc-bot`, with `.gitignore`, `.env.example` and this handover committed (they existed locally but had never been in the repo — notably `.gitignore`, which matters a lot now that the server is a live clone).

Working tree was verified byte-identical to `origin/main` before any v17 work started, so nothing was lost in the transition.

### 6.3 Features shipped in v17

1. **New trigger phrases** — `getting on`, `game in/at`, `on in/at`. `on in/at` is **deliberately unguarded** on an explicit call by the owner: it catches "on in 10" but also fires on "the movie was on at 10". There's a test pinning that trade-off so it reads as a decision, not a bug. `/cancel` is the escape hatch.
2. **Bare clock times** — a message that is only a time ("10:30", "9pm", "7:15 am") now tracks. Exact times always worked *with* an intent word; only the bare form was missing.
3. **`MAX_FUTURE_HOURS`** — the hard-coded 12-hour parsing limit is now `config.maxFutureHours`.
4. **Ambiguous bare numbers are asked about, not guessed.** A bare 1–12 could be minutes or an o'clock. `parseJoinTime` now returns null for those; `parseBareNumberAmbiguity` returns both readings, and the bot reacts ⏳/🕐 and tracks nothing until the author taps one. Answering converts the message into a normal plan message. Bare 13–180 still resolves straight to minutes.
5. **Shared plans.** Every tracked plan carries the bot's ⏰; anyone tapping it is tracked against the same stated time, with their own verdict and no-show. Un-tapping withdraws them with `recorded: false` (opting out of someone else's plan is not flaking). `/track <when>` starts one deliberately. Needs the `GuildMessageReactions` intent and Message/Reaction/User **partials** — without the partials, reactions on pre-restart messages arrive with an empty emoji and silently do nothing.
6. **Early scold.** Arriving `EARLY_SCOLD_THRESHOLD_MINUTES` (default 60) or more early now gets its own line pool (`EARLY_SCOLD_LINES`), mirroring the late roast. `classify()` exposes `earlyMinutes`; routing now keys off the new `isCalloutWorthy` (roast **or** early scold) so both bypass `/log-here` for the same reason.
7. **`/uncancel`.** "nvm" is typed at friends far more than at the bot, and the detection can't tell them apart. Rather than make detection timid, undo is cheap: it restores the plan *and* removes the Cancels row — but only if one was written. `planTracker` records a `recorded` flag per cancellation (chat "nvm" → true, `/cancel` → false) so this never guesses.
8. **Monthly leaderboards.** Standings now cover the current calendar month; `/leaderboard scope: All time` gives the full history. **Nothing is ever deleted** — `getLeaderboard` takes an optional range and simply reads less. This matters: `/awards` reads back over the previous month and would break if records were purged. The live message finalises itself at the month boundary (last edit, "live" footer dropped), stays in the channel as that month's record, and a fresh one is posted below. Rollover also runs on the existing hourly timer, so a quiet 1st doesn't leave stale standings up.

### 6.4 Conventions worth keeping

The v16 pattern of pulling pure decision logic out of Discord I/O held throughout: `decideReactionAction` and `decideAmbiguityAnswer` are exported and unit-tested exactly the way `chooseVerdictRouting` is. `src/commands/*` still has no dedicated tests, deliberately — same reasoning as v16 §3.3.

Tests went 120 → **203**. Several existing tests were *updated rather than worked around*, because they encoded decisions v17 deliberately reversed (bare-number minutes, `on in 5` not matching, the empty-board wording, the live-store shape). Each is commented to say so.

One permission note: `resolveAmbiguity` withdraws only the **bot's own** ⏳/🕐 marks (`users.remove(ownId)`), never `reaction.remove()`, which clears an emoji for everyone and needs Manage Messages — a permission this bot is not invited with.

### 6.5 Still open

- The three v16 §4.3 questions are **still unanswered** and were not touched: Avg Time Late semantics (late-only vs overall), whether the roast tone/threshold suits the server, and dark-theme legibility. Ask before changing any of them.
- **Nothing in v17 has been exercised against a live Discord server yet.** All 203 tests pass and every command builds a valid payload, but the reaction flows in particular (partials, permissions, the ⏳/🕐 tidy-up) can only really be confirmed by running it. Deploy and try each one.
- The bot's role needs **Add Reactions** and **Read Message History** for shared plans to work, on top of the **Attach Files** permission v16 already required.
