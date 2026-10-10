import { afterEach, describe, expect, it } from "vitest";

import { WORD_REPLACE_FENCE as WEB_REPLACE_FENCE } from "../../../../../frontend/src/lib/wordReview/wordHistoryNames";
import {
  parseWordKeptItems,
  wordSelectionReplyOriginal,
  wordSelectionReplyProposal,
  wordSelectionWithoutMarkers,
} from "../../../../../frontend/src/lib/wordReview/wordSelectionReply";
import {
  installWordSelectionHost,
  SV2_MAIN_DOCUMENT,
  uninstallWordSelectionHost,
} from "../../../test/mocks/word/selectionHost";
import { wordSelectionWithoutKeptItems } from "../wordSelectionAnchor";
import {
  WORD_SELECTION_ARG_KEYS,
  wordKeptItemsArg,
  wordSelectionFacetArgs,
} from "../wordSelectionArgs";
import { captureWordSelection } from "../wordSelectionCapture";
import {
  splitWordSelectionReplacement,
  WORD_REPLACE_FENCE,
} from "../wordSelectionEdit";

import type { MockSelectionTarget } from "../../../test/mocks/word/selectionHost";
import type {
  WordSelectionShape,
  WordSelectionSnapshot,
} from "../wordSelectionAnchor";
import type { WordKeptMarker } from "../wordSelectionItems";

afterEach(() => uninstallWordSelectionHost());

async function captured(target: MockSelectionTarget) {
  const host = installWordSelectionHost(SV2_MAIN_DOCUMENT, { host: "pc" });
  host.select(target);
  const read = await captureWordSelection();
  if (read.status !== "ok" || !read.value) throw new Error("no capture");
  return read.value;
}

const marker = (
  number: number,
  kind: WordKeptMarker["kind"],
  end: WordKeptMarker["end"],
  shows = "",
): WordKeptMarker => ({ number, kind, end, shows, detail: "" });

const withMarkers = (...paragraphs: WordKeptMarker[][]) =>
  ({
    paragraphs: paragraphs.map((markers) => ({
      kept: { text: "", markers, kinds: [] },
    })),
  }) as unknown as WordSelectionSnapshot;

describe("Word selection replies read in the Erato web app", () => {
  it("reads every kind and end of kept_items as the add-in writes them", () => {
    const selection = withMarkers(
      [
        marker(1, "field", "point", 'Say "hi"\u0001'),
        marker(2, "note", "point", "\u0002"),
        marker(3, "picture", "point"),
        marker(4, "break", "point", "\u000B"),
        marker(5, "link", "open"),
        marker(5, "link", "close"),
        marker(6, "control", "open"),
        marker(6, "control", "close"),
        marker(7, "bookmark", "open"),
        marker(7, "bookmark", "close"),
      ],
      [
        marker(8, "comment", "close"),
        marker(9, "comment", "point"),
        marker(10, "comment", "open"),
      ],
    );
    const markers = selection.paragraphs.flatMap((p) => p.kept!.markers);

    const notes = parseWordKeptItems(wordKeptItemsArg(selection));

    expect(notes.size).toBe(10);
    for (const { number, kind, end, shows } of markers)
      expect(notes.get(number)).toEqual({
        kind,
        point: end === "point",
        shows: end === "point" ? shows.replace(/[\u0000-\u001F]/gu, "") : "",
      });
  });

  it("reads each format span with its emphasis in the add-in's words", () => {
    const selection = {
      paragraphs: [
        {
          kept: {
            text: "",
            markers: [marker(2, "field", "point", "3")],
            kinds: [],
          },
          formats: {
            text: "",
            spans: [
              { number: 1, emphasis: { bold: true, italic: false } },
              { number: 3, emphasis: { underline: "Double" } },
            ],
          },
        },
        {
          formats: {
            text: "",
            spans: [
              { number: 4, emphasis: { underline: "None" } },
              { number: 5, emphasis: { strikeThrough: true } },
            ],
          },
        },
      ],
    } as unknown as WordSelectionSnapshot;

    const notes = parseWordKeptItems(wordKeptItemsArg(selection));

    expect([...notes.entries()]).toEqual([
      [
        1,
        {
          kind: "format",
          point: false,
          shows: "",
          formatting: ["bold", "not italic"],
        },
      ],
      [2, { kind: "field", point: true, shows: "3" }],
      [
        3,
        { kind: "format", point: false, shows: "", formatting: ["underline"] },
      ],
      [
        4,
        {
          kind: "format",
          point: false,
          shows: "",
          formatting: ["no underline"],
        },
      ],
      [
        5,
        {
          kind: "format",
          point: false,
          shows: "",
          formatting: ["strikethrough"],
        },
      ],
    ]);
  });

  it.each<MockSelectionTarget>([
    { p: "MX1" },
    { p: "CM1" },
    { p: "FN1" },
    { p: "PC1" },
    { p: "MX1", to: { p: "FD1" } },
  ])(
    "copies the passage %j without markers as the context-only fallback words it",
    async (target) => {
      const selection = await captured(target);
      expect(selection.selectedText).toMatch(/\u27E6/u);

      const notes = parseWordKeptItems(wordKeptItemsArg(selection));

      expect(wordSelectionWithoutMarkers(selection.selectedText, notes)).toBe(
        wordSelectionWithoutKeptItems(selection).selectedText,
      );
    },
  );

  it("compares against the selection the request stored", async () => {
    const selection = await captured({ p: "MX1", to: { p: "FD1" } });
    const args = wordSelectionFacetArgs(
      { documentName: "Report.docx", documentIdentity: "doc-1", selection },
      new Set(WORD_SELECTION_ARG_KEYS),
    );

    expect(wordSelectionReplyOriginal(args)).toBe(selection.selectedText);
  });

  it.each<[string, WordSelectionShape, number]>([
    ["One\r\nTwo\rThree\n", "multi_paragraph", 3],
    ["One\u2028Two", "multi_paragraph", 2],
    ["\n Alpha \n\n bravo\t\n", "paragraph", 1],
    ["quick\u2029brown", "inline", 1],
  ])("shows %j as the add-in would write it", (content, shape, count) => {
    const split = splitWordSelectionReplacement(content, shape, count);
    if (!("lines" in split)) throw new Error(split.refused);

    expect(wordSelectionReplyProposal(content, shape)).toBe(
      split.lines.join("\n"),
    );
  });

  it("cards the fence the add-in replaces with", () => {
    expect(WEB_REPLACE_FENCE).toBe(WORD_REPLACE_FENCE);
  });
});
