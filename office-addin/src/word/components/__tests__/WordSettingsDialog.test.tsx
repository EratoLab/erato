import { i18n } from "@lingui/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  WORD_COMPATIBILITY_MODE_KEY,
  wordInPlaceAvailability,
} from "../../utils/wordInPlaceSwitch";
import { WordSettingsDialog } from "../WordSettingsDialog";

import type { AddinSettingsHostContribution } from "../../../core/AddinSettingsDialogCore";

let contribution: AddinSettingsHostContribution | undefined;

vi.mock("../../../core/AddinSettingsDialogCore", () => ({
  AddinSettingsDialogCore: (props: {
    hostContribution?: AddinSettingsHostContribution;
  }) => {
    contribution = props.hostContribution;
    return (
      <div>
        {props.hostContribution?.serversToolsEntities}
        {props.hostContribution?.content}
      </div>
    );
  },
}));

let mockIncludeDocument = true;
const mockSetIncludeDocument = vi.fn();
let mockCommentPrecedence = "selection";
const mockSetCommentPrecedence = vi.fn();

vi.mock("../../wordPreferences", () => ({
  useWordIncludeDocumentByDefault: () => [
    mockIncludeDocument,
    mockSetIncludeDocument,
  ],
  useWordCommentPrecedence: () => [
    mockCommentPrecedence,
    mockSetCommentPrecedence,
  ],
  useWordCommentAuthor: () => [
    mockCommentAuthor.value,
    mockSetCommentAuthor,
    mockCommentAuthor.enforced,
  ],
}));

const mockCommentAuthor = { value: "user", enforced: false };
const mockSetCommentAuthor = vi.fn();

const mockUseActionFacetClientActions = vi.fn();
const mockFacets = {
  ids: new Set<string>(),
  args: new Map<string, Set<string>>(),
};

vi.mock("../../../core/clientActions/useAvailableActionFacets", () => ({
  useActionFacetClientActions: () => mockUseActionFacetClientActions(),
  useAvailableActionFacetIds: () => mockFacets.ids,
  useAvailableActionFacetArgs: () => mockFacets.args,
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
  RadioCard: ({
    label,
    helper,
    name,
    value,
    checked,
    onChange,
    disabled,
  }: {
    label: string;
    helper: string;
    name: string;
    value: string;
    checked: boolean;
    onChange: () => void;
    disabled?: boolean;
  }) => (
    <label>
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
      />
      <span>{label}</span>
      <span>{helper}</span>
    </label>
  ),
  usePersistedState: () => [{}, vi.fn()],
}));

