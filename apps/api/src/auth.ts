import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { config } from "./config";
import type { Role as WalletRole } from "./chain";

export type UserRole = "operator" | "verifier" | "importer" | "authority";

export interface User {
  id: string;
  name: string;
  role: UserRole;
  title: string;
  org: string;
  country: string;
  wallet?: WalletRole;
}

/** Demo organisations. All fictional; roles mirror the real CBAM / ETS value chain. */
export const USERS: User[] = [
  { id: "op-elif", name: "Elif Demir", role: "operator", title: "Head of Climate Compliance", org: "Anatolia Industrial Group", country: "TR", wallet: "oracle" },
  { id: "ver-kerem", name: "Kerem Aydın", role: "verifier", title: "Lead MRV Verifier", org: "Bosphorus Verification Services", country: "TR", wallet: "verifier" },
  { id: "imp-hanna", name: "Hanna Weber", role: "importer", title: "CBAM Declarant", org: "Rheinland Baustoffe GmbH", country: "DE", wallet: "importerA" },
  { id: "imp-joost", name: "Joost de Vries", role: "importer", title: "Trade Compliance Lead", org: "Rotterdam Metals B.V.", country: "NL", wallet: "importerB" },
  { id: "auth-ets", name: "ETS Registry Desk", role: "authority", title: "Carbon price registry", org: "National ETS Authority (demo)", country: "TR", wallet: "authority" },
];

export const userById = (id: string) => USERS.find((u) => u.id === id);

const b64 = (s: string) => Buffer.from(s).toString("base64url");
const sign = (payload: string) => createHmac("sha256", config.sessionSecret).update(payload).digest("base64url");

export function issueToken(userId: string, ttlSeconds = 60 * 60 * 12): string {
  const payload = b64(JSON.stringify({ sub: userId, exp: Math.floor(Date.now() / 1000) + ttlSeconds }));
  return `${payload}.${sign(payload)}`;
}

export function readToken(token: string | undefined): User | null {
  if (!token) return null;
  const [payload, mac] = token.split(".");
  if (!payload || !mac) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const { sub, exp } = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (typeof exp !== "number" || exp < Date.now() / 1000) return null;
    return userById(sub) ?? null;
  } catch {
    return null;
  }
}

declare module "fastify" {
  interface FastifyRequest {
    user: User | null;
  }
}

export function authHook(req: FastifyRequest) {
  const h = req.headers.authorization;
  const q = (req.query as Record<string, string> | undefined)?.token;
  req.user = readToken(h?.startsWith("Bearer ") ? h.slice(7) : q);
}

export const requireRole =
  (...roles: UserRole[]) =>
  async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.user) return reply.code(401).send({ error: "Sign in required" });
    if (roles.length && !roles.includes(req.user.role)) {
      return reply.code(403).send({ error: `This action needs the ${roles.join(" or ")} role` });
    }
  };
