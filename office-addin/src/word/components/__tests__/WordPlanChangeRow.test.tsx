import { i18n } from "@lingui/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  packageXml,
  paragraph,
  readySnapshot,
} from "../../../test/mocks/word/authoringFixtures";
import { buildWordPlanReview } from "../../utils/wordPlanReview";
import { WordPlanChangeRow } from "../WordPlanChangeRow";

import type {
  WordAuthoringSnapshot,
  WordDocumentPlan,
  WordPlanEntry,
} from "../../utils/wordDocumentPlan";
import type { WordPlanRow } from "../../utils/wordPlanReview";

const TABLE =
  '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>' +
  [
    ["Team", "Hours"],
    ["East", "18"],
    ["West", "18"],
  ]
    .map(
      (row) =>
        "<w:tr>" +
        row.map((c) => `<w:tc><w:tcPr/>${paragraph(c)}</w:tc>`).join("") +
        "</w:tr>",
    )
    .join("") +
  "</w:tbl>";
const plan = (
  snapshot: WordAuthoringSnapshot,
  entries: WordPlanEntry[],
  extra: Partial<WordDocumentPlan> = {},
): WordDocumentPlan => ({
  version: 1,
  snapshot: snapshot.token,
  readToken: "read-proof",
  scope: "body",
  entries,
  deleted: [],
  ...extra,
});
const renderRow = (
  row: WordPlanRow,
  snapshot?: WordAuthoringSnapshot,
  onLocate?: (ref: string) => void,
) =>
  render(
    <ul>
      <WordPlanChangeRow row={row} snapshot={snapshot} onLocate={onLocate} />
    </ul>,
  );

beforeEach(() => {
  i18n.load("en", {});
  i18n.activate("en");
});
afterEach(cleanup);

describe("WordPlanChangeRow", () => {
  it("shows a table-cell text edit as the new text with the old text struck", () => {
    const snapshot = readySnapshot(packageXml(paragraph("Allocation") + TABLE));
    const table = snapshot.blocks[1];
    const review = buildWordPlanReview(
      plan(snapshot, [
        { kind: "keep", source: ["b1"] },
        {
          kind: "replace",
          source: [table.ref],
          blocks: [
            {
              id: "t",
              type: "table",
              text: "",
              sourceRef: table.ref,
              rows: table.content!.rows.map((r) => ({
                sourceIndex: r.sourceIndex,
                cells: r.cells.map((c) => ({
                  sourceIndex: c.sourceIndex,
                  ...(r.sourceIndex === 2 && c.sourceIndex === 1
                    ? { textEdit: { expectedText: "18", text: "21" } }
                    : {}),
                })),
              })),
            },
          ],
        },
      ]),
      snapshot,
    );
    renderRow(review.rows.find((r) => r.family === "table")!, snapshot);
    const toggle = screen.getByRole("button", { expanded: false });
    expect(toggle).toHaveTextContent("3 × 2 · 1 cell changed");
    fireEvent.click(toggle);
    expect(screen.getByText("21").tagName).toBe("INS");
    expect(screen.getByText("18").tagName).toBe("DEL");
    expect(
      screen.getAllByRole("columnheader").map((th) => th.textContent),
    ).toEqual(["Team", "Hours"]);
    expect(screen.queryByText("East")).not.toBeInTheDocument();
    expect(screen.getByText("West")).toBeInTheDocument();
  });

  it("shows changed layout properties in centimetres, never points", () => {
    const snapshot = readySnapshot();
    snapshot.fullDocument = true;
    snapshot.sections = [
      {
        id: "s1",
        layout: { orientation: "portrait", width: 595.3, height: 841.9 },
        headers: {},
        footers: {},
        xml: "",
      },
    ];
    const review = buildWordPlanReview(
      plan(
        snapshot,
        snapshot.blocks.map((b) => ({ kind: "keep", source: [b.ref] })),
        {
          scope: "document",
          sections: [
            {
              id: "n1",
              source: "s1",
              layout: { orientation: "landscape", width: 841.9, height: 595.3 },
            },
          ],
        },
      ),
      snapshot,
    );
    renderRow(review.partsRows[0], snapshot);
    const toggle = screen.getByRole("button", { expanded: false });
    expect(toggle).toHaveTextContent("Page layout");
    expect(toggle).toHaveTextContent("3 settings changed");
    fireEvent.click(toggle);
    const detail = document.querySelector(".word-plan-row__layout")!;
    expect(detail).toHaveTextContent(
      "Page widthBefore: 21 cm → After: 29.7 cm",
    );
    expect(detail).toHaveTextContent(
      "OrientationBefore: Portrait → After: Landscape",
    );
    expect(detail.textContent).not.toMatch(/\bpt\b/);
  });

  it("says when previous layout values were not captured", () => {
    renderRow({
      key: "section:n2",
      family: "layout",
      status: "new",
      sectionId: "n2",
      beforeAvailable: false,
      changes: [
        { property: "columns", length: false, after: 2 },
        { property: "columnSpacing", length: true, after: 36 },
      ],
    });
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(
      screen.getByText(
        "Previous values were not captured; only the new settings are shown.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("1.27 cm")).toBeInTheDocument();
  });

  it("renders an object as one line without a disclosure", () => {
    const { container } = renderRow({
      key: "output:f",
      family: "object",
      status: "new",
      objectKind: "field",
      name: "PAGE",
    });
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(container.querySelector("li")).toHaveTextContent(
      "Document field · PAGENew",
    );
  });

  it("compares a document part's text before and after", () => {
    renderRow({
      key: "story:f1",
      family: "part",
      status: "changed",
      storyType: "footer",
      storyId: "f1",
      bindings: ["default", "first"],
      before: "Draft footer",
      after: "Final footer",
    });
    const toggle = screen.getByRole("button", { expanded: false });
    expect(toggle).toHaveTextContent("Footer");
    expect(toggle).toHaveTextContent("Default pages · First page");
    fireEvent.click(toggle);
    const [, original, proposed] = screen.getAllByRole("tab");
    fireEvent.click(original);
    expect(screen.getByText("Draft footer")).toBeInTheDocument();
    fireEvent.click(proposed);
    expect(screen.getByText("Final footer")).toBeInTheDocument();
  });

  it("collapses unchanged content into one counted line", () => {
    renderRow({
      key: "keep:b1",
      family: "unchanged",
      status: "unchanged",
      count: 4,
      paragraphs: 3,
      tables: 1,
      objects: 0,
    });
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(
      screen.getByText("3 paragraphs, 1 table unchanged"),
    ).toBeInTheDocument();
  });

  it("labels headings by level and locates the source passage in Word", () => {
    const snapshot = readySnapshot();
    const source = snapshot.blocks[0];
    source.paragraphOrdinal = 1;
    const onLocate = vi.fn();
    renderRow(
      {
        key: "output:h",
        family: "text",
        status: "changed",
        locateRef: source.ref,
        blockType: "heading",
        level: 2,
        before: source.text,
        after: { id: "h", type: "heading", level: 2, text: "Renamed" },
      },
      snapshot,
      onLocate,
    );
    const toggle = screen.getByRole("button", { expanded: false });
    expect(toggle).toHaveTextContent("Heading 2");
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("button", { name: "Show in Word" }));
    expect(onLocate).toHaveBeenCalledWith(source.ref);
    expect(screen.getAllByRole("tab")).toHaveLength(3);
  });
});
