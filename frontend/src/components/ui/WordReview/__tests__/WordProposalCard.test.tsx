import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "@/components/providers/ThemeProvider";

import { WordProposalCard } from "../WordProposalCard";

import type {
  WordAuthoringSnapshot,
  WordDocumentPlan,
} from "@/lib/wordReview/wordDocumentPlan";
import type { PropsWithChildren } from "react";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

const wrapper = ({ children }: PropsWithChildren) => (
  <ThemeProvider
    enableCustomTheme={false}
    initialThemeMode="light"
    persistThemeMode={false}
    persistTextSize={false}
  >
    {children}
  </ThemeProvider>
);

const paragraph = (ref: string, text: string) => ({
  ref,
  text,
  type: "paragraph" as const,
  protected: false,
  xml: `<w:p xmlns:w="${W}"><w:r><w:t>${text}</w:t></w:r></w:p>`,
});

const snapshot = (): WordAuthoringSnapshot => ({
  token: "snap-1",
  identity: "doc-A",
  ooxml: "",
  fingerprint: "word-body-v2:test",
  blocks: [paragraph("b1", "Context"), paragraph("b2", "Old ending.")],
  styles: [],
  read: new Set(["b1", "b2"]),
  revoked: false,
  used: false,
});

const plan: WordDocumentPlan = {
  version: 1,
  snapshot: "snap-1",
  readToken: "read-proof",
  scope: "body",
  entries: [
    { kind: "keep", source: ["b1"] },
    {
      kind: "replace",
      source: ["b2"],
      blocks: [{ id: "n1", type: "paragraph", text: "New ending." }],
    },
  ],
  deleted: [],
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("WordProposalCard", () => {
  it("is read-only without an adapter and copies the planned text", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(
      <WordProposalCard
        plan={plan}
        snapshot={snapshot()}
        documentName="Q3 report.docx"
      />,
      { wrapper },
    );

    expect(
      screen.getByRole("region", { name: "Proposed document changes" }),
    ).toBeInTheDocument();
    expect(screen.getByText("From Word · Q3 report.docx")).toBeInTheDocument();
    expect(
      screen.getByText("Open this chat in Word with the document to apply."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Show in Word/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Copy text" }));
    expect(writeText).toHaveBeenCalledWith("Context\nNew ending.");
    expect(await screen.findByText("Text copied.")).toBeInTheDocument();
  });

  it("reviews a plan from its own data when the document is not available", () => {
    render(<WordProposalCard plan={plan} />, { wrapper });

    expect(screen.getByText("From Word")).toBeInTheDocument();
    expect(screen.getByText(/^Saved draft:/)).toBeInTheDocument();
  });

  it("hands the footer and status to an adapter", () => {
    const onToggleDetails = vi.fn();
    const view = render(
      <WordProposalCard
        plan={plan}
        snapshot={snapshot()}
        adapter={{
          apply: <button type="button">Apply rewrite</button>,
          actions: <button type="button">Copy draft</button>,
          revert: <p>Undo line</p>,
          status: {
            collapsed: false,
            alert: <p>Applied.</p>,
            notice: <p>Blocked here.</p>,
            note: "Draft copied.",
          },
        }}
      />,
      { wrapper },
    );

    expect(screen.queryByText(/^From Word/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Copy text" })).toBeNull();
    for (const text of ["Applied.", "Blocked here.", "Undo line"])
      expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Draft copied.");
    expect(screen.getByRole("button", { name: "Apply rewrite" })).toBeVisible();

    view.rerender(
      <WordProposalCard
        plan={plan}
        snapshot={snapshot()}
        adapter={{
          status: {
            collapsed: true,
            onToggleDetails,
            receipt: <p>Rewrite applied.</p>,
            alert: <p>Applied.</p>,
          },
        }}
      />,
    );
    expect(screen.getByText("Rewrite applied.")).toBeInTheDocument();
    expect(screen.queryByText("Applied.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show details" }));
    expect(onToggleDetails).toHaveBeenCalledTimes(1);
  });
});
