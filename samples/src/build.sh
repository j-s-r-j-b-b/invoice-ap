#!/usr/bin/env bash
# Regenerate sample invoice PDFs. Run from Git Bash: bash build.sh
# Note: msedge.exe returns immediately and renders asynchronously, so we poll for each output.
export PATH="$LOCALAPPDATA/Programs/node:$PATH"
SRC="$(cd "$(dirname "$0")" && pwd -W)"   # Windows-style path
OUT="$(cd "$SRC/.." && pwd -W)"
EDGE="/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
url() { echo "file:///$(echo "$1" | sed 's/ /%20/g')"; }
run() { # run <outfile> <edge args...>
  local out="$1"; shift; rm -f "$out"
  "$EDGE" --headless --disable-gpu --no-first-run --hide-scrollbars --user-data-dir="$TEMP/edge-inv-$RANDOM" "$@" >/dev/null 2>&1
  for i in $(seq 1 60); do
    if [ -s "$out" ]; then s1=$(stat -c %s "$out"); sleep 1; [ "$s1" = "$(stat -c %s "$out")" ] && return 0; fi
    sleep 0.5
  done; echo "TIMEOUT $out"; return 1
}
node "$SRC/gen.mjs"
for f in s1-brightline s2-northwind s3-apex s4-kestrel s6-zenith; do
  run "$OUT/$f.pdf" --no-pdf-header-footer --print-to-pdf="$OUT/$f.pdf" "$(url "$SRC/$f.html")"
done
# s5: render to PNG (scan look), then wrap the image alone in a PDF (no text layer)
run "$SRC/s5-greenleaf-scan.png" --window-size=1240,1754 --screenshot="$SRC/s5-greenleaf-scan.png" "$(url "$SRC/s5-greenleaf-scan.html")"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$SRC/tojpg.ps1" "$SRC/s5-greenleaf-scan.png" "$SRC/s5-greenleaf-scan.jpg"
run "$OUT/s5-greenleaf-scan.pdf" --no-pdf-header-footer --print-to-pdf="$OUT/s5-greenleaf-scan.pdf" "$(url "$SRC/s5-wrap.html")"
ls -l "$OUT"/*.pdf
