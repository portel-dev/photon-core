# Changelog

All notable changes to `@portel/photon-core` will be documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); version numbers follow [Semantic Versioning 2.0](https://semver.org/).

## [2.27.0] - 2026-05-09

### Added

- **Three consumption modes for runtime capabilities, one symbol.** `Photon` works as both a class (for `extends Photon`) and a type (for `constructor(private photon: Photon)`). Authors that already extend an unrelated base class can still inject `Photon` as a constructor parameter. The injected value is configured for the host photon's name + scope so `this.photon.memory.set(...)` resolves to the same store an equivalent `extends Photon` consumer would see. Switching between modes is purely cosmetic.
- **`Cloudflare` injection** — wrapped, auto-named CF surface (`cf.kv(qualifier?)`, `cf.r2(qualifier?)`, etc.) shipped as a separate constructor-injectable type, *not* a member of the `Photon` base. Importing `Cloudflare` from `@portel/photon` is the deploy-target signal — the import line documents the dependency. Outside CF, the loader injects a throwing Proxy whose error message names the imported symbol.
- **`CloudflareEnv<T>`** — raw Worker `env` for the escape hatch. Generic so authors can supply a typed binding shape inline; default `Record<string, unknown>` works without an explicit type. Mixing `Cloudflare` and `CloudflareEnv` in one constructor is fine.
- **Auto-naming convention** — `bindingNameFor(photon, category, qualifier?)` exported as the single source of truth. `cf.kv()` → `<photon>_kv`, `cf.kv('cache')` → `<photon>_cache_kv`. Photon names with hyphens normalize to underscores. Shared categories (`ai`, `images`, `browser`) use fixed canonical bindings (`AI` / `IMAGES` / `BROWSER`).
- **Forgiving auto-inject** in `photon-loader-lite` — plain classes that reference `this.cf.*` or `this.cfEnv.*` without declaring the matching constructor parameter still get the field populated post-construction. Mirrors the existing capability-detection mechanism for `this.memory` / `this.emit` / `this.call` etc.
- **Schema-extractor** recognizes `Photon` / `Cloudflare` / `CloudflareEnv` as constructor parameter types ahead of the env-var fallback so the loader knows which injection backend to wire. New `injectionType` values: `'photonRuntime'`, `'cloudflare'`, `'cloudflareEnv'`. Type matchers accept optional modifiers (`Photon | undefined`, `CloudflareEnv<MyBindings>`).
- **`detectCapabilities`** flags `'cloudflare'` / `'cloudflareEnv'` (replacing the previous `'cf'`) so `this.cf.*` and `this.cfEnv.*` usage gates the auto-inject.
- **`createCloudflareFromEnv(env, photonName)`** — factory for hosts (deployed Worker template, tests) that need to construct a `Cloudflare` surface from a real CF env using the auto-naming convention. Resource ids default to the binding name when no override is set.
- **`notConfiguredCloudflare()`** — throwing-Proxy fallback the loader hands out when no CF runtime is configured. Diagnostic messages name the imported symbol so authors don't conflate "I forgot the import" with "I forgot to deploy."

### Changed

- `Photon` base class capability methods (`emit`, `render`, `ask`, `call`, `storage`, `assets`, `channel`) flipped from `protected` to public — required so the inject-mode author can call `this.photon.emit(...)` without TypeScript rejecting protected access. Inherited methods are still filtered out of MCP tool extraction by the schema extractor (the boundary that matters); `protected` was author-style discouragement, not real encapsulation.
- `withPhotonCapabilities()` mixin: dropped the `_cfRuntime` slot, `_cfStub` cache, and `cf` getter. CF is no longer a built-in capability; it's a platform dependency surfaced through explicit injection.

### Removed

- `CFRuntime` and `notConfiguredCF` were temporarily kept as transitional re-exports during the migration. Both retired now that the photon repo's classic loader, worker template, and deploy autogen consume the new `Cloudflare` injection end-to-end. The structural binding-shape exports (`R2BucketLike`, `KVNamespaceLike`, `D1DatabaseLike`, `D1PreparedStatementLike`, `QueueLike`, `VectorizeIndexLike`, `AiLike`, `ImagesBindingLike`, `FetcherLike`) stay public — hosts that mock CF bindings in unit tests need them to type their fakes.
- `Photon.cf` getter and `_cfRuntime` / `_cfStub` fields removed from the base class. Photons that used to read `this.cf` either declare a `Cloudflare` constructor parameter or rely on the forgiving auto-inject for `this.cf.*`.

### Tests

- `tests/photon-injection.test.ts` (9 cases) — facade shape, both CF injections, forgiving auto-inject, extends ↔ inject memory parity.
- `tests/cloudflare-surface.test.ts` (14 cases) — binding naming, throwing-Proxy fallbacks, env-backed factory, type matchers.
- `tests/detect-capabilities.test.ts` updated for `cloudflare` / `cloudflareEnv` (replacing `cf`); 42 cases pass.

## [2.26.0] - 2026-05-05

### Added

- **`this.roots`** - Read-only getter on `Photon` exposing MCP workspace roots declared by the connected client (`roots/list`). Returns `Array<{ uri: string; name?: string }>`. Empty when the client has no `roots` capability or the photon is running outside a live MCP session. The runtime fetches once per session and refreshes on `notifications/roots/list_changed`.
- **`notifyResourceUpdated(uri)`** - Method on `Photon` for triggering `notifications/resources/updated` to every subscribed client. Default is a no-op (CLI/unit-test safe); the runtime injects a wired version per instance.
- **`@get /path` and `@post /path` method tags** - HTTP-only route declarations. Methods annotated with `@get` or `@post` are registered as HTTP endpoints (not MCP tools). The schema extractor emits them as `httpRoutes` in `ExtractedMetadata`.
- **`@auth cf-access`** - New auth mode value in `ExtractedMetadata.auth`. Signals Cloudflare Access JWT validation instead of OIDC.
- **`@resource` and `@prompt` as canonical method-level tags** - Aliases for the legacy `@Static` (resource resolver) and `@Template` (prompt template) forms. Both old and new names are accepted; the canonical forms are preferred in new photons.
- **Dual-layout asset discovery** - `{photon}/assets/` is now the canonical bundle root when present. Legacy `{photon}/ui/`, `{photon}/prompts/`, `{photon}/resources/` flat layout still resolves without changes, keeping all pre-v1.29 photons working.
- `HttpRoute` interface exported from `schema-extractor` (`{ method, path, handler }`).

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

[2.27.0]: https://github.com/portel-dev/photon-core/compare/v2.26.0...v2.27.0
[2.26.0]: https://github.com/portel-dev/photon-core/compare/v2.25.0...v2.26.0
[2.25.0]: https://github.com/portel-dev/photon-core/compare/v2.24.0...v2.25.0
[2.24.0]: https://github.com/portel-dev/photon-core/compare/v2.23.0...v2.24.0
