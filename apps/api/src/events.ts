import { EventEmitter } from "node:events";

export type MizanEvent =
  | { type: "reading"; facilityId: string; deviceId: string; metric: string; ts: number; value: number; readingId: number }
  | { type: "rejection"; facilityId: string | null; deviceId: string | null; reason: string; detail: string }
  | { type: "interval"; facilityId: string; ts: number; risk: number; directKg: number; indirectKg: number; productionKg: number }
  | { type: "incident"; incidentId: number; facilityId: string; severity: string; title: string; isNew: boolean }
  | { type: "batch"; batchId: number; facilityId: string; status: string; risk: number }
  | { type: "certificate"; certificateId: number; facilityId: string; status: "issued" | "claimed" }
  | { type: "chain"; status: "ok" | "error"; message: string };

class Bus extends EventEmitter {
  publish(e: MizanEvent) {
    this.emit("event", e);
  }
}

export const bus = new Bus();
bus.setMaxListeners(200);
