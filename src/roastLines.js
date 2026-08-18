// roastLines.js — the joke lines used to needle someone who joined voice
// really late (see verdict.js's buildVerdictMessage and config.js's
// ROAST_THRESHOLD_MINUTES, which controls how late "really late" means).
// Kept in its own file, separate from the classification/message logic, so
// adding or editing jokes never means touching any actual logic.
//
// Add your own any time - just add a new string to ROAST_LINES below. Include
// the literal text "{minutes}" anywhere in a line and it'll be swapped for
// the actual number of minutes late (e.g. "Only {minutes} minutes late"
// becomes "Only 47 minutes late"). Not every line needs a {minutes} - plenty
// read fine without one.
const ROAST_LINES = [
  "Oh, good, you're here. I was just starting to draft your missing person report.",
  "Nice of you to join us in this century.",
  "Look who decided to show up. No, really — everyone, look.",
  "Welcome! We saved you a seat. We also aged a little, but that's fine.",
  "Fashionably late, or just late-late? Asking for the group chat.",
  "We were about to split your snacks. Glad you made it before that became permanent.",
  "Ah, there you are. I was starting to update your emergency contact info.",
  "Only {minutes} minutes late — practically early, by your standards.",
  "Take your time. It's not like anyone was waiting. (Everyone was waiting.)",
  "You've arrived! Slowly. But you've arrived.",
  "I'd say 'better late than never,' but let's not set the bar that low.",
  "So glad you could pencil us in.",
  "{minutes} minutes late. Adding it to your permanent record, right next to the others.",
  "We were taking bets on whether you'd show. Nobody won, but we all lost time.",
  "I hope the nap was worth it.",
  "Breaking news: you exist, and you are, in fact, capable of joining a call.",
  "Everyone, let's give a warm, mildly resentful welcome.",
  "I was going to send a search party, but the search party was also waiting on you.",
  "Your timing is truly a personal art form at this point.",
  "Glad you found the time between all your other very important nothing.",
  "Slow and steady loses the race, but here you are anyway.",
  "We already covered the important parts. You're just in time for the leftovers.",
  "I'm not mad. I'm just going to remember this.",
  "At this point your arrival should come with its own sound effect.",
  "The meeting started without you, and honestly, it went fine.",
  "You've kept us waiting long enough that this is basically a surprise party now.",
  "Punctuality called. It left a while ago, right around when you should have joined.",
  "{minutes} minutes late — long enough for us to briefly consider starting a new hobby.",
  "Better late than- actually, you know what, just late.",
  "So this is what {minutes} minutes of freedom looks like. Must be nice.",
];

// Picks a random line and fills in {minutes} if that line uses it.
function pickRoastLine(minutes) {
  const line = ROAST_LINES[Math.floor(Math.random() * ROAST_LINES.length)];
  return line.replace(/\{minutes\}/g, String(minutes));
}

module.exports = { ROAST_LINES, pickRoastLine };
