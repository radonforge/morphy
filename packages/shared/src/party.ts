import { PARTY_CODE_ALPHABET, PARTY_CODE_LENGTH } from "./constants";

/**
 * Party (private room) codes: short human-typable strings from an alphabet
 * without look-alike characters (no I/L/O/0/1). The code doubles as the
 * Colyseus roomId, so joining is a plain `joinById(code)`.
 */

/** Generate a random party code of {@link PARTY_CODE_LENGTH} characters. */
export function generatePartyCode(): string {
  let code = "";
  for (let i = 0; i < PARTY_CODE_LENGTH; i++) {
    code += PARTY_CODE_ALPHABET[Math.floor(Math.random() * PARTY_CODE_ALPHABET.length)];
  }
  return code;
}

/** Canonicalize user input (trim + uppercase) before validating or joining. */
export function normalizePartyCode(raw: string): string {
  return raw.trim().toUpperCase();
}

/** Narrow an untrusted value to a well-formed party code (boundary validation). */
export function isPartyCode(value: unknown): value is string {
  if (typeof value !== "string" || value.length !== PARTY_CODE_LENGTH) return false;
  for (const char of value) {
    if (!PARTY_CODE_ALPHABET.includes(char)) return false;
  }
  return true;
}
