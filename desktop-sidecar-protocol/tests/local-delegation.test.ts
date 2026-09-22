import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { supportsStrictLocalDelegation } from "../typescript/src/localDelegation.js";
import { MockSidecar } from "../test-server/src/server.js";
import {
  validateLocalTaskStatus,
  validateLocalTasksStartV1Params,
  validateLocalTasksCancelV1Params,
  validateLocalTasksReviewV1Params,
  validateLocalExportsReadV1Params,
  validateLocalExportsAckV1Params,
  validateLocalContextClaims,
} from "../typescript/src/generated/validators.mjs";
import type { DiscoverResult } from "../typescript/src/generated/index.js";

const document = JSON.parse(
  await readFile(new URL("../openrpc.json", import.meta.url), "utf8"),
);
const start = JSON.parse(
  await readFile(
    new URL("../conformance/fixtures/local-delegation.json", import.meta.url),
    "utf8",
  ),
);
const handle = "h".repeat(43);
const contextHandle = "c".repeat(43);
const security = {
  profile: "strict_snapshot_v1",
  enforcement: "enforced",
  contextAuthentication: "pinned_backend_assertion_v1",
  consent: "native_exact_snapshot",
  recovery: "durable_receipt_v1",
  trustModel: "installed_native_code",
} as const;
function discovery(): DiscoverResult {
  const result: DiscoverResult = {
    protocolVersion: "1.0",
    serverInfo: { name: "test", version: "1" },
    instanceId: "test",
    document: structuredClone(document),
    localDelegation: { ...security },
  };
  for (const method of result.document.methods) {
    if (method.name.startsWith("local_"))
      method["x-erato-capability"]!.availability = { state: "enabled" };
  }
  return result;
}

describe("strict local delegation contract", () => {
  it("reserves every new method disabled and exposes no grant issuance", () => {
    const methods = document.methods.filter((m: { name: string }) =>
      m.name.startsWith("local_"),
    );
    expect(methods).toHaveLength(9);
    for (const method of methods)
      expect(method["x-erato-capability"].availability).toEqual({
        state: "disabled",
        reasonCode: "local_delegation_not_enabled",
      });
    expect(
      methods.some((m: { name: string }) => /approve|grant/.test(m.name)),
    ).toBe(false);
  });

  it("requires the exact security declaration and the complete enabled catalogue", () => {
    expect(supportsStrictLocalDelegation(discovery())).toBe(true);
    const legacy = discovery();
    delete legacy.localDelegation;
    expect(supportsStrictLocalDelegation(legacy)).toBe(false);
    const disabled = discovery();
    disabled.document = document;
    expect(supportsStrictLocalDelegation(disabled)).toBe(false);
    const unqualified = discovery();
    unqualified.localDelegation!.enforcement = "unavailable";
    expect(supportsStrictLocalDelegation(unqualified)).toBe(false);
    for (const name of document.methods
      .filter((m: { name: string }) => m.name.startsWith("local_"))
      .map((m: { name: string }) => m.name)) {
      const missing = discovery();
      missing.document.methods = missing.document.methods.filter(
        (m) => m.name !== name,
      );
      expect(supportsStrictLocalDelegation(missing), name).toBe(false);
      const duplicate = discovery();
      duplicate.document.methods.push(
        duplicate.document.methods.find((m) => m.name === name)!,
      );
      expect(supportsStrictLocalDelegation(duplicate), name).toBe(false);
    }
  });

  it.each([
    "subject",
    "sender",
    "filename",
    "folder",
    "snippet",
    "summary",
    "trace",
    "error",
    "count",
    "digest",
    "exportId",
  ])("rejects pre-consent %s metadata", (field) => {
    expect(validateLocalTaskStatus({ handle, state: "ready_for_review" })).toBe(
      true,
    );
    expect(
      validateLocalTaskStatus({
        handle,
        state: "ready_for_review",
        [field]: "SECRET_MARKER",
      }),
    ).toBe(false);
  });

  it("accepts the fixture and refuses unbounded, mutable or unknown operations", () => {
    expect(validateLocalTasksStartV1Params(start)).toBe(true);
    for (const plan of [
      { ...start.plan, operation: "run_code" },
      { ...start.plan, maxBytes: 12582913 },
      { ...start.plan, executionSeconds: 301 },
      { ...start.plan, queryVariants: [] },
      { ...start.plan, queryVariants: Array(9).fill("query") },
      { ...start.plan, path: "/private/cache" },
    ])
      expect(validateLocalTasksStartV1Params({ ...start, plan })).toBe(false);
    expect(
      validateLocalTasksStartV1Params({
        ...start,
        binding: { ...start.binding, deviceId: "" },
      }),
    ).toBe(false);
    expect(
      validateLocalTasksStartV1Params({ ...start, authorization: "approved" }),
    ).toBe(false);
  });

  it("cancels a logical binding after lost start acknowledgement without admitting mixed targets", () => {
    const bound = { contextHandle, binding: start.binding, plan: start.plan };
    expect(validateLocalTasksCancelV1Params(bound)).toBe(true);
    expect(validateLocalTasksCancelV1Params({ contextHandle, handle })).toBe(
      true,
    );
    for (const invalid of [
      { contextHandle },
      { ...bound, handle },
      { contextHandle, binding: start.binding },
      { ...bound, approved: true },
    ])
      expect(validateLocalTasksCancelV1Params(invalid)).toBe(false);
  });

  it("never accepts browser consent bits, preferences or grant credentials", () => {
    for (const validate of [
      validateLocalTasksReviewV1Params,
      validateLocalExportsReadV1Params,
    ]) {
      expect(validate({ contextHandle, handle })).toBe(true);
      for (const extra of [
        { approved: true },
        { alwaysAllow: true },
        { grant: "forged" },
        { accountId: "other" },
      ])
        expect(validate({ contextHandle, handle, ...extra })).toBe(false);
    }
    expect(
      validateLocalExportsAckV1Params({
        contextHandle,
        handle,
        uploaded: true,
      }),
    ).toBe(false);
    expect(
      validateLocalContextClaims({
        iss: "https://erato.example",
        aud: "erato-local-context-v1",
        sub: "a",
        origin: "https://app.example",
        deviceId: handle,
        challenge: handle,
        jti: handle,
        iat: 1,
        exp: 300,
        accessToken: "secret",
      }),
    ).toBe(false);
  });

  it("the reference server cannot authorize a forged export", async () => {
    const server = new MockSidecar({ allowedOrigins: ["https://app.example"] });
    const address = await server.start();
    try {
      const response = await fetch(address.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://app.example",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "test",
          method: "local_exports.read.v1",
          params: {
            contextHandle,
            handle,
            approved: true,
            secret: "SECRET_MARKER",
          },
        }),
      });
      const body = await response.text();
      expect(body).not.toContain("SECRET_MARKER");
      expect(JSON.parse(body).error.data.reasonCode).toBe(
        "local_delegation_not_enabled",
      );
    } finally {
      await server.stop();
    }
  });
});
