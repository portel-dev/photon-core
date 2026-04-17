/**
 * Tool-description sanitizer.
 *
 * Defends against MCP tool-description poisoning (OWASP MCP #3) by stripping
 * invisible codepoints and redacting embedded prompt-injection markers from
 * JSDoc descriptions before they reach the model.
 *
 * Called by the schema extractor at parse time; any photon loaded via the
 * runtime benefits automatically. Intentionally conservative — it only
 * touches obvious attack patterns. Legitimate documentation does not use
 * zero-width spaces or contain `[[SYSTEM: ...]]` directives.
 */

/**
 * Unicode ranges that are invisible to humans but preserved by LLM tokenizers.
 * Stripped unconditionally — no legitimate doc string needs them.
 *
 *   U+200B ZERO WIDTH SPACE
 *   U+200C ZERO WIDTH NON-JOINER
 *   U+200D ZERO WIDTH JOINER
 *   U+200E LEFT-TO-RIGHT MARK
 *   U+200F RIGHT-TO-LEFT MARK
 *   U+202A-E LRE/RLE/PDF/LRO/RLO (bidi override)
 *   U+2060 WORD JOINER
 *   U+2066-9 LRI/RLI/FSI/PDI (bidi isolate)
 *   U+FEFF ZERO WIDTH NO-BREAK SPACE (BOM)
 */
const INVISIBLE_CHARS = /[\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g;

/**
 * Instruction-bracket patterns commonly used in tool-poisoning payloads.
 * Each match is replaced with `[REDACTED]` and counted as a warning.
 */
const INSTRUCTION_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  // Bracketed system directives: [[SYSTEM: ...]], [INST] ... [/INST], <|im_start|>...<|im_end|>
  { name: 'bracketed-system', pattern: /\[{1,2}\s*SYSTEM\s*:[^\]]*\]{1,2}/gi },
  { name: 'llama-inst', pattern: /\[\/?INST\]/gi },
  { name: 'chatml-tag', pattern: /<\|im_(?:start|end|sep)\|>/gi },
  // Verbatim instruction phrases that only appear in jailbreaks, never in docs.
  { name: 'ignore-previous', pattern: /\bignore\s+(?:all\s+|the\s+)?(?:previous|prior|above)\s+instructions?\b/gi },
  { name: 'disregard-previous', pattern: /\bdisregard\s+(?:all\s+|the\s+)?(?:previous|prior|above)\b/gi },
  { name: 'system-prompt-literal', pattern: /\bSYSTEM[_\s-]?PROMPT\b/g },
];

/** Max length of a cleaned description. Anything longer is an attack surface. */
export const MAX_DESCRIPTION_LENGTH = 2000;

export interface SanitizerWarning {
  /** Label of the rule that fired. */
  rule: string;
  /** Short slice of the matched text for forensics (capped at 80 chars). */
  sample: string;
}

export interface SanitizeResult {
  cleaned: string;
  warnings: SanitizerWarning[];
  /** Whether the string was truncated because it exceeded MAX_DESCRIPTION_LENGTH. */
  truncated: boolean;
}

/**
 * Strip invisible codepoints, redact instruction markers, and cap length.
 * Idempotent: sanitize(sanitize(x).cleaned).cleaned === sanitize(x).cleaned
 * so callers can apply it defensively without risking duplicate `[REDACTED]`
 * tokens.
 */
export function sanitizeDescription(input: string): SanitizeResult {
  const warnings: SanitizerWarning[] = [];

  // Step 1: strip invisibles. Counts as one warning if any were present.
  const withoutInvisibles = input.replace(INVISIBLE_CHARS, (match) => {
    warnings.push({ rule: 'invisible-char', sample: codepointSample(match) });
    return '';
  });

  // Step 2: redact each known instruction pattern.
  let redacted = withoutInvisibles;
  for (const { name, pattern } of INSTRUCTION_PATTERNS) {
    redacted = redacted.replace(pattern, (match) => {
      warnings.push({ rule: name, sample: match.slice(0, 80) });
      return '[REDACTED]';
    });
  }

  // Step 3: cap length. An attacker-friendly 50KB description is itself a
  // prompt-injection vector via context-window flooding (OWASP MCP #10).
  let truncated = false;
  if (redacted.length > MAX_DESCRIPTION_LENGTH) {
    redacted = redacted.slice(0, MAX_DESCRIPTION_LENGTH) + '…';
    truncated = true;
  }

  return { cleaned: redacted, warnings, truncated };
}

function codepointSample(s: string): string {
  return Array.from(s)
    .map((c) => 'U+' + c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0'))
    .join(',')
    .slice(0, 80);
}
