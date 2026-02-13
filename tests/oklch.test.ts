/**
 * Tests for OKLCH Color Engine
 */

import {
  oklchToSRGB,
  srgbToHex,
  oklchToHex,
  generateThemeColors,
  generateBeamThemeColors,
  beamThemeToCSS,
  themePresets,
  type ThemeConfig,
} from '../src/design-system/oklch.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (e) {
    console.log(`❌ ${name}`);
    console.error(`   ${e}`);
    failed++;
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function assertClose(actual: number, expected: number, tolerance: number, label: string) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${label}: expected ~${expected}, got ${actual} (tolerance: ${tolerance})`);
  }
}

function isValidHex(hex: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(hex);
}

// =============================================================================
// OKLCH → sRGB Conversion
// =============================================================================

test('oklchToSRGB: black (L=0)', () => {
  const [r, g, b] = oklchToSRGB(0, 0, 0);
  assertClose(r, 0, 0.01, 'r');
  assertClose(g, 0, 0.01, 'g');
  assertClose(b, 0, 0.01, 'b');
});

test('oklchToSRGB: white (L=1, C=0)', () => {
  const [r, g, b] = oklchToSRGB(1, 0, 0);
  assertClose(r, 1, 0.02, 'r');
  assertClose(g, 1, 0.02, 'g');
  assertClose(b, 1, 0.02, 'b');
});

test('oklchToSRGB: mid-gray (L=0.5, C=0)', () => {
  const [r, g, b] = oklchToSRGB(0.5, 0, 0);
  // Gray should have r≈g≈b, around 0.2-0.25 in sRGB
  assert(Math.abs(r - g) < 0.02, 'r≈g for neutral');
  assert(Math.abs(g - b) < 0.02, 'g≈b for neutral');
  assert(r > 0.1 && r < 0.5, 'reasonable mid-gray');
});

test('oklchToSRGB: saturated red-ish (L=0.6, C=0.2, H=30)', () => {
  const [r, g, b] = oklchToSRGB(0.6, 0.2, 30);
  // Red hue should have r > g > b
  assert(r > g, 'red > green for H=30');
  assert(r > b, 'red > blue for H=30');
});

test('oklchToSRGB: saturated blue (L=0.5, C=0.2, H=260)', () => {
  const [r, g, b] = oklchToSRGB(0.5, 0.2, 260);
  // Blue hue should have b > r and b > g
  assert(b > r, 'blue > red for H=260');
});

// =============================================================================
// srgbToHex
// =============================================================================

test('srgbToHex: black', () => {
  assert(srgbToHex(0, 0, 0) === '#000000', 'black');
});

test('srgbToHex: white', () => {
  assert(srgbToHex(1, 1, 1) === '#ffffff', 'white');
});

test('srgbToHex: clamps out-of-range values', () => {
  const hex = srgbToHex(1.5, -0.5, 0.5);
  assert(isValidHex(hex), 'valid hex despite out-of-range inputs');
  assert(hex.startsWith('#ff'), 'clamped r to ff');
  assert(hex.substring(3, 5) === '00', 'clamped g to 00');
});

// =============================================================================
// oklchToHex
// =============================================================================

test('oklchToHex: produces valid hex for various inputs', () => {
  const testCases = [
    [0, 0, 0],
    [1, 0, 0],
    [0.5, 0.1, 180],
    [0.7, 0.3, 300],
    [0.3, 0.05, 60],
    [0.8, 0.4, 120], // high chroma — may need gamut clamping
  ];
  for (const [L, C, H] of testCases) {
    const hex = oklchToHex(L, C, H);
    assert(isValidHex(hex), `valid hex for L=${L} C=${C} H=${H}: got ${hex}`);
  }
});

// =============================================================================
// generateThemeColors
// =============================================================================

test('generateThemeColors: dark mode produces all required keys', () => {
  const config: ThemeConfig = { hue: 260, chroma: 0.15, lightness: 0.65, theme: 'dark' };
  const colors = generateThemeColors(config);
  const requiredKeys = [
    'surface', 'surfaceContainer', 'surfaceContainerHigh', 'surfaceContainerHighest', 'surfaceBright',
    'onSurface', 'onSurfaceVariant', 'onSurfaceMuted',
    'primary', 'primaryContainer', 'onPrimary', 'onPrimaryContainer',
    'success', 'successContainer', 'onSuccess', 'onSuccessContainer',
    'warning', 'warningContainer', 'onWarning', 'onWarningContainer',
    'error', 'errorContainer', 'onError', 'onErrorContainer',
    'outline', 'outlineVariant', 'scrim',
  ];
  for (const key of requiredKeys) {
    assert(key in colors, `missing key: ${key}`);
  }
});

test('generateThemeColors: all color values are valid hex (except scrim)', () => {
  const config: ThemeConfig = { hue: 180, chroma: 0.12, lightness: 0.6, theme: 'dark' };
  const colors = generateThemeColors(config);
  for (const [key, value] of Object.entries(colors)) {
    if (key === 'scrim') continue; // scrim is rgba
    assert(isValidHex(value), `${key} should be valid hex, got: ${value}`);
  }
});

test('generateThemeColors: light mode produces different surface values than dark', () => {
  const baseConfig = { hue: 260, chroma: 0.15, lightness: 0.65 };
  const dark = generateThemeColors({ ...baseConfig, theme: 'dark' });
  const light = generateThemeColors({ ...baseConfig, theme: 'light' });
  assert(dark.surface !== light.surface, 'surfaces differ between themes');
  assert(dark.onSurface !== light.onSurface, 'text differs between themes');
});

// =============================================================================
// generateBeamThemeColors
// =============================================================================

test('generateBeamThemeColors: produces all required keys', () => {
  const config: ThemeConfig = { hue: 220, chroma: 0.12, lightness: 0.6, theme: 'dark' };
  const colors = generateBeamThemeColors(config);
  const requiredKeys = [
    'bgApp', 'bgGlass', 'bgGlassStrong', 'bgPanel',
    'tPrimary', 'tMuted', 'borderGlass',
    'accentPrimary', 'accentSecondary', 'glowPrimary',
    'colorError', 'colorSuccess', 'colorWarning', 'colorInfo',
    'cliBg', 'cliBorder', 'cliText', 'cliMuted', 'cliHoverBg',
    'syntaxComment', 'syntaxKeyword', 'syntaxString', 'syntaxNumber',
    'syntaxFunction', 'syntaxOperator', 'syntaxVariable', 'syntaxPunctuation',
  ];
  for (const key of requiredKeys) {
    assert(key in colors, `missing key: ${key}`);
  }
});

// =============================================================================
// beamThemeToCSS
// =============================================================================

test('beamThemeToCSS: maps to correct CSS variable names', () => {
  const config: ThemeConfig = { hue: 260, chroma: 0.15, lightness: 0.65, theme: 'dark' };
  const colors = generateBeamThemeColors(config);
  const cssVars = beamThemeToCSS(colors);

  assert('--bg-app' in cssVars, 'has --bg-app');
  assert('--accent-primary' in cssVars, 'has --accent-primary');
  assert('--t-primary' in cssVars, 'has --t-primary');
  assert('--syntax-keyword' in cssVars, 'has --syntax-keyword');
  assert(Object.keys(cssVars).length >= 28, 'produces enough CSS vars');
});

// =============================================================================
// Presets
// =============================================================================

test('all presets produce valid colors for both themes', () => {
  for (const preset of themePresets) {
    for (const theme of ['dark', 'light'] as const) {
      const config: ThemeConfig = { ...preset.config, theme };
      const colors = generateThemeColors(config);
      for (const [key, value] of Object.entries(colors)) {
        if (key === 'scrim') continue;
        assert(isValidHex(value), `preset "${preset.name}" ${theme}: ${key} = "${value}" is not valid hex`);
      }
    }
  }
});

test('all presets produce valid Beam theme colors', () => {
  for (const preset of themePresets) {
    for (const theme of ['dark', 'light'] as const) {
      const config: ThemeConfig = { ...preset.config, theme };
      const colors = generateBeamThemeColors(config);
      // Spot-check that hex values in bgApp are valid
      assert(isValidHex(colors.bgApp), `preset "${preset.name}" ${theme}: bgApp invalid`);
      assert(isValidHex(colors.accentPrimary), `preset "${preset.name}" ${theme}: accentPrimary invalid`);
    }
  }
});

// =============================================================================
// Edge Cases
// =============================================================================

test('zero chroma produces neutral (grayscale) colors', () => {
  const config: ThemeConfig = { hue: 0, chroma: 0, lightness: 0.65, theme: 'dark' };
  const colors = generateThemeColors(config);
  // With C=0, primary should be a gray
  const hex = colors.primary;
  // Extract RGB — all should be very close
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  assert(Math.abs(r - g) < 5, 'neutral: r≈g');
  assert(Math.abs(g - b) < 5, 'neutral: g≈b');
});

test('high chroma values produce valid colors (gamut clamping)', () => {
  const config: ThemeConfig = { hue: 130, chroma: 0.4, lightness: 0.7, theme: 'dark' };
  const colors = generateThemeColors(config);
  for (const [key, value] of Object.entries(colors)) {
    if (key === 'scrim') continue;
    assert(isValidHex(value), `high chroma: ${key} should be valid hex, got: ${value}`);
  }
});

test('hue wrapping: H=359 and H=1 produce similar results', () => {
  const c1 = generateThemeColors({ hue: 359, chroma: 0.15, lightness: 0.65, theme: 'dark' });
  const c2 = generateThemeColors({ hue: 1, chroma: 0.15, lightness: 0.65, theme: 'dark' });
  // Primary colors should be very similar (2 degrees apart)
  const r1 = parseInt(c1.primary.slice(1, 3), 16);
  const r2 = parseInt(c2.primary.slice(1, 3), 16);
  assert(Math.abs(r1 - r2) < 10, `hue wrap: primaries should be similar, got ${c1.primary} vs ${c2.primary}`);
});

// =============================================================================
// Summary
// =============================================================================

console.log(`\n${'='.repeat(50)}`);
console.log(`OKLCH Tests: ${passed} passed, ${failed} failed`);
console.log(`${'='.repeat(50)}`);

if (failed > 0) process.exit(1);
