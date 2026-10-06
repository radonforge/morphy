import { useEffect, useState } from "react";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** Whether the player asked the system for reduced motion, kept current while the page is open. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => window.matchMedia(REDUCED_MOTION_QUERY).matches);

  useEffect(() => {
    const query = window.matchMedia(REDUCED_MOTION_QUERY);
    const onChange = () => setReduced(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return reduced;
}
