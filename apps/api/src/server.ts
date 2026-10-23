import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import { z } from "zod";
import { FACILITIES, CBAM_PHASE_IN, DEFAULT_EUA_PRICE, ILLUSTRATIVE_DEFAULT_SEE, DEFAULT_VALUE_MARKUP, FACTORS, type Hex, type SignedReading } from "@mizan/shared";
import { config } from "./config";
import { chain, ChainError } from "./chain";
import { DB_PATH } from "./db";
import { bus, type MizanEvent } from "./events";
import { USERS, authHook, issueToken, requireRole } from "./auth";
import { audit, listAudit, verifyAuditChain } from "./audit";
import { ingestReadings } from "./ingest";
import { anchorQueued } from "./batcher";
import { train } from "./integrity/engine";
import {
  HttpError,
  attestBatch,
  attestLowRisk,
  bootstrapFacilities,
  claimCertificate,
  enrollDevice,
  getCertificate,
  importers,
  integritySweep,
  issueCertificate,
  planAllocations,
  recordCarbonPrice,
  reviewIncident,
  transferCertificate,
} from "./services";
import {
  batchDetail,
  facilityDetail,
  incidentDetail,
  listBatches,
  listCarbonPrices,
  listCertificates,
  listIncidents,
  listRejections,
  overview,
  ratioSeries,
  readingProof,
  sampleReadings,
  series,
} from "./queries";

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "warn" }, bodyLimit: 32 * 1024 * 1024 });
await app.register(cors, { origin: true });
app.decorateRequest("user", null);
app.addHook("onRequest", async (req) => authHook(req));

app.setErrorHandler((err, _req, reply) => {
  if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message, detail: err.detail });
  if (err instanceof ChainError) return reply.code(409).send({ error: `Smart contract refused: ${err.message}`, revert: err.revert?.name });
  if (err instanceof z.ZodError) return reply.code(400).send({ error: "Invalid request", issues: err.issues });
  const e = err as { statusCode?: number; message: string };
  if (e.statusCode && e.statusCode < 500) return reply.code(e.statusCode).send({ error: e.message });
  app.log.error(err);
  return reply.code(500).send({ error: e.message });
});

const parse = <T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> => schema.parse(data);
const idParam = (req: FastifyRequest) => Number((req.params as { id: string }).id);

/* ---------------------------------------------------------------- health & config */

app.get("/api/health", async () => ({ ok: true, chain: await chain.status(), db: DB_PATH }));

app.get("/api/public/config", async () => {
  const dep = chain.deployment;
  const pick = (name: "MizanRegistry" | "MRVLedger" | "EmissionsCertificate") => dep?.contracts[name].address ?? null;
  return {
    chainId: config.chainId,
    network: dep?.network ?? null,
    rpcUrl: config.publicRpcUrl,
    explorerUrl: config.explorerUrl || null,
    contracts: { MizanRegistry: pick("MizanRegistry"), MRVLedger: pick("MRVLedger"), EmissionsCertificate: pick("EmissionsCertificate") },
    roles: dep?.roles ?? null,
    windowSeconds: config.windowSeconds,
    intervalSeconds: config.intervalSeconds,
    demoMode: config.demoMode,
    cbam: { phaseIn: CBAM_PHASE_IN, defaultEuaPrice: DEFAULT_EUA_PRICE, defaultSee: ILLUSTRATIVE_DEFAULT_SEE, defaultMarkup: DEFAULT_VALUE_MARKUP },
    factors: FACTORS,
    facilities: FACILITIES,
  };
});

/* ---------------------------------------------------------------- auth */

app.get("/api/auth/users", async () =>
  USERS.map((u) => ({ id: u.id, name: u.name, role: u.role, title: u.title, org: u.org, country: u.country, address: u.wallet ? chain.address(u.wallet) : null })),
);
app.post("/api/auth/login", async (req, reply) => {
  if (!config.demoMode) return reply.code(403).send({ error: "Password-less demo login is disabled" });
  const { userId } = parse(z.object({ userId: z.string() }), req.body);
  const u = USERS.find((x) => x.id === userId);
  if (!u) return reply.code(404).send({ error: "Unknown user" });
  audit(u.id, "session.started", `user:${u.id}`);
  return { token: issueToken(u.id), user: { ...u, address: u.wallet ? chain.address(u.wallet) : null } };
});
app.get("/api/auth/me", { preHandler: requireRole() }, async (req) => ({
  ...req.user!,
  address: req.user!.wallet ? chain.address(req.user!.wallet) : null,
}));

/* ---------------------------------------------------------------- devices (machine to machine) */

const enrollSchema = z.object({ deviceId: z.string().min(3).max(64), publicKey: z.string().startsWith("0x") });
app.post("/api/devices/enroll", async (req, reply) => {
  if (req.headers["x-enroll-token"] !== config.enrollToken) return reply.code(401).send({ error: "Invalid enrollment token" });
  const body = parse(enrollSchema, req.body);
  return enrollDevice(body.deviceId, body.publicKey as Hex);
});

