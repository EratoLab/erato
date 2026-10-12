import { afterEach, describe, expect, it } from "vitest";

import {
  operationExecutorBinding,
  operationExecutorHeaders,
  registerOperationExecutor,
} from "./registration";

import type { ExecutorBinding } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const sidecar: ExecutorBinding = {
  device_id: "sidecar-device",
  realm: "desktop-sidecar",
  host_context: { kind: "origin", identity: "https://app.example" },
};
const mailbox: ExecutorBinding = {
  device_id: "pane-device-000000",
  realm: "office-addin",
  host_context: { kind: "outlook_mailbox", identity: "a".repeat(64) },
};

const cleanups: (() => void)[] = [];
function register(
  name: string,
  binding: ExecutorBinding | undefined,
  yields = false,
) {
  cleanups.push(registerOperationExecutor(name, () => binding, { yields }));
}

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
});

describe("operation executor registration", () => {
  it("advertises a single ready binding", () => {
    register("fetch_availability", mailbox, true);
    register("other_tool", undefined, true);
    expect(operationExecutorHeaders()).toEqual({
      "X-Erato-Executor": JSON.stringify(mailbox),
      "X-Erato-Client-Tools": "fetch_availability",
    });
  });

  it("lets a strict executor keep the header over a yielding one", () => {
    register("fetch_availability", mailbox, true);
    register("local_collect_evidence", sidecar);
    expect(operationExecutorHeaders()).toEqual({
      "X-Erato-Executor": JSON.stringify(sidecar),
      "X-Erato-Client-Tools": "local_collect_evidence",
    });
  });

  it("joins a yielding executor that shares the strict binding", () => {
    register("local_collect_evidence", sidecar);
    register("sidecar_extra", sidecar, true);
    expect(operationExecutorHeaders()["X-Erato-Client-Tools"]).toBe(
      "local_collect_evidence,sidecar_extra",
    );
  });

  it("sends no binding when strict executors conflict", () => {
    register("local_collect_evidence", sidecar);
    register("fetch_availability", mailbox);
    expect(operationExecutorHeaders()).toEqual({});
  });

  it("returns one tool's own binding whatever the header carries", () => {
    register("local_collect_evidence", sidecar);
    register("fetch_availability", mailbox, true);
    expect(operationExecutorBinding("fetch_availability")).toEqual(mailbox);
    expect(operationExecutorBinding("unknown_tool")).toBeUndefined();
  });
});
