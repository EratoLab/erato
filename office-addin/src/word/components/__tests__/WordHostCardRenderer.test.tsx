import { i18n } from "@lingui/core";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { messages as frontendMessages } from "../../../../../frontend/src/locales/en/messages.po";
import { TestTheme } from "../../../test/helpers/TestTheme";
import {
  installMockWordDocument,
  uninstallMockWordDocument,
} from "../../../test/mocks/word/document";
import { WordWriteProvider } from "../../providers/WordWriteProvider";
import { WordHostCardRenderer } from "../WordHostCardRenderer";

import type { MockWordHost } from "../../../test/mocks/word/document";
import type * as EratoLibrary from "@erato/frontend/library";
import type { WordDocumentCapture } from "@erato/frontend/word-review";

const mockUseHostArtifact = vi.fn();
const mockUseChatContext = vi.fn();
const server = vi.hoisted(() => ({
  decisions: {},
}));

vi.mock("@erato/frontend/library", async (importOriginal) => {
  return {
    ...(await importOriginal<typeof EratoLibrary>()),
    SyntaxHighlightedCode: ({ code }: { code: string }) => <pre>{code}</pre>,
    useChatContext: () => mockUseChatContext(),
    ...(await import("../../../test/helpers/eratoLibraryMock")).chatHooksFrom(
      () => mockUseChatContext(),
    ),
    useHostArtifact: () => mockUseHostArtifact(),
    useApprovalTools: () => [
      { qualified_name: "word/apply_edits", client_actions: [APPLY] },
      { qualified_name: "word/insert_at_cursor", client_actions: [INSERT] },
    ],
    useProfile: () => ({
      profile: { client_tool_decisions: server.decisions },
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
  isFreshCompletion?: boolean;
  itemIdentity?: string;
  proposedClientAction?: string;
}

let nextMessageId = 0;

function makeArtifact(overrides: Partial<TestArtifact> = {}): TestArtifact {
  nextMessageId += 1;
  return {
    facetId: REVIEW_FACET,
    renderMode: "suggestions",
    messageId: `word-msg-${nextMessageId}`,
    cardFenceLanguages: ["erato-word-edits", "erato-word-insert"],
    allowedClientActions: [APPLY],
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
  /** The user's decisions on the server, by tool. */
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
  server.decisions = options.decisions ?? {};

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
  return view;
}

const flush = () => act(() => Promise.resolve());

describe("WordHostCardRenderer", () => {
  let word: MockWordHost;

  beforeEach(() => {
    i18n.load("en", frontendMessages);
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

    it("hides the action the user set to Never", () => {
      renderCard({
        artifact: makeArtifact({ proposedClientAction: APPLY }),
        decisions: { "word/apply_edits": "never_allow" },
      });

      expect(screen.queryByRole("button", { name: /^Apply/ })).toBeNull();
    });

    it("still offers the action under Ask or Always", () => {
      renderCard({
        artifact: makeArtifact(),
        decisions: { "word/apply_edits": "always_allow" },
      });

      expect(
        screen.getByRole("button", { name: /^Apply (edit|all \d+ edits)$/ }),
      ).toBeEnabled();
    });
  });

  describe("the identity gate", () => {
    it("folds to what it proposed after a pane reload, with no Apply even when opened", () => {
      renderCard({ artifact: makeArtifact(), captures: new Map() });

      expect(screen.getByTestId("word-review-receipt")).toHaveTextContent(
        /^Proposed: /,
      );
      expect(screen.queryByRole("button", { name: /^Apply/ })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Show details" }));
      expect(
        screen.getByText(/no longer has the document snapshot/),
      ).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^Apply/ })).toBeNull();
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
      const receipt = screen.getByTestId("word-review-receipt");
      expect(receipt).toHaveTextContent("1 edit applied");
      expect(receipt).toHaveTextContent("1 skipped");
      expect(receipt).not.toHaveTextContent("failed");
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
        screen.getByText(/Nothing is restored if the body changed since/),
      ).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Restore body" }));
      await flush();

      expect(word.word.paragraphs().map((entry) => entry.text)).toEqual(
        PARAGRAPHS,
      );
      expect(screen.queryByTestId("word-revert-button")).toBeNull();
      expect(screen.getByTestId("word-review-receipt")).toHaveTextContent(
        "Undone: Change 1 paragraph",
      );
      fireEvent.click(screen.getByRole("button", { name: "Show details" }));
      expect(
        screen.getByRole("heading", { name: "Undone: Change 1 paragraph" }),
      ).toBeVisible();
      fireEvent.click(screen.getByRole("button", { name: /Paragraph 2/ }));
      expect(screen.queryByText(/restored to just before/)).toBeNull();
      expect(screen.queryByText(/Revert is unavailable/)).toBeNull();
    });

    it("keeps a later edit and the Revert when the body changed after the batch", async () => {
      renderCard({ artifact: makeArtifact() });

      fireEvent.click(
        screen.getByRole("button", {
          name: /^Apply (edit|all \d+ edits)$/,
        }),
      );
      await flush();
      word.word.setParagraphs([
        { text: "Alpha." },
        { text: "Bravo, revised." },
        { text: "Charlie, typed later." },
      ]);

      fireEvent.click(screen.getByTestId("word-revert-button"));
      fireEvent.click(screen.getByRole("button", { name: "Restore body" }));
      await flush();

      expect(word.word.writes()).toEqual([]);
      expect(word.word.paragraphs()[2].text).toBe("Charlie, typed later.");
      expect(
        screen.getByText(
          "The document changed after applying. Revert was not run because it could remove later edits.",
        ),
      ).toBeInTheDocument();
      expect(screen.queryByText(/Turn off Track Changes/)).toBeNull();
      expect(screen.getByTestId("word-revert-button")).toBeInTheDocument();
    });

    it("does not restore the body over Track Changes turned on after a direct Apply", async () => {
      renderCard({ artifact: makeArtifact() });

      fireEvent.click(
        screen.getByRole("button", {
          name: /^Apply (edit|all \d+ edits)$/,
        }),
      );
      await flush();
      word.word.setTrackingMode("TrackAll");
      const writes = word.word.writes().length;

      fireEvent.click(screen.getByTestId("word-revert-button"));
      fireEvent.click(screen.getByRole("button", { name: "Restore body" }));
      await flush();

      expect(word.word.writes()).toHaveLength(writes);
      expect(
        screen.getByText(
          "Revert was not run because Track Changes is on. Turn off Track Changes, then revert the batch again.",
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/Edits are applied directly/),
      ).toBeInTheDocument();
      expect(screen.queryByText(/Track Changes is on, so Erato/)).toBeNull();
      expect(screen.getByTestId("word-revert-button")).toBeInTheDocument();
    });

    it("offers no Apply while Track Changes is on, and says why", async () => {
      word.word.setTrackingMode("TrackAll");
      renderCard({ artifact: makeArtifact() });
      await flush();

      expect(screen.queryByRole("button", { name: /^Apply/ })).toBeNull();
      expect(
        screen.getByText(
          "Track Changes is on, so Erato doesn't apply these edits. Make them in Word yourself.",
        ),
      ).toBeInTheDocument();
    });

    it("never offers a proposal read under Track Changes", async () => {
      const artifact = makeArtifact({ proposedClientAction: APPLY });
      renderCard({
        artifact,
        captures: new Map([
          [artifact.messageId, capture({ trackChanges: true })],
        ]),
      });
      await flush();

      expect(screen.queryByRole("button", { name: /^Apply/ })).toBeNull();
      expect(
        screen.getByText(/Track Changes is on, so Erato doesn't apply/),
      ).toBeInTheDocument();
      expect(word.word.writes()).toEqual([]);
    });

    const returnToPane = () =>
      act(async () => {
        window.dispatchEvent(new Event("blur"));
        window.dispatchEvent(new Event("focus"));
        await Promise.resolve();
      });
    const applyButton = () =>
      screen.queryByRole("button", { name: /^Apply (edit|all \d+ edits)$/ });

    it("offers Apply again once Track Changes is turned off in Word", async () => {
      word.word.setTrackingMode("TrackAll");
      renderCard({ artifact: makeArtifact() });
      await flush();
      expect(applyButton()).toBeNull();

      word.word.setTrackingMode("Off");
      await returnToPane();

      expect(applyButton()).toBeInTheDocument();
      expect(
        screen.getByText(/Edits are applied directly/),
      ).toBeInTheDocument();
      expect(screen.queryByText(/Track Changes is on, so Erato/)).toBeNull();
    });

    it("withholds Apply once Track Changes is turned on in Word", async () => {
      renderCard({ artifact: makeArtifact() });
      await flush();
      expect(applyButton()).toBeInTheDocument();

      word.word.setTrackingMode("TrackAll");
      await returnToPane();

      expect(applyButton()).toBeNull();
      expect(
        screen.getByText(/Track Changes is on, so Erato doesn't apply/),
      ).toBeInTheDocument();
    });

    it("keeps a capture read under Track Changes withheld after Track Changes is turned off", async () => {
      const artifact = makeArtifact();
      renderCard({
        artifact,
        captures: new Map([
          [artifact.messageId, capture({ trackChanges: true })],
        ]),
      });
      await flush();

      await returnToPane();

      expect(applyButton()).toBeNull();
      expect(
        screen.getByText(/Track Changes is on, so Erato doesn't apply/),
      ).toBeInTheDocument();
    });

    it("names the authors of revisions that refused an edit, as plain text", async () => {
      word.word.setParagraphs([
        { text: "Alpha." },
        {
          text: "Bravo.",
          ooxml:
            '<w:ins w:id="1" w:author="&lt;b&gt;Eve&lt;/b&gt;"><w:r><w:t>x</w:t></w:r></w:ins>',
        },
        { text: "Charlie." },
      ]);
      renderCard({ artifact: makeArtifact() });

      fireEvent.click(screen.getByRole("button", { name: "Apply edit" }));
      await flush();

      expect(word.word.writes()).toEqual([]);
      expect(
        screen.getByText(
          "Skipped - the paragraph has tracked changes by <b>Eve</b>; accept or reject them in Word, then ask again",
        ),
      ).toBeInTheDocument();
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

      expect(screen.getByRole("alert")).toHaveTextContent(
        "Some changes may already be in the document",
      );
      expect(screen.getByTestId("word-edits-list")).toBeVisible();
      expect(screen.queryByTestId("word-review-receipt")).toBeNull();
      expect(screen.getByTestId("word-revert-button")).toBeInTheDocument();

      fireEvent.click(screen.getByTestId("word-revert-button"));
      expect(
        screen.getByText(/Nothing is restored if the body changed since/),
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
        "0 edits applied1 skipped",
      );
    });
  });

  describe("failure and expiry states", () => {
    it("reports an edits batch Word never accepted as an error", async () => {
      renderCard({ artifact: makeArtifact() });
      await flush();
      uninstallMockWordDocument();

      fireEvent.click(screen.getByRole("button", { name: "Apply edit" }));
      await flush();

      expect(screen.getByRole("alert")).toHaveTextContent(
        "Word did not accept the change. Nothing was written",
      );
      expect(
        screen.getByRole("heading", { name: "Batch could not be completed" }),
      ).toBeInTheDocument();
      expect(screen.queryByTestId("word-review-receipt")).toBeNull();
      expect(screen.queryByTestId("word-revert-button")).toBeNull();
    });

    it("reports a rejected insert as an error", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      renderCard({
        artifact: makeArtifact({
          facetId: COMPOSE_FACET,
          allowedClientActions: [INSERT],
        }),
        language: "erato-word-insert",
        content: "A drafted paragraph.",
      });
      await flush();
      word.word.run.mockRejectedValue(new Error("Insert rejected"));

      fireEvent.click(
        screen.getByRole("button", { name: "Insert the text at the cursor" }),
      );
      await flush();

      expect(screen.getByRole("alert")).toHaveTextContent(
        "Word did not accept the change",
      );
      expect(word.word.writes()).toEqual([]);
      expect(screen.getByText("A drafted paragraph.")).toBeVisible();
    });

    it("says Undo expired once a later batch replaced the snapshot", async () => {
      const artifact = makeArtifact();
      mockUseHostArtifact.mockReturnValue(artifact);
      mockUseChatContext.mockReturnValue({
        messages: {
          [artifact.messageId]: { id: artifact.messageId, role: "assistant" },
        },
        messageOrder: [artifact.messageId],
        currentChatId: "chat-1",
      });
      render(
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
          <WordHostCardRenderer
            language="erato-word-edits"
            content={JSON.stringify({
              edits: [{ paragraph: 3, text: "Charlie, revised." }],
            })}
          />
        </WordWriteProvider>,
        { wrapper: TestTheme },
      );
      await flush();
      const [first, second] = screen
        .getAllByTestId("word-edits-card")
        .map((card) => within(card));

      fireEvent.click(first.getByRole("button", { name: "Apply edit" }));
      await flush();
      expect(first.getByTestId("word-revert-button")).toBeInTheDocument();
      fireEvent.click(second.getByRole("button", { name: "Apply edit" }));
      await flush();

      expect(first.queryByTestId("word-revert-button")).toBeNull();
      expect(second.getByTestId("word-revert-button")).toHaveTextContent(
        "Undo",
      );
      expect(first.queryByText(/Revert is unavailable/)).toBeNull();
      fireEvent.click(first.getByRole("button", { name: "Show details" }));
      expect(
        first.getByText(/Its single-use snapshot was consumed or replaced/),
      ).toBeInTheDocument();
    });

    it("tells a half-written batch how to recover once its Revert is gone", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const artifact = makeArtifact();
      mockUseHostArtifact.mockReturnValue(artifact);
      mockUseChatContext.mockReturnValue({
        messages: {
          [artifact.messageId]: { id: artifact.messageId, role: "assistant" },
        },
        messageOrder: [artifact.messageId],
        currentChatId: "chat-1",
      });
      render(
        <WordWriteProvider
          documentIdentity={IDENTITY}
          capturesByAssistantMessageId={
            new Map([[artifact.messageId, capture()]])
          }
        >
          <WordHostCardRenderer
            language="erato-word-edits"
            content={JSON.stringify({
              edits: [
                { paragraph: 1, text: "Alpha, revised." },
                { paragraph: 2, text: "Bravo, revised." },
              ],
            })}
          />
          <WordHostCardRenderer
            language="erato-word-edits"
            content={JSON.stringify({
              edits: [{ paragraph: 3, text: "Charlie, revised." }],
            })}
          />
        </WordWriteProvider>,
        { wrapper: TestTheme },
      );
      await flush();
      const [first, second] = screen
        .getAllByTestId("word-edits-card")
        .map((card) => within(card));

      word.word.failWriteOn("id-2");
      fireEvent.click(first.getByRole("button", { name: /^Apply all/ }));
      await flush();
      expect(first.getByTestId("word-revert-button")).toBeInTheDocument();
      expect(first.queryByText(/Revert is unavailable/)).toBeNull();
      word.word.failWriteOn(null);
      fireEvent.click(second.getByRole("button", { name: "Apply edit" }));
      await flush();

      expect(first.queryByTestId("word-revert-button")).toBeNull();
      expect(
        first.getByText(
          "Revert is unavailable for this batch. Use Undo in Word to remove anything that was written.",
        ),
      ).toBeInTheDocument();
    });

    it("heads the proposal by size and scope, not by apply progress", async () => {
      renderCard({ artifact: makeArtifact() });
      await flush();
      expect(
        screen.getByRole("heading", { name: "Change 1 paragraph" }),
      ).toBeInTheDocument();
      expect(screen.getByText("Small")).toBeInTheDocument();
      expect(screen.queryByText(/included in full/)).toBeNull();
      expect(screen.queryByText(/Request window/)).toBeNull();
      expect(screen.queryByText(/\d+ of \d+ shown/)).toBeNull();
      const run = word.word.run.getMockImplementation()!;
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      word.word.run.mockImplementation(async (callback) => {
        await held;
        return run(callback);
      });
      fireEvent.click(screen.getByRole("button", { name: "Apply edit" }));
      await screen.findByRole("button", { name: "Checking document…" });
      expect(screen.queryByText(/Applying \d+ edits/)).toBeNull();
      expect(
        screen.getByRole("heading", { name: "Change 1 paragraph" }),
      ).toBeInTheDocument();
      release();
      await flush();
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

    it("ends an earlier Undo once text is inserted", async () => {
      word.word.setSelection("");
      const artifact = makeArtifact();
      mockUseChatContext.mockReturnValue({
        messages: {
          [artifact.messageId]: { id: artifact.messageId, role: "assistant" },
        },
        messageOrder: [artifact.messageId],
        currentChatId: "chat-1",
      });
      mockUseHostArtifact.mockReturnValue(artifact);
      const cards = (withInsert: boolean) => (
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
          {withInsert && (
            <WordHostCardRenderer
              language="erato-word-insert"
              content="A drafted paragraph."
            />
          )}
        </WordWriteProvider>
      );
      const view = render(cards(false), { wrapper: TestTheme });
      await flush();
      fireEvent.click(screen.getByRole("button", { name: "Apply edit" }));
      await flush();
      expect(screen.getByTestId("word-revert-button")).toBeInTheDocument();

      mockUseHostArtifact.mockReturnValue({
        ...artifact,
        facetId: COMPOSE_FACET,
        allowedClientActions: [INSERT],
      });
      view.rerender(cards(true));
      expect(screen.getByTestId("word-revert-button")).toBeInTheDocument();
      fireEvent.click(
        screen.getByRole("button", { name: "Insert the text at the cursor" }),
      );
      await flush();
      expect(
        screen.getByText("Inserted into the document."),
      ).toBeInTheDocument();
      expect(screen.queryByTestId("word-revert-button")).toBeNull();
    });

    it("goes through the same identity gate as apply", () => {
      renderCard({
        artifact: makeArtifact({
          facetId: COMPOSE_FACET,
          allowedClientActions: [INSERT],
        }),
        language: "erato-word-insert",
        content: "A drafted paragraph.",
        currentIdentity: "pane-session:other",
      });

      expect(
        screen.getByRole("button", { name: "Insert the text at the cursor" }),
      ).toBeDisabled();
    });

    it("folds to what it proposed after a pane reload", () => {
      renderCard({
        artifact: makeArtifact({
          facetId: COMPOSE_FACET,
          allowedClientActions: [INSERT],
        }),
        language: "erato-word-insert",
        content: "A drafted paragraph.",
        captures: new Map(),
      });

      expect(screen.getByTestId("word-review-receipt")).toHaveTextContent(
        "Proposed: Insert text",
      );
      expect(
        screen.queryByRole("button", { name: "Insert the text at the cursor" }),
      ).toBeNull();
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
        screen.getByText(/Request window: paragraphs 1–107\./),
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
      expect(receipt.getByText("3 skipped")).toBeVisible();
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
      fireEvent.click(screen.getByRole("button", { name: "Show in Word" }));
      await flush();
      expect(word.word.selections()).toEqual([["id-2"]]);
      expect(word.word.writes()).toEqual([]);
      fireEvent.click(screen.getByRole("button", { name: "Apply edit" }));
      await flush();
      fireEvent.click(screen.getByRole("button", { name: "Show details" }));
      fireEvent.click(screen.getByRole("button", { name: "Show in Word" }));
      await flush();
      expect(word.word.selections()).toEqual([["id-2"], ["id-2"]]);
    });

    it("keeps the Apply button focused and busy while Word works, then releases it", async () => {
      renderCard({ artifact: makeArtifact() });
      await flush();
      const run = word.word.run.getMockImplementation()!;
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      word.word.run.mockImplementation(async (callback) => {
        await held;
        return run(callback);
      });
      const apply = screen.getByRole("button", { name: "Apply edit" });
      apply.focus();
      fireEvent.click(apply);
      const busy = await screen.findByRole("button", {
        name: "Checking document…",
      });
      expect(busy).toBe(apply);
      expect(busy).toHaveAttribute("aria-busy", "true");
      expect(busy).toHaveFocus();
      fireEvent.click(busy);
      release();
      await waitFor(() =>
        expect(
          screen.queryByRole("button", { name: /Apply edit|…$/ }),
        ).toBeNull(),
      );
      expect(word.word.writes()).toHaveLength(1);
      expect(document.querySelector('[aria-busy="true"]')).toBeNull();
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
        screen.getByText(/Track Changes is on, so Erato doesn't apply/),
      ).toBeInTheDocument();
      expect(word.word.writes()).toEqual([]);
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
