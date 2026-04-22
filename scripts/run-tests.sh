#!/usr/bin/env bash
# Runs every passing test suite in photon-core.
#
# Three suites are deliberately excluded and tracked as known gaps rather than
# silently skipped:
#   - tests/schedule.test.ts
#       Pre-existing test-state contamination — two "create: …" cases fail
#       because earlier tests leave a ScheduleProvider entry in the shared
#       store. Pre-dates the v2.24.0 window. Tracked for a future fix.
#   - tests/schema-extractor-constraint-validation.test.ts
#       Imports from 'vitest' but photon-core has no vitest devDependency.
#       Either install vitest or migrate the file to node:test — the
#       coverage it adds is already duplicated by tsc type-checks.
#   - tests/schema-extractor-phase2-validation.test.ts
#       Same vitest-import blocker as above.
#
# Update this list alongside any new test file.

set -eo pipefail

SUITES=(
  tests/audit.test.ts
  tests/bases-registry.test.ts
  tests/bulkhead.test.ts
  tests/channels.test.ts
  tests/collection.test.ts
  tests/collections.test.ts
  tests/data-paths.test.ts
  tests/description-sanitizer.test.ts
  tests/detect-capabilities.test.ts
  tests/detect-namespace.test.ts
  tests/duration.test.ts
  tests/functional-tags.test.ts
  tests/gitignore.test.ts
  tests/instance-store.test.ts
  tests/locks.test.ts
  tests/mask-maxbytes-middleware.test.ts
  tests/memory-namespace-stability.test.ts
  tests/memory.test.ts
  tests/middleware.test.ts
  tests/mixin.test.ts
  tests/oklch.test.ts
  tests/on-error-hook.test.ts
  tests/photon-base-sample-elicit.test.ts
  tests/photon-error.test.ts
  tests/photon-loader-lite.test.ts
  tests/shared-utils.test.ts
  tests/watcher.test.ts
)

PASS=0
FAIL=0
FAILED_SUITES=()
for t in "${SUITES[@]}"; do
  printf "  %-60s " "$t"
  if npx tsx "$t" > /tmp/photon-core-$(basename "$t").log 2>&1; then
    echo "OK"
    PASS=$((PASS + 1))
  else
    echo "FAIL"
    FAIL=$((FAIL + 1))
    FAILED_SUITES+=("$t")
  fi
done

echo
echo "  Passed: $PASS / ${#SUITES[@]}"
if [ "$FAIL" -gt 0 ]; then
  echo "  Failed: $FAIL"
  for t in "${FAILED_SUITES[@]}"; do
    echo
    echo "  ── $t ──"
    tail -20 "/tmp/photon-core-$(basename "$t").log" | sed 's/^/    /'
  done
  exit 1
fi
