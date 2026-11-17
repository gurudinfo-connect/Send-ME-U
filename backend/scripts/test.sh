#!/bin/sh
# Runs each test file in its own process (they share one database, so strictly one at a time).
export NODE_ENV=test
fail=0
for f in tests/*.test.ts; do
  echo "== $f"
  npx tsx --test --test-force-exit --test-timeout=30000 "$f" 2>&1 | grep -E "^\s*(not ok|ok) |^# (pass|fail)" || fail=1
  [ "${PIPESTATUS:-0}" = 0 ] 2>/dev/null
done
exit $fail
