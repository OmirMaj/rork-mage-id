#!/bin/bash
# heavy.sh <command...> — run a memory-heavy command (tsc = 3.6 GB RSS on this repo; jest; ship-check) in one of
# HEAVY_SLOTS machine-wide slots shared by every agent. The 2026-09-23 OOMs came from 4+ tsc runs at once on an
# 18 GB Mac; on 2026-10-01 the founder asked for lower RAM, so the default is ONE slot.
# Re-entrant: a nested heavy.sh (the old "heavy.sh heavy.sh …" two-slot idiom) runs inside the slot it already holds.
# Waits (a line every 30 s) for a free slot, clears slots whose owner died, releases on exit.
if [ -n "$HEAVY_SLOT_HELD" ]; then exec "$@"; fi
SLOTS=${HEAVY_SLOTS:-1}
LOCKDIR=/private/tmp/claude-501/heavy-locks
mkdir -p "$LOCKDIR"
waited=0
while true; do
  for i in $(seq 1 "$SLOTS"); do
    slot="$LOCKDIR/slot$i"
    if mkdir "$slot" 2>/dev/null; then
      echo $$ > "$slot/pid"
      trap 'rm -rf "'"$slot"'"' EXIT INT TERM HUP
      [ $waited -gt 0 ] && echo "[heavy] got slot $i after ${waited}s"
      export HEAVY_SLOT_HELD=1
      # Cap jest's own workers too (the gate's jest otherwise forks one per core: 11 workers, ~4.8 GB).
      export JEST_MAX_WORKERS=${JEST_MAX_WORKERS:-2}
      "$@"
      exit $?
    fi
    p=$(cat "$slot/pid" 2>/dev/null)
    if [ -n "$p" ] && ! kill -0 "$p" 2>/dev/null; then rm -rf "$slot"; fi
  done
  [ $((waited % 30)) -eq 0 ] && echo "[heavy] waiting for a slot (${waited}s)"
  sleep 3; waited=$((waited + 3))
done
