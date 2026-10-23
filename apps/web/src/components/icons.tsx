import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };
const base = ({ size = 16, ...p }: P) => ({
  width: size,
  height: size,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  ...p,
});

export const IconOverview = (p: P) => (
  <svg {...base(p)}><rect x="2" y="2" width="5" height="5" rx="1" /><rect x="9" y="2" width="5" height="3" rx="1" /><rect x="9" y="7" width="5" height="7" rx="1" /><rect x="2" y="9" width="5" height="5" rx="1" /></svg>
);
export const IconFactory = (p: P) => (
  <svg {...base(p)}><path d="M2 14V7l4 2.5V7l4 2.5V3h3v11z" /><path d="M5 11.5h1M8 11.5h1M11 11.5h1" /></svg>
);
export const IconShield = (p: P) => (
  <svg {...base(p)}><path d="M8 1.8 13 3.6v4c0 3.2-2.1 5.4-5 6.6-2.9-1.2-5-3.4-5-6.6v-4z" /><path d="m5.8 8 1.6 1.6L10.4 6.4" /></svg>
);
export const IconLedger = (p: P) => (
  <svg {...base(p)}><rect x="1.8" y="5.5" width="4" height="5" rx="1" /><rect x="10.2" y="5.5" width="4" height="5" rx="1" /><path d="M5.8 8h4.4" /><path d="M8 3v2M8 11v2" /></svg>
);
export const IconCertificate = (p: P) => (
  <svg {...base(p)}><path d="M3 2h10v8H3z" /><path d="M5.5 5h5M5.5 7.3h3" /><circle cx="10.5" cy="11.2" r="1.9" /><path d="m9.5 12.8-.6 2 1.6-.8 1.6.8-.6-2" /></svg>
);
export const IconExposure = (p: P) => (
  <svg {...base(p)}><path d="M2 14h12" /><path d="M3.5 11.5V9M6.5 11.5V7M9.5 11.5V5M12.5 11.5V2.5" /></svg>
);
export const IconVerify = (p: P) => (
  <svg {...base(p)}><circle cx="7" cy="7" r="4.5" /><path d="m10.4 10.4 3.4 3.4" /><path d="m5.2 7 1.3 1.3L9 5.8" /></svg>
);
export const IconAudit = (p: P) => (
  <svg {...base(p)}><path d="M3.5 2.5h9v11h-9z" /><path d="M6 5.5h4M6 8h4M6 10.5h2.5" /></svg>
);
export const IconAlert = (p: P) => (
  <svg {...base(p)}><path d="M8 2 14.5 13.5h-13z" /><path d="M8 6.5v3M8 11.6v.1" /></svg>
);
export const IconCheck = (p: P) => (
  <svg {...base(p)}><path d="m3.5 8.4 2.8 2.8 6.2-6.4" /></svg>
);
export const IconX = (p: P) => (
  <svg {...base(p)}><path d="m4 4 8 8M12 4l-8 8" /></svg>
);
export const IconCopy = (p: P) => (
  <svg {...base(p)}><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" /><path d="M10.5 5.5V3.8c0-.7-.6-1.3-1.3-1.3H3.8c-.7 0-1.3.6-1.3 1.3v5.4c0 .7.6 1.3 1.3 1.3h1.7" /></svg>
);
export const IconExternal = (p: P) => (
  <svg {...base(p)}><path d="M9 2.5h4.5V7M13.5 2.5 7.5 8.5M12 9.5v3.5H3V4h3.5" /></svg>
);
export const IconBolt = (p: P) => (
  <svg {...base(p)}><path d="M9 1.5 3.5 9H8l-1 5.5L12.5 7H8z" /></svg>
);
export const IconLogout = (p: P) => (
  <svg {...base(p)}><path d="M6 13.5H3V2.5h3M10 11l3-3-3-3M13 8H6" /></svg>
);
export const IconKey = (p: P) => (
  <svg {...base(p)}><circle cx="5" cy="10.5" r="2.8" /><path d="m7 8.5 6-6M11 4.5l1.5 1.5M9.5 6l1 1" /></svg>
);
export const IconLock = (p: P) => (
  <svg {...base(p)}><rect x="3" y="7" width="10" height="7" rx="1.5" /><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" /></svg>
);
export const IconDot = ({ color, size = 8 }: { color: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 8 8" aria-hidden><circle cx="4" cy="4" r="4" fill={color} /></svg>
);
export const IconArrowRight = (p: P) => (
  <svg {...base(p)}><path d="M3 8h10M9 4l4 4-4 4" /></svg>
);
export const IconPlay = (p: P) => (
  <svg {...base(p)}><path d="M4.5 3v10l8-5z" /></svg>
);
export const IconSun = (p: P) => (
  <svg {...base(p)}><circle cx="8" cy="8" r="3" /><path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" /></svg>
);
export const IconMoon = (p: P) => (
  <svg {...base(p)}><path d="M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5z" /></svg>
);

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="7" fill="var(--btn-ink)" />
      <g fill="none" stroke="var(--btn-ink-text)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 7v18M10.5 25h11M7 11h18" />
        <path d="M7 11l-3 7h6zM25 11l-3 7h6z" />
      </g>
    </svg>
  );
}
