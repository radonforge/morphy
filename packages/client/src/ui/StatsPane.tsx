import type { PlayerStatsPayload } from "@morphy/shared";
import { useEffect, useRef, useState } from "react";
import { fetchStats, resetStats } from "../net/stats";
import { getDeviceId } from "../storage";

type ResetStep = "idle" | "confirm" | "working" | "failed";

const ZERO_STATS: PlayerStatsPayload = { rounds: 0, wins: 0, kills: 0, survivals: 0 };

type State = { kind: "loading" } | { kind: "error" } | { kind: "ready"; stats: PlayerStatsPayload };

function winRate(stats: PlayerStatsPayload): number {
  return stats.rounds > 0 ? Math.round((stats.wins / stats.rounds) * 100) : 0;
}

function ResetControl({ onErased }: { onErased: () => void }) {
  const [step, setStep] = useState<ResetStep>("idle");
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const erase = () => {
    setStep("working");
    resetStats(getDeviceId())
      .then(() => {
        if (!mounted.current) return;
        setStep("idle");
        onErased();
      })
      .catch(() => {
        if (mounted.current) setStep("failed");
      });
  };

  return (
    <div className="stats-reset">
      {step === "idle" && (
        <button type="button" className="menu-party-btn" onClick={() => setStep("confirm")}>
          Reset my stats
        </button>
      )}
      {(step === "confirm" || step === "working") && (
        <>
          <span>Erase your stats and callsign from the server? This cannot be undone.</span>
          <button
            type="button"
            className="menu-party-btn"
            disabled={step === "working"}
            onClick={erase}
          >
            Yes, erase
          </button>
          <button
            type="button"
            className="menu-party-btn"
            disabled={step === "working"}
            onClick={() => setStep("idle")}
          >
            Cancel
          </button>
        </>
      )}
      {step === "failed" && (
        <>
          <span>Couldn't reset your stats.</span>
          <button type="button" className="menu-party-btn" onClick={erase}>
            Retry
          </button>
          <button type="button" className="menu-party-btn" onClick={() => setStep("idle")}>
            Back
          </button>
        </>
      )}
    </div>
  );
}

export function StatsPane() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let active = true;
    setState({ kind: "loading" });
    fetchStats(getDeviceId())
      .then((stats) => {
        if (active) setState({ kind: "ready", stats });
      })
      .catch(() => {
        if (active) setState({ kind: "error" });
      });
    return () => {
      active = false;
    };
  }, []);

  const showZeroed = () => setState({ kind: "ready", stats: ZERO_STATS });

  if (state.kind === "loading") {
    return <div className="menu-card menu-mini">Loading…</div>;
  }
  if (state.kind === "error") {
    return (
      <div className="menu-card">
        <p className="menu-mini">Couldn't load your stats. Try again later.</p>
        <ResetControl onErased={showZeroed} />
      </div>
    );
  }

  const stats = state.stats;
  const cells: { label: string; value: string }[] = [
    { label: "Rounds", value: String(stats.rounds) },
    { label: "Wins", value: String(stats.wins) },
    { label: "Win rate", value: `${winRate(stats)}%` },
    { label: "Captures", value: String(stats.kills) },
    { label: "Survivals", value: String(stats.survivals) },
  ];
  return (
    <div className="menu-card">
      <dl className="stats-grid">
        {cells.map(({ label, value }) => (
          <div key={label} className="stats-cell">
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <ResetControl onErased={showZeroed} />
    </div>
  );
}
