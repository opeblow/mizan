import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { IconAlert, IconCheck, IconCopy, IconDot, IconExternal, IconX } from "./icons";
import { short } from "../lib/format";

/* ---------------------------------------------------------------- status language
   Status colours are reserved for state and always come with an icon and a label. */

export type Tone = "good" | "warning" | "serious" | "critical" | "neutral" | "info";
const TONE_COLOR: Record<Tone, string> = {
  good: "var(--good)",
  warning: "var(--warning)",
  serious: "var(--serious)",
  critical: "var(--critical)",
  neutral: "var(--muted)",
  info: "var(--s1)",
};

export function Badge({ tone = "neutral", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  const cls = tone === "critical" ? "critical" : tone === "good" ? "good" : tone === "warning" || tone === "serious" ? "warning" : "";
  const icon =
    tone === "good" ? (
      <IconCheck size={12} style={{ color: "var(--good-text)" }} />
    ) : tone === "critical" || tone === "serious" ? (
      <IconAlert size={12} style={{ color: TONE_COLOR[tone] }} />
    ) : (
      <IconDot color={TONE_COLOR[tone]} size={7} />
    );
  return (
    <span className={`badge ${cls}`} title={title}>
      {icon}
      {children}
    </span>
  );
}

export const riskTone = (r: number): Tone => (r >= 0.75 ? "critical" : r >= 0.5 ? "serious" : r >= 0.3 ? "warning" : "good");
export const riskLabel = (r: number) => (r >= 0.75 ? "Critical" : r >= 0.5 ? "High" : r >= 0.3 ? "Elevated" : "Low");

export function RiskBadge({ risk }: { risk: number }) {
  return (
    <Badge tone={riskTone(risk)} title="AI integrity risk">
      {riskLabel(risk)} · {Math.round(risk * 100)}%
    </Badge>
  );
}

export function SeverityBadge({ severity }: { severity: string }) {
  const tone: Tone = severity === "critical" ? "critical" : severity === "high" ? "serious" : severity === "medium" ? "warning" : "neutral";
  return <Badge tone={tone}>{severity[0].toUpperCase() + severity.slice(1)}</Badge>;
}

export function BatchStatus({ status, risk }: { status: string; risk?: number }) {
  if (status === "verified") return <Badge tone="good">Verified</Badge>;
  if (status === "rejected") return <Badge tone="critical">Rejected</Badge>;
  if (status === "anchored") return risk != null && risk >= 0.3 ? <Badge tone="warning">Needs review</Badge> : <Badge tone="info">Anchored · pending</Badge>;
  if (status === "queued") return <Badge tone="neutral">Sealed · queued</Badge>;
  if (status === "error") return <Badge tone="critical">Anchor failed</Badge>;
  return <Badge>{status}</Badge>;
}

/* ---------------------------------------------------------------- hash chip */

export function Hash({ value, href, head = 8, tail = 6, label }: { value: string | null | undefined; href?: string | null; head?: number; tail?: number; label?: string }) {
  const [copied, setCopied] = useState(false);
  if (!value) return <span className="muted">–</span>;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard blocked */
    }
  };
  return (
    <span className="hash" title={value}>
      {href ? (
        <a href={href} target="_blank" rel="noreferrer">
          {label ?? short(value, head, tail)}
        </a>
      ) : (
        <span>{label ?? short(value, head, tail)}</span>
      )}
      <button type="button" onClick={copy} aria-label={copied ? "Copied" : "Copy full value"}>
        {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
      </button>
      {href && (
        <a href={href} target="_blank" rel="noreferrer" aria-label="Open in block explorer">
          <IconExternal size={12} />
        </a>
      )}
    </span>
  );
}

/* ---------------------------------------------------------------- layout bits */

export function Card({ title, sub, action, children, foot, pad = true }: { title?: ReactNode; sub?: ReactNode; action?: ReactNode; children: ReactNode; foot?: ReactNode; pad?: boolean }) {
  return (
    <section className="card">
      {(title || action) && (
        <div className="card-head">
          <div>
            {title && <h2>{title}</h2>}
            {sub && <div className="sub">{sub}</div>}
          </div>
          {action}
        </div>
      )}
      <div className={pad ? "card-body" : ""}>{children}</div>
      {foot && <div className="card-foot">{foot}</div>}
    </section>
  );
}

export function Stat({ label, value, unit, note, icon }: { label: ReactNode; value: ReactNode; unit?: string; note?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="stat">
      <div className="stat-label">
        {icon}
        {label}
      </div>
      <div className="stat-value">
        {value}
        {unit && <span className="stat-unit">{unit}</span>}
      </div>
      {note && <div className="stat-note">{note}</div>}
    </div>
  );
}

export function PageHead({ eyebrow, title, lede, actions }: { eyebrow?: ReactNode; title: ReactNode; lede?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {lede && <p className="lede">{lede}</p>}
      </div>
      {actions && <div className="row wrap">{actions}</div>}
    </div>
  );
}

export const Empty = ({ children }: { children: ReactNode }) => <div className="empty">{children}</div>;
export const Spinner = () => <span className="spinner" role="status" aria-label="Loading" />;

export function Loading({ error }: { error?: string | null }) {
  if (error)
    return (
      <div className="callout critical">
        <IconAlert size={16} style={{ color: "var(--critical)" }} />
        <div>{error}</div>
      </div>
    );
  return (
    <div className="empty row" style={{ justifyContent: "center" }}>
      <Spinner /> Loading
    </div>
  );
}

export function Drawer({ open, onClose, title, sub, children, foot }: { open: boolean; onClose: () => void; title: ReactNode; sub?: ReactNode; children: ReactNode; foot?: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true">
        <div className="drawer-head">
          <div className="grow">
            <h2 style={{ fontSize: 17 }}>{title}</h2>
            {sub && <div className="small muted" style={{ marginTop: 3 }}>{sub}</div>}
          </div>
          <button className="btn ghost sm" onClick={onClose} aria-label="Close">
            <IconX size={14} />
          </button>
        </div>
        <div className="drawer-body">{children}</div>
        {foot && <div className="drawer-foot">{foot}</div>}
      </aside>
    </>
  );
}

/* ---------------------------------------------------------------- toasts */

interface Toast {
  id: number;
  tone: "good" | "critical" | "neutral";
  text: ReactNode;
}
const ToastCtx = createContext<(tone: Toast["tone"], text: ReactNode) => void>(() => undefined);
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((tone: Toast["tone"], text: ReactNode) => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs.slice(-3), { id, tone, text }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), tone === "critical" ? 9000 : 5000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className="toast">
            {t.tone === "good" ? (
              <IconCheck size={16} style={{ color: "var(--good-text)" }} />
            ) : t.tone === "critical" ? (
              <IconAlert size={16} style={{ color: "var(--critical)" }} />
            ) : (
              <IconDot color="var(--s1)" />
            )}
            <div>{t.text}</div>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
