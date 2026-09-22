import { i18n } from "@lingui/core";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  packageXml,
  paragraph,
  readySnapshot,
} from "../../../test/mocks/word/authoringFixtures";
import { mixedAuthoringXml } from "../../../test/mocks/word/mixedAuthoringFixtures";
import { parseWordBlock } from "../../utils/wordRichPlan";
import { WordRichBlockPreview } from "../WordRichBlockPreview";

import type { WordPlanBlock } from "../../utils/wordDocumentPlan";

const p = (id: string, text: string) => ({ id, type: "paragraph", text });
const snapshot = () => readySnapshot(packageXml(paragraph("Source text")));
const preview = (value: unknown, source = snapshot()) => {
  const block = parseWordBlock(value);
  expect(block).not.toBeNull();
  return render(<WordRichBlockPreview block={block!} snapshot={source} />);
};
beforeEach(() => {
  i18n.load("en", {});
  i18n.activate("en");
});
afterEach(cleanup);

describe("rich Word approval previews", () => {
  it("shows retained cell contents beside a changed cell using the shared Card", () => {
    const source = readySnapshot(mixedAuthoringXml());
    const table = source.blocks.find((b) => b.nativeKind === "table")!;
    const { container } = preview(
      {
        id: "t1",
        type: "table",
        sourceRef: table.ref,
        rows: [
          {
            sourceIndex: 0,
            format: { repeatHeader: true },
            cells: [{ sourceIndex: 0 }, { sourceIndex: 1 }],
          },
          {
            sourceIndex: 1,
            cells: [
              { sourceIndex: 0 },
              { sourceIndex: 1, blocks: [p("budget", "€48,000")] },
            ],
          },
        ],
      },
      source,
    );
    expect(screen.getByRole("table")).toHaveAccessibleName(
      "Table 2 rows · 2 columns",
    );
    expect(
      screen.getByRole("columnheader", {
        name: "Region Existing content retained",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("North")).toBeInTheDocument();
    expect(screen.getByText("€48,000")).toBeInTheDocument();
    expect(screen.queryByText("€42,000")).not.toBeInTheDocument();
    expect(screen.getAllByText("Existing content retained")).toHaveLength(3);
    expect(container.querySelector('[data-ui="card"]')).toBeInTheDocument();
  });

  it("renders merged cells, headings, formatting and ordered lists in new tables", () => {
    preview({
      id: "t1",
      type: "table",
      columns: [100, 100, 100],
      rows: [
        {
          cells: [
            {
              colSpan: 2,
              rowSpan: 2,
              format: { shading: "CCDDFF" },
              blocks: [
                {
                  id: "title",
                  type: "heading",
                  level: 2,
                  text: "Recommendation",
                },
              ],
            },
            {
              blocks: [
                {
                  id: "l1",
                  type: "list-item",
                  list: "list1",
                  level: 0,
                  ordered: true,
                  text: "First",
                },
              ],
            },
          ],
        },
        {
          cells: [
            {
              blocks: [
                {
                  id: "l2",
                  type: "list-item",
                  list: "list2",
                  level: 0,
                  ordered: true,
                  text: "Second",
                },
              ],
            },
          ],
        },
      ],
    });
    const cell = screen.getByRole("cell", { name: "Recommendation" });
    expect(cell).toHaveAttribute("colspan", "2");
    expect(cell).toHaveAttribute("rowspan", "2");
    expect(cell).toHaveStyle({ backgroundColor: "#CCDDFF" });
    expect(within(cell).getByRole("heading", { level: 2 })).toBeInTheDocument();
    expect(screen.getByText("First")).toBeInTheDocument();
    expect(screen.getByText("Second")).toBeInTheDocument();
  });

  it("distinguishes an explicit cell clear from retaining existing content", () => {
    const source = readySnapshot(mixedAuthoringXml());
    const table = source.blocks.find((b) => b.nativeKind === "table")!;
    preview(
      {
        id: "clear-cell",
        type: "table",
        sourceRef: table.ref,
        rows: [
          {
            sourceIndex: 1,
            cells: [{ sourceIndex: 0 }, { sourceIndex: 1, blocks: [] }],
          },
        ],
      },
      source,
    );
    expect(screen.getByText("North")).toBeInTheDocument();
    expect(screen.getByText("Empty cell")).toBeInTheDocument();
    expect(screen.getAllByText("Existing content retained")).toHaveLength(1);
    expect(screen.queryByText("€42,000")).not.toBeInTheDocument();
  });

  it("uses data from the captured Word image and shows its requested dimensions", () => {
    const source = readySnapshot(mixedAuthoringXml());
    const image = source.blocks.find((b) => b.nativeKind === "image")!;
    preview(
      {
        id: "picture",
        type: "image",
        image: {
          sourceRef: image.ref,
          widthPt: 144,
          heightPt: 72,
          alt: "Pilot logo",
        },
      },
      source,
    );
    const img = screen.getByRole("img", { name: "Pilot logo" });
    expect(img.tagName).toBe("IMG");
    expect(img.getAttribute("src")).toMatch(/^data:image\/png;base64,iVBOR/);
    expect(screen.getByText("144 × 72 pt")).toBeInTheDocument();
  });

  it("uses captured attachment bytes for asset references", () => {
    const source = snapshot();
    const base64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=";
    source.assets = [
      {
        ref: "asset_1",
        fileId: "file1",
        name: "logo.png",
        mime: "image/png",
        base64,
        widthPx: 1,
        heightPx: 1,
        sizeBytes: 68,
      },
    ];
    preview(
      {
        id: "asset",
        type: "image",
        image: { assetRef: "asset_1", alt: "Uploaded logo" },
      },
      source,
    );
    expect(screen.getByRole("img", { name: "Uploaded logo" })).toHaveAttribute(
      "src",
      `data:image/png;base64,${base64}`,
    );
  });

  it("never renders arbitrary model image URLs or SVG payloads", () => {
    const block = {
      id: "bad",
      type: "image",
      text: "",
      image: {
        alt: "Unavailable image",
        data: { mime: "image/svg+xml", base64: "PHN2Zz4=" },
        url: "https://attacker.invalid/track",
      },
    } as unknown as WordPlanBlock;
    const { container } = render(
      <WordRichBlockPreview block={block} snapshot={snapshot()} />,
    );
    expect(container.querySelector("img")).not.toBeInTheDocument();
    expect(container.innerHTML).not.toContain("attacker.invalid");
    expect(screen.getByRole("img", { name: "Unavailable image" }).tagName).toBe(
      "DIV",
    );
  });

  it("shows nested content controls and field values without JSON or XML", () => {
    const { container } = preview({
      id: "control",
      type: "content-control",
      control: {
        title: "Client",
        children: [
          p("client", "Example client"),
          {
            id: "field",
            type: "field",
            field: { instruction: "NUMPAGES", text: "12" },
          },
        ],
      },
    });
    expect(screen.getByText("Client")).toBeInTheDocument();
    expect(screen.getByText("Example client")).toBeInTheDocument();
    expect(screen.getByText("Document field")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(container.textContent).not.toContain('"type":');
    expect(container.textContent).not.toContain("<w:");
  });

  it("shows requested native updates and removal instead of the old protected-object explanation", () => {
    const source = readySnapshot(mixedAuthoringXml());
    const field = source.blocks.find((b) => b.nativeKind === "field")!;
    preview(
      {
        id: "field-edit",
        type: "native-edit",
        sourceRef: field.ref,
        edits: [
          {
            kind: "field",
            target: "field-1",
            operation: "update",
            text: "New client",
            instruction: "MERGEFIELD Client",
          },
        ],
      },
      source,
    );
    expect(screen.getByText("Update Document field")).toBeInTheDocument();
    expect(screen.getByText("New client")).toBeInTheDocument();
    expect(screen.queryByText(/protected/i)).not.toBeInTheDocument();
  });
});
