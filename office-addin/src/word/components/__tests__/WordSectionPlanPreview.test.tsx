import { i18n } from "@lingui/core";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  examplePlan,
  readySnapshot,
} from "../../../test/mocks/word/authoringFixtures";
import { WordDocumentPlanReview } from "../WordDocumentPlanReview";
import { WordSectionPlanPreview } from "../WordSectionPlanPreview";

import type { WordSectionPlan } from "../../utils/wordStories";

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
        pageNumberStart: 7,
        break: "oddPage",
        margins: {
          top: 72,
          bottom: 72,
          left: 54,
          right: 54,
          header: 36,
          footer: 36,
          gutter: 9,
        },
      },
    },
  ];
  const plan = examplePlan(snapshot.token);
  plan.scope = "document";
  return { snapshot, plan };
}
beforeEach(() => {
  i18n.load("en", {});
  i18n.activate("en");
});
afterEach(cleanup);

describe("Word section review", () => {
  it("shows the compiled page geometry with inherited margins without changing the source", () => {
    const { snapshot, plan } = scenario();
    const before = JSON.stringify(snapshot.sections);
    const section: WordSectionPlan = {
      id: "new-section",
      source: "section-1",
      after: "n2",
      layout: { orientation: "landscape", margins: { top: 42 } },
    };
    const { container } = render(
      <WordSectionPlanPreview
        section={section}
        index={1}
        snapshot={snapshot}
        plan={plan}
        label={() => "Pilot recommendation"}
      />,
    );
    expect(screen.getByText("Section 2")).toBeInTheDocument();
    expect(screen.getByText("Page size: 792 × 612 pt")).toBeInTheDocument();
    expect(screen.getByText("Landscape")).toBeInTheDocument();
    expect(screen.getByText("2 columns", { exact: false })).toHaveTextContent(
      "18 pt apart",
    );
    expect(screen.getByText("Top margin").parentElement).toHaveTextContent(
      "42 pt",
    );
    expect(screen.getByText("Bottom margin").parentElement).toHaveTextContent(
      "72 pt",
    );
    expect(screen.getByText("Gutter").parentElement).toHaveTextContent("9 pt");
    expect(
      screen.getByText("Ends after Pilot recommendation"),
    ).toBeInTheDocument();
    expect(container.querySelector('[data-ui="card"]')).toBeInTheDocument();
    expect(JSON.stringify(snapshot.sections)).toBe(before);
  });

  it("shows inherited page numbering, boundary and running content", () => {
    const { snapshot, plan } = scenario();
    render(
      <WordSectionPlanPreview
        section={{ id: "new-section", source: "section-1" }}
        index={0}
        snapshot={snapshot}
        plan={plan}
        label={(ref) => ref}
      />,
    );
    expect(screen.getByText("Page numbering starts at 7")).toBeInTheDocument();
    expect(screen.getByText("Start on the next odd page")).toBeInTheDocument();
    expect(
      screen.getByText("Default pages: Existing header"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Default pages: Existing footer"),
    ).toBeInTheDocument();
    expect(screen.getByText("Final section")).toBeInTheDocument();
  });

  it("distinguishes an explicit empty story and empty binding from old content", () => {
    const { snapshot, plan } = scenario();
    plan.stories = [
      { id: "footer-1", type: "footer", kind: "upsert", blocks: [] },
    ];
    render(
      <WordSectionPlanPreview
        section={{
          id: "new-section",
          headers: { default: null },
          layout: { differentFirstPage: true, differentOddEvenPages: false },
        }}
        index={0}
        snapshot={snapshot}
        plan={plan}
        label={(ref) => ref}
      />,
    );
    expect(screen.getAllByText("Default pages: Empty")).toHaveLength(2);
    expect(screen.queryByText(/Existing header|Existing footer/)).toBeNull();
    expect(
      screen.getByText("Different first-page header and footer"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Use the same headers and footers on odd and even pages",
      ),
    ).toBeInTheDocument();
  });

  it("exposes all story families and section settings through the standard tab rail", () => {
    const { snapshot, plan } = scenario();
    plan.stories = [
      {
        id: "header-1",
        type: "header",
        kind: "upsert",
        blocks: [
          {
            id: "h",
            type: "paragraph",
            text: "Revised header",
            runs: [{ text: "Revised header", bold: true }],
          },
        ],
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
    plan.sections = [{ id: "new-section", source: "section-1" }];
    const { container } = render(
      <WordDocumentPlanReview plan={plan} snapshot={snapshot} />,
    );
    expect(container.querySelector('[data-ui="tab-rail"]')).toBeInTheDocument();
    expect(
      screen.getByText("Document parts changed: 5 · Sections configured: 1"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Document parts" }));
    const panel = screen.getByRole("tabpanel", { name: "Document parts" });
    expect(within(panel).getByText("Revised header")).toHaveStyle({
      fontWeight: "bold",
    });
    for (const family of ["Header", "Footer", "Footnote", "Endnote", "Comment"])
      expect(
        within(panel).getByRole("heading", {
          name: new RegExp(`^${family} ·`),
        }),
      ).toBeInTheDocument();
    expect(within(panel).getByText("Existing footer")).toBeInTheDocument();
    expect(
      within(panel).getByText("Sections and page layout"),
    ).toBeInTheDocument();
  });
});
