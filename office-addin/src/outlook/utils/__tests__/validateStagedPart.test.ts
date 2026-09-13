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
  extensions: string[],
  mime_types: string[],
  operations: Capability["operations"] = ["extract_text"],
): Capability {
  return { id, extensions, mime_types, operations };
}

// Mirrors the backend's capability table, in its priority order.
function backendCapabilities({
  audio = true,
}: { audio?: boolean } = {}): Capability[] {
  return [
    capability(
      "word",
      ["doc", "docx"],
      [
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ],
    ),
    capability("pdf", ["pdf"], ["application/pdf"]),
    capability(
      "excel",
      ["xls", "xlsx"],
      [
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ],
    ),
    capability(
      "powerpoint",
      ["ppt", "pptx"],
      [
        "application/vnd.ms-powerpoint",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      ],
    ),
    capability("email", ["eml"], ["message/rfc822"]),
    capability(
      "text",
      ["txt", "md", "markdown", "json", "xml", "csv", "html", "htm"],
      [
        "text/plain",
        "text/markdown",
        "application/json",
        "application/xml",
        "text/xml",
        "text/csv",
        "text/html",
      ],
    ),
    capability(
      "image",
      ["jpg", "jpeg", "png", "gif", "webp", "bmp", "tiff", "tif"],
      ["image/*"],
      ["analyze_image"],
    ),
    capability(
      "audio",
      ["mp3", "m4a", "wav", "aac", "flac", "ogg", "oga", "opus", "webm", "mp4"],
      ["audio/*"],
      audio ? ["extract_text"] : [],
    ),
    capability("other", ["*"], ["*/*"], []),
  ];
}

const backend: StagedPartTypePolicy = {
  capabilities: backendCapabilities(),
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
        capabilities: backend.capabilities,
        isLoading: true,
      }),
    ).toEqual({ ok: true });
    expect(
      validateStagedPart(zip, limits, { capabilities: [], isLoading: false }),
    ).toEqual({ ok: true });
  });

  it("accepts a part whose type the backend can read", () => {
    expect(validateStagedPart(pdf, limits, backend)).toEqual({ ok: true });
  });

  it("accepts every extension the backend's text capability lists", () => {
    for (const [filename, mimeType] of [
      ["Deck.html", "text/html"],
      ["page.HTM", "text/html"],
      ["data.json", "application/json"],
      ["notes.xml", "application/xml"],
      ["table.csv", "text/csv"],
    ]) {
      expect(
        validateStagedPart({ filename, mimeType, size: 10 }, limits, backend),
      ).toEqual({ ok: true });
    }
  });

  it("follows the model's audio support", () => {
    const voice = { filename: "voice.mp3", mimeType: "audio/mpeg", size: 10 };
    expect(validateStagedPart(voice, limits, backend)).toEqual({ ok: true });
    expect(
      validateStagedPart(voice, limits, {
        capabilities: backendCapabilities({ audio: false }),
        isLoading: false,
      }),
    ).toMatchObject({ verdict: "unsupported" });
  });

  it("matches an extension-less part by its MIME type", () => {
    expect(
      validateStagedPart(
        { filename: "inline-body", mimeType: "text/html", size: 10 },
        limits,
        backend,
      ),
    ).toEqual({ ok: true });
    expect(
      validateStagedPart(
        { filename: "image001", mimeType: "image/png", size: 10 },
        limits,
        backend,
      ),
    ).toEqual({ ok: true });
    expect(
      validateStagedPart(
        { filename: "blob", mimeType: "", size: 10 },
        limits,
        backend,
      ),
    ).toMatchObject({ verdict: "unsupported" });
  });

  it("rejects a part the backend cannot read and marks it excluded", () => {
    const verdict = validateStagedPart(zip, limits, backend);
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
      backend,
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
      validateStagedPart({ ...zip, size: 1_001 }, limits, backend),
    ).toMatchObject({ verdict: "unsupported" });
  });

  it("skips the size check when the cap is unknown", () => {
    expect(
      validateStagedPart(
        { ...pdf, size: 5_000 },
        { maxBytes: 0, maxFormatted: "" },
        backend,
      ),
    ).toEqual({ ok: true });
  });
});
