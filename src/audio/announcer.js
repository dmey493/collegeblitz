// The announcer: every call is voiced by the ElevenLabs "World Wrestling Announcer" voice.
// Recorded takes live in ./voice as <call>-<line>-<take>.mp3 ("td-0-0" is the first take of
// "Touchdown!"); tools/voice/prep.sh trims and levels a downloaded clip into that folder.
// A line with no recording yet falls back to the browser's text-to-speech.

// Short calls keep the rhythm; the rest are the arcade announcer's kind of line: irreverent,
// over the top, and never at a loss for a comparison.
export const CALLS = {
  td: ['Touchdown!', 'Touchdown! Check the end zone for survivors!', 'He went through them like a hot knife through butter!', 'Six points, and that defense is in the lost and found!'],
  int: ['Intercepted!', 'Picked off!', 'That pass had the wrong return address!', 'He just threw a birthday present to the wrong kid!'],
  fumble: ['Fumble!', "He's carrying it like a greased pig!", 'Butterfingers! The ball has left the building!'],
  sack: ['Sacked!', 'Folded him up like a lawn chair!', "He's eating more turf than a lawnmower!"],
  big: ['What a hit!', 'He just got hit by the express train!', 'That one rearranged his furniture!', "He'll be hearing birds chirp till Tuesday!", 'Somebody get that man a dental plan!'],
  fire: ["He's on fire!", 'Call the fire marshal! This is a five-alarm blaze!', "He's cooking with gasoline now!"],
  fg: ["It's good!", 'Split the uprights like a lumberjack!'],
  nofg: ['No good!', 'That kick needed a GPS!'],
  first: ['First down!', 'Move the chains! Keep that parade rolling!'],
  late: ['Late hit!', 'The whistle is just a suggestion around here!', "After the whistle? That's just plain rude!"],
  noflag: ['No flag!', 'No flags in this league!', 'The refs are on a coffee break!', "Interference? The rule book's in the shredder!"],
  juke: ['He broke his ankles! Somebody bring the crutches!', 'Spun him like a ceiling fan!', 'He left him grabbing at smoke!'],
  grab: ['What a catch!', 'He went up like that ball owed him money!', 'Snatched it out of the sky like a hungry hawk!', 'That man has glue for gloves!'],
  layout: ['Diving catch!', 'Superman dive! Somebody find his cape!', 'He dove for it like the last donut in the box!'],
  pile: ['Pile on!', 'Bodies stacking up like pancakes!', 'Everybody into the pool!'],
  deflect: ['Swatted like a mosquito!', 'Get that weak stuff out of here!'],
  safety: ['Safety! He got trapped in his own house!'],
  stiff: ['Stiff-armed him into next week!'],
};

// the build inlines each clip as a data: URL
const FILES = import.meta.glob('./voice/*.mp3', { eager: true, query: '?url', import: 'default' });

// "td-0" -> [url, url, ...] (every take of that line)
export const TAKES = {};
for (const [path, url] of Object.entries(FILES)) {
  const m = /\/([a-z]+)-(\d+)-\d+\.mp3$/.exec(path);
  if (!m || !CALLS[m[1]] || !CALLS[m[1]][+m[2]]) continue;
  (TAKES[`${m[1]}-${m[2]}`] ||= []).push(url);
}

// pick a line for a call: its text, plus one of its recorded takes when there are any
export function pickLine(key, rnd = Math.random) {
  const lines = CALLS[key];
  if (!lines) return null;
  const i = Math.floor(rnd() * lines.length);
  const takes = TAKES[`${key}-${i}`];
  return { text: lines[i], url: takes ? takes[Math.floor(rnd() * takes.length)] : null };
}
