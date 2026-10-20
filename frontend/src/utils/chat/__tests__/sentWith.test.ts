import { i18n } from "@lingui/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  registerSentWithDescriptors,
  resetSentWithDescriptors,
  sentWithChipsFor,
} from "../sentWith";

import type { SentWithChip, SentWithDescriptor } from "../sentWith";

const documentChip = (label: string): SentWithChip => ({
  id: "word.document",
  kind: "word.document",
  icon: "document",
  label,
});

const userMessage = (
  facetId: string | undefined,
  args: Record<string, string> | undefined,
) => ({
  role: "user" as const,
  action_facet_id: facetId,
  action_facet_args: args,
});

describe("sentWithChipsFor", () => {
  afterEach(() => {
    resetSentWithDescriptors();
    vi.restoreAllMocks();
  });

  it("is empty for a facet no host registered", () => {
    expect(
      sentWithChipsFor(userMessage("word_document_review", { a: "1" })),
    ).toEqual([]);
  });

  it("is empty for an assistant message and for a message without a facet", () => {
    registerSentWithDescriptors({
      word_document_review: () => [documentChip("Report.docx")],
    });
    expect(
      sentWithChipsFor({
        role: "assistant",
        action_facet_id: "word_document_review",
        action_facet_args: { document_name: "Report.docx" },
      }),
    ).toEqual([]);
    expect(sentWithChipsFor(userMessage(undefined, undefined))).toEqual([]);
    expect(
      sentWithChipsFor(userMessage("word_document_review", undefined)),
    ).toEqual([]);
  });

  it("is empty when the descriptor says the facet carried no content", () => {
    registerSentWithDescriptors({ outlook_schedule: () => null });
    expect(
      sentWithChipsFor(userMessage("outlook_schedule", { now_iso: "x" })),
    ).toEqual([]);
  });

  it("is empty when the descriptor throws on an old row", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    registerSentWithDescriptors({
      word_selection: () => {
        throw new Error("bad row");
      },
    });
    expect(
      sentWithChipsFor(userMessage("word_selection", { selected_text: "x" })),
    ).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it("uses the latest registration for an id", () => {
    const args = { document_name: "Report.docx" };
    registerSentWithDescriptors({
      word_document_review: () => [documentChip("first")],
    });
    expect(
      sentWithChipsFor(userMessage("word_document_review", args))[0]?.label,
    ).toBe("first");
    registerSentWithDescriptors({
      word_document_review: () => [documentChip("second")],
    });
    expect(
      sentWithChipsFor(userMessage("word_document_review", args))[0]?.label,
    ).toBe("second");
  });

  it("builds once per args object, and again after a language switch", () => {
    const descriptor = vi.fn<SentWithDescriptor>((args) => [
      documentChip(args.document_name),
    ]);
    registerSentWithDescriptors({ word_document_review: descriptor });
    const args = { document_name: "Report.docx" };

    const first = sentWithChipsFor(userMessage("word_document_review", args));
    const second = sentWithChipsFor(userMessage("word_document_review", args));
    expect(second).toBe(first);
    expect(descriptor).toHaveBeenCalledTimes(1);

    const previous = i18n.locale;
    i18n.load("de", {});
    i18n.activate("de");
    try {
      sentWithChipsFor(userMessage("word_document_review", args));
      expect(descriptor).toHaveBeenCalledTimes(2);
    } finally {
      if (previous) {
        i18n.activate(previous);
      }
    }
  });

  it("rebuilds a message cached before its host registered", () => {
    const args = { document_name: "Report.docx" };
    expect(sentWithChipsFor(userMessage("word_document_review", args))).toEqual(
      [],
    );
    registerSentWithDescriptors({
      word_document_review: () => [documentChip("Report.docx")],
    });
    expect(
      sentWithChipsFor(userMessage("word_document_review", args)),
    ).toHaveLength(1);
  });
});
