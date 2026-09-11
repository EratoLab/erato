import { i18n } from "@lingui/core";
import { beforeAll, describe, expect, it } from "vitest";

import {
  isPolicyExcluded,
  validateStagedPart,
  type StagedPartTypePolicy,
} from "../validateStagedPart";

type Capability = StagedPartTypePolicy["capabilities"][number];

function capability(
  id: string,
  operations: Capability["operations"] = ["extract_text"],
): Capability {
  return { id, extensions: [], mime_types: [], operations };
}

const pdfOnly: StagedPartTypePolicy = {
  capabilities: [capability("pdf"), capability("other", [])],
  isLoading: false,
};

const limits = { maxBytes: 1_000, maxFormatted: "1 KB" };

const pdf = { filename: "Deck.pdf", mimeType: "application/pdf", size: 10 };
const zip = { filename: "build.zip", mimeType: "application/zip", size: 10 };

beforeAll(() => {
  i18n.activate("en");
});

describe("validateStagedPart", () => {
  it("passes every type while the capabilities are loading or absent", () => {
    expect(
      validateStagedPart(zip, limits, { capabilities: [], isLoading: true }),
    ).toEqual({ ok: true });
    expect(
      validateStagedPart(zip, limits, {
        capabilities: pdfOnly.capabilities,
        isLoading: true,
      }),
    ).toEqual({ ok: true });
    expect(
      validateStagedPart(zip, limits, { capabilities: [], isLoading: false }),
    ).toEqual({ ok: true });
  });

  it("accepts a part whose type the backend can read", () => {
    expect(validateStagedPart(pdf, limits, pdfOnly)).toEqual({ ok: true });
  });

  it("rejects a part the backend cannot read and marks it excluded", () => {
    const verdict = validateStagedPart(zip, limits, pdfOnly);
    expect(verdict).toEqual({
      ok: false,
      verdict: "unsupported",
      reason: "Won't be read by the AI",
    });
    expect(isPolicyExcluded(verdict)).toBe(true);
  });

  it("flags an oversized readable part without excluding it", () => {
    const verdict = validateStagedPart(
      { ...pdf, size: 1_001 },
      limits,
      pdfOnly,
    );
    expect(verdict).toEqual({
      ok: false,
      verdict: "too-large",
      reason: "File exceeds the server limit of 1 KB",
    });
    expect(isPolicyExcluded(verdict)).toBe(false);
  });

  it("reports an oversized unreadable part as unsupported, not too large", () => {
    expect(
      validateStagedPart({ ...zip, size: 1_001 }, limits, pdfOnly),
    ).toMatchObject({ verdict: "unsupported" });
  });

  it("skips the size check when the cap is unknown", () => {
    expect(
      validateStagedPart(
        { ...pdf, size: 5_000 },
        { maxBytes: 0, maxFormatted: "" },
        pdfOnly,
      ),
    ).toEqual({ ok: true });
  });
});
