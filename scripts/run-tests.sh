#!/usr/bin/env bash
# Runs every test suite in photon-core.
#
# Two test runners cover different files:
#   - `bun run` for plain Node-assert suites (the photon-core
#     convention — assert + custom test wrappers, no framework).
#     Previously this used `npx tsx`; switched because tsx's esbuild
#     transform service intermittently throws "write EPIPE" when
#     many suites run in sequence. Bun's TS support is native and
#     stable.
#   - `npx vitest` for the two schema-extractor validation files
#     which use vitest's `describe/it/expect`. vitest is now a
#     devDependency so these run as part of the standard suite —
#     no longer skipped.
#
# Update this list alongside any new test file.

set -eo pipefail

# Bun-runnable suites — Node-assert style.
TSX_SUITES=(
  tests/audit.test.ts
  tests/bases-registry.test.ts
  tests/bulkhead.test.ts
  tests/channels.test.ts
  tests/cloudflare-surface.test.ts
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
  tests/photon-injection.test.ts
  tests/photon-loader-lite.test.ts
  tests/schedule.test.ts
  tests/shared-utils.test.ts
  tests/watcher.test.ts
)

# Vitest-driven suites.
VITEST_SUITES=(
  tests/schema-extractor-constraint-validation.test.ts
  tests/schema-extractor-phase2-validation.test.ts
)

PASS=0
FAIL=0
FAILED_SUITES=()

echo "── tsx suites ──"
for t in "${TSX_SUITES[@]}"; do
  printf "  %-60s " "$t"
  if bun run "$t" > /tmp/photon-core-$(basename "$t").log 2>&1; then
    echo "OK"
    PASS=$((PASS + 1))
  else
    echo "FAIL"
    FAIL=$((FAIL + 1))
    FAILED_SUITES+=("$t")
  fi
done

echo
echo "── vitest suites ──"
if npx vitest run "${VITEST_SUITES[@]}" > /tmp/photon-core-vitest.log 2>&1; then
  for t in "${VITEST_SUITES[@]}"; do
    printf "  %-60s OK\n" "$t"
    PASS=$((PASS + 1))
  done
else
  for t in "${VITEST_SUITES[@]}"; do
    printf "  %-60s FAIL\n" "$t"
    FAIL=$((FAIL + 1))
    FAILED_SUITES+=("$t")
  done
fi

TOTAL=$(( ${#TSX_SUITES[@]} + ${#VITEST_SUITES[@]} ))
echo
echo "  Passed: $PASS / $TOTAL"
if [ "$FAIL" -gt 0 ]; then
  echo "  Failed: $FAIL"
  for t in "${FAILED_SUITES[@]}"; do
    echo
    echo "  ── $t ──"
    if [ -f "/tmp/photon-core-$(basename "$t").log" ]; then
      tail -20 "/tmp/photon-core-$(basename "$t").log" | sed 's/^/    /'
    else
      tail -20 /tmp/photon-core-vitest.log | sed 's/^/    /'
    fi
  done
  exit 1
fi