const readingSchema = z.object({
  deviceId: z.string().min(3).max(64),
  facilityId: z.string().min(3).max(32),
  seq: z.number().int().nonnegative(),
  ts: z.number().int().positive(),
  metric: z.enum([
    "electricity_kwh",
    "natural_gas_nm3",
    "charge_carbon_kg",
    "steel_output_kg",
    "petcoke_kg",
    "clinker_output_kg",
    "cement_output_kg",
    "aluminium_output_kg",
  ]),
  valueMilli: z.number().int(),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
});
/** No user session: the ML-DSA signature on each reading is the authentication. */
app.post("/api/ingest", async (req) => {
  const { readings } = parse(z.object({ readings: z.array(readingSchema).min(1).max(5000) }), req.body);
  const out = ingestReadings(readings as SignedReading[]);
  if (out.sealedBatches.length) void anchorQueued();
  return out;
});

/* ---------------------------------------------------------------- dashboards */

const anyUser = { preHandler: requireRole() };
app.get("/api/overview", anyUser, async () => overview());
app.get("/api/facilities", anyUser, async () => FACILITIES.map((f) => facilityDetail(f.id)));
app.get("/api/facilities/:id", anyUser, async (req) => facilityDetail((req.params as { id: string }).id));
app.get("/api/facilities/:id/series", anyUser, async (req) => {
  const q = parse(z.object({ hours: z.coerce.number().min(1).max(24 * 60).default(72), bucket: z.coerce.number().min(15).max(1440).default(60) }), req.query);
  return series((req.params as { id: string }).id, q.hours, q.bucket);
});
app.get("/api/facilities/:id/ratios", anyUser, async (req) => {
  const q = parse(z.object({ hours: z.coerce.number().min(1).max(24 * 60).default(72), bucket: z.coerce.number().min(15).max(1440).default(60) }), req.query);
  return ratioSeries((req.params as { id: string }).id, q.hours, q.bucket);
});
app.get("/api/facilities/:id/allocations", anyUser, async (req) => {
  const q = parse(z.object({ quantityT: z.coerce.number().positive() }), req.query);
  return planAllocations((req.params as { id: string }).id, Math.round(q.quantityT * 1000));
});

app.get("/api/incidents", anyUser, async (req) => {
  const q = parse(z.object({ status: z.string().optional(), facilityId: z.string().optional() }), req.query);
  return listIncidents(q.status ?? "open", q.facilityId);
});
app.get("/api/incidents/:id", anyUser, async (req) => incidentDetail(idParam(req)));
app.post("/api/incidents/:id/review", { preHandler: requireRole("verifier") }, async (req) => {
  const body = parse(z.object({ decision: z.enum(["confirmed", "dismissed"]), note: z.string().max(2000).default("") }), req.body);
  return reviewIncident(req.user!, idParam(req), body.decision, body.note);
});
app.get("/api/rejections", anyUser, async () => listRejections());

app.get("/api/batches", anyUser, async (req) => {
  const q = parse(z.object({ facilityId: z.string().optional(), status: z.string().optional(), limit: z.coerce.number().max(1000).optional() }), req.query);
  return listBatches(q);
});
app.get("/api/batches/:id", anyUser, async (req) => batchDetail(idParam(req)));
app.post("/api/batches/:id/attest", { preHandler: requireRole("verifier") }, async (req) => {
  const body = parse(z.object({ approved: z.boolean(), note: z.string().max(2000).default("") }), req.body);
  return attestBatch(req.user!, idParam(req), body.approved, body.note);
});
app.post("/api/batches/attest-low-risk", { preHandler: requireRole("verifier") }, async (req) => {
  const body = parse(z.object({ maxRisk: z.number().min(0).max(0.5).default(0.3), facilityId: z.string().optional() }), req.body ?? {});
  return attestLowRisk(req.user!, body.maxRisk, body.facilityId);
});
app.post("/api/batches/retry", { preHandler: requireRole("operator") }, async () => {
  const { run } = await import("./db");
  run("UPDATE batches SET status = 'queued' WHERE status = 'error'");
  void anchorQueued();
  return { ok: true };
});

/* ---------------------------------------------------------------- carbon price & certificates */

app.get("/api/carbon-prices", anyUser, async () => listCarbonPrices());
app.post("/api/carbon-prices", { preHandler: requireRole("authority") }, async (req) => {
  const body = parse(
    z.object({
      facilityId: z.string(),
      tonnes: z.number().positive().max(10_000_000),
      eurPerTonne: z.number().positive().max(500),
      scheme: z.string().min(2).max(80),
      evidence: z.string().min(3).max(500),
    }),
    req.body,
  );
  return recordCarbonPrice(req.user!, body);
});

