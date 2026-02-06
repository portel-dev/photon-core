/**
 * Base class for purpose-driven UI types
 *
 * All UI types extend this to get the _photonType discriminator
 * that auto-UI uses to select the appropriate renderer.
 */
export abstract class PhotonUIType {
  /** Discriminator for auto-UI type detection */
  abstract readonly _photonType: string;

  /** Convert to JSON-serializable format */
  abstract toJSON(): Record<string, any>;
}

/**
 * Check if a value is a PhotonUIType
 */
export function isPhotonUIType(value: unknown): value is PhotonUIType {
  return (
    value !== null &&
    typeof value === 'object' &&
    '_photonType' in value &&
    typeof (value as any)._photonType === 'string'
  );
}
