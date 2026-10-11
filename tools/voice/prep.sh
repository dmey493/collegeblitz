#!/bin/sh
# Trim and level announcer clips downloaded from ElevenLabs before they go into the game.
#   tools/voice/prep.sh <in.mp3> <call>-<line>-<take>
# e.g. tools/voice/prep.sh ~/Downloads/content.mp3 td-0-0  ->  src/audio/voice/td-0-0.mp3
# <call> and <line> index the CALLS table in src/audio/announcer.js ("td-0" = "Touchdown!").
set -e
in="$1"
name="$2"
out="$(dirname "$0")/../../src/audio/voice/$name.mp3"
# cut the dead air at both ends, level to a consistent loudness, mono 96 kbps
ffmpeg -hide_banner -loglevel error -y -i "$in" \
  -af "silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse,loudnorm=I=-14:TP=-1.5:LRA=11" \
  -ac 1 -ar 44100 -b:a 96k -map_metadata -1 "$out"
echo "$out"
