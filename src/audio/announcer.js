// The announcer: every call is voiced by the ElevenLabs "World Wrestling Announcer" voice.
// Recorded takes live in ./voice as <call>-<line>-<take>.mp3 ("td-0-0" is the first take of
// "Touchdown!"); tools/voice/prep.sh trims and levels a downloaded clip into that folder.
// A line with no recording yet falls back to the browser's text-to-speech.

export const CALLS = {
  td: ['Touchdown!', 'He takes it to the house!', 'Six points!'],
  int: ['Intercepted!', 'Picked off!'],
  fumble: ['Fumble!', 'He coughs it up!'],
  sack: ['Sacked!', 'Quarterback down!'],
  big: ['What a hit!', 'Oh, he got crushed!', 'Bone crusher!', 'He felt that one!'],
  fire: ["He's on fire!"],
  fg: ["It's good!"],
  nofg: ['No good!'],
  first: ['First down!'],
  late: ['Late hit!'],
  noflag: ['No flag!', 'No flags in this league!', 'Interference? Not here!'],
  juke: ['Spin move!', 'Look at that move!'],
  grab: ['What a catch!', 'He went up and got it!', 'Unbelievable grab!'],
  layout: ['Diving catch!', 'He laid out for it!'],
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
