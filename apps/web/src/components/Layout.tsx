import { useEffect, useState, type ReactNode } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useSession } from "../App";
import { useLive, useLiveStatus, useResource } from "../lib/api";
import { dateTime } from "../lib/format";
import {
  IconAudit,
  IconCertificate,
  IconExposure,
  IconFactory,
  IconLedger,
  IconLogout,
  IconMoon,
  IconOverview,
  IconShield,
  IconSun,
  IconVerify,
  Logo,
} from "./icons";
import { useToast } from "./ui";
import { ScenarioConsole } from "./ScenarioConsole";

const TITLES: [RegExp, string][] = [
  [/^\/facilities/, "Installation"],
  [/^\/integrity/, "Integrity"],
  [/^\/ledger/, "MRV ledger"],
  [/^\/certificates/, "Certificates"],
  [/^\/exposure/, "CBAM exposure"],
  [/^\/verify/, "Public verifier"],
  [/^\/audit/, "Audit trail"],
  [/^\//, "Overview"],
];

const ROLE_LABEL = { operator: "Operator", verifier: "Verifier", importer: "EU importer", authority: "ETS authority" };

export function Layout({ children }: { children: ReactNode }) {
  const { user, signOut } = useSession();
  const loc = useLocation();
  const nav = useNavigate();
  const toast = useToast();
  const live = useLiveStatus();
  const { data: ov } = useResource<any>("/api/overview", ["batch", "incident", "certificate"], 4000);
  const [simTs, setSimTs] = useState<number | null>(null);
  const [theme, setTheme] = useState<string | undefined>(document.documentElement.dataset.theme);

  useLive((events) => {
    const last = [...events].reverse().find((e) => e.type === "interval");
    if (last && last.type === "interval") setSimTs((t) => Math.max(t ?? 0, last.ts));
    for (const e of events) {
      if (e.type === "incident" && e.isNew && (e.severity === "critical" || e.severity === "high")) {
        toast("critical", (
          <span>
            <strong>{e.title}</strong>
            <br />
            <span className="muted">{e.facilityId} · integrity engine</span>
          </span>
        ));
      }
      if (e.type === "chain" && e.status === "error") toast("critical", e.message);
    }
  });

  useEffect(() => {
    if (ov?.latestTs) setSimTs((t) => Math.max(t ?? 0, ov.latestTs));
  }, [ov?.latestTs]);

  const toggleTheme = () => {
    const isDark = theme === "dark" || (!theme && window.matchMedia("(prefers-color-scheme: dark)").matches);
    const next = isDark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("mizan.theme", next);
    } catch {
      /* ignore */
    }
    setTheme(next);
  };

  const title = TITLES.find(([re]) => re.test(loc.pathname))?.[1] ?? "Mizan";
  const openIncidents = ov?.totals?.incidents?.open ?? 0;
  const review = ov?.facilities?.reduce((s: number, f: any) => s + f.needsReview, 0) ?? 0;
  const chainOk = ov?.chain?.ready;

  return (
    <div className="shell">
      <aside className="rail">
        <NavLink to="/" className="wordmark" aria-label="Mizan home">
          <Logo />
          <div>
            <div className="wordmark-name">Mizan</div>
            <div className="wordmark-sub">Verifiable embedded emissions</div>
          </div>
        </NavLink>
        <nav className="nav" aria-label="Main">
          <NavLink to="/" end>
            <IconOverview /> Overview
          </NavLink>
          {ov?.facilities?.map((f: any) => (
            <NavLink key={f.id} to={`/facilities/${f.id}`}>
              <IconFactory /> <span className="grow" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
            </NavLink>
          ))}
          <div className="nav-label">Assurance</div>
          <NavLink to="/integrity">
            <IconShield /> Integrity {openIncidents > 0 && <span className="nav-count">{openIncidents}</span>}
          </NavLink>
          <NavLink to="/ledger">
            <IconLedger /> MRV ledger {review > 0 && <span className="nav-count">{review}</span>}
          </NavLink>
          <NavLink to="/certificates">
            <IconCertificate /> Certificates
          </NavLink>
          <NavLink to="/exposure">
            <IconExposure /> CBAM exposure
          </NavLink>
          <div className="nav-label">Trust</div>
          <NavLink to="/verify">
            <IconVerify /> Public verifier
          </NavLink>
          <NavLink to="/audit">
            <IconAudit /> Audit trail
          </NavLink>
        </nav>
        <div className="rail-foot">
          {user && (user.role === "operator" || user.role === "verifier") && <ScenarioConsole />}
          {user && (
            <div className="who">
              <div className="spread">
                <span className="tiny muted">{ROLE_LABEL[user.role]}</span>
                <span className="row" style={{ gap: 2 }}>
                  <button className="btn ghost sm" onClick={toggleTheme} aria-label="Toggle colour theme">
                    {theme === "dark" ? <IconSun size={14} /> : <IconMoon size={14} />}
                  </button>
                  <button
                    className="btn ghost sm"
                    onClick={() => {
                      signOut();
                      nav("/login");
                    }}
                    aria-label="Switch role"
                    title="Switch role"
                  >
                    <IconLogout size={14} />
                  </button>
                </span>
              </div>
              <div className="who-name">{user.name}</div>
              <div className="who-org">{user.org}</div>
            </div>
          )}
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <span className="topbar-title">{title}</span>
          <div className="topbar-meta">
            <span className="row hide-sm" title="Simulated plant clock (Europe/Istanbul)">
              Plant time <span className="num" style={{ color: "var(--ink)" }}>{simTs ? dateTime(simTs) : "–"}</span>
            </span>
            <span className="row" title={ov?.chain?.error ?? "Connected to the chain"}>
              <span className={`live-dot ${chainOk ? "" : "off"}`} />
              {chainOk ? (
                <>
                  Chain {ov?.chain?.chainId} · block <span className="num" style={{ color: "var(--ink)" }}>{ov?.chain?.block?.toLocaleString("en-GB")}</span>
                </>
              ) : (
                "Chain offline"
              )}
            </span>
            <span className="row">
              <span className={`live-dot ${live ? "pulse" : "off"}`} /> {live ? "Live" : "Reconnecting"}
            </span>
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
