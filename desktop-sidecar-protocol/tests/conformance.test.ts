import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  validateDiagnosticsEchoV1Params,
  validateDiscoveryDocument,
  validateJsonRpcEnvelope,
  validateOutlookListEmailsV1Params,
  validateOutlookListMailboxesV1Result,
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
