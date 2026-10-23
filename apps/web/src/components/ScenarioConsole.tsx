import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { IconBolt } from "./icons";
import { useToast } from "./ui";

const SCENARIOS = [
  { id: "meter-tamper", label: "Tamper EAF grid meter", hint: "Steel · meter reports 68% of real load for 6 h" },
  { id: "fuel-bypass", label: "Bypass kiln fuel meter", hint: "Cement · fuel fed through unmetered line" },
  { id: "stuck-sensor", label: "Freeze gas meter", hint: "Aluminium · meter repeats one value" },
  { id: "forged-signature", label: "Inject forged reading", hint: "Cement · altered value, stolen signature" },
  { id: "replay", label: "Replay old message", hint: "Steel · resend a genuine signed reading" },
] as const;

/** Lets a presenter trigger real attacks on the simulated meter fleet and watch Mizan respond. */
export function ScenarioConsole() {
  const [status, setStatus] = useState<{ running: boolean; mode?: string; active?: { name: string; facilityId: string; remaining: number }[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();

  useEffect(() => {
    let alive = true;
    const poll = () =>
      api("/api/demo/status")
        .then((s) => alive && setStatus(s))
        .catch(() => alive && setStatus({ running: false }));
    void poll();
    const t = setInterval(poll, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const trigger = async (id: string) => {
    setBusy(id);
    try {
      const r = await api("/api/demo/scenario", { body: { scenario: id } });
      setStatus((s) => ({ ...(s ?? { running: true }), active: r.active }));
      if (id !== "clear") toast("neutral", `Scenario started at ${r.facilityId}. Watch the integrity queue.`);
    } catch (e) {
      toast("critical", (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <details className="who" style={{ gap: 6 }}>
      <summary className="row" style={{ cursor: "pointer", listStyle: "none" }}>
        <IconBolt size={14} />
        <span className="small" style={{ fontWeight: 500 }}>Attack simulator</span>
        <span className="tiny muted" style={{ marginLeft: "auto" }}>
          {status?.running ? (status.active?.length ? `${status.active.length} active` : status.mode) : "offline"}
        </span>
      </summary>
      <div className="stack-sm" style={{ marginTop: 8 }}>
        {SCENARIOS.map((s) => (
          <button key={s.id} className="btn sm" style={{ justifyContent: "flex-start", height: "auto", padding: "6px 9px", flexDirection: "column", alignItems: "flex-start", gap: 1 }} disabled={!status?.running || !!busy} onClick={() => trigger(s.id)}>
            <span>{s.label}</span>
            <span className="tiny muted" style={{ fontWeight: 400, whiteSpace: "normal", textAlign: "left" }}>{s.hint}</span>
          </button>
        ))}
        {!!status?.active?.length && (
          <button className="btn sm ghost" onClick={() => trigger("clear")}>
            Stop all scenarios
          </button>
        )}
      </div>
    </details>
  );
}
