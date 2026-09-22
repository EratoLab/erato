import { i18n } from "@lingui/core";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readySnapshot } from "../../../test/mocks/word/authoringFixtures";
import { WordRichBlockPreview } from "../WordRichBlockPreview";

import type { WordPlanBlock } from "../../utils/wordDocumentPlan";

beforeEach(() => {
  i18n.load("en", {});
  i18n.activate("en");
});
afterEach(cleanup);

describe("rich Word formatting review", () => {
  it("shows run formatting and language while honoring explicit overrides to paragraph defaults", () => {
    const block: WordPlanBlock = {
      id: "p1",
      type: "paragraph",
      text: "Decorated Plain",
      format: {
        alignment: "right",
        spacingBefore: 6,
        spacingAfter: 12,
        indentLeft: 18,
        indentRight: 6,
        firstLineIndent: -6,
        lineSpacing: { rule: "multiple", value: 1.5 },
        shading: "DDEEFF",
        borders: { bottom: { style: "dotted", width: 1, color: "243B53" } },
        font: {
          bold: true,
          italic: true,
          fontFamily: "Aptos",
          fontSize: 18,
          language: "de-DE",
        },
      },
      runs: [
        {
          text: "Decorated",
          underlineStyle: "wave",
          strike: true,
          smallCaps: true,
          caps: true,
          color: "123456",
          highlight: "yellow",
          verticalAlign: "superscript",
          characterSpacing: 1.5,
        },
        {
          text: "Plain",
          bold: false,
          italic: false,
          underline: false,
          fontSize: 12,
          language: "fr-FR",
          verticalAlign: "baseline",
        },
      ],
    };
    render(<WordRichBlockPreview block={block} snapshot={readySnapshot()} />);
    const decorated = screen.getByText("Decorated"),
      plain = screen.getByText("Plain");
    expect(decorated).toHaveAttribute("lang", "de-DE");
    expect(decorated).toHaveStyle({
      fontFamily: "Aptos",
      fontSize: "1.5em",
      fontWeight: "bold",
      fontStyle: "italic",
      fontVariant: "small-caps",
      textTransform: "uppercase",
      color: "#123456",
      backgroundColor: "#FFFF00",
      textDecorationLine: "underline line-through",
      textDecorationStyle: "wavy",
      verticalAlign: "super",
      letterSpacing: "0.125em",
    });
    expect(plain).toHaveAttribute("lang", "fr-FR");
    expect(plain).toHaveStyle({
      fontWeight: "normal",
      fontStyle: "normal",
      fontSize: "1em",
      verticalAlign: "baseline",
    });
    expect(decorated.parentElement).toHaveStyle({
      textAlign: "right",
      marginBlockStart: "0.5em",
      marginBlockEnd: "1em",
      marginInlineStart: "1.5em",
      marginInlineEnd: "0.5em",
      textIndent: "-0.5em",
      lineHeight: "1.5",
      backgroundColor: "#DDEEFF",
      borderBottomStyle: "dotted",
    });
  });

  it("gives wide tables readable columns inside a keyboard-scrollable region", () => {
    const block: WordPlanBlock = {
      id: "table",
      type: "table",
      text: "",
      rows: [
        {
          cells: Array.from({ length: 8 }, (_, i) => ({
            blocks: [
              {
                id: `c${i}`,
                type: "paragraph" as const,
                text: `Column ${i + 1}`,
              },
            ],
          })),
        },
      ],
    };
    render(<WordRichBlockPreview block={block} snapshot={readySnapshot()} />);
    expect(
      screen.getByRole("region", { name: "Table contents" }),
    ).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("table")).toHaveStyle({ minWidth: "48em" });
  });

  it("uses the frontend DOCX paper surface while retaining explicit document colors", () => {
    const block: WordPlanBlock = {
      id: "table",
      type: "table",
      text: "",
      rows: [
        {
          cells: [
            {
              format: { shading: "EAF2F8" },
              blocks: [
                {
                  id: "p",
                  type: "paragraph",
                  text: "Document navy",
                  runs: [{ text: "Document navy", color: "243B53" }],
                },
              ],
            },
          ],
        },
      ],
    };
    const { container } = render(
      <WordRichBlockPreview block={block} snapshot={readySnapshot()} />,
    );
    expect(screen.getByRole("table")).toHaveClass(
      "docx-preview-theme",
      "word-rich-preview__paper",
    );
    expect(screen.getByRole("cell", { name: "Document navy" })).toHaveStyle({
      backgroundColor: "#EAF2F8",
    });
    expect(screen.getByText("Document navy")).toHaveStyle({ color: "#243B53" });
    expect(screen.getByText("Document navy").parentElement).toHaveClass(
      "docx-preview-theme",
    );
    expect(container.querySelector('[data-ui="card"]')).not.toHaveClass(
      "docx-preview-theme",
    );
  });
});
