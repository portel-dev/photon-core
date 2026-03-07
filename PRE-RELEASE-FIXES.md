# Pre-Release Defensive Fixes for photon-core

**Goal:** Add comprehensive validation and fail-safe handling for all JSDoc/schema extraction issues before v2.10.0 release.

---

## Phase 1: Critical Issues (HIGH SEVERITY) 🔴 - ✅ COMPLETE
*Must fix before release - cause invalid schemas*

**Status**: All 5 issues IMPLEMENTED and TESTED (commit 7f29515)
- Comprehensive test suite: 27 tests covering all Phase 1 constraints + edge cases
- All tests passing without side effects

### 1. @min > @max Validation (Issue 2.1)
- **File:** `src/schema-extractor.ts:1251-1260`
- **Problem:** Constraint values not validated; @min > @max creates invalid JSON schema
- **Fix:** Add validation in `applyConstraints()` to reject inverted ranges
- **Effort:** 30 min
- **Test:** Create photon with `@min 100 @max 10`

### 2. @pattern Regex Validation (Issue 4.1)
- **File:** `src/schema-extractor.ts:1262-1266`
- **Problem:** Invalid regex patterns accepted silently
- **Fix:** Wrap in try-catch, validate with `new RegExp()`
- **Effort:** 30 min
- **Test:** Create photon with invalid regex like `@pattern [a-z}`

### 3. @choice Comma Parsing (Issue 10.1)
- **File:** `src/schema-extractor.ts:1274-1279`
- **Problem:** Quoted choices with commas split incorrectly
- **Fix:** Implement quoted-aware split logic
- **Effort:** 45 min
- **Test:** `@choice "json,xml", yaml, csv`

### 4. @multipleOf Validation (Issue 9.1)
- **File:** `src/schema-extractor.ts:1322-1326`
- **Problem:** Allows zero or negative values (JSON schema requires > 0)
- **Fix:** Validate `multipleOf > 0` before applying
- **Effort:** 15 min
- **Test:** `@multipleOf 0`, `@multipleOf -5`

### 5. @validate Non-Existent Field (Issue 12.1)
- **File:** `src/schema-extractor.ts:1768-1779`
- **Problem:** Validation rules reference fields that don't exist
- **Fix:** Cross-check against actual parameter names
- **Effort:** 30 min
- **Test:** `@validate nonExistentField must be...`

---

## Phase 2: High-Impact Issues (MEDIUM SEVERITY) 🟡
*Should fix - prevent silent failures and confusing behavior*

### 6. @format Invalid Values (Issue 4.2)
- **File:** `src/schema-extractor.ts:1814-1854`
- **Problem:** Typos in @format silently ignored
- **Fix:** Whitelist valid formats, warn on invalid
- **Effort:** 30 min
- **Test:** `@format table-invalid`, `@format json-xml`

### 7. Constraint-Type Mismatch (Issue 1.2)
- **File:** `src/schema-extractor.ts:1410-1441`
- **Problem:** @min applied to boolean or other incompatible types
- **Fix:** Validate constraint applicability before applying
- **Effort:** 45 min
- **Test:** `@param isActive {@min 10} boolean`

### 8. @retryable Invalid Config (Issue 9.2)
- **File:** `src/schema-extractor.ts:1719-1724`
- **Problem:** Allows 0 count or negative delays
- **Fix:** Validate both count > 0 and delay > 0
- **Effort:** 20 min
- **Test:** `@retryable 0 0ms`

### 9. @throttled Invalid Rate (Issue 9.3)
- **File:** `src/schema-extractor.ts:1732-1736`
- **Problem:** Silent failure on invalid rate format
- **Fix:** Validate `parseRate()` return, warn on error
- **Effort:** 20 min
- **Test:** `@throttled 0/sec`, `@throttled invalid`

### 10. Complex Default Values (Issue 5.1)
- **File:** `src/schema-extractor.ts:932-953`
- **Problem:** Function calls in defaults become strings, not evaluated
- **Fix:** Warn when default is complex expression, omit from schema
- **Effort:** 30 min
- **Test:** `async getData(limit: number = Math.max(10, 100))`

### 11. Default Type Validation (Issue 5.2)
- **File:** `src/schema-extractor.ts:576 & 940`
- **Problem:** Default value type doesn't match parameter type
- **Fix:** Type-check defaults after extraction, warn/convert
- **Effort:** 40 min
- **Test:** `async process(count: number = 3.7)` with `@field integer`

### 12. ReadOnly/WriteOnly Conflict (Issue 8.1)
- **File:** `src/schema-extractor.ts:1334-1351`
- **Problem:** Silent conflict resolution with "last wins"
- **Fix:** Warn when both present, suggest removing redundant
- **Effort:** 20 min
- **Test:** `@readOnly @writeOnly` on same param

