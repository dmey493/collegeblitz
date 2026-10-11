#!/bin/sh
# Trim, shorten and level a sound effect downloaded from ElevenLabs.
#   tools/voice/sfx.sh <in.mp3> <name> <max seconds>   ->  src/audio/sfx/<name>.mp3
set -e
in="$1"; name="$2"; max="${3:-1.2}"
out="$(dirname "$0")/../../src/audio/sfx/$name.mp3"
fade=$(echo "$max" | awk '{ f = $1 * 0.3; if (f > 0.6) f = 0.6; print f }')
start=$(echo "$max $fade" | awk '{ print $1 - $2 }')
ffmpeg -nostdin -hide_banner -loglevel error -y -i "$in" \
  -af "silenceremove=start_periods=1:start_threshold=-40dB,atrim=0:$max,afade=t=out:st=$start:d=$fade,loudnorm=I=-16:TP=-1.5:LRA=11" \
  -ac 1 -ar 44100 -b:a 96k -map_metadata -1 "$out"
echo "$out"
