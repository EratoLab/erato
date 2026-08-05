import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  validateDiagnosticsEchoV1Params,
  validateDiscoveryDocument,
  validateJsonRpcEnvelope,
  validateOutlookListEmailsV1Params,
  validateOutlookListMailboxesV1Result,
  validateSidecarProgressV1Params,
  validateSidecarProgressV1Result,
} from "../typescript/src/generated/validators.mjs";

interface InvalidMessageFixture {
  cases: { name: string; message: unknown; error: string }[];
}

describe("language-neutral conformance fixtures", () => {
  it("rejects every invalid message fixture", async () => {
    const fixture = await readFixture<InvalidMessageFixture>(
      "invalid-messages.json",
    );
    for (const testCase of fixture.cases) {
      expect(validateJsonRpcEnvelope(testCase.message), testCase.name).toBe(
        false,
      );
    }
  });

  it("accepts additive parameter fields but rejects a changed required type", () => {
    expect(
      validateDiagnosticsEchoV1Params({
        message: "hello",
        futureOptionalField: true,
      }),
    ).toBe(true);
    expect(validateDiagnosticsEchoV1Params({ message: 42 })).toBe(false);
  });

  it("accepts unknown future availability values without enabling them", async () => {
    const document = JSON.parse(
      await readFile(new URL("../openrpc.json", import.meta.url), "utf8"),
    );
    const echoMethod = document.methods.find(
      (method: { name?: string }) => method.name === "diagnostics.echo.v1",
    );
    echoMethod["x-erato-capability"].availability = {
      state: "requires_interaction",
      futureField: true,
    };

    expect(validateDiscoveryDocument(document)).toBe(true);
  });

  it("validates the sidecar.progress.v1 boundary", () => {
    expect(validateSidecarProgressV1Params({ requestId: "c-123" })).toBe(true);
    expect(validateSidecarProgressV1Params({ requestId: 7 })).toBe(true);
    expect(validateSidecarProgressV1Params({})).toBe(false);
    expect(validateSidecarProgressV1Params({ requestId: "" })).toBe(false);
  });

  it("accepts progress results for both rollout directions", () => {
    // A sidecar that does not track the request answers with a bare state.
    expect(validateSidecarProgressV1Result({ state: "unknown" })).toBe(true);
    // Unknown future states and additive fields stay valid; receivers treat
    // unrecognized states as running.
    expect(
      validateSidecarProgressV1Result({
        state: "futureState",
        futureField: { revision: 2 },
      }),
    ).toBe(true);
    // A running request returns the log so far, including nested work and a
    // superseding update for a step already reported.
    expect(
      validateSidecarProgressV1Result({
        state: "running",
        trace: {
          steps: [
            {
              sequence: 0,
              id: "delay",
              status: "running",
              startedAtOffsetMs: 0,
            },
            { sequence: 1, id: "readEmail", status: "ok", parentSequence: 0 },
            { sequence: 0, id: "delay", status: "ok", durationMs: 120 },
          ],
        },
      }),
    ).toBe(true);
    // The state is required, and a step without its sequence identity is
    // rejected.
    expect(validateSidecarProgressV1Result({ trace: { steps: [] } })).toBe(
      false,
    );
    expect(
      validateSidecarProgressV1Result({
        state: "finished",
        trace: { steps: [{ id: "delay", status: "ok" }] },
      }),
    ).toBe(false);
  });

  it("bounds the diagnostic echo delay", () => {
    expect(
      validateDiagnosticsEchoV1Params({ message: "hi", delayMs: 250 }),
    ).toBe(true);
    expect(
      validateDiagnosticsEchoV1Params({ message: "hi", delayMs: 60001 }),
    ).toBe(false);
    expect(
      validateDiagnosticsEchoV1Params({ message: "hi", delayMs: -1 }),
    ).toBe(false);
  });

  it("validates the Outlook action boundary", () => {
    expect(
      validateOutlookListEmailsV1Params({
        mailboxId: "8b7d2f4a6c9e1035d8a1b2c3e4f50617",
      }),
    ).toBe(true);
    expect(validateOutlookListEmailsV1Params({ mailboxId: "" })).toBe(false);
    expect(
      validateOutlookListMailboxesV1Result({
        mailboxes: [
          {
            id: "8b7d2f4a6c9e1035d8a1b2c3e4f50617",
            displayName: "Work",
            emailAddress: "work@example.com",
            profileName: "Work Profile",
            source: "windowsOutlook",
          },
        ],
        warnings: [],
      }),
    ).toBe(true);
  });
});

async function readFixture<T>(name: string): Promise<T> {
  return JSON.parse(
    await readFile(
      new URL(`../conformance/fixtures/${name}`, import.meta.url),
      "utf8",
    ),
  ) as T;
}
