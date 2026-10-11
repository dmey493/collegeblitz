#!/bin/sh
# The down-and-distance voice: a deep, robotic, clipped read ("Third and... seven").
# Pauses squeezed out, pitched down, sped up, a short metallic comb and hard compression for
# the snap.
#   tools/voice/robot.sh <in.mp3> <name> [tempo]   ->  src/audio/downs/<name>.mp3
# (the voice draws out "and": the down halves get a faster tempo, 1.9, than the numbers, 1.5)
set -e
in="$1"; name="$2"; tempo="${3:-1.5}"
out="$(dirname "$0")/../../src/audio/downs/$name.mp3"
ffmpeg -nostdin -hide_banner -loglevel error -y -i "$in" \
  -af "silenceremove=start_periods=1:start_threshold=-42dB,silenceremove=stop_periods=-1:stop_duration=0.04:stop_threshold=-36dB:stop_silence=0.02,asetrate=44100*0.86,aresample=44100,atempo=$tempo,aecho=0.85:0.55:7:0.38,highpass=f=70,acompressor=threshold=-24dB:ratio=9:attack=1:release=60:makeup=6,alimiter=limit=0.9,loudnorm=I=-16:TP=-1.5:LRA=7" \
  -ac 1 -ar 44100 -b:a 96k -map_metadata -1 "$out"
echo "$out"
