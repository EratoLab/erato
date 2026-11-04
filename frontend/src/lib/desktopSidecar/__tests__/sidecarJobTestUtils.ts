import { DesktopSidecarClient } from "@erato/desktop-sidecar-protocol";
import { vi } from "vitest";

import jobEnvelope from "../../../../../desktop-sidecar-protocol/conformance/fixtures/job-envelope.json";

import type {
  JobCallResult,
  SidecarSnapshot,
} from "@erato/desktop-sidecar-protocol";

/** One JSON-RPC response of the fake sidecar: a result or an error object. */
export type SidecarReply =
  | { result: unknown }
  | { error: { code: number; message: string; data?: unknown } };

export type SidecarResponder = (
  method: string,
  params: Record<string, unknown>,
) => SidecarReply | Promise<SidecarReply>;

type JobDiscovery = Pick<SidecarSnapshot, "strict" | "jobs" | "providers">;

export const NORMAL_MODE = "current sidecar in normal mode";
export const PREVIOUS_SIDECAR = "previous sidecar without the job envelope";
export const STRICT_MODE =
  "current sidecar in strict mode with a future provider field";

/** The handle the protocol's job fixtures use. */
export const JOB_HANDLE = jobEnvelope.statuses[0].handle;

/** What the job envelope fixture's discovery case reports, as the snapshot keeps it. */
export function fixtureDiscovery(name: string): JobDiscovery {
  const entry = jobEnvelope.discovery.find(
    (candidate) => candidate.name === name,
  );
  if (!entry) throw new Error(`No discovery fixture named ${name}.`);
  const { strict, jobs, providers } = entry.result as JobDiscovery;
  return {
    ...(strict === undefined ? {} : { strict }),
    ...(jobs === undefined ? {} : { jobs }),
    ...(providers === undefined ? {} : { providers }),
  };
}

export const completedJob = (results: JobCallResult[]): SidecarReply => ({
  result: { handle: JOB_HANDLE, state: "completed", results },
});

export const pendingJob = (state = "running"): SidecarReply => ({
  result: { handle: JOB_HANDLE, state },
});

/**
 * A ready client whose requests `respond` answers, through the pinned
 * request and result validators. A pending answer rejects when its request
 * is aborted, as a held HTTP request does.
 */
export function fakeSidecarClient(
  respond: SidecarResponder,
  discovery: Partial<SidecarSnapshot> = {},
) {
  const requests: {
    method: string;
    params: Record<string, unknown>;
    at: number;
  }[] = [];
  const client = new DesktopSidecarClient({
    transport: {
      request: (body, options) => {
        const { id, method, params } = JSON.parse(body) as {
          id: string;
          method: string;
          params?: Record<string, unknown>;
        };
        requests.push({ method, params: params ?? {}, at: Date.now() });
        return new Promise<string>((resolve, reject) => {
          const signal = options?.signal;
          signal?.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
          Promise.resolve(respond(method, params ?? {})).then(
            (reply) =>
              resolve(JSON.stringify({ jsonrpc: "2.0", id, ...reply })),
            reject,
          );
        });
      },
    },
    clientInfo: {
      name: "test",
      version: "1",
      host: { application: "test", runtime: "test" },
      os: { name: "test" },
    },
  });
  const supports = vi.spyOn(client, "supports").mockReturnValue(true);
  vi.spyOn(client, "getSnapshot").mockReturnValue({
    ...client.getSnapshot(),
    state: "ready",
    ...discovery,
  });
  const methods = () => requests.map((request) => request.method);
  return { client, requests, methods, supports };
}
