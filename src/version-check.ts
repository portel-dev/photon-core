/**
 * Runtime Version Check Utilities
 *
 * Parse @runtime tags from Photon source and check compatibility.
 * Extracted from photon's loader.ts.
 */

/**
 * Parse the @runtime version requirement from Photon source code
 *
 * @example parseRuntimeRequirement('/** @runtime ^1.5.0 *\/') → '^1.5.0'
 */
export function parseRuntimeRequirement(source: string): string | undefined {
  const match = source.match(/@runtime\s+([^\r\n\s]+)/);
  return match ? match[1].trim() : undefined;
}

/**
 * Check if a current version satisfies a required version range
 *
 * Supports: ^1.5.0, ~1.5.0, >=1.5.0, >1.5.0, exact (1.5.0)
 */
export function checkRuntimeCompatibility(
  required: string,
  current: string,
): { compatible: boolean; message?: string } {
  const parseVersion = (v: string): [number, number, number] => {
    const clean = v.replace(/^[~^>=<]+/, '');
    const parts = clean.split('.').map((p) => parseInt(p, 10) || 0);
    return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
  };

  const [reqMajor, reqMinor, reqPatch] = parseVersion(required);
  const [curMajor, curMinor, curPatch] = parseVersion(current);

  const isExact = !required.match(/^[~^>=<]/);
  const isCaret = required.startsWith('^');
  const isTilde = required.startsWith('~');
  const isGte = required.startsWith('>=');
  const isGt = required.startsWith('>') && !isGte;

  let compatible = false;

  if (isExact) {
    compatible =
      curMajor === reqMajor && curMinor === reqMinor && curPatch === reqPatch;
  } else if (isCaret) {
    // ^1.5.0 means >=1.5.0 and <2.0.0
    if (curMajor === reqMajor) {
      if (curMinor > reqMinor) {
        compatible = true;
      } else if (curMinor === reqMinor) {
        compatible = curPatch >= reqPatch;
      }
    }
  } else if (isTilde) {
    // ~1.5.0 means >=1.5.0 and <1.6.0
    compatible =
      curMajor === reqMajor &&
      curMinor === reqMinor &&
      curPatch >= reqPatch;
  } else if (isGte) {
    if (curMajor > reqMajor) {
      compatible = true;
    } else if (curMajor === reqMajor) {
      if (curMinor > reqMinor) {
        compatible = true;
      } else if (curMinor === reqMinor) {
        compatible = curPatch >= reqPatch;
      }
    }
  } else if (isGt) {
    if (curMajor > reqMajor) {
      compatible = true;
    } else if (curMajor === reqMajor) {
      if (curMinor > reqMinor) {
        compatible = true;
      } else if (curMinor === reqMinor) {
        compatible = curPatch > reqPatch;
      }
    }
  }

  if (!compatible) {
    return {
      compatible: false,
      message: `This photon requires runtime version ${required}, but you have ${current}. Please upgrade: npm install -g @portel/photon@latest`,
    };
  }

  return { compatible: true };
}
