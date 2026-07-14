const DEVICE_ID_MIN_LENGTH = 8;
const DEVICE_ID_MAX_LENGTH = 64;
const DEVICE_ID_PATTERN = /^[A-Za-z0-9-]+$/;

/**
 * Narrow a client-supplied device identity. Returns null for anything that is
 * not a plausible opaque token, so callers can ignore it rather than accrue
 * stats against — or look them up by — a garbage key.
 */
export function parseDeviceId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length < DEVICE_ID_MIN_LENGTH || trimmed.length > DEVICE_ID_MAX_LENGTH) return null;
  return DEVICE_ID_PATTERN.test(trimmed) ? trimmed : null;
}
