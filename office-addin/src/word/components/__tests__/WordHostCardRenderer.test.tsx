import { i18n, type Messages } from "@lingui/core";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { messages as frontendMessages } from "../../../../../frontend/src/locales/en/messages.json";
import { TestTheme } from "../../../test/helpers/TestTheme";
import {
  installMockWordDocument,
  uninstallMockWordDocument,
} from "../../../test/mocks/word/document";
import { WordWriteProvider } from "../../providers/WordWriteProvider";
import { WordHostCardRenderer } from "../WordHostCardRenderer";

import type { MockWordHost } from "../../../test/mocks/word/document";
import type { WordDocumentCapture } from "../../utils/wordDocumentCapture";
import type * as EratoLibrary from "@erato/frontend/library";

// Mocked at the same seams as the Outlook renderer suites: the artifact the
// host stamps, the chat snapshot, and the persisted decisions. Everything
// under test — the fence parser, the registry dispatch, the write gate and the
// executor against the Word mock — runs for real.
const mockUseHostArtifact = vi.fn();
const mockUseChatContext = vi.fn();
const mockUsePersistedState = vi.fn();

vi.mock("@erato/frontend/library", async (importOriginal) => {
  return {
    ...(await importOriginal<typeof EratoLibrary>()),
    SyntaxHighlightedCode: ({ code }: { code: string }) => <pre>{code}</pre>,
    ActionConfirmationCard: (props: {
      description?: unknown;
      onAllowOnce: () => void;
      onAlwaysAllow: () => void;
      onDeny: () => void;
      isBusy?: boolean;
    }) => (
      <div data-testid="confirmation-card">
        <div data-testid="confirmation-description">
          {props.description as never}
        </div>
        <button type="button" onClick={props.onAllowOnce}>
          allow-once
        </button>
        <button type="button" onClick={props.onAlwaysAllow}>
          always-allow
        </button>
        <button type="button" onClick={props.onDeny}>
          deny
        </button>
      </div>
    ),
    useChatContext: () => mockUseChatContext(),
    useHostArtifact: () => mockUseHostArtifact(),
    usePersistedState: () => mockUsePersistedState(),
    useConfirmationRegistryStore: (
      selector: (state: {
        registerConfirmation: () => void;
        unregisterConfirmation: () => void;
      }) => unknown,
    ) =>
      selector({
        registerConfirmation: () => {},
        unregisterConfirmation: () => {},
      }),
  };
});

const REVIEW_FACET = "word_document_review";
const COMPOSE_FACET = "word_compose";
const APPLY = "word.apply_edits";
const INSERT = "word.insert_at_cursor";
const IDENTITY = "https://contoso.sharepoint.com/report.docx";

const PARAGRAPHS = ["Alpha.", "Bravo.", "Charlie."];
const EDITS_FENCE = JSON.stringify({
  edits: [{ paragraph: 2, text: "Bravo, revised." }],
});

const capture = (overrides: Partial<WordDocumentCapture> = {}) => ({
  identity: IDENTITY,
  ordinalMap: new Map(
    PARAGRAPHS.map((text, index) => [
      index + 1,
      { uniqueLocalId: `id-${index + 1}`, text },
    ]),
  ),
  paragraphsSent: PARAGRAPHS.length,
  renderedOrdinals: new Set(PARAGRAPHS.map((_text, index) => index + 1)),
  partialOrdinal: null,
  ...overrides,
});

interface TestArtifact {
  facetId: string;
  renderMode: "body" | "suggestions";
  messageId: string;
  cardFenceLanguages: string[];
  allowedClientActions: string[];
  alwaysAskClientActions?: string[];
  clientActionPresentation: string;
  isFreshCompletion?: boolean;
  itemIdentity?: string;
  proposedClientAction?: string;
}

// Unique per test: the once-per-message auto-prompt slot is module-level state
// that intentionally survives remounts (and thus tests).
let nextMessageId = 0;

