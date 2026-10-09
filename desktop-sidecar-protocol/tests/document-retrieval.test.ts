import { describe, expect, it } from "vitest";
import {
  validateSourcesGetDocumentV1Params as params,
  validateSourcesGetDocumentV1Result as result,
} from "../typescript/src/generated/validators.mjs";

describe("document retrieval contract", () => {
  const documentId = "00000000-0000-0000-0000-000000000001";
  it("rejects malformed identities, unsupported scopes and caller paths", () => {
    expect(params({ documentId })).toBe(true);
    expect(params({ documentId, subject_scope: "subject_with_thread" })).toBe(
      true,
    );
    expect(params({ documentId: "/tmp/file" })).toBe(false);
    expect(params({ documentId, subject_scope: "everything" })).toBe(false);
    expect(params({ documentId, path: "/tmp/file" })).toBe(true);
  });
  it("accepts empty files and validates standard padded base64", () => {
    const metadata = { filename: "empty.txt", mimeType: "text/plain" };
    for (const contentBase64 of ["", "AA==", "AAA=", "AAAA"])
      expect(result({ ...metadata, contentBase64 })).toBe(true);
    for (const contentBase64 of ["A", "AA", "AA=", "!!!!", "AAAA\n"])
      expect(result({ ...metadata, contentBase64 })).toBe(false);
  });
  it("accepts open export warnings and rejects malformed ones", () => {
    const exported = {
      filename: "thread.eml",
      mimeType: "message/rfc822",
      contentBase64: "",
    };
    const warning = { code: "message_omitted", documentId };
    expect(
      result({
        ...exported,
        warnings: [
          { code: "body_preview_only", documentId, message: "Preview only." },
          { ...warning, sourceError: "source_changed", future: true },
          { code: "future_code" },
        ],
      }),
    ).toBe(true);
    for (const malformed of [
      { documentId },
      { ...warning, code: "" },
      { ...warning, documentId: "message-1" },
      { ...warning, sourceError: "" },
      { ...warning, message: "" },
    ])
      expect(result({ ...exported, warnings: [malformed] })).toBe(false);
  });
});
