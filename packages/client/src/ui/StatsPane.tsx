import type { PlayerStatsPayload } from "@morphy/shared";
import { useEffect, useState } from "react";
import { fetchStats } from "../net/stats";
import { getDeviceId } from "../storage";

type State = { kind: "loading" } | { kind: "error" } | { kind: "ready"; stats: PlayerStatsPayload };

function winRate(stats: PlayerStatsPayload): number {
  return stats.rounds > 0 ? Math.round((stats.wins / stats.rounds) * 100) : 0;
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

  if (state.kind === "loading") {
    return <div className="menu-card menu-mini">Loading…</div>;
  }
  if (state.kind === "error") {
    return <div className="menu-card menu-mini">Couldn't load your stats — try again later.</div>;
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
    </div>
  );
}
