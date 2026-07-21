/** In-memory fallback used when browser persistence is unavailable or blocked. */
const fallback = new Map<string, string>();

function persistentStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function storageGet(key: string): string | null {
  const storage = persistentStorage();
  if (storage) {
    try {
      const value = storage.getItem(key);
      if (value !== null) fallback.set(key, value);
      return value ?? fallback.get(key) ?? null;
    } catch {
      // Fall through to the page-lifetime value.
    }
  }
  return fallback.get(key) ?? null;
}

export function storageSet(key: string, value: string): void {
  fallback.set(key, value);
  const storage = persistentStorage();
  if (!storage) return;
  try {
    storage.setItem(key, value);
  } catch {
    // The in-memory value remains available for this page lifetime.
  }
}

export function storageRemove(key: string): void {
  fallback.delete(key);
  const storage = persistentStorage();
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch {
    // Nothing else to do when persistence is blocked.
  }
}

export function storageKeys(): string[] {
  const keys = new Set(fallback.keys());
  const storage = persistentStorage();
  if (storage) {
    try {
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (key !== null) keys.add(key);
      }
    } catch {
      // Return the fallback keys collected so far.
    }
  }
  return [...keys];
}
