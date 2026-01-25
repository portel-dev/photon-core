# photon-core 2.2.0 Release Plan

## Summary

This release adds the **Channel Broker Architecture** for cross-process pub/sub messaging, plus several fixes and improvements.

## Changes Since 2.1.2

### New Features

1. **Pluggable Channel Broker Architecture** (`7cac3ba`)
   - Cross-process messaging with multiple backend support
   - Brokers: `daemon`, `redis`, `http`, `noop`
   - Auto-detection based on environment variables
   - Used by `PhotonMCP.emit({ channel: '...' })`

2. **@accept Constraint** (`c06113d`)
   - File type filtering in UI forms
   - `@accept image/*,application/pdf`
   - Works with `@file` type annotations

### Bug Fixes

1. **Extract photon name from channel** (`1f07df4`)
   - When `PHOTON_NAME` not set, extract from channel format `photonName:subChannel`
   - Fixes pub/sub when MCP started without env var

2. **@icon matching** (`7edf15f`)
   - Prevent `@icon` from matching inside layout hints
   - Fixes `@ui(grid, icon: '📊')` being parsed incorrectly

3. **Daemon tag regex** (`f7ac6ad`)
   - Fix extraction to exclude JSDoc closing characters
   - Ensures `@scheduled`, `@webhook` tags parse correctly

### Refactoring

1. **Docblock tags for daemon features** (`ee8d215`, `1502d02`)
   - `@scheduled` - Cron-based scheduled jobs
   - `@webhook` - HTTP webhook handlers
   - `@locked` - Distributed lock acquisition
   - Uses JSDoc-style tags instead of decorators

### Tests & Documentation

- Channel broker tests (`cb95cb3`)
- Channel broker architecture docs (`6233fd4`)

## Architectural Boundaries

### What's in photon-core (library)

- `PhotonMCP` base class
- Channel broker **interfaces** and **implementations**
- Schema extraction with JSDoc tags
- Generator/stateful execution
- Auto-UI rendering system
- Design system tokens

### What stays in photon (framework)

- Daemon **server** implementation
- CLI commands and runner
- Beam UI
- Loader and marketplace
- Hot reload logic

## Version Bump

**2.1.2 → 2.2.0** (minor)

- New feature: Channel broker architecture
- New feature: @accept constraint
- No breaking changes

## Pre-Release Checklist

- [x] All tests pass (`npm test`)
- [x] Build succeeds (`npm run build`)
- [ ] CHANGELOG.md updated
- [ ] README includes channel broker docs
- [ ] Version bumped in package.json

## Post-Release

After publishing photon-core 2.2.0:

1. Update `@portel/photon` to use `@portel/photon-core@^2.2.0`
2. Publish new photon version
3. Clear npx cache or restart MCP processes

## Commands

```bash
# Run tests
npm test

# Build
npm run build

# Publish
npm version minor
npm publish --access public
```
