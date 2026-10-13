import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { wordDocumentOperationBinding } from "../wordDocumentOperationBinding";

describe("Word operation binding", () => {
  it("binds the document and pane without sending its URL", async () => {
    const document = "https://private.example/doc.docx";
    const binding = await wordDocumentOperationBinding(
      document,
      "device",
      "pane",
    );
    expect(binding).toEqual({
      device_id: "device",
      realm: "office-addin",
      host_context: {
        kind: "word_document",
        identity: createHash("sha256")
          .update(JSON.stringify([document, "pane"]))
          .digest("hex"),
      },
    });
    expect(JSON.stringify(binding)).not.toContain(document);
    expect(
      await wordDocumentOperationBinding(document, "device", "pane"),
    ).toEqual(binding);
    expect(
      await wordDocumentOperationBinding(document, "device", "reloaded-pane"),
    ).not.toEqual(binding);
    expect(
      await wordDocumentOperationBinding("other-document", "device", "pane"),
    ).not.toEqual(binding);
    expect(
      await wordDocumentOperationBinding(document, undefined, "pane"),
    ).toBeUndefined();
  });
});
