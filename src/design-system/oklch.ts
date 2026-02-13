/**
 * OKLCH Color Engine
 *
 * Pure-math OKLCH → sRGB conversion for perceptually uniform theme generation.
 * No external dependencies.
 *
 * References:
 * - Björn Ottosson's Oklab: https://bottosson.github.io/posts/oklab/
 * - CSS Color Level 4: https://www.w3.org/TR/css-color-4/#ok-lab
 */

// =============================================================================
// TYPES
// =============================================================================

export interface ThemeConfig {
  /** Color hue: 0-360 */
  hue: number;
  /** Color saturation/vibrancy: 0-0.4 */
  chroma: number;
  /** Base lightness: 0-1 */
  lightness: number;
  /** Dark or light mode */
  theme: 'dark' | 'light';
}

export interface ThemePreset {
  name: string;
  config: Omit<ThemeConfig, 'theme'>;
}

/** All generated theme colors as hex strings */
export interface GeneratedThemeColors {
  // Surfaces
  surface: string;
  surfaceContainer: string;
  surfaceContainerHigh: string;
  surfaceContainerHighest: string;
  surfaceBright: string;

  // Text
  onSurface: string;
  onSurfaceVariant: string;
  onSurfaceMuted: string;

  // Primary
  primary: string;
  primaryContainer: string;
  onPrimary: string;
  onPrimaryContainer: string;

  // Status - derived from hue offsets
  success: string;
  successContainer: string;
  onSuccess: string;
  onSuccessContainer: string;

  warning: string;
  warningContainer: string;
  onWarning: string;
  onWarningContainer: string;

  error: string;
  errorContainer: string;
  onError: string;
  onErrorContainer: string;

  // Outline
  outline: string;
  outlineVariant: string;

  // Scrim
  scrim: string;
}

/** Beam-specific CSS variables generated from OKLCH */
export interface BeamThemeColors {
  bgApp: string;
  bgGlass: string;
  bgGlassStrong: string;
  bgPanel: string;
  tPrimary: string;
  tMuted: string;
  borderGlass: string;
  accentPrimary: string;
  accentSecondary: string;
  glowPrimary: string;
  // Status
  colorError: string;
  colorErrorGlow: string;
  colorErrorBg: string;
  colorSuccess: string;
  colorSuccessBg: string;
  colorWarning: string;
  colorWarningBg: string;
  colorWarningGlow: string;
  colorInfo: string;
  // CLI preview
  cliBg: string;
  cliBorder: string;
  cliText: string;
  cliMuted: string;
  cliHoverBg: string;
  // Syntax highlighting
  syntaxComment: string;
  syntaxKeyword: string;
  syntaxString: string;
  syntaxNumber: string;
  syntaxFunction: string;
  syntaxOperator: string;
  syntaxVariable: string;
  syntaxPunctuation: string;
}

// =============================================================================
// OKLCH → sRGB CONVERSION
// =============================================================================

/**
 * Convert OKLCH to linear sRGB.
 * L: 0-1 (lightness), C: 0-0.4+ (chroma), H: 0-360 (hue in degrees)
 */
export function oklchToSRGB(L: number, C: number, H: number): [number, number, number] {
  // Convert hue to radians
  const hRad = (H * Math.PI) / 180;

  // OKLCH → OKLab
  const a = C * Math.cos(hRad);
  const b = C * Math.sin(hRad);

  // OKLab → linear LMS (via inverse of the matrix)
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;

  // Cube the values (inverse of cube root)
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  // Linear LMS → linear sRGB
  const r = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bv = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;

  // Apply sRGB gamma (linear → sRGB)
  return [gammaEncode(r), gammaEncode(g), gammaEncode(bv)];
}

