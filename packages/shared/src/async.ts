/**
 * Reject a promise after `ms` without losing a value that resolves late.
 *
 * Promises are not cancellable: callers that acquire a resource must provide
 * `onLateResolve` so a value delivered after the timeout is disposed instead
 * of leaking in the background.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
  onLateResolve?: (value: T) => void,
): Promise<T> {
  const timers = globalThis as unknown as {
    setTimeout(callback: () => void, delay: number): unknown;
    clearTimeout(handle: unknown): void;
  };
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = timers.setTimeout(() => {
      settled = true;
      reject(new Error(`${label}: timed out after ${ms}ms`));
    }, ms);

    promise.then(
      (value) => {
        timers.clearTimeout(timer);
        if (settled) {
          onLateResolve?.(value);
          return;
        }
        settled = true;
        resolve(value);
      },
      (error: unknown) => {
        timers.clearTimeout(timer);
        if (settled) return;
        settled = true;
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}
