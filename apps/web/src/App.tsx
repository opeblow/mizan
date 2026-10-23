import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { api, getToken, setToken, type SessionUser } from "./lib/api";
import { ToastProvider, Loading } from "./components/ui";
import { Layout } from "./components/Layout";
import { Login } from "./pages/Login";
import { Overview } from "./pages/Overview";
import { Facility } from "./pages/Facility";
import { Integrity } from "./pages/Integrity";
import { Ledger } from "./pages/Ledger";
import { Certificates } from "./pages/Certificates";
import { Exposure } from "./pages/Exposure";
import { Verify } from "./pages/Verify";
import { Audit } from "./pages/Audit";

interface Session {
  user: SessionUser | null;
  signIn: (userId: string) => Promise<void>;
  signOut: () => void;
}
const SessionCtx = createContext<Session>({ user: null, signIn: async () => undefined, signOut: () => undefined });
export const useSession = () => useContext(SessionCtx);

function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(!getToken());

  useEffect(() => {
    if (!getToken()) return;
    api<SessionUser>("/api/auth/me")
      .then(setUser)
      .catch(() => setToken(null))
      .finally(() => setReady(true));
  }, []);

  useEffect(() => {
    const out = () => setUser(null);
    window.addEventListener("mizan:signed-out", out);
    return () => window.removeEventListener("mizan:signed-out", out);
  }, []);

  const signIn = useCallback(async (userId: string) => {
    const res = await api<{ token: string; user: SessionUser }>("/api/auth/login", { body: { userId } });
    setToken(res.token);
    setUser(res.user);
  }, []);
  const signOut = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  if (!ready) return <Loading />;
  return <SessionCtx.Provider value={{ user, signIn, signOut }}>{children}</SessionCtx.Provider>;
}

function Private({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const loc = useLocation();
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  return <Layout>{children}</Layout>;
}

/** The public verifier works without signing in, inside the app shell when a session exists. */
function PublicOrShell({ children }: { children: ReactNode }) {
  const { user } = useSession();
  return user ? <Layout>{children}</Layout> : <div className="content" style={{ margin: "0 auto" }}>{children}</div>;
}

export function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <SessionProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/verify/*" element={<PublicOrShell><Verify /></PublicOrShell>} />
            <Route path="/" element={<Private><Overview /></Private>} />
            <Route path="/facilities/:id" element={<Private><Facility /></Private>} />
            <Route path="/integrity" element={<Private><Integrity /></Private>} />
            <Route path="/integrity/:id" element={<Private><Integrity /></Private>} />
            <Route path="/ledger" element={<Private><Ledger /></Private>} />
            <Route path="/ledger/:id" element={<Private><Ledger /></Private>} />
            <Route path="/certificates" element={<Private><Certificates /></Private>} />
            <Route path="/certificates/:id" element={<Private><Certificates /></Private>} />
            <Route path="/exposure" element={<Private><Exposure /></Private>} />
            <Route path="/audit" element={<Private><Audit /></Private>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </SessionProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
