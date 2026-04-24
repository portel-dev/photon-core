# Changelog

All notable changes to `@portel/photon-core` will be documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); version numbers follow [Semantic Versioning 2.0](https://semver.org/).

## [2.25.0] - 2026-04-24

### Added

- New imperative primitives on the `Photon` base class: `this.sample()` for MCP sampling, `this.confirm()` for yes/no prompts, and `this.elicit()` for structured input requests. Complements the existing async-generator `yield`-based elicitation flow and lets plain async methods request input without switching to a generator. Available on all loaded photons via capability injection.

### Fixed

- `this.schedule.cancel()` now fires the registered unschedule hook so the in-memory cron registration is evicted from the daemon when the backing task file is unlinked. Prior behavior left ghost timers firing forever against a deleted task record.
- Unschedule-hook failures now surface to the caller instead of being silently swallowed. Cancel operations that fail to evict are visible so the caller can react.
- `detectCapabilities()` now recognizes typed-access patterns with function-type parens like `((this as any).foo)()`. Prior regex missed this shape and skipped capability injection for affected photons.

## [2.24.0] — 2026-04-21

### Added

- `detectCapabilities()` now recognizes typed-access patterns like `(this as any).call(...)`, `(this as SomeClass).memory`, `(<T>this).emit(...)`, and double casts. Previously the regex only matched literal `this.X` tokens, so plain-class photons using a TypeScript workaround silently missed capability injection at runtime. Covers all nine capabilities (emit/memory/call/mcp/lock/instanceMeta/allInstances/caller/render). 32 regression tests in `tests/detect-capabilities.test.ts`.
- Stat-gate in `Photon.executeTool()` — the base class now checks source mtime before dispatch when a photon was loaded without a daemon. Mirrors the daemon-side gate so `photon cli foo bar` run immediately after a `sed -i` sees the new code on the first call.
- Tool descriptions are sanitized at parse time — `sanitizeDescription()` strips HTML, collapses whitespace, and caps length via `MAX_DESCRIPTION_LENGTH`. New exports: `sanitizeDescription`, `MAX_DESCRIPTION_LENGTH`, `SanitizerWarning`, `SanitizeResult`.
- `@mask` and `@maxResponseBytes` middleware guards — post-execution masking for PII-sensitive fields and hard byte caps on tool responses.
- Per-parameter JSDoc descriptions extracted by the schema extractor.
- `@format a2ui` recognized as a valid `OutputFormat` value; Photon can now declare `@format a2ui` on methods that return A2UI v0.9 surfaces.

### Fixed

- `this.memory` baseDir is now pinned on the Photon instance at construction so memory reads survive daemon restarts. Previously `MemoryProvider` fell back to `getDefaultContext()` and could drift between cwd-derived locations.
- Same root cause: `ScheduleProvider` now pins `baseDir` so schedule files follow the photon's `workingDir` instead of the resolving process's default.

### Tests

- `tests/memory-namespace-stability.test.ts` — 3 cases covering the kith namespace-orphan regression that prompted the memory/schedule baseDir fixes.
- `tests/detect-capabilities.test.ts` — 32 cases covering literal + typed-access + type-cast + whitespace patterns and negative cases.
- `tests/description-sanitizer.test.ts` — 9 cases for the new description sanitizer.
- `tests/mask-maxbytes-middleware.test.ts` — 9 cases for the post-execution guards.

## [2.23.0] — 2026-04-15

See git log; CHANGELOG seeded from v2.24.0 forward. Earlier releases are tagged in git history.

[2.25.0]: https://github.com/portel-dev/photon-core/compare/v2.24.0...v2.25.0
[2.24.0]: https://github.com/portel-dev/photon-core/compare/v2.23.0...v2.24.0
