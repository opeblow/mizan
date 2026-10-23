import { useCallback, useEffect, useRef, useState } from "react";

export interface SessionUser {
  id: string;
  name: string;
  role: "operator" | "verifier" | "importer" | "authority";
  title: string;
  org: string;
  country: string;
  address: string | null;
}

/** Where the API lives. Empty in local dev (Vite proxies /api); set VITE_API_URL for a separate host such as Render. */
const DEFAULT_PROD_API = "https://mizan-p0rr.onrender.com";
export const API_BASE = ((import.meta.env.VITE_API_URL as string | undefined) || (import.meta.env.PROD ? DEFAULT_PROD_API : "")).replace(/\/+$/, "");

const TOKEN_KEY = "mizan.token";
const store = {
  get: () => {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set: (v: string | null) => {
    try {
      if (v) localStorage.setItem(TOKEN_KEY, v);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* storage unavailable: session lasts for this tab only */
    }
  },
};

let memoryToken: string | null = store.get();
export const getToken = () => memoryToken;
export const setToken = (t: string | null) => {
  memoryToken = t;
  store.set(t);
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: Record<string, unknown>,
  ) {
    super(message);
  }
}

export async function api<T = any>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(API_BASE + path, {
    method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
    headers: {
      ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
      ...(memoryToken ? { authorization: `Bearer ${memoryToken}` } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && memoryToken) {
      setToken(null);
      window.dispatchEvent(new Event("mizan:signed-out"));
    }
    throw new ApiError(res.status, (data as { error?: string }).error ?? res.statusText, data as Record<string, unknown>);
  }
  return data as T;
}

/* ---------------------------------------------------------------- live events */

export type LiveEvent =
  | { type: "reading"; facilityId: string; deviceId: string; metric: string; ts: number; value: number; readingId: number }
  | { type: "rejection"; facilityId: string | null; deviceId: string | null; reason: string; detail: string }
  | { type: "interval"; facilityId: string; ts: number; risk: number; directKg: number; indirectKg: number; productionKg: number }
  | { type: "incident"; incidentId: number; facilityId: string; severity: string; title: string; isNew: boolean }
  | { type: "batch"; batchId: number; facilityId: string; status: string; risk: number }
  | { type: "certificate"; certificateId: number; facilityId: string; status: string }
  | { type: "chain"; status: string; message: string };

type Listener = (events: LiveEvent[]) => void;
const listeners = new Set<Listener>();
let source: EventSource | null = null;
let connected = false;
const statusListeners = new Set<(c: boolean) => void>();

function ensureStream() {
  if (source) return;
  source = new EventSource(`${API_BASE}/api/stream`);
  source.onopen = () => {
    connected = true;
    statusListeners.forEach((l) => l(true));
  };
  source.onerror = () => {
    connected = false;
    statusListeners.forEach((l) => l(false));
  };
  source.onmessage = (m) => {
    try {
      const events = JSON.parse(m.data) as LiveEvent[];
      listeners.forEach((l) => l(events));
    } catch {
      /* ignore malformed frame */
    }
  };
}

export function useLive(listener: Listener) {
  const ref = useRef(listener);
  ref.current = listener;
  useEffect(() => {
    ensureStream();
    const l: Listener = (e) => ref.current(e);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
}

export function useLiveStatus() {
  const [c, setC] = useState(connected);
  useEffect(() => {
    ensureStream();
    statusListeners.add(setC);
    return () => {
      statusListeners.delete(setC);
    };
  }, []);
  return c;
}

/* ---------------------------------------------------------------- data hook */

/**
 * Fetches a resource and refetches it when live events matching `refreshOn` arrive (throttled), so every
 * screen stays current without polling.
 */
export function useResource<T>(path: string | null, refreshOn: LiveEvent["type"][] = [], throttleMs = 1500) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!path);
  const timer = useRef<number | null>(null);
  const pathRef = useRef(path);
  pathRef.current = path;

  const load = useCallback(async () => {
    const p = pathRef.current;
    if (!p) return;
    try {
      const d = await api<T>(p);
      if (pathRef.current === p) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(!!path);
    void load();
  }, [path, load]);

  useLive((events) => {
    if (!refreshOn.length || !events.some((e) => refreshOn.includes(e.type))) return;
    if (timer.current) return;
    timer.current = window.setTimeout(() => {
      timer.current = null;
      void load();
    }, throttleMs);
  });

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return { data, error, loading, reload: load, setData };
}
