/**
 * Duration and rate parsing utilities for functional tags
 *
 * Supports duration strings: 30s, 5m, 1h, 1d, 500ms
 * Supports rate expressions: 10/min, 100/h, 5/s
 */

const DURATION_MULTIPLIERS: Record<string, number> = {
  ms: 1,
  s: 1_000,
  sec: 1_000,
  m: 60_000,
  min: 60_000,
  h: 3_600_000,
  hr: 3_600_000,
  d: 86_400_000,
  day: 86_400_000,
};

/**
 * Parse a duration string into milliseconds
 * @example parseDuration('30s') → 30000
 * @example parseDuration('5m') → 300000
 * @example parseDuration('500ms') → 500
 * @example parseDuration('1234') → 1234 (raw ms fallback)
 */
export function parseDuration(input: string): number {
  const trimmed = input.trim();
  const match = trimmed.match(/^(\d+(?:\.\d+)?)(ms|s|sec|m|min|h|hr|d|day)$/i);
  if (match) {
    const value = parseFloat(match[1]);
    const unit = match[2].toLowerCase();
    return Math.round(value * DURATION_MULTIPLIERS[unit]);
  }
  // Fallback: raw milliseconds
  const raw = parseInt(trimmed, 10);
  return isNaN(raw) ? 0 : raw;
}

const RATE_WINDOW_MULTIPLIERS: Record<string, number> = {
  s: 1_000,
  sec: 1_000,
  m: 60_000,
  min: 60_000,
  h: 3_600_000,
  hr: 3_600_000,
  d: 86_400_000,
  day: 86_400_000,
};

/**
 * Parse a rate expression into count and window
 * @example parseRate('10/min') → { count: 10, windowMs: 60000 }
 * @example parseRate('100/h') → { count: 100, windowMs: 3600000 }
 */
export function parseRate(input: string): { count: number; windowMs: number } {
  const trimmed = input.trim();
  const match = trimmed.match(/^(\d+)\/(s|sec|m|min|h|hr|d|day)$/i);
  if (match) {
    const count = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();
    return { count, windowMs: RATE_WINDOW_MULTIPLIERS[unit] };
  }
  // Fallback: treat as count per minute
  const count = parseInt(trimmed, 10);
  return { count: isNaN(count) ? 10 : count, windowMs: 60_000 };
}
