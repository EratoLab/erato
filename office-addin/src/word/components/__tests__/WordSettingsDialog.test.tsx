import { i18n } from "@lingui/core";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WordSettingsDialog } from "../WordSettingsDialog";

import type { AddinSettingsHostContribution } from "../../../core/AddinSettingsDialogCore";

// The shared dialog is exercised by its own suite; what matters here is WHAT
// Word contributes to it, so the dialog is replaced by a probe that renders
// the contribution and records its shape.
let contribution: AddinSettingsHostContribution | undefined;

vi.mock("../../../core/AddinSettingsDialogCore", () => ({
  AddinSettingsDialogCore: (props: {
    hostContribution?: AddinSettingsHostContribution;
  }) => {
    contribution = props.hostContribution;
    return <div>{props.hostContribution?.serversToolsEntities}</div>;
  },
}));

const mockUseActionFacetClientActions = vi.fn();

vi.mock("../../../core/clientActions/useAvailableActionFacets", () => ({
  useActionFacetClientActions: () => mockUseActionFacetClientActions(),
}));

vi.mock("@erato/frontend/library", () => ({
  DocumentIcon: () => <svg />,
  EntityRow: ({
    name,
    children,
  }: {
    name: string;
    children: React.ReactNode;
  }) => (
    <div>
      <span>{name}</span>
      {children}
    </div>
  ),
  RadioCard: ({ label, helper }: { label: string; helper: string }) => (
    <div>
      <span>{label}</span>
      <span>{helper}</span>
    </div>
  ),
  usePersistedState: () => [{}, vi.fn()],
}));

describe("WordSettingsDialog", () => {
  beforeEach(() => {
    i18n.load("en", {});
    i18n.activate("en");
    contribution = undefined;
    mockUseActionFacetClientActions.mockReturnValue(
      new Map([
        [
          "word_document_review",
          {
            displayName: "Review this document",
            clientActions: ["word.apply_edits"],
            presentation: "auto_prompt",
            alwaysAskActions: [],
          },
        ],
        [
          "word_compose",
          {
            displayName: "Draft in this document",
            clientActions: ["word.insert_at_cursor"],
            presentation: "auto_prompt",
            alwaysAskActions: [],
          },
        ],
      ]),
    );
  });
  afterEach(cleanup);

  it("contributes no host tab — only the shared pane entity", () => {
    render(<WordSettingsDialog isOpen={true} onClose={() => {}} />);

    expect(contribution?.serversToolsEntities).toBeTruthy();
    expect(contribution?.content).toBeUndefined();
    expect(contribution?.tabLabel).toBeUndefined();
  });

  it("shows both Word actions, grouped by the facet that advertises them", () => {
    render(<WordSettingsDialog isOpen={true} onClose={() => {}} />);

    expect(screen.getByText("Word actions")).toBeInTheDocument();
    expect(
      screen.getByText("Apply the changes to the document"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Insert the text at the cursor"),
    ).toBeInTheDocument();
    expect(screen.getByText("Review this document")).toBeInTheDocument();
    expect(screen.getByText("Draft in this document")).toBeInTheDocument();
  });

  it("uses Word copy that never claims a later send-time gate", () => {
    render(<WordSettingsDialog isOpen={true} onClose={() => {}} />);

    // Outlook's copy promises "nothing is sent until you press Send"; a Word
    // grant writes immediately, so the copy must name the real safety net.
    expect(screen.queryByText(/press Send in Outlook/)).toBeNull();
    expect(
      screen.getAllByText(/write into the open document straight away/).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/a single Revert undoes the batch/).length,
    ).toBeGreaterThan(0);
  });

  it("describes insertion and structural recovery separately from paragraph edits", () => {
    mockUseActionFacetClientActions.mockReturnValue(
      new Map([
        [
          "word_document_authoring",
          {
            displayName: "Rewrite this document",
            clientActions: [
              "word.apply_edits",
              "word.insert_at_cursor",
              "word.apply_document_plan",
            ],
            presentation: "auto_prompt",
            alwaysAskActions: [],
          },
        ],
      ]),
    );
    render(<WordSettingsDialog isOpen onClose={() => {}} />);
    expect(
      screen.getAllByText(/a single Revert undoes the batch/),
    ).toHaveLength(1);
    expect(
      screen.getByText(/This action has no Erato Revert/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/while the applied document remains unchanged/),
    ).toBeInTheDocument();
  });
});
