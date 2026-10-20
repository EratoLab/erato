import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  registerSentWithDescriptors,
  resetSentWithDescriptors,
} from "@/utils/chat/sentWith";

import { useEditComposerContext } from "../useEditComposerContext";

import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const upload = (id: string, filename: string) =>
  ({ id, filename }) as FileUploadItem;

const args = { document_name: "Supply agreement.docx", paragraphs_total: "86" };
const message = {
  role: "user" as const,
  action_facet_id: "word_document_review",
  action_facet_args: args,
};

const registerDocument = () =>
  registerSentWithDescriptors({
    word_document_review: (stored) => [
      {
        id: "word.document",
        kind: "word.document",
        icon: "document",
        label: stored.document_name,
        meta: "86 ¶",
      },
    ],
  });

describe("useEditComposerContext", () => {
  afterEach(resetSentWithDescriptors);

  it("shows the stored facet as a locked, included chip that carries its estimate", () => {
    registerDocument();
    const files = [upload("o1", "budget.xlsx")];
    const { result } = renderHook(() =>
      useEditComposerContext({ message, files, onRemoveFiles: vi.fn() }),
    );

    const [item] = result.current.items;
    expect(item).toMatchObject({
      id: "sent-with:word.document",
      kind: "word.document",
      origin: "user",
      placement: "ambient",
      state: "included",
      label: "Supply agreement.docx",
      meta: "Sent as before",
      locked: true,
    });
    expect(item.lockReason).toMatch(/keeps the context it was sent with/);
    expect(item.estimate?.name).toBe("word_document_review.txt");
    expect(result.current.estimates).toEqual([item.estimate]);
    expect(result.current.slotFiles).toBe(files);
  });

  it("keeps the items, the slot files and the estimates across a re-render", () => {
    registerDocument();
    const files = [upload("o1", "budget.xlsx")];
    const onRemoveFiles = vi.fn();
    const { result, rerender } = renderHook(() =>
      useEditComposerContext({ message, files, onRemoveFiles }),
    );
    const first = result.current;

    rerender();
    expect(result.current.items).toBe(first.items);
    expect(result.current.slotFiles).toBe(first.slotFiles);
    expect(result.current.estimates).toBe(first.estimates);
  });

  it("shows nothing for a facet the server would drop, and nothing unregistered", () => {
    registerDocument();
    const { result } = renderHook(() =>
      useEditComposerContext({
        message,
        files: [],
        onRemoveFiles: vi.fn(),
        isActionFacetAvailable: (id) => id !== "word_document_review",
      }),
    );
    expect(result.current.items).toEqual([]);
    expect(result.current.estimates).toEqual([]);

    resetSentWithDescriptors();
    const unregistered = renderHook(() =>
      useEditComposerContext({ message, files: [], onRemoveFiles: vi.fn() }),
    );
    expect(unregistered.result.current.items).toEqual([]);
  });

  it("leaves claimed files out of the slot only while their chip sends them", () => {
    const transcript = upload("t1", "teams-Product_sync.md");
    const shared = upload("f1", "teams-file-abcd1234-report.pdf");
    const own = upload("o1", "budget.xlsx");
    const { result } = renderHook(() =>
      useEditComposerContext({
        message: { role: "user" },
        files: [transcript, shared, own],
        onRemoveFiles: vi.fn(),
      }),
    );
    // No preview URL: nothing to read, so the minted name decides.
    expect(result.current.items.map((item) => item.state)).toEqual([
      "included",
    ]);
    expect(result.current.slotFiles.map((file) => file.id)).toEqual(["o1"]);
    expect(result.current.estimates).toEqual([]);
  });
});
