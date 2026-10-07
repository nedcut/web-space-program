#!/usr/bin/env bash
# Before/after images from an A/B run's first-repetition screenshots (device resolution 2940×1840):
#   <case>-before-after.jpg  — both frames at "normal viewing" size (1470 px wide each, as on a Retina screen)
#   <case>-crop-1to1.jpg      — a 900×600 device-pixel crop of each, side by side (pixel-peeping)
#   compare-shots.sh <ab-name> <out-dir> <case>:<cropX>:<cropY> …
set -euo pipefail
name=$1; out=$2; shift 2
S=/mnt/c/wsp-tools/shots/perfgpu
for spec in "$@"; do
  IFS=: read -r c x y <<<"$spec"
  a="$S/ab-$name-A-$c-r1-$c.png"; b="$S/ab-$name-B-$c-r1-$c.png"
  ffmpeg -loglevel error -y -i "$a" -i "$b" -filter_complex "[0]scale=1470:-1[a];[1]scale=1470:-1[b];[a][b]hstack" -q:v 3 "$out/$c-before-after.jpg"
  ffmpeg -loglevel error -y -i "$a" -i "$b" -filter_complex "[0]crop=900:600:$x:$y[a];[1]crop=900:600:$x:$y[b];[a][b]hstack" -q:v 2 "$out/$c-crop-1to1.jpg"
done
