/** Source key of a player contact, as the reflex tracks it internally. */
export function playerSource(id: string): string {
  return `p:${id}`;
}

/** Source key of a decoy contact, as the reflex tracks it internally. */
export function decoySource(id: string): string {
  return `d:${id}`;
}

/**
 * Opaque names for what a limited-vision bot perceives. A session id would tell
 * a policy it is looking at a player, and a decoy's room key would tell it the
 * opposite, so every contact of either kind is named from one counter instead
 * and the way back to the thing itself never leaves the reflex. The counter
 * never rewinds, so a handle is never reused for a different contact.
 */
export class ContactHandles {
  private readonly bySource = new Map<string, string>();
  private readonly byHandle = new Map<string, string>();
  private seq = 0;

  handleFor(source: string): string {
    const known = this.bySource.get(source);
    if (known !== undefined) return known;
    const handle = `c${++this.seq}`;
    this.bySource.set(source, handle);
    this.byHandle.set(handle, source);
    return handle;
  }

  sourceOf(handle: string): string | undefined {
    return this.byHandle.get(handle);
  }

  /** Forget every contact whose source is no longer in the world. */
  retain(live: ReadonlySet<string>): void {
    for (const [source, handle] of this.bySource) {
      if (live.has(source)) continue;
      this.bySource.delete(source);
      this.byHandle.delete(handle);
    }
  }

  /** Forget every contact, so a handle from one round is no tell in the next. */
  clear(): void {
    this.bySource.clear();
    this.byHandle.clear();
  }
}