/** sRGB gamma encoding (linear → sRGB) */
function gammaEncode(c: number): number {
  if (c <= 0.0031308) {
    return 12.92 * c;
  }
  return 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

/** Clamp a value to [0, 1] */
function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/**
 * Convert sRGB [0-1] to hex color string.
 */
export function srgbToHex(r: number, g: number, b: number): string {
  const toHex = (c: number) => {
    const v = Math.round(clamp01(c) * 255);
    return v.toString(16).padStart(2, '0');
  };
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Convert OKLCH directly to hex color string.
 * Gamut-clamps out-of-range values.
 */
export function oklchToHex(L: number, C: number, H: number): string {
  const [r, g, b] = oklchToSRGB(L, C, H);
  return srgbToHex(r, g, b);
}

/**
 * Convert OKLCH to rgba() string with alpha.
 */
function oklchToRgba(L: number, C: number, H: number, alpha: number): string {
  const [r, g, b] = oklchToSRGB(L, C, H);
  return `rgba(${Math.round(clamp01(r) * 255)}, ${Math.round(clamp01(g) * 255)}, ${Math.round(clamp01(b) * 255)}, ${alpha})`;
}

// =============================================================================
// THEME PRESETS
// =============================================================================

export const themePresets: ThemePreset[] = [
  { name: 'Default Violet', config: { hue: 260, chroma: 0.15, lightness: 0.65 } },
  { name: 'Ocean Blue', config: { hue: 220, chroma: 0.12, lightness: 0.60 } },
  { name: 'Emerald', config: { hue: 155, chroma: 0.14, lightness: 0.60 } },
  { name: 'Amber', config: { hue: 75, chroma: 0.14, lightness: 0.70 } },
  { name: 'Rose', config: { hue: 350, chroma: 0.14, lightness: 0.62 } },
  { name: 'Monochrome', config: { hue: 0, chroma: 0.0, lightness: 0.65 } },
];

// =============================================================================
// THEME COLOR GENERATION
// =============================================================================

/**
 * Generate Material Design 3-compatible theme colors from OKLCH parameters.
 */
export function generateThemeColors(config: ThemeConfig): GeneratedThemeColors {
  const { hue: H, chroma: C, lightness: L, theme } = config;
  const isDark = theme === 'dark';

  // --- Surface colors ---
  // Dark: very low lightness, minimal chroma for subtle tinting
  // Light: very high lightness, minimal chroma
  const surface = isDark
    ? oklchToHex(0.15, C * 0.03, H)
    : oklchToHex(0.97, C * 0.02, H);
  const surfaceContainer = isDark
    ? oklchToHex(0.19, C * 0.04, H)
    : oklchToHex(0.94, C * 0.025, H);
  const surfaceContainerHigh = isDark
    ? oklchToHex(0.23, C * 0.05, H)
    : oklchToHex(0.91, C * 0.03, H);
  const surfaceContainerHighest = isDark
    ? oklchToHex(0.27, C * 0.06, H)
    : oklchToHex(0.88, C * 0.035, H);
  const surfaceBright = isDark
    ? oklchToHex(0.95, C * 0.01, H)
    : oklchToHex(1.0, 0, H);

  // --- Text colors ---
  const onSurface = isDark
    ? oklchToHex(0.93, C * 0.02, H)
    : oklchToHex(0.22, C * 0.02, H);
  const onSurfaceVariant = isDark
    ? oklchToHex(0.75, C * 0.04, H)
    : oklchToHex(0.38, C * 0.04, H);
  const onSurfaceMuted = isDark
    ? oklchToHex(0.55, C * 0.05, H)
    : oklchToHex(0.50, C * 0.05, H);

  // --- Primary accent ---
  const primary = isDark
    ? oklchToHex(L, C, H)
    : oklchToHex(L * 0.7, C, H);
  const primaryContainer = isDark
    ? oklchToHex(0.30, C * 0.5, H)
    : oklchToHex(0.90, C * 0.3, H);
  const onPrimary = isDark
    ? oklchToHex(0.15, C * 0.1, H)
    : oklchToHex(0.98, C * 0.01, H);
  const onPrimaryContainer = isDark
    ? oklchToHex(0.90, C * 0.2, H)
    : oklchToHex(0.20, C * 0.15, H);

  // --- Status colors (hue offsets from base) ---
  // Success: green tones
  const successH = (H + 145) % 360;
  const success = isDark
    ? oklchToHex(0.70, 0.15, successH)
    : oklchToHex(0.45, 0.15, successH);
  const successContainer = isDark
    ? oklchToHex(0.25, 0.06, successH)
    : oklchToHex(0.92, 0.06, successH);
  const onSuccess = isDark
    ? oklchToHex(0.15, 0.05, successH)
    : oklchToHex(0.98, 0.01, successH);
  const onSuccessContainer = isDark
    ? oklchToHex(0.90, 0.08, successH)
    : oklchToHex(0.20, 0.08, successH);

  // Warning: amber/yellow tones
  const warningH = (H + 100) % 360;
  const warning = isDark
    ? oklchToHex(0.75, 0.15, warningH)
    : oklchToHex(0.50, 0.15, warningH);
  const warningContainer = isDark
    ? oklchToHex(0.25, 0.06, warningH)
    : oklchToHex(0.92, 0.06, warningH);
  const onWarning = isDark
    ? oklchToHex(0.15, 0.05, warningH)
    : oklchToHex(0.98, 0.01, warningH);
  const onWarningContainer = isDark
    ? oklchToHex(0.90, 0.08, warningH)
    : oklchToHex(0.20, 0.08, warningH);

  // Error: red tones
  const errorH = (H + 210) % 360;
  const error = isDark
    ? oklchToHex(0.65, 0.18, errorH)
    : oklchToHex(0.48, 0.18, errorH);
  const errorContainer = isDark
    ? oklchToHex(0.25, 0.07, errorH)
    : oklchToHex(0.92, 0.07, errorH);
  const onError = isDark
    ? oklchToHex(0.15, 0.05, errorH)
    : oklchToHex(0.98, 0.01, errorH);
  const onErrorContainer = isDark
    ? oklchToHex(0.90, 0.08, errorH)
    : oklchToHex(0.20, 0.08, errorH);

  // --- Outline ---
  const outline = isDark
    ? oklchToHex(0.40, C * 0.06, H)
    : oklchToHex(0.65, C * 0.06, H);
  const outlineVariant = isDark
    ? oklchToHex(0.28, C * 0.04, H)
    : oklchToHex(0.82, C * 0.04, H);

  // --- Scrim ---
  const scrim = isDark ? 'rgba(0, 0, 0, 0.5)' : 'rgba(0, 0, 0, 0.2)';

  return {
    surface, surfaceContainer, surfaceContainerHigh, surfaceContainerHighest, surfaceBright,
    onSurface, onSurfaceVariant, onSurfaceMuted,
    primary, primaryContainer, onPrimary, onPrimaryContainer,
    success, successContainer, onSuccess, onSuccessContainer,
    warning, warningContainer, onWarning, onWarningContainer,
    error, errorContainer, onError, onErrorContainer,
    outline, outlineVariant,
    scrim,
  };
}

/**
 * Generate Beam-specific CSS variable values from OKLCH parameters.
 * These map to the --bg-app, --accent-primary, etc. variables used in beam-app.ts.
 */
export function generateBeamThemeColors(config: ThemeConfig): BeamThemeColors {
  const { hue: H, chroma: C, lightness: L, theme } = config;
  const isDark = theme === 'dark';

  // Secondary accent: shifted hue, reduced chroma
  const secondaryH = (H + 70) % 360;

  // === Surfaces ===
  const bgApp = isDark
    ? oklchToHex(0.15, C * 0.04, H)
    : oklchToHex(0.92, C * 0.03, H);
  const bgGlass = isDark
    ? oklchToRgba(0.19, C * 0.04, H, 0.6)
    : oklchToRgba(0.98, C * 0.02, H, 0.75);
  const bgGlassStrong = isDark
    ? oklchToRgba(0.19, C * 0.04, H, 0.85)
    : oklchToRgba(0.98, C * 0.02, H, 0.9);
  const bgPanel = isDark
    ? oklchToHex(0.18, C * 0.05, H)
    : oklchToHex(0.96, C * 0.02, H);

  // === Text ===
  const tPrimary = isDark
    ? oklchToHex(0.93, C * 0.02, H)
    : oklchToHex(0.22, C * 0.03, H);
  const tMuted = isDark
    ? oklchToHex(0.58, C * 0.04, H)
    : oklchToHex(0.48, C * 0.04, H);

  // === Borders ===
  const borderGlass = isDark
    ? oklchToRgba(0.75, C * 0.03, H, 0.1)
    : oklchToRgba(0.40, C * 0.05, H, 0.12);

  // === Accents ===
  const accentPrimary = isDark
    ? oklchToHex(L, C, H)
    : oklchToHex(L * 0.72, C * 0.9, H);
  const accentSecondary = isDark
    ? oklchToHex(L * 0.9, C * 0.8, secondaryH)
    : oklchToHex(L * 0.6, C * 0.7, secondaryH);
  const glowPrimary = isDark
    ? oklchToRgba(L, C, H, 0.3)
    : oklchToRgba(L * 0.72, C * 0.9, H, 0.15);

  // === Status Colors ===
  const successH = (H + 145) % 360;
  const warningH = (H + 100) % 360;
  const errorH = (H + 210) % 360;

  const colorError = isDark
    ? oklchToHex(0.68, 0.18, errorH)
    : oklchToHex(0.50, 0.16, errorH);
  const colorErrorGlow = oklchToRgba(0.68, 0.18, errorH, isDark ? 0.3 : 0.2);
  const colorErrorBg = oklchToRgba(0.68, 0.18, errorH, isDark ? 0.1 : 0.08);
  const colorSuccess = isDark
    ? oklchToHex(0.72, 0.16, successH)
    : oklchToHex(0.48, 0.14, successH);
  const colorSuccessBg = oklchToRgba(0.55, 0.12, successH, isDark ? 0.2 : 0.12);
  const colorWarning = isDark
    ? oklchToHex(0.78, 0.15, warningH)
    : oklchToHex(0.55, 0.14, warningH);
  const colorWarningBg = oklchToRgba(0.78, 0.15, warningH, isDark ? 0.15 : 0.12);
  const colorWarningGlow = oklchToRgba(0.78, 0.15, warningH, isDark ? 0.3 : 0.2);

  // === CLI Preview ===
  const cliBg = isDark
    ? oklchToHex(0.10, C * 0.03, H)
    : oklchToHex(0.96, C * 0.02, H);
  const cliBorder = isDark
    ? oklchToHex(0.28, C * 0.05, H)
    : borderGlass;
  const cliText = isDark
    ? oklchToHex(0.72, 0.14, successH)
    : oklchToHex(0.42, 0.12, successH);
  const cliMuted = isDark
    ? oklchToHex(0.40, C * 0.04, H)
    : tMuted;
  const cliHoverBg = isDark
    ? oklchToHex(0.15, C * 0.04, H)
    : oklchToHex(0.92, C * 0.03, H);

  // === Syntax Highlighting (fixed offsets from base hue) ===
  const syntaxComment = isDark
    ? oklchToHex(0.50, C * 0.04, H)
    : oklchToHex(0.50, C * 0.04, H);
  const syntaxKeyword = isDark
    ? oklchToHex(0.72, 0.14, (H + 30) % 360)
    : oklchToHex(0.45, 0.14, (H + 30) % 360);
  const syntaxString = isDark
    ? oklchToHex(0.75, 0.13, successH)
    : oklchToHex(0.45, 0.13, successH);
  const syntaxNumber = isDark
    ? oklchToHex(0.72, 0.14, (H + 180) % 360)
    : oklchToHex(0.48, 0.14, (H + 180) % 360);
  const syntaxFunction = isDark
    ? oklchToHex(0.75, 0.12, (H + 60) % 360)
    : oklchToHex(0.45, 0.12, (H + 60) % 360);
  const syntaxOperator = isDark
    ? oklchToHex(0.70, 0.10, (H + 15) % 360)
    : oklchToHex(0.45, 0.10, (H + 15) % 360);
  const syntaxVariable = isDark
    ? oklchToHex(0.80, 0.10, (H - 20 + 360) % 360)
    : oklchToHex(0.40, 0.10, (H - 20 + 360) % 360);
  const syntaxPunctuation = isDark
    ? oklchToHex(0.65, C * 0.04, H)
    : oklchToHex(0.40, C * 0.04, H);

  return {
    bgApp, bgGlass, bgGlassStrong, bgPanel,
    tPrimary, tMuted, borderGlass,
    accentPrimary, accentSecondary, glowPrimary,
    colorError, colorErrorGlow, colorErrorBg,
    colorSuccess, colorSuccessBg,
    colorWarning, colorWarningBg, colorWarningGlow,
    colorInfo: accentSecondary,
    cliBg, cliBorder, cliText, cliMuted, cliHoverBg,
    syntaxComment, syntaxKeyword, syntaxString, syntaxNumber,
    syntaxFunction, syntaxOperator, syntaxVariable, syntaxPunctuation,
  };
}

/**
 * Convert BeamThemeColors to a CSS custom properties object
 * suitable for applying to :host or document root.
 */
export function beamThemeToCSS(colors: BeamThemeColors): Record<string, string> {
  return {
    '--bg-app': colors.bgApp,
    '--bg-glass': colors.bgGlass,
    '--bg-glass-strong': colors.bgGlassStrong,
    '--bg-panel': colors.bgPanel,
    '--t-primary': colors.tPrimary,
    '--t-muted': colors.tMuted,
    '--border-glass': colors.borderGlass,
    '--accent-primary': colors.accentPrimary,
    '--accent-secondary': colors.accentSecondary,
    '--glow-primary': colors.glowPrimary,
    '--color-error': colors.colorError,
    '--color-error-glow': colors.colorErrorGlow,
    '--color-error-bg': colors.colorErrorBg,
    '--color-success': colors.colorSuccess,
    '--color-success-bg': colors.colorSuccessBg,
    '--color-warning': colors.colorWarning,
    '--color-warning-bg': colors.colorWarningBg,
    '--color-warning-glow': colors.colorWarningGlow,
    '--color-info': colors.colorInfo,
    '--cli-bg': colors.cliBg,
    '--cli-border': colors.cliBorder,
    '--cli-text': colors.cliText,
    '--cli-muted': colors.cliMuted,
    '--cli-hover-bg': colors.cliHoverBg,
    '--syntax-comment': colors.syntaxComment,
    '--syntax-keyword': colors.syntaxKeyword,
    '--syntax-string': colors.syntaxString,
    '--syntax-number': colors.syntaxNumber,
    '--syntax-function': colors.syntaxFunction,
    '--syntax-operator': colors.syntaxOperator,
    '--syntax-variable': colors.syntaxVariable,
    '--syntax-punctuation': colors.syntaxPunctuation,
  };
}
