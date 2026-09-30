import { i18n } from "@lingui/core";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TestTheme } from "../../../test/helpers/TestTheme";
import { readySnapshot } from "../../../test/mocks/word/authoringFixtures";
import { buildWordPlanReview } from "../../utils/wordPlanReview";
import { WordDocumentPlanReview } from "../WordDocumentPlanReview";

import type {
  WordAuthoringSnapshot,
  WordDocumentPlan,
} from "../../utils/wordDocumentPlan";

function scenario() {
  const snapshot = readySnapshot();
  snapshot.stories = [
    {
      id: "header-1",
      type: "header",
      text: "Existing header",
      xml: "",
      part: "/word/header1.xml",
    },
    {
      id: "footer-1",
      type: "footer",
      text: "Existing footer",
      xml: "",
      part: "/word/footer1.xml",
    },
  ];
  snapshot.sections = [
    {
      id: "section-1",
      xml: "",
      headers: { default: "header-1" },
      footers: { default: "footer-1" },
      layout: {
        orientation: "portrait",
        width: 612,
        height: 792,
        columns: 2,
        columnSpacing: 18,
        margins: { top: 72, bottom: 72, left: 54, right: 54 },
      },
    },
  ];
  const plan: WordDocumentPlan = {
    version: 1,
    snapshot: snapshot.token,
    readToken: "read-proof",
    scope: "document",
    entries: [
      { kind: "keep", source: snapshot.blocks.map((block) => block.ref) },
    ],
    deleted: [],
  };
  return { snapshot, plan };
}
function mount(plan: WordDocumentPlan, snapshot: WordAuthoringSnapshot) {
  return render(
    <WordDocumentPlanReview
      plan={plan}
      snapshot={snapshot}
      review={buildWordPlanReview(plan, snapshot)}
    />,
    { wrapper: TestTheme },
  );
}
const partsSection = () =>
  screen.getByRole("heading", { name: "Document parts" }).closest("section")!;

beforeEach(() => {
  i18n.load("en", {});
  i18n.activate("en");
});
afterEach(cleanup);

describe("Word document parts and layout review", () => {
  it("shows only the changed page settings in centimetres, never points", () => {
    const { snapshot, plan } = scenario();
    const before = JSON.stringify(snapshot.sections);
    plan.sections = [
      {
        id: "section-1",
        source: "section-1",
        layout: { orientation: "landscape", margins: { top: 42 } },
      },
    ];
    const { container } = mount(plan, snapshot);
    expect(screen.getByText("Layout")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Update page layout" }),
    ).toBeInTheDocument();
    fireEvent.click(
      within(partsSection()).getByRole("button", { name: /Page layout/ }),
    );
    expect(screen.getByText("Top margin").parentElement).toHaveTextContent(
      /2\.54 cm\s*→\s*1\.48 cm/,
    );
    expect(screen.getByText("Orientation").parentElement).toHaveTextContent(
      /Portrait\s*→\s*Landscape/,
    );
    expect(screen.queryByText("Bottom margin")).toBeNull();
    expect(container).not.toHaveTextContent(/\d pt\b/);
    expect(JSON.stringify(snapshot.sections)).toBe(before);
  });

  it("names a cleared header and an emptied footer instead of old content", () => {
    const { snapshot, plan } = scenario();
    plan.stories = [
      { id: "footer-1", type: "footer", kind: "upsert", blocks: [] },
    ];
    plan.sections = [
      {
        id: "section-1",
        source: "section-1",
        headers: { default: null },
        layout: { differentFirstPage: true },
      },
    ];
    mount(plan, snapshot);
    fireEvent.click(
      within(partsSection()).getByRole("button", { name: /Page layout/ }),
    );
    expect(
      screen.getByText("Header · Default pages").parentElement,
    ).toHaveTextContent("Empty");
    expect(
      screen.getByText("Different first-page header and footer"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Existing header")).toBeNull();
  });

  it("lists every story family once, with removal and without internal ids", () => {
    const { snapshot, plan } = scenario();
    plan.stories = [
      {
        id: "header-1",
        type: "header",
        kind: "upsert",
        blocks: [{ id: "h", type: "paragraph", text: "Revised header" }],
      },
      { id: "footer-1", type: "footer", kind: "delete" },
      {
        id: "footnote-new",
        type: "footnote",
        kind: "upsert",
        blocks: [{ id: "fn", type: "paragraph", text: "A new note" }],
      },
      {
        id: "endnote-new",
        type: "endnote",
        kind: "upsert",
        blocks: [{ id: "en", type: "paragraph", text: "An endnote" }],
      },
      {
        id: "comment-new",
        type: "comment",
        kind: "upsert",
        blocks: [{ id: "co", type: "paragraph", text: "Reviewer comment" }],
      },
    ];
    const { container } = mount(plan, snapshot);
    const parts = partsSection();
    for (const family of ["Header", "Footer", "Footnote", "Endnote", "Comment"])
      expect(
        within(parts).getByRole("button", { name: new RegExp(`^${family}`) }),
      ).toBeInTheDocument();
    expect(
      within(within(parts).getByRole("button", { name: /^Footer/ })).getByText(
        "Removed",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/Document parts change too/)).toBeInTheDocument();
    expect(container.querySelector('[data-ui="tab-rail"]')).toBeNull();
    expect(container).not.toHaveTextContent(/footnote-new|header-1/);
    fireEvent.click(within(parts).getByRole("button", { name: /^Header/ }));
    expect(parts).toHaveTextContent(/Revised/);
  });
});