### 13. Pattern+Enum Conflict (Issue 8.2)
- **File:** `src/schema-extractor.ts:1457`
- **Problem:** Enum override from JSDoc silently overrides TypeScript
- **Fix:** Warn when TSEnum ≠ JSDocEnum, show both
- **Effort:** 30 min
- **Test:** TS type `'a'|'b'` with `@choice x,y,z`

### 14. Unknown Layout Hints (Issue 11.1)
- **File:** `src/schema-extractor.ts:1861-1882`
- **Problem:** Typos in @title, @icon, etc. silently ignored
- **Fix:** Whitelist valid hint names, warn on unknown
- **Effort:** 25 min
- **Test:** `@titulo` instead of `@title`

---

## Phase 3: Developer Experience (LOW SEVERITY) 🟢
*Nice-to-have - improve warnings and debugging*

### 15. Undocumented Required Params (Issue 6.1)
- **File:** `src/schema-extractor.ts:147-166`
- **Problem:** No hint to document required parameters
- **Fix:** Warn when required param has no @param description
- **Effort:** 15 min
- **Test:** Function with required param but no JSDoc

### 16. Extra @param Aggregation (Issue 7.2)
- **File:** `src/schema-extractor.ts:170-194`
- **Problem:** Individual warnings not aggregated
- **Fix:** Show summary of all mismatches in one message
- **Effort:** 15 min
- **Test:** Method with multiple unmatched @param tags

### 17. @returns Documentation (Issue 3.1)
- **File:** `src/schema-extractor.ts:356-412`
- **Problem:** Return type not documented
- **Fix:** Extract @returns JSDoc and add to metadata
- **Effort:** 45 min
- **Test:** Multiple methods with different return types

---

## Implementation Strategy

### Week 1: Critical Issues (Phase 1)
```
Day 1: Issues 2.1, 4.1 (min/max, pattern validation)
Day 2: Issues 10.1, 9.1, 12.1 (choice, multipleOf, validate)
Day 3: Testing + review
```

### Week 2: High-Impact Issues (Phase 2)
```
Day 1: Issues 4.2, 1.2, 9.2 (format, constraint-type, retryable)
Day 2: Issues 9.3, 5.1, 5.2 (throttle, defaults, type-check)
Day 3: Issues 8.1, 8.2, 11.1, 14 (conflicts, hints)
Day 4: Testing + review
```

### Week 3: UX Improvements (Phase 3)
```
Day 1: Issues 6.1, 7.2, 3.1 (docs, aggregation, returns)
Day 2: Integration testing
Day 3: Documentation + release prep
```

---

## Automated Test Photons

Create test fixtures in `/test-photons/` to catch regressions:

```typescript
// edge-cases.photon.ts - Tests all edge cases

/**
 * Test invalid constraints
 * @param age {@min 100} {@max 10} Should warn about min > max
 * @param pattern {@pattern [invalid-regex} Should warn about regex
 * @param choices {@choice "a,b", c} Should parse quoted choices correctly
 * @param multiple {@multipleOf 0} Should warn about invalid multipleOf
 */
async invalidConstraints(
  age: number,
  pattern: string,
  choices: string,
  multiple: number
) {}

/**
 * Test type conflicts
 * @param count {@min 5} Should warn about min on boolean
 */
async typeConflicts(count: boolean) {}

/**
 * Test complex defaults
 * @param limit Limited by max
 */
async complexDefaults(limit: number = Math.max(10, 100)) {}
```

---

## Quality Gates Before Release

- [ ] All Phase 1 issues fixed and tested
- [ ] No new console warnings in test suite (clean output)
- [ ] Edge case photons pass without errors
- [ ] Documentation updated for constraint rules
- [ ] Type tests pass (TypeScript strict mode)
- [ ] CI passes on all test photons
- [ ] Manual QA: Verify all warning messages are clear
- [ ] Release notes document validation improvements

---

## Version Bump Strategy

Current: v2.9.4
Target: v2.10.0 (minor bump for new validation features)

Commit messages will use:
- `fix:` for Issues 1-12 (actual bugs)
- `feat:` for Issues 13-17 (new validation features)

---

## Related Tickets

- Parameter name mismatch fail-safe: Already merged (commit de7a1bb)
- This plan: Pre-release validation sweep
- Follow-up: Post-release monitoring for edge cases

---

## Success Metrics

**Before fixes:** Photons with invalid constraints could cause:
- Runtime schema validation errors (JSON Schema fails)
- Silent configuration mismatches (warnings ignored)
- Developer confusion (no feedback on typos)

**After fixes:** All issues caught with clear warnings, suggesting corrections.
