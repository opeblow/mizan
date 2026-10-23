/** Facility identity colours: fixed categorical slots 1-3, validated all-pairs. Colour follows the entity. */
export const FACILITY_COLOR: Record<string, string> = {
  "TR-CEM-01": "var(--s1)",
  "TR-STL-01": "var(--s2)",
  "TR-ALU-01": "var(--s3)",
};

export const SCOPE_SERIES = [
  { key: "direct", label: "Direct (scope 1)", color: "var(--s1)" },
  { key: "indirect", label: "Electricity (scope 2)", color: "var(--s2)" },
];

export const DETECTOR_LABEL: Record<string, string> = {
  physics: "Physics envelope",
  statistical: "Robust statistics",
  iforest: "Isolation forest",
  stuck: "Frozen sensor",
  missing: "Mass balance",
  "bad-signature": "Signature check",
  replay: "Replay guard",
  "sequence-regression": "Sequence guard",
  "unknown-device": "Device registry",
  "revoked-device": "Device registry",
};

export const CATEGORY_LABEL: Record<string, string> = {
  manipulation: "Possible manipulation",
  "data-quality": "Data quality",
  security: "Security",
};

export const REJECT_LABEL: Record<string, string> = {
  "bad-signature": "Invalid ML-DSA signature",
  replay: "Replayed message",
  "sequence-regression": "Sequence went backwards",
  "stale-timestamp": "Stale timestamp",
  "unknown-device": "Unknown device",
  "revoked-device": "Revoked device",
  "device-mismatch": "Wrong facility or metric",
  "window-sealed": "Window already sealed",
};

export const CBAM_INDIRECT_NOTE =
  "CBAM counts indirect (electricity) emissions for cement and fertilisers only; for iron, steel and aluminium only direct emissions are embedded.";
