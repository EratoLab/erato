import { describe, expect, it } from "vitest";

import { resolveWordWriteGate } from "../wordWriteGate";

import type { WordDocumentCapture } from "../wordDocumentCapture";

const IDENTITY = "https://contoso.sharepoint.com/report.docx";

const capture = (identity = IDENTITY): WordDocumentCapture => ({
  identity,
  ordinalMap: new Map([[1, { uniqueLocalId: "id-1", text: "Alpha." }]]),
  paragraphsSent: 1,
  renderedOrdinals: new Set([1]),
  partialOrdinal: null,
});

describe("resolveWordWriteGate", () => {
  it("allows a matching identity with a known capture", () => {
    const gate = resolveWordWriteGate({
      capture: capture(),
      expectedIdentity: IDENTITY,
      currentIdentity: IDENTITY,
    });

    expect(gate).toEqual({ allowed: true, capture: capture() });
  });

  it("blocks after a pane reload, with a stated reason and no fallback", () => {
    expect(
      resolveWordWriteGate({
        capture: undefined,
        expectedIdentity: IDENTITY,
        currentIdentity: IDENTITY,
      }),
    ).toEqual({ allowed: false, reason: "no-capture" });
  });

  it("blocks when the pane has a different document open", () => {
    expect(
      resolveWordWriteGate({
        capture: capture(),
        expectedIdentity: IDENTITY,
        currentIdentity: "pane-session:2f0c",
      }),
    ).toEqual({ allowed: false, reason: "identity-mismatch" });
  });

  it.each([
    ["the send-time identity is unknown", undefined, IDENTITY],
    ["the current identity is unknown", IDENTITY, null],
    ["both are unknown", undefined, null],
  ])("fails closed when %s", (_name, expectedIdentity, currentIdentity) => {
    expect(
      resolveWordWriteGate({
        capture: capture(),
        expectedIdentity,
        currentIdentity,
      }),
    ).toEqual({ allowed: false, reason: "identity-mismatch" });
  });

  it("blocks when the capture was taken against a different document", () => {
    // The stamp and the pane agree, but the capture came from elsewhere —
    // the ordinals would resolve against the wrong snapshot.
    expect(
      resolveWordWriteGate({
        capture: capture("pane-session:old"),
        expectedIdentity: IDENTITY,
        currentIdentity: IDENTITY,
      }),
    ).toEqual({ allowed: false, reason: "identity-mismatch" });
  });
});
