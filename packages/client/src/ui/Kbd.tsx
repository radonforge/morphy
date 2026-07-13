import type { ReactNode } from "react";

/** A styled keycap for on-screen control hints. */
export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}