describe("WordSettingsDialog", () => {
  beforeEach(() => {
    i18n.load("en", {});
    i18n.activate("en");
    contribution = undefined;
    mockIncludeDocument = true;
    mockSetIncludeDocument.mockReset();
    mockCommentPrecedence = "selection";
    mockSetCommentPrecedence.mockReset();
    mockFacets.ids = new Set();
    mockFacets.args = new Map();
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
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.removeItem(WORD_COMPATIBILITY_MODE_KEY);
  });

  it("contributes a Word tab alongside the shared pane entity", () => {
    render(<WordSettingsDialog isOpen={true} onClose={() => {}} />);

    expect(contribution?.serversToolsEntities).toBeTruthy();
    expect(contribution?.content).toBeTruthy();
    expect(contribution?.tabLabel).toBe("Word");
  });

  describe("include the open document", () => {
    const toggle = () =>
      screen.getByRole<HTMLInputElement>("checkbox", {
        name: "Include the open document in new chats",
      });

    it.each([true, false])(
      "shows the effective default (%s) and saves the user's choice",
      (current) => {
        mockIncludeDocument = current;
        render(<WordSettingsDialog isOpen onClose={() => {}} />);
        expect(toggle().checked).toBe(current);
        expect(toggle()).toHaveAccessibleDescription(
          "Erato reads the document when you send a message. You can remove it from any chat.",
        );

        fireEvent.click(toggle());
        expect(mockSetIncludeDocument).toHaveBeenCalledExactlyOnceWith(
          !current,
        );
      },
    );
  });

  describe("comment precedence", () => {
    const advertise = (facets: Record<string, string[]>) => {
      mockFacets.ids = new Set(Object.keys(facets));
      mockFacets.args = new Map(
        Object.entries(facets).map(([id, args]) => [id, new Set(args)]),
      );
    };
    const radio = (name: RegExp) =>
      screen.getByRole<HTMLInputElement>("radio", { name });
    const group = () => screen.queryByTestId("word-comment-precedence");

    it("is hidden while no comment thread can be sent on its own", () => {
      render(<WordSettingsDialog isOpen onClose={() => {}} />);
      expect(group()).toBeNull();

      cleanup();
      advertise({
        word_selection: ["selected_text", "anchored_comments"],
        word_document_review: ["document_text", "comment_map"],
        word_comment_thread: ["thread_json"],
      });
      render(<WordSettingsDialog isOpen onClose={() => {}} />);
      expect(group()).toBeNull();
    });

    it.each(["selection", "comment"])(
      "sits in Word behavior once advertised, shows %s and saves the choice",
      (current) => {
        mockCommentPrecedence = current;
        advertise({ word_comment_thread: ["thread_json", "comments_json"] });
        render(<WordSettingsDialog isOpen onClose={() => {}} />);

        expect(group()).toHaveTextContent(
          "When the text you select has comments, Erato should:",
        );
        const selected = radio(/Work on the selected text \(default\)/);
        const comment = radio(/Work on the comment/);
        expect(selected.checked).toBe(current === "selection");
        expect(comment.checked).toBe(current === "comment");
        expect(selected).toHaveAccessibleName(
          /Comments are sent along, and Erato can offer to replace the text\./,
        );
        expect(comment).toHaveAccessibleName(
          /Erato does not offer to replace the text\./,
        );

        fireEvent.click(current === "selection" ? comment : selected);
        expect(mockSetCommentPrecedence).toHaveBeenCalledExactlyOnceWith(
          current === "selection" ? "comment" : "selection",
        );
      },
    );
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

  it("explains Always allow for replacing a selected passage", () => {
    mockUseActionFacetClientActions.mockReturnValue(
      new Map([
        [
          "word_selection",
          {
            displayName: "Word selection",
            clientActions: ["word.replace_selection"],
            presentation: "auto_prompt",
            alwaysAskActions: [],
          },
        ],
      ]),
    );
    render(<WordSettingsDialog isOpen onClose={() => {}} />);
    expect(
      screen.getByText(
        /Replaces the selected passage without asking, only if it is unchanged since your request/,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/a single Revert undoes the batch/)).toBeNull();
  });

  describe("compatibility mode", () => {
    const wordHost = () =>
      vi.stubGlobal("Office", {
        context: {
          requirements: { isSetSupported: () => true },
          document: { url: "", getFileAsync: () => {} },
        },
      });
    const toggle = () =>
      screen.getByRole("checkbox", {
        name: "Replace the whole document when applying (compatibility mode)",
      });

    it("is stored per device and sends rewrites through the full-document import", () => {
      wordHost();
      render(<WordSettingsDialog isOpen onClose={() => {}} />);
      expect(toggle()).not.toBeChecked();
      expect(wordInPlaceAvailability()).toEqual({ enabled: true });

      fireEvent.click(toggle());
      expect(toggle()).toBeChecked();
      expect(localStorage.getItem(WORD_COMPATIBILITY_MODE_KEY)).toBe("1");
      expect(wordInPlaceAvailability()).toEqual({
        enabled: false,
        reason: "setting",
      });

      fireEvent.click(toggle());
      expect(toggle()).not.toBeChecked();
      expect(localStorage.getItem(WORD_COMPATIBILITY_MODE_KEY)).toBeNull();
      expect(wordInPlaceAvailability()).toEqual({ enabled: true });
    });

    it("still renders, and leaves in-place writing on, when storage throws", () => {
      wordHost();
      const blocked = () => {
        throw new Error("Access is denied for this document.");
      };
      vi.spyOn(localStorage, "getItem").mockImplementation(blocked);
      vi.spyOn(localStorage, "setItem").mockImplementation(blocked);
      render(<WordSettingsDialog isOpen onClose={() => {}} />);
      expect(screen.getByText("Word actions")).toBeInTheDocument();
      expect(toggle()).not.toBeChecked();

      fireEvent.click(toggle());
      expect(toggle()).not.toBeChecked();
      expect(wordInPlaceAvailability()).toEqual({ enabled: true });
    });
  });

  describe("Post new comments as", () => {
    const offerAdds = () =>
      mockUseActionFacetClientActions.mockReturnValue(
        new Map([
          [
            "word_selection",
            {
              displayName: "Selection",
              clientActions: ["word.add_comments"],
              presentation: "render_buttons",
              alwaysAskActions: [],
            },
          ],
        ]),
      );

    beforeEach(() => {
      mockCommentAuthor.value = "user";
      mockCommentAuthor.enforced = false;
      mockSetCommentAuthor.mockReset();
    });

    it("is hidden until a facet offers new comments", () => {
      render(<WordSettingsDialog isOpen onClose={() => {}} />);
      expect(screen.queryByTestId("word-comment-author")).toBeNull();
    });

    it("offers me with the label or Erato, and stores the choice", () => {
      offerAdds();
      render(<WordSettingsDialog isOpen onClose={() => {}} />);
      expect(screen.getByText("Post new comments as:")).toBeInTheDocument();
      expect(
        screen.getByRole("radio", { name: /Me, with an AI label \(default\)/ }),
      ).toBeChecked();
      expect(
        screen.getByText(
          /Co-authors on Word for the web may briefly see your name/,
        ),
      ).toBeInTheDocument();
      fireEvent.click(
        screen.getByRole("radio", { name: /Erato, on my behalf/ }),
      );
      expect(mockSetCommentAuthor).toHaveBeenCalledWith("assistant");
    });

    it("cannot be changed where the deployment locks it", () => {
      offerAdds();
      mockCommentAuthor.value = "assistant";
      mockCommentAuthor.enforced = true;
      render(<WordSettingsDialog isOpen onClose={() => {}} />);
      expect(
        screen.getByRole("radio", { name: /Erato, on my behalf/ }),
      ).toBeDisabled();
      expect(
        screen.getByText("Your organization sets this."),
      ).toBeInTheDocument();
    });
  });
});