app.get("/api/importers", anyUser, async () => importers());
app.get("/api/certificates", anyUser, async (req) => listCertificates(req.user!.role === "importer" ? req.user!.id : undefined));
app.get("/api/certificates/:id", anyUser, async (req) => getCertificate(idParam(req)));
app.post("/api/certificates", { preHandler: requireRole("operator") }, async (req) => {
  const body = parse(
    z.object({ facilityId: z.string(), importerId: z.string(), quantityT: z.number().positive().max(1_000_000), shipmentRef: z.string().min(3).max(120) }),
    req.body,
  );
  return issueCertificate(req.user!, body);
});
app.post("/api/certificates/:id/claim", { preHandler: requireRole("importer") }, async (req) => {
  const body = parse(z.object({ declarationRef: z.string().min(3).max(120) }), req.body);
  return claimCertificate(req.user!, idParam(req), body.declarationRef);
});
app.post("/api/certificates/:id/transfer", { preHandler: requireRole("importer") }, async (req) => {
  const body = parse(z.object({ toImporterId: z.string() }), req.body);
  return transferCertificate(req.user!, idParam(req), body.toImporterId);
});

/* ---------------------------------------------------------------- audit & integrity */

app.get("/api/audit", anyUser, async (req) => {
  const q = parse(z.object({ limit: z.coerce.number().max(500).default(100), before: z.coerce.number().optional() }), req.query);
  return { entries: listAudit(q.limit, q.before), chain: verifyAuditChain() };
});
app.get("/api/integrity/sweep", anyUser, async () => integritySweep());

/* ---------------------------------------------------------------- public verification (no login) */

app.get("/api/public/readings/:id", async (req) => readingProof(idParam(req)));
app.get("/api/public/readings", async (req) => {
  const q = parse(z.object({ batchId: z.coerce.number().optional(), facilityId: z.string().optional(), limit: z.coerce.number().max(200).optional() }), req.query);
  return sampleReadings(q);
});
app.get("/api/public/certificates/:id", async (req) => getCertificate(idParam(req)));
app.get("/api/public/batches/:id", async (req) => {
  const b = batchDetail(idParam(req));
  return { ...b, readings: b.readings.slice(0, 50) };
});

/* ---------------------------------------------------------------- demo scenario console */

const SCENARIOS = ["meter-tamper", "replay", "forged-signature", "stuck-sensor", "fuel-bypass", "clear"] as const;
app.post("/api/demo/scenario", { preHandler: requireRole("operator", "verifier") }, async (req, reply) => {
  if (!config.demoMode) return reply.code(403).send({ error: "Demo mode is off" });
  const body = parse(z.object({ scenario: z.enum(SCENARIOS), facilityId: z.string().optional() }), req.body);
  try {
    const res = await fetch(`${config.simulatorControlUrl}/scenario`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    audit(req.user!.id, "demo.scenario", `scenario:${body.scenario}`, body);
    return reply.code(res.status).send(data);
  } catch {
    return reply.code(503).send({ error: "The meter simulator is not running. Start it with \"pnpm simulate\"." });
  }
});
app.get("/api/demo/status", anyUser, async () => {
  try {
    const res = await fetch(`${config.simulatorControlUrl}/status`);
    return await res.json();
  } catch {
    return { running: false };
  }
});

/* ---------------------------------------------------------------- live stream (SSE) */

app.get("/api/stream", async (req: FastifyRequest, reply: FastifyReply) => {
  reply.raw.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "access-control-allow-origin": "*",
  });
  reply.raw.write(`retry: 3000\n\n`);
  // readings arrive in bursts; coalesce them so the browser gets at most a few frames per second
  let pending: MizanEvent[] = [];
  let timer: NodeJS.Timeout | null = null;
  const flush = () => {
    timer = null;
    if (!pending.length) return;
    reply.raw.write(`data: ${JSON.stringify(pending)}\n\n`);
    pending = [];
  };
  const onEvent = (e: MizanEvent) => {
    if (e.type === "reading" && pending.length > 400) return;
    pending.push(e);
    if (!timer) timer = setTimeout(flush, 300);
  };
  const ping = setInterval(() => reply.raw.write(`: ping\n\n`), 15000);
  bus.on("event", onEvent);
  req.raw.on("close", () => {
    bus.off("event", onEvent);
    clearInterval(ping);
    if (timer) clearTimeout(timer);
  });
  return reply;
});

/* ---------------------------------------------------------------- startup */

async function connectChain() {
  const ok = await chain.init();
  if (ok) {
    try {
      await bootstrapFacilities();
    } catch (e) {
      console.error("[mizan] facility bootstrap failed, will retry:", (e as Error).message);
      chain.ready = false;
      return false;
    }
    console.log(`[mizan] chain ready: ${config.rpcUrl} (chain ${config.chainId})`);
  } else {
    console.warn(`[mizan] chain not ready: ${chain.lastError}`);
  }
  return ok;
}

await connectChain();
for (const f of FACILITIES) train(f.id);
setInterval(async () => {
  if (!chain.ready) await connectChain().catch(() => undefined);
  await anchorQueued().catch((e) => console.error("[mizan] anchor loop", e));
}, 3000);

await app.listen({ port: config.port, host: config.host });
console.log(`[mizan] API listening on http://${config.host}:${config.port}`);