function makeArtifact(overrides: Partial<TestArtifact> = {}): TestArtifact {
  nextMessageId += 1;
  return {
    facetId: REVIEW_FACET,
    renderMode: "suggestions",
    messageId: `word-msg-${nextMessageId}`,
    cardFenceLanguages: ["erato-word-edits", "erato-word-insert"],
    allowedClientActions: [APPLY],
    clientActionPresentation: "render_buttons",
    isFreshCompletion: true,
    itemIdentity: IDENTITY,
    ...overrides,
  };
}

function renderCard(options: {
  artifact: TestArtifact | null;
  language?: string;
  content?: string;
  currentIdentity?: string | null;
  captures?: Map<string, WordDocumentCapture>;
  decisions?: Record<string, string>;
}) {
  const artifact = options.artifact;
  mockUseHostArtifact.mockReturnValue(artifact);
  const messageId = artifact?.messageId ?? "unrelated";
  mockUseChatContext.mockReturnValue({
    messages: { [messageId]: { id: messageId, role: "assistant" } },
    messageOrder: [messageId],
    currentChatId: "chat-1",
  });
  const setDecisions = vi.fn();
  mockUsePersistedState.mockReturnValue([
    options.decisions ?? {},
    setDecisions,
  ]);

  const captures =
    options.captures ??
    new Map<string, WordDocumentCapture>([[messageId, capture()]]);

  const view = render(
    <WordWriteProvider
      documentIdentity={
        options.currentIdentity === undefined
          ? IDENTITY
          : options.currentIdentity
      }
      capturesByAssistantMessageId={captures}
    >
      <WordHostCardRenderer
        language={options.language ?? "erato-word-edits"}
        content={options.content ?? EDITS_FENCE}
      />
    </WordWriteProvider>,
    { wrapper: TestTheme },
  );
  return { ...view, setDecisions };
}

const flush = () => act(() => Promise.resolve());

