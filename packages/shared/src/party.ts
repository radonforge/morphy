import { PARTY_CODE_ALPHABET, PARTY_CODE_LENGTH } from "./constants";

/**
 * Party (private room) codes: short human-typable strings from an alphabet
 * without look-alike characters (no I/L/O/0/1). The code doubles as the
 * Colyseus roomId, so joining is a plain `joinById(code)`.
 */

/**
 * Web Crypto global, present in every supported runtime (browsers, Node >= 20).
 * Declared locally because this package compiles against the pure ES lib.
 */
declare const crypto: { getRandomValues<T extends ArrayBufferView>(array: T): T };

const BYTE_RANGE = 256;

/**
 * Generate a random party code of {@link PARTY_CODE_LENGTH} characters.
 * The code gates room access, so it comes from a CSPRNG; rejection sampling
 * keeps the alphabet distribution unbiased.
 */
export function generatePartyCode(): string {
  const alphabetLength = PARTY_CODE_ALPHABET.length;
  const usableRange = BYTE_RANGE - (BYTE_RANGE % alphabetLength);
  const byte = new Uint8Array(1);
  let code = "";
  while (code.length < PARTY_CODE_LENGTH) {
    crypto.getRandomValues(byte);
    const value = byte[0];
    if (value !== undefined && value < usableRange) {
      code += PARTY_CODE_ALPHABET[value % alphabetLength];
    }
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
