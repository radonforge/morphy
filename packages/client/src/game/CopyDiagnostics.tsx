import { useEffect, useState } from "react";

const COPIED_FEEDBACK_MS = 2000;

type CopyState = { kind: "idle" } | { kind: "copied" } | { kind: "manual"; text: string };

/**
 * "Copy diagnostics": puts a plain-text snapshot on the clipboard for a player to
 * paste to us. The clipboard API only exists in a secure context, and a LAN match
 * served over plain http is not one, so there the text is shown selected instead.
 */
export function CopyDiagnostics({ collect }: { collect: () => string }) {
  const [state, setState] = useState<CopyState>({ kind: "idle" });

  useEffect(() => {
    if (state.kind !== "copied") return;
    const timer = window.setTimeout(() => setState({ kind: "idle" }), COPIED_FEEDBACK_MS);
    return () => window.clearTimeout(timer);
  }, [state]);

  const copy = () => {
    const text = collect();
    if (!navigator.clipboard) {
      setState({ kind: "manual", text });
      return;
    }
    navigator.clipboard.writeText(text).then(
      () => setState({ kind: "copied" }),
      () => setState({ kind: "manual", text }),
    );
  };

  if (state.kind === "manual") {
    return (
      <textarea
        className="diag-text"
        readOnly
        value={state.text}
        aria-label="Diagnostics"
        ref={(el) => el?.select()}
      />
    );
  }
  return (
    <button type="button" className="btn-ghost" onClick={copy}>
      {state.kind === "copied" ? "Copied" : "Copy diagnostics"}
    </button>
  );
}