describe("WordHostCardRenderer", () => {
  let word: MockWordHost;

  beforeEach(() => {
    i18n.load("en", frontendMessages as unknown as Messages);
    i18n.activate("en");
    word = installMockWordDocument(PARAGRAPHS.map((text) => ({ text })));
  });
  afterEach(() => {
    uninstallMockWordDocument();
    cleanup();
    vi.clearAllMocks();
  });

  describe("dispatch by language", () => {
    it("renders the edit list for the edits tag", () => {
      renderCard({ artifact: makeArtifact() });

      expect(screen.getByTestId("word-edits-card")).toBeInTheDocument();
      expect(screen.getByText("Paragraph 2")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("tab", { name: "Proposed" }));
      expect(screen.getByText("Bravo, revised.")).toBeInTheDocument();
    });

    it("renders the insert preview for the insert tag", () => {
      renderCard({
        artifact: makeArtifact({
          facetId: COMPOSE_FACET,
          allowedClientActions: [INSERT],
        }),
        language: "erato-word-insert",
        content: "A drafted paragraph.",
      });

      expect(screen.getByTestId("word-insert-card")).toBeInTheDocument();
      expect(screen.getByText("A drafted paragraph.")).toBeInTheDocument();
    });

    it("renders an unknown tag raw rather than inventing a card", () => {
      renderCard({ artifact: makeArtifact(), language: "json" });

      expect(screen.getByTestId("word-card-raw")).toBeInTheDocument();
      expect(screen.queryByTestId("word-edits-card")).toBeNull();
    });

    it("explains an invalid proposal without offering actions", () => {
      renderCard({
        artifact: makeArtifact(),
        content: '{"edits":[{"paragraph":2,"te',
      });

      expect(screen.getByRole("alert")).toHaveTextContent(
        "incomplete or invalid",
      );
      expect(screen.queryByRole("button", { name: /^Apply/ })).toBeNull();
    });
  });

  describe("what may be offered", () => {
    it("offers nothing when the backend does not advertise the action", () => {
      renderCard({
        artifact: makeArtifact({ allowedClientActions: [] }),
      });

      expect(screen.getByTestId("word-edits-card")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^Apply/ })).toBeNull();
    });

    it("offers nothing when the advertised action belongs to another facet", () => {
      renderCard({
        artifact: makeArtifact({
          facetId: COMPOSE_FACET,
          allowedClientActions: [APPLY],
        }),
      });

      expect(screen.queryByRole("button", { name: /^Apply/ })).toBeNull();
    });

    it("hides the action and ignores the proposal on a `never` decision", () => {
      renderCard({
        artifact: makeArtifact({
          clientActionPresentation: "auto_prompt",
          proposedClientAction: APPLY,
        }),
        decisions: { [`${REVIEW_FACET}/${APPLY}`]: "never" },
      });

      expect(screen.queryByRole("button", { name: /^Apply/ })).toBeNull();
      expect(screen.queryByTestId("confirmation-card")).toBeNull();
    });
  });

  describe("the identity gate", () => {
    it("disables the action with a stated reason after a pane reload", () => {
      renderCard({ artifact: makeArtifact(), captures: new Map() });

      expect(
        screen.getByRole("button", {
          name: /^Apply (edit|all \d+ edits)$/,
        }),
      ).toBeDisabled();
      expect(
        screen.getByText(/no longer has the document snapshot/),
      ).toBeInTheDocument();
    });

    it("disables the action with a stated reason for another document", () => {
      renderCard({
        artifact: makeArtifact(),
        currentIdentity: "pane-session:other",
      });

      expect(
        screen.getByRole("button", {
          name: /^Apply (edit|all \d+ edits)$/,
        }),
      ).toBeDisabled();
      expect(
        screen.getByText(/different document than the one open now/),
      ).toBeInTheDocument();
    });

    it("re-checks identity at execution, not only at render", async () => {
      // The card can be opened against document A and resolved after the pane
      // has switched to document B.
      const artifact = makeArtifact({
        clientActionPresentation: "auto_prompt",
        proposedClientAction: APPLY,
      });
      const captures = new Map<string, WordDocumentCapture>([
        [artifact.messageId, capture()],
      ]);
      const { rerender } = renderCard({ artifact, captures });
      await flush();
      expect(screen.getByTestId("confirmation-card")).toBeInTheDocument();

      rerender(
        <WordWriteProvider
          documentIdentity="pane-session:switched-away"
          capturesByAssistantMessageId={captures}
        >
          <WordHostCardRenderer
            language="erato-word-edits"
            content={EDITS_FENCE}
          />
        </WordWriteProvider>,
      );
      fireEvent.click(screen.getByRole("button", { name: "allow-once" }));
      await flush();

      expect(word.word.writes()).toEqual([]);
      expect(
        screen.getAllByText(/different document than the one open now/).length,
      ).toBeGreaterThan(0);
    });

    it("writes nothing when the identity is missing on either side", () => {
      renderCard({
        artifact: makeArtifact({ itemIdentity: undefined }),
      });

      expect(
        screen.getByRole("button", {
          name: /^Apply (edit|all \d+ edits)$/,
        }),
      ).toBeDisabled();
    });
  });

  describe("applying", () => {
    it("treats a click as consent and writes, then reports per edit", async () => {
      renderCard({ artifact: makeArtifact() });

      fireEvent.click(
        screen.getByRole("button", {
          name: /^Apply (edit|all \d+ edits)$/,
        }),
      );
      await flush();

      expect(word.word.paragraphs().map((entry) => entry.text)).toEqual([
        "Alpha.",
        "Bravo, revised.",
        "Charlie.",
      ]);
      expect(screen.getByTestId("word-review-receipt")).toHaveTextContent(
        "1 edit applied",
      );
      expect(screen.getByTestId("word-edits-list")).not.toBeVisible();
      fireEvent.click(screen.getByRole("button", { name: "Show details" }));
      const report = screen.getByTestId("word-edit-report");
      expect(report).toBeVisible();
      expect(report).toHaveTextContent("Paragraph 2");
      expect(report).toHaveTextContent("Applied");
      expect(screen.queryByTestId("confirmation-card")).toBeNull();
    });

    it("reports a partial batch and applies only the surviving edits", async () => {
      word.word.setParagraphs([
        { text: "Alpha." },
        { text: "Bravo, changed by the user." },
        { text: "Charlie." },
      ]);
      renderCard({
        artifact: makeArtifact(),
        content: JSON.stringify({
          edits: [
            { paragraph: 2, text: "Never written." },
            { paragraph: 3, text: "Charlie, revised." },
          ],
        }),
      });

      fireEvent.click(
        screen.getByRole("button", {
          name: /^Apply (edit|all \d+ edits)$/,
        }),
      );
      await flush();

      expect(word.word.paragraphs()[1].text).toBe(
        "Bravo, changed by the user.",
      );
      expect(word.word.paragraphs()[2].text).toBe("Charlie, revised.");
      expect(screen.getByTestId("word-review-receipt")).toHaveTextContent(
        "1 applied · 1 skipped · 0 failed",
      );
      fireEvent.click(screen.getByRole("button", { name: "Show details" }));
      expect(screen.getByTestId("word-edit-report")).toHaveTextContent(
        "the paragraph changed since you asked",
      );
    });

    it("offers Revert once, restores the body, and does not offer it twice", async () => {
      renderCard({ artifact: makeArtifact() });

      fireEvent.click(
        screen.getByRole("button", {
          name: /^Apply (edit|all \d+ edits)$/,
        }),
      );
      await flush();

      fireEvent.click(screen.getByTestId("word-revert-button"));
      expect(
        screen.getByText(/This can remove later changes to the body/),
      ).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Restore body" }));
      await flush();

      expect(word.word.paragraphs().map((entry) => entry.text)).toEqual(
        PARAGRAPHS,
      );
      expect(screen.queryByTestId("word-revert-button")).toBeNull();
    });

    it("offers Revert when Word rejected the write half-way", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      word.word.failWriteOn("id-2");
      renderCard({ artifact: makeArtifact() });

      fireEvent.click(
        screen.getByRole("button", {
          name: /^Apply (edit|all \d+ edits)$/,
        }),
      );
      await flush();

      // Under a standing grant this card is the only place the user learns
      // anything: telling them nothing was written, with no way back, is the
      // one outcome a half-applied batch must never produce.
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Some changes may already be in the document",
      );
      expect(screen.getByTestId("word-edits-list")).toBeVisible();
      expect(screen.queryByTestId("word-review-receipt")).toBeNull();
      expect(screen.getByTestId("word-revert-button")).toBeInTheDocument();

      fireEvent.click(screen.getByTestId("word-revert-button"));
      expect(
        screen.getByText(/This can remove later changes to the body/),
      ).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Restore body" }));
      await flush();

      expect(word.word.paragraphs().map((entry) => entry.text)).toEqual(
        PARAGRAPHS,
      );
    });

    it("offers no Revert when nothing was written", async () => {
      word.word.setParagraphs([
        { text: "Alpha." },
        { text: "Bravo, changed." },
        { text: "Charlie." },
      ]);
      renderCard({ artifact: makeArtifact() });

      fireEvent.click(
        screen.getByRole("button", {
          name: /^Apply (edit|all \d+ edits)$/,
        }),
      );
      await flush();

      expect(screen.queryByTestId("word-revert-button")).toBeNull();
      expect(word.word.writes()).toEqual([]);
      expect(screen.getByTestId("word-review-receipt")).toHaveTextContent(
        "0 applied · 1 skipped · 0 failed",
      );
    });
  });

  describe("inserting", () => {
    it("inserts the FENCE content, not the message body", async () => {
      word.word.setSelection("");
      renderCard({
        artifact: makeArtifact({
          facetId: COMPOSE_FACET,
          allowedClientActions: [INSERT],
        }),
        language: "erato-word-insert",
        content: "A drafted paragraph.",
      });

      fireEvent.click(
        screen.getByRole("button", { name: "Insert the text at the cursor" }),
      );
      await flush();

      expect(word.word.writes()).toEqual([
        {
          kind: "insertText",
          target: "selection",
          ordinal: 0,
          value: "A drafted paragraph.",
          location: "Replace",
        },
      ]);
      expect(
        screen.getByText("Inserted into the document."),
      ).toBeInTheDocument();
      expect(screen.getByText("A drafted paragraph.")).not.toBeVisible();
      fireEvent.click(screen.getByRole("button", { name: "Show details" }));
      expect(screen.getByText("A drafted paragraph.")).toBeVisible();
    });

    it("goes through the same identity gate as apply", () => {
      renderCard({
        artifact: makeArtifact({
          facetId: COMPOSE_FACET,
          allowedClientActions: [INSERT],
        }),
        language: "erato-word-insert",
        content: "A drafted paragraph.",
        captures: new Map(),
      });

      expect(
        screen.getByRole("button", { name: "Insert the text at the cursor" }),
      ).toBeDisabled();
    });
  });

  describe("auto_prompt consent", () => {
    it("surfaces ONE card per turn covering the whole edit list", async () => {
      renderCard({
        artifact: makeArtifact({
          clientActionPresentation: "auto_prompt",
          proposedClientAction: APPLY,
        }),
        content: JSON.stringify({
          edits: [
            { paragraph: 1, text: "First." },
            { paragraph: 3, text: "Third." },
          ],
        }),
      });
      await flush();

      const cards = screen.getAllByTestId("confirmation-card");
      expect(cards).toHaveLength(1);
      const description = screen.getByTestId("confirmation-description");
      expect(description).toHaveTextContent("Apply all 2 edits reviewed above");
      expect(screen.getAllByTestId("word-edits-list")).toHaveLength(1);
      expect(screen.getByTestId("word-edits-list")).toHaveTextContent(
        "Paragraph 1",
      );
      expect(screen.getByTestId("word-edits-list")).toHaveTextContent(
        "Paragraph 3",
      );
    });

    it("writes only after the card is allowed", async () => {
      renderCard({
        artifact: makeArtifact({
          clientActionPresentation: "auto_prompt",
          proposedClientAction: APPLY,
        }),
      });
      await flush();
      expect(word.word.writes()).toEqual([]);

      fireEvent.click(screen.getByRole("button", { name: "allow-once" }));
      await flush();

      expect(word.word.paragraphs()[1].text).toBe("Bravo, revised.");
    });

    it("writes nothing when the card is denied", async () => {
      renderCard({
        artifact: makeArtifact({
          clientActionPresentation: "auto_prompt",
          proposedClientAction: APPLY,
        }),
      });
      await flush();

      fireEvent.click(screen.getByRole("button", { name: "deny" }));
      await flush();

      expect(word.word.writes()).toEqual([]);
      expect(screen.queryByTestId("confirmation-card")).toBeNull();
      expect(screen.getByTestId("word-review-receipt")).toHaveTextContent(
        "Proposal declined",
      );
    });

    it("stores the grant under the Word key when Always allow is chosen", async () => {
      const { setDecisions } = renderCard({
        artifact: makeArtifact({
          clientActionPresentation: "auto_prompt",
          proposedClientAction: APPLY,
        }),
      });
      await flush();

      fireEvent.click(screen.getByRole("button", { name: "always-allow" }));
      await flush();

      expect(setDecisions).toHaveBeenCalledWith({
        [`${REVIEW_FACET}/${APPLY}`]: "always",
      });
    });

    it("executes with no prompt on a stored `always`, and still reports", async () => {
      renderCard({
        artifact: makeArtifact({
          clientActionPresentation: "auto_prompt",
          proposedClientAction: APPLY,
        }),
        decisions: { [`${REVIEW_FACET}/${APPLY}`]: "always" },
      });
      await flush();

      expect(screen.queryByTestId("confirmation-card")).toBeNull();
      expect(word.word.paragraphs()[1].text).toBe("Bravo, revised.");
      expect(screen.getByTestId("word-review-receipt")).toHaveTextContent(
        "1 edit applied",
      );
      expect(screen.getByTestId("word-review-receipt")).toHaveTextContent(
        "Always allow",
      );
      expect(screen.getByTestId("word-edit-report")).not.toBeVisible();
    });

    it("clamps a stored `always` back to a card when the deployment enforces asking", async () => {
      renderCard({
        artifact: makeArtifact({
          clientActionPresentation: "auto_prompt",
          proposedClientAction: APPLY,
          alwaysAskClientActions: [APPLY],
        }),
        decisions: { [`${REVIEW_FACET}/${APPLY}`]: "always" },
      });
      await flush();

      expect(screen.getByTestId("confirmation-card")).toBeInTheDocument();
      expect(word.word.writes()).toEqual([]);
    });

    it("surfaces nothing for a message this pane did not complete", async () => {
      renderCard({
        artifact: makeArtifact({
          clientActionPresentation: "auto_prompt",
          proposedClientAction: APPLY,
          isFreshCompletion: false,
        }),
      });
      await flush();

      expect(screen.queryByTestId("confirmation-card")).toBeNull();
      expect(word.word.writes()).toEqual([]);
    });

    it("surfaces nothing when the open document is a different one", async () => {
      renderCard({
        artifact: makeArtifact({
          clientActionPresentation: "auto_prompt",
          proposedClientAction: APPLY,
        }),
        currentIdentity: "pane-session:other",
      });
      await flush();

      expect(screen.queryByTestId("confirmation-card")).toBeNull();
      expect(word.word.writes()).toEqual([]);
    });

    it("surfaces nothing under the default render_buttons presentation", async () => {
      renderCard({
        artifact: makeArtifact({ proposedClientAction: APPLY }),
      });
      await flush();

      expect(screen.queryByTestId("confirmation-card")).toBeNull();
      expect(word.word.writes()).toEqual([]);
    });
  });
  describe("v1 review contract", () => {
    it("keeps all 41 edits in scope when filtering a long document", async () => {
      const texts = Array.from(
        { length: 320 },
        (_, i) => `Paragraph ${i + 1} original.`,
      );
      const artifact = makeArtifact();
      const longCapture: WordDocumentCapture = {
        identity: IDENTITY,
        ordinalMap: new Map(
          texts.map((text, i) => [
            i + 1,
            { text, uniqueLocalId: `id-${i + 1}` },
          ]),
        ),
        paragraphsSent: 107,
        renderedOrdinals: new Set(Array.from({ length: 107 }, (_, i) => i + 1)),
        partialOrdinal: null,
      };
      word.word.setParagraphs(
        texts.map((text, i) => ({
          text: i === 0 || i === 2 || i === 4 ? "Manually changed" : text,
        })),
      );
      const edits = Array.from({ length: 41 }, (_, i) => ({
        paragraph: i * 2 + 1,
        text: `Replacement ${i + 1}.`,
      }));
      renderCard({
        artifact,
        captures: new Map([[artifact.messageId, longCapture]]),
        content: JSON.stringify({ edits }),
      });
      await flush();
      expect(
        screen.getByText("107 of 320 paragraphs included in full"),
      ).toBeInTheDocument();
      fireEvent.change(screen.getByRole("combobox", { name: "Paragraphs" }), {
        target: { value: "76" },
      });
      expect(
        within(screen.getByTestId("word-edits-list")).getAllByRole("listitem"),
      ).toHaveLength(3);
      expect(word.word.selections()).toHaveLength(0);
      fireEvent.click(
        screen.getByRole("button", { name: "Apply all 41 edits" }),
      );
      await flush();
      const receipt = within(screen.getByTestId("word-review-receipt"));
      expect(receipt.getByText("38 edits applied")).toBeVisible();
      expect(
        receipt.getByText("38 applied · 3 skipped · 0 failed"),
      ).toBeVisible();
      expect(screen.getByTestId("word-edits-list")).not.toBeVisible();
      expect(
        word.word.writes().filter((write) => write.kind === "insertText"),
      ).toHaveLength(38);
      expect(word.word.paragraphs()[0].text).toBe("Manually changed");
    });

    it("browses without moving Word, and locates only on explicit request", async () => {
      renderCard({ artifact: makeArtifact() });
      await flush();
      fireEvent.click(screen.getByRole("tab", { name: "Original" }));
      expect(word.word.selections()).toHaveLength(0);
      fireEvent.click(screen.getByRole("button", { name: "Show in Word ↗" }));
      await flush();
      expect(word.word.selections()).toEqual([["id-2"]]);
      expect(word.word.writes()).toEqual([]);
      fireEvent.click(screen.getByRole("button", { name: "Apply edit" }));
      await flush();
      fireEvent.click(screen.getByRole("button", { name: "Show details" }));
      fireEvent.click(screen.getByRole("button", { name: "Show in Word ↗" }));
      await flush();
      expect(word.word.selections()).toEqual([["id-2"], ["id-2"]]);
    });

    it("retains outcomes and comparison across a card remount and prevents replay", async () => {
      const artifact = makeArtifact();
      const captures = new Map([[artifact.messageId, capture()]]);
      const view = renderCard({ artifact, captures });
      await flush();
      fireEvent.click(screen.getByRole("button", { name: "Apply edit" }));
      await flush();
      view.rerender(
        <WordWriteProvider
          documentIdentity={IDENTITY}
          capturesByAssistantMessageId={captures}
        >
          {null}
        </WordWriteProvider>,
      );
      view.rerender(
        <WordWriteProvider
          documentIdentity={IDENTITY}
          capturesByAssistantMessageId={captures}
        >
          <WordHostCardRenderer
            language="erato-word-edits"
            content={EDITS_FENCE}
          />
        </WordWriteProvider>,
      );
      await flush();
      expect(screen.getByTestId("word-review-receipt")).toBeVisible();
      expect(screen.getByTestId("word-edit-report")).not.toBeVisible();
      expect(screen.queryByRole("button", { name: "Apply edit" })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Show details" }));
      fireEvent.click(screen.getByRole("tab", { name: "Original" }));
      expect(screen.getByRole("tabpanel")).toHaveTextContent("Bravo.");
      fireEvent.click(screen.getByRole("button", { name: "Hide details" }));
      expect(screen.queryByRole("tabpanel")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Show details" }));
      expect(screen.getByRole("tab", { name: "Original" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      expect(word.word.writes()).toHaveLength(1);
    });

    it("disables result location after a Revert attempt, including failed restoration", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      renderCard({ artifact: makeArtifact() });
      await flush();
      fireEvent.click(screen.getByRole("button", { name: "Apply edit" }));
      await flush();
      fireEvent.click(screen.getByTestId("word-revert-button"));
      expect(word.word.writes()).toHaveLength(1);
      word.word.run.mockRejectedValueOnce(new Error("Restoration failed"));
      fireEvent.click(screen.getByRole("button", { name: "Restore body" }));
      await flush();
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Some content may already have been restored",
      );
      expect(screen.queryByTestId("word-revert-button")).toBeNull();
      expect(
        screen.getByRole("button", { name: "Location unavailable" }),
      ).toBeDisabled();
    });

    it("rechecks the host tracking mode immediately before writing", async () => {
      renderCard({ artifact: makeArtifact() });
      await flush();
      expect(
        screen.getByText(/Erato does not add revision marks/),
      ).toBeInTheDocument();
      word.word.setTrackingMode("TrackAll");
      fireEvent.click(screen.getByRole("button", { name: "Apply edit" }));
      await flush();
      expect(
        screen.getByText(/Word Track Changes is already on/),
      ).toBeInTheDocument();
      expect(word.word.writes()).toHaveLength(1);
    });

    it("does not expose writes for a complete JSON fence while generation is active", () => {
      const artifact = makeArtifact();
      const view = renderCard({ artifact });
      mockUseChatContext.mockReturnValue({
        messages: {
          [artifact.messageId]: {
            id: artifact.messageId,
            role: "assistant",
            status: "sending",
          },
        },
        messageOrder: [artifact.messageId],
        currentChatId: "chat-1",
      });
      view.rerender(
        <WordWriteProvider
          documentIdentity={IDENTITY}
          capturesByAssistantMessageId={
            new Map([[artifact.messageId, capture()]])
          }
        >
          <WordHostCardRenderer
            language="erato-word-edits"
            content={EDITS_FENCE}
          />
        </WordWriteProvider>,
      );
      expect(screen.getByText("Preparing changes…")).toBeInTheDocument();
      expect(screen.queryByRole("button")).toBeNull();
      expect(word.word.writes()).toEqual([]);
    });
  });
});
