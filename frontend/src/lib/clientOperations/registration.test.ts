import { afterEach, describe, expect, it } from "vitest";

import {
  additionalOperationBindings,
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
const document: ExecutorBinding = {
  device_id: "pane-device-000000",
  realm: "office-addin",
  host_context: { kind: "word_document", identity: "b".repeat(64) },
};
const desktop: ExecutorBinding = {
  device_id: "pane-device-000000",
  realm: "desktop-sidecar",
  host_context: { kind: "desktop_sidecar", identity: "local" },
};
const SIDECAR_TOOLS = [
  "get_sidecar_document",
  "read_sidecar_conversation",
  "search_sidecar_index",
];

const cleanups: (() => void)[] = [];
function register(
  name: string,
  binding: ExecutorBinding | undefined,
  yields = false,
) {
  cleanups.push(registerOperationExecutor(name, () => binding, { yields }));
}
function registerAdditional(
  name: string,
  binding: ExecutorBinding | undefined,
) {
  cleanups.push(
    registerOperationExecutor(name, () => binding, { additional: true }),
  );
}
/** The headers before additional executors existed, for one registry. */
function headersWithout(register: () => void) {
  register();
  const before = operationExecutorHeaders();
  cleanups.splice(0).forEach((cleanup) => cleanup());
  return before;
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

describe("additional executors", () => {
  it.each<[string, () => void]>([
    [
      "Outlook",
      () => {
        register("fetch_availability", mailbox, true);
      },
    ],
    [
      "Word",
      () => {
        register("read_document_blocks", document, true);
        register("submit_document_plan", document, true);
      },
    ],
    [
      "strict local evidence",
      () => {
        register("local_collect_evidence", sidecar);
        register("fetch_availability", mailbox, true);
      },
    ],
  ])("never change X-Erato-Executor beside %s", (_host, registerHost) => {
    const before = headersWithout(registerHost);
    registerHost();
    SIDECAR_TOOLS.forEach((name) => registerAdditional(name, desktop));
    const { "X-Erato-Additional-Executors": additional, ...rest } =
      operationExecutorHeaders();
    expect(rest).toEqual(before);
    expect(JSON.parse(additional ?? "[]")).toEqual([desktop]);
  });

  it("sends no additional header while no additional binding is ready", () => {
    register("fetch_availability", mailbox, true);
    SIDECAR_TOOLS.forEach((name) => registerAdditional(name, undefined));
    expect(operationExecutorHeaders()).not.toHaveProperty(
      "X-Erato-Additional-Executors",
    );
    expect(additionalOperationBindings()).toEqual([]);
  });

  it("lists an additional binding without a primary one", () => {
    registerAdditional("search_sidecar_index", desktop);
    expect(operationExecutorHeaders()).toEqual({
      "X-Erato-Additional-Executors": JSON.stringify([desktop]),
    });
  });

  it("keeps one binding per host kind, never the primary's kind", () => {
    register("fetch_availability", mailbox, true);
    registerAdditional("search_sidecar_index", desktop);
    registerAdditional("other_sidecar_tool", {
      ...desktop,
      device_id: "other-device-000000",
    });
    registerAdditional("other_mailbox_tool", {
      ...mailbox,
      host_context: { kind: "outlook_mailbox", identity: "c".repeat(64) },
    });
    expect(
      JSON.parse(operationExecutorHeaders()["X-Erato-Additional-Executors"]!),
    ).toEqual([desktop]);
  });

  it("names the tools registered with each additional binding", () => {
    register("fetch_availability", mailbox, true);
    [...SIDECAR_TOOLS]
      .reverse()
      .forEach((name) => registerAdditional(name, desktop));
    expect(additionalOperationBindings()).toEqual([
      { binding: desktop, names: SIDECAR_TOOLS },
    ]);
    expect(operationExecutorBinding("search_sidecar_index")).toEqual(desktop);
  });
});
