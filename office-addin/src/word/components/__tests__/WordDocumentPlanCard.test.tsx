import { ConversationMessagesProvider } from "@erato/frontend/library";
import { i18n } from "@lingui/core";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { messages as frontendMessages } from "../../../../../frontend/src/locales/en/messages.po";
import { TestTheme } from "../../../test/helpers/TestTheme";
import {
  examplePlan,
  packageXml,
  paragraph,
  readySnapshot,
  wordSerializationNoise,
} from "../../../test/mocks/word/authoringFixtures";
import { storedWordReads } from "../../../test/mocks/word/historyReads";
import {
  editWordPackage,
  installWordOoxmlHost,
} from "../../../test/mocks/word/ooxmlHost";
import {
  SENTINEL,
  captureRealisticSnapshot,
  realisticWordPackageXml,
  statusRewritePlan,
} from "../../../test/mocks/word/realisticWordFixtures";
import { WordWriteProvider } from "../../providers/WordWriteProvider";
import { buildWordArtifact } from "../../utils/buildWordArtifact";
import { WordDocumentReadSession } from "../../utils/wordDocumentReadTool";
import {
  createWordDocumentSubmissionExecutor,
  WORD_SUBMIT_PLAN_TOOL,
} from "../../utils/wordDocumentSubmission";
import { wordDocumentFingerprint } from "../../utils/wordDocumentXml";
import {
  ALL_WORD_IN_PLACE_CAPABILITIES,
  setWordInPlaceCapabilitiesForTests,
  wordInPlaceCapabilities,
} from "../../utils/wordInPlaceCapabilities";
import {
  WORD_COMPATIBILITY_MODE_KEY,
  resetWordInPlaceLatchForTests,
} from "../../utils/wordInPlaceSwitch";
import { WordHostCardRenderer } from "../WordHostCardRenderer";

import type { WordOoxmlHostOptions } from "../../../test/mocks/word/ooxmlHost";
import type * as EratoLibrary from "@erato/frontend/library";
import type {
  WordAuthoringSnapshot,
  WordDocumentCapture,
  WordDocumentPlan,
  WordPlanEntry,
} from "@erato/frontend/word-review";
import type { ReactNode } from "react";

const mock = vi.hoisted(() => {
  const artifact: Record<string, unknown> = {};
  return {
    artifact,
    decisions: {},
    setDecisions: vi.fn(),
    messageStatus: "completed",
    content: [] as unknown[],
  };
});
vi.mock("@erato/frontend/library", async (importOriginal) => ({
  ...(await importOriginal<typeof EratoLibrary>()),
  CopyErrorButton: () => null,
  useHostArtifact: () => mock.artifact,
  useChatContext: () => ({
    messages: {
      [String(mock.artifact.messageId)]: {
        id: String(mock.artifact.messageId),
        status: mock.messageStatus,
        role: "assistant",
        content: mock.content,
      },
    },
    messageOrder: [String(mock.artifact.messageId)],
  }),
  usePersistedState: () => [mock.decisions, mock.setDecisions],
  useConfirmationRegistryStore: (select: (value: unknown) => unknown) =>
    select({
      registerConfirmation: () => {},
      unregisterConfirmation: () => {},
    }),
  ActionConfirmationCard: ({
    onAllowOnce,
    onDeny,
    onAlwaysAllow,
    alwaysAllowDisabledReason,
    denyLabel,
    isBusy,
    progressLabel,
  }: {
    onAllowOnce: () => void;
    onDeny: () => void;
    onAlwaysAllow: () => void;
    alwaysAllowDisabledReason?: string;
    denyLabel?: string;
    isBusy: boolean;
    progressLabel?: string;
  }) => (
    <div>
      {progressLabel && <output>{progressLabel}</output>}
      <button disabled={isBusy} onClick={onAllowOnce}>
        Allow once
      </button>
      <button
        disabled={isBusy || !!alwaysAllowDisabledReason}
        onClick={onAlwaysAllow}
      >
        Always allow
      </button>
      {alwaysAllowDisabledReason && <p>{alwaysAllowDisabledReason}</p>}
      <button onClick={onDeny}>{denyLabel}</button>
    </div>
  ),
}));
/** The chat the message list exposes to message renderers, as the mocked context holds it. */
function Conversation({ children }: { children: ReactNode }) {
  const id = String(mock.artifact.messageId);
  const [messages] = useState(() => ({
    [id]: {
      id,
      status: mock.messageStatus,
      role: "assistant",
      content: mock.content,
      createdAt: "2026-10-01T00:00:00Z",
    } as EratoLibrary.Message,
  }));
  return (
    <TestTheme>
      <ConversationMessagesProvider messages={messages}>
        {children}
      </ConversationMessagesProvider>
    </TestTheme>
  );
}
function setup(
  ooxml?: string,
  buildPlan: (snapshot: WordAuthoringSnapshot) => WordDocumentPlan = (
    snapshot,
  ) => examplePlan(snapshot.token),
) {
  const snapshot = readySnapshot(ooxml);
  const messageId = String(mock.artifact.messageId);
  snapshot.ownerMessageId = messageId;
  const plan = buildPlan(snapshot);
  const capture: WordDocumentCapture = {
    identity: "doc-A",
    authoring: snapshot,
    ordinalMap: new Map(
      snapshot.blocks.map((b, i) => [
        i + 1,
        { uniqueLocalId: b.ref, text: b.text },
      ]),
    ),
    paragraphsSent: 6,
    renderedOrdinals: new Set([1, 2, 3, 4, 5, 6]),
    partialOrdinal: null,
  };
  let current = snapshot.ooxml;
  let fail = false;
  let unreadable = false;
  let noise = false;
  const insert = vi.fn((value: string) => {
    current = noise ? wordSerializationNoise(value) : value;
    if (fail) throw new Error("Uncertain write");
  });
  const context = {
    document: {
      changeTrackingMode: "Off",
      load: vi.fn(),
      body: {
        getOoxml: () => {
          if (unreadable && insert.mock.calls.length)
            throw new Error("Read failed");
          return { value: current };
        },
        insertOoxml: insert,
      },
    },
    sync: async () => {},
  };
  vi.stubGlobal("Word", {
    run: async (callback: (context: Word.RequestContext) => Promise<unknown>) =>
      callback(context as unknown as Word.RequestContext),
  });
  const mount = () =>
    render(
      <WordWriteProvider
        documentIdentity="doc-A"
        capturesByAssistantMessageId={new Map([[messageId, capture]])}
      >
        <WordHostCardRenderer
          language="erato-word-document-plan"
          content={JSON.stringify(plan)}
        />
      </WordWriteProvider>,
      { wrapper: Conversation },
    );
  return {
    snapshot,
    plan,
    capture,
    insert,
    mount,
    fail: () => {
      fail = true;
    },
    failRead: () => {
      unreadable = true;
    },
    resume: () => {
      fail = false;
      unreadable = false;
    },
    noise: () => {
      noise = true;
      current = wordSerializationNoise(current);
    },
    change: () => {
      current = current.replace("Recommendation", "Later edit");
    },
    editSource: () => {
      current = current.replace("Context", "Later context");
    },
    fingerprint: () => wordDocumentFingerprint(current),
  };
}
const APPLIED = "Applied: Change 5 items";
/** The building-blocks card names Apply after the plan's size and kind. */
const APPLY_LABEL = /^(Apply changes?|Replace document|Insert paragraphs)$/;
const heading = (text: string) =>
  `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
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
const CHAPTERS = packageXml(
  ["Intro", "Scope", "Plan", "Notes"]
    .map((name) => heading(name) + paragraph(`${name} body.`))
    .join(""),
);
const bodyPlan = (
  snapshot: WordAuthoringSnapshot,
  entries: WordDocumentPlan["entries"],
  deleted: WordDocumentPlan["deleted"] = [],
): WordDocumentPlan => ({
  version: 1,
  snapshot: snapshot.token,
  readToken: "read-proof",
  scope: "body",
  entries,
  deleted,
});
/** Hold every Word batch until released, to observe the in-progress UI. */
function holdWord() {
  const word = (
    globalThis as unknown as {
      Word: { run: (callback: never) => Promise<unknown> };
    }
  ).Word;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.stubGlobal("Word", {
    run: async (callback: never) => {
      await held;
      return word.run(callback);
    },
  });
  return release;
}
function renderRealisticCard(
  snapshot: ReturnType<typeof readySnapshot>,
  content: string,
) {
  const messageId = String(mock.artifact.messageId);
  const capture: WordDocumentCapture = {
    identity: "doc-A",
    authoring: snapshot,
    ordinalMap: new Map(),
    paragraphsSent: snapshot.blocks.length,
    renderedOrdinals: new Set(),
    partialOrdinal: null,
  };
  return render(
    <WordWriteProvider
      documentIdentity="doc-A"
      capturesByAssistantMessageId={new Map([[messageId, capture]])}
    >
      <WordHostCardRenderer
        language="erato-word-document-plan"
        content={content}
      />
    </WordWriteProvider>,
    { wrapper: TestTheme },
  );
}
beforeEach(() => {
  i18n.load("en", frontendMessages);
  i18n.activate("en");
  mock.decisions = {};
  mock.setDecisions.mockClear();
  mock.messageStatus = "completed";
  mock.content = [];
  mock.artifact = {
    facetId: "word_document_authoring",
    messageId: globalThis.crypto.randomUUID(),
    itemIdentity: "doc-A",
    allowedClientActions: ["word.apply_document_plan"],
    isFreshCompletion: true,
    clientActionPresentation: "render_buttons",
  };
});
afterEach(() => {
  cleanup();
  localStorage.removeItem(WORD_COMPATIBILITY_MODE_KEY);
  delete window.WORD_FORCE_IMPORT_APPLY;
  resetWordInPlaceLatchForTests();
  setWordInPlaceCapabilitiesForTests(undefined);
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe("structural document review", () => {
  it("requires consent for an accepted submission, then applies once with recovery", async () => {
    const state = setup();
    const session = new WordDocumentReadSession();
    const context = {
      toolCallId: "submission",
      messageId: String(mock.artifact.messageId),
      chatId: "chat-A",
    };
    session.activate(state.snapshot, context);
    await session.execute(
      { snapshot: state.snapshot.token },
      { ...context, toolCallId: "read" },
    );
    state.plan.readToken = state.snapshot.readToken!;
    const result = await createWordDocumentSubmissionExecutor(session)(
      state.plan,
      context,
    );
    expect(state.insert).not.toHaveBeenCalled();
    if (!result.ok) throw new Error("Expected accepted plan");
    mock.artifact = {
      ...buildWordArtifact({
        facetId: "word_document_authoring",
        clientActionInfo: {
          clientActions: ["word.apply_document_plan"],
          alwaysAskActions: ["word.apply_document_plan"],
          presentation: "auto_prompt",
        },
        content: [
          {
            content_type: "tool_use",
            tool_name: WORD_SUBMIT_PLAN_TOOL,
            tool_call_id: context.toolCallId,
            status: "success",
            input: state.plan,
            output: {
              status: "success",
              result: result.result,
              submission: { status: "accepted" },
            },
          } as unknown as EratoLibrary.ContentPart,
        ],
        messageId: context.messageId,
        capture: state.capture,
      }),
    };
    state.mount();
    const allow = await screen.findByRole("button", { name: "Allow once" });
    expect(state.insert).not.toHaveBeenCalled();
    fireEvent.click(allow);
    await screen.findByText(APPLIED);
    expect(state.insert).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Undo" })).toBeEnabled();
  });

  it("restores a saved submission for inspection after a pane reload without enabling Apply", async () => {
    const state = setup();
    mock.artifact.submittedCard = {
      toolCallId: "saved",
      language: "erato-word-document-plan",
      content: JSON.stringify(state.plan),
    };
    mock.artifact.isFreshCompletion = false;
    delete mock.artifact.itemIdentity;
    render(
      <WordWriteProvider
        documentIdentity="doc-A"
        capturesByAssistantMessageId={new Map()}
      >
        <WordHostCardRenderer
          language="erato-word-document-plan"
          content={JSON.stringify(state.plan)}
        />
      </WordWriteProvider>,
      { wrapper: Conversation },
    );
    expect(
      screen.getByRole("heading", { name: "Change 5 items" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Apply changes" }),
    ).toBeDisabled();
    expect(screen.getByText("Recommendation")).toBeVisible();
    expect(
      screen.getByText(/original document is not available in this session/),
    ).toBeVisible();
    expect(screen.queryByText(/Headers, footers/)).toBeNull();
    expect(screen.queryByText(/reused ·|source blocks/)).toBeNull();
    expect(state.insert).not.toHaveBeenCalled();
  });

  it("reviews a reloaded plan in full against the read stored in the chat, without enabling Apply", async () => {
    const state = setup(CHAPTERS, (snapshot) =>
      bodyPlan(
        snapshot,
        [{ kind: "keep", source: ["b1", "b2", "b3", "b4", "b7", "b8"] }],
        [{ source: ["b5", "b6"], reason: "Plan moved elsewhere." }],
      ),
    );
    mock.content = await storedWordReads(
      globalThis.structuredClone(state.snapshot),
      String(mock.artifact.messageId),
    );
    mock.artifact.submittedCard = {
      toolCallId: "saved",
      language: "erato-word-document-plan",
      content: JSON.stringify(state.plan),
    };
    mock.artifact.isFreshCompletion = false;
    delete mock.artifact.itemIdentity;
    render(
      <WordWriteProvider
        documentIdentity="doc-A"
        capturesByAssistantMessageId={new Map()}
      >
        <WordHostCardRenderer
          language="erato-word-document-plan"
          content={JSON.stringify(state.plan)}
        />
      </WordWriteProvider>,
      { wrapper: Conversation },
    );
    expect(screen.getByText("Check first")).toBeVisible();
    expect(
      screen.getByRole("button", {
        name: "1 heading is no longer in the document",
      }),
    ).toBeVisible();
    expect(
      screen.queryByText(/original document is not available in this session/),
    ).toBeNull();
    const apply = screen.getByRole("button", { name: "Apply changes" });
    expect(apply).toBeDisabled();
    fireEvent.click(apply);
    expect(state.insert).not.toHaveBeenCalled();
  });

  it("applies through the live capture even when the chat also holds the read", async () => {
    const state = setup();
    const stale = globalThis.structuredClone(state.snapshot);
    stale.blocks[2].text = "Stale history";
    mock.content = await storedWordReads(
      stale,
      String(mock.artifact.messageId),
    );
    state.mount();
    expect(screen.queryByText(/Stale history/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Apply changes" }));
    await waitFor(() => expect(screen.getByText(APPLIED)).toBeInTheDocument());
    expect(state.insert).toHaveBeenCalledTimes(1);
  });

  it("applies one coherent plan then collapses, reopens and guards later edits", async () => {
    const state = setup();
    const { container } = state.mount();
    expect(
      screen.getByRole("heading", { name: "Change 5 items" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Medium")).toBeInTheDocument();
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(container).not.toHaveTextContent(
      /\bb\d\b|source blocks read|reused ·|\d pt\b/,
    );
    fireEvent.click(screen.getByRole("button", { name: "Preview the result" }));
    expect(
      screen.getByRole("region", { name: "Preview of the result" }),
    ).toHaveTextContent("Pilot in October. Retain support.");
    fireEvent.click(screen.getByRole("button", { name: "Apply changes" }));
    await waitFor(() => expect(screen.getByText(APPLIED)).toBeInTheDocument());
    expect(state.insert).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Show details" }));
    expect(
      screen.getByRole("heading", { name: "Change 5 items" }),
    ).toBeVisible();
    state.change();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() =>
      expect(screen.getByText(/Revert was not run/)).toBeInTheDocument(),
    );
    expect(state.insert).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    expect(screen.queryByText(/Undo available/)).toBeNull();
    expect(
      screen.getByRole("button", { name: "Download original body" }),
    ).toBeInTheDocument();
  });
  it("keeps the Apply button focused and busy with the current stage, then releases it", async () => {
    const state = setup();
    state.mount();
    const release = holdWord();
    const apply = screen.getByRole("button", {
      name: "Apply changes",
    });
    apply.focus();
    fireEvent.click(apply);
    const busy = await screen.findByRole("button", { name: "Saving backup…" });
    expect(busy).toBe(apply);
    expect(busy).toHaveAttribute("aria-busy", "true");
    expect(busy).toHaveAttribute("aria-disabled", "true");
    expect(busy).toHaveFocus();
    expect(
      screen.queryByText(/Applying and verifying/),
    ).not.toBeInTheDocument();
    fireEvent.click(busy);
    release();
    await screen.findByText(APPLIED);
    expect(state.insert).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });
  it("locks Apply on every other card while one card writes", async () => {
    const state = setup();
    render(
      <WordWriteProvider
        documentIdentity="doc-A"
        capturesByAssistantMessageId={
          new Map([[String(mock.artifact.messageId), state.capture]])
        }
      >
        {[0, 2].map((indent) => (
          <WordHostCardRenderer
            key={indent}
            language="erato-word-document-plan"
            content={JSON.stringify(state.plan, null, indent)}
          />
        ))}
      </WordWriteProvider>,
      { wrapper: Conversation },
    );
    const release = holdWord();
    const [first, second] = screen.getAllByRole("button", {
      name: "Apply changes",
    });
    fireEvent.click(first);
    await screen.findByRole("button", { name: "Saving backup…" });
    expect(second).toBeDisabled();
    fireEvent.click(second);
    release();
    await screen.findByText(APPLIED);
    expect(state.insert).toHaveBeenCalledTimes(1);
  });
  it("releases the busy Apply button after a failed write", async () => {
    const state = setup();
    state.fail();
    state.mount();
    fireEvent.click(screen.getByRole("button", { name: "Apply changes" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("partially changed"),
    );
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });
  it("shows the current stage on the consent card while applying", async () => {
    mock.artifact.clientActionPresentation = "auto_prompt";
    mock.artifact.proposedClientAction = "word.apply_document_plan";
    const state = setup();
    state.mount();
    const release = holdWord();
    fireEvent.click(await screen.findByRole("button", { name: "Allow once" }));
    expect(await screen.findByText("Saving backup…")).toBeInTheDocument();
    release();
    await screen.findByText(APPLIED);
    expect(state.insert).toHaveBeenCalledTimes(1);
  });
  it("blocks a forged complete-read token and never writes", () => {
    const state = setup();
    state.plan.readToken = "forged";
    state.mount();
    expect(
      screen.getByRole("button", { name: "Apply changes" }),
    ).toBeDisabled();
    expect(
      screen.getByText(/complete document has not been read/),
    ).toBeInTheDocument();
    expect(state.insert).not.toHaveBeenCalled();
  });
  it("keeps uncertain writes expanded with a retained backup and guarded restoration", async () => {
    const state = setup();
    state.fail();
    state.mount();
    fireEvent.click(screen.getByRole("button", { name: "Apply changes" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("partially changed"),
    );
    expect(screen.queryByText(APPLIED)).toBeNull();
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Download original body" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Restore original body" }),
    ).toBeInTheDocument();
    expect(state.insert).toHaveBeenCalledTimes(1);
    state.resume();
    fireEvent.click(
      screen.getByRole("button", { name: "Restore original body" }),
    );
    await waitFor(() => expect(state.insert).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Download original body" }),
      ).toBeNull(),
    );
  });
  it("retains a downloadable original when an interrupted write cannot be read back", async () => {
    const state = setup();
    state.fail();
    state.failRead();
    state.mount();
    fireEvent.click(screen.getByRole("button", { name: "Apply changes" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("partially changed"),
    );
    expect(
      screen.queryByRole("button", { name: "Restore original body" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Download original body" }),
    ).toBeInTheDocument();
    expect(state.insert).toHaveBeenCalledTimes(1);
  });
  it("downloads the exact pre-write body after an interrupted restoration", async () => {
    const state = setup();
    state.mount();
    fireEvent.click(screen.getByRole("button", { name: "Apply changes" }));
    await screen.findByText(APPLIED);
    state.fail();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("partially changed"),
    );
    const createObjectURL = vi.fn<(blob: Blob) => string>(
      () => "blob:original-body",
    );
    vi.stubGlobal(
      "URL",
      class extends URL {
        static createObjectURL = createObjectURL;
        static revokeObjectURL = vi.fn();
      },
    );
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        expect(this.download).toBe("word-body-before-rewrite.xml");
        expect(this.href).toBe("blob:original-body");
      });
    vi.useFakeTimers();
    fireEvent.click(
      screen.getByRole("button", { name: "Download original body" }),
    );
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    expect(click).toHaveBeenCalledOnce();
    const blob = createObjectURL.mock.calls[0][0];
    const text = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsText(blob);
    });
    expect(text).toBe(state.snapshot.ooxml);
    state.resume();
    fireEvent.click(
      screen.getByRole("button", { name: "Restore original body" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Download original body" }),
      ).toBeNull(),
    );
    expect(state.insert).toHaveBeenCalledTimes(3);
  });
  it("does not report failure after harmless Word serialization changes", async () => {
    const state = setup();
    state.noise();
    state.mount();
    fireEvent.click(screen.getByRole("button", { name: "Apply changes" }));
    await waitFor(() => expect(screen.getByText(APPLIED)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(state.insert).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("discloses Word's own first-paragraph spacing change and keeps the exact original downloadable after a content-tier Revert", async () => {
    window.WORD_FORCE_IMPORT_APPLY = true;
    const word = installWordOoxmlHost(realisticWordPackageXml(), {
      profile: "word-pc-16.0.20326",
      spacingDrift: true,
    });
    const messageId = String(mock.artifact.messageId);
    const snapshot = await captureRealisticSnapshot(messageId);
    const capture: WordDocumentCapture = {
      identity: "doc-A",
      authoring: snapshot,
      ordinalMap: new Map(),
      paragraphsSent: snapshot.blocks.length,
      renderedOrdinals: new Set(),
      partialOrdinal: null,
    };
    render(
      <WordWriteProvider
        documentIdentity="doc-A"
        capturesByAssistantMessageId={new Map([[messageId, capture]])}
      >
        <WordHostCardRenderer
          language="erato-word-document-plan"
          content={JSON.stringify(
            statusRewritePlan(snapshot, "Status: revised."),
          )}
        />
      </WordWriteProvider>,
      { wrapper: TestTheme },
    );
    fireEvent.click(screen.getByRole("button", { name: APPLY_LABEL }));
    await screen.findByText("Applied with Word adjustments");
    const note = screen.getByTestId("word-plan-adjustments");
    expect(note).toBeVisible();
    expect(note).toHaveTextContent(
      "Word also changed the spacing before the first paragraph.",
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(word.insert).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole("button", { name: "Download original document" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await screen.findByText(/^(Restored the document|Undone: )/);
    expect(word.insert).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    expect(screen.getByTestId("word-plan-adjustments")).toHaveTextContent(
      "Word also changed the spacing before the first paragraph.",
    );
    expect(
      screen.getByRole("button", { name: "Download original document" }),
    ).toBeInTheDocument();
  });
  it("applies an eligible rewrite in place, then undoes exactly that paragraph", async () => {
    const word = installWordOoxmlHost(realisticWordPackageXml(), {
      profile: "word-pc-16.0.20326",
    });
    const original = wordDocumentFingerprint(word.ooxml());
    const messageId = String(mock.artifact.messageId);
    const snapshot = await captureRealisticSnapshot(messageId);
    renderRealisticCard(
      snapshot,
      JSON.stringify(statusRewritePlan(snapshot, "Status: revised in place.")),
    );
    fireEvent.click(screen.getByRole("button", { name: APPLY_LABEL }));
    await screen.findByText(/^Applied: /);
    expect(word.insert).not.toHaveBeenCalled();
    expect(word.ooxml()).toContain("Status: revised in place.");
    expect(screen.queryByTestId("word-plan-adjustments")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await screen.findByText(/^(Restored the document|Undone: )/);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(wordDocumentFingerprint(word.ooxml())).toBe(original);
    expect(word.insert).not.toHaveBeenCalled();
  });
  it("says the rewrite went in as tracked changes, then rejects them on Revert", async () => {
    setWordInPlaceCapabilitiesForTests(ALL_WORD_IN_PLACE_CAPABILITIES);
    const word = installWordOoxmlHost(realisticWordPackageXml(), {
      profile: "word-pc-16.0.20326",
      trackChanges: true,
    });
    word.setTrackingMode("TrackAll");
    const original = wordDocumentFingerprint(word.ooxml());
    const messageId = String(mock.artifact.messageId);
    const snapshot = await captureRealisticSnapshot(messageId, "TrackAll");
    renderRealisticCard(
      snapshot,
      JSON.stringify(
        statusRewritePlan(snapshot, "Status: revised as tracked."),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: APPLY_LABEL }));
    await screen.findByText(/^Applied: /);
    expect(screen.getByTestId("word-plan-adjustments")).toHaveTextContent(
      "Applied as tracked changes under your name.",
    );
    expect(word.ooxml()).toContain("<w:ins ");
    fireEvent.click(
      screen.getByRole("button", { name: "Reject these tracked changes" }),
    );
    await screen.findByText(/^(Restored the document|Undone: )/);
    expect(screen.queryByTestId("word-plan-adjustments")).toBeNull();
    expect(wordDocumentFingerprint(word.ooxml())).toBe(original);
    expect(word.insert).not.toHaveBeenCalled();
  });
  it("explains that a full rewrite cannot run while Track Changes is on", async () => {
    setWordInPlaceCapabilitiesForTests(ALL_WORD_IN_PLACE_CAPABILITIES);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const word = installWordOoxmlHost(realisticWordPackageXml(), {
      profile: "word-pc-16.0.20326",
      trackChanges: true,
    });
    word.setTrackingMode("TrackAll");
    const messageId = String(mock.artifact.messageId);
    const snapshot = await captureRealisticSnapshot(messageId, "TrackAll");
    renderRealisticCard(
      snapshot,
      JSON.stringify({
        ...statusRewritePlan(snapshot, "Status: revised."),
        sections: [
          {
            id: "final",
            source: "section-1",
            layout: { orientation: "landscape" },
          },
        ],
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: APPLY_LABEL }));
    expect(
      await screen.findByText(
        "This change needs a full-document rewrite, which can't run while Track Changes is on. Turn off Track Changes or ask for a smaller edit.",
      ),
    ).toBeInTheDocument();
    expect(word.insert).not.toHaveBeenCalled();
    expect(word.events.some((e) => e.startsWith("mutation:"))).toBe(false);
  });
  it("keeps the original downloadable when an in-place Revert would overwrite a later edit", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const word = installWordOoxmlHost(realisticWordPackageXml(), {
      profile: "word-pc-16.0.20326",
    });
    const messageId = String(mock.artifact.messageId);
    const snapshot = await captureRealisticSnapshot(messageId);
    renderRealisticCard(
      snapshot,
      JSON.stringify(statusRewritePlan(snapshot, "Status: revised in place.")),
    );
    fireEvent.click(screen.getByRole("button", { name: APPLY_LABEL }));
    await screen.findByText(/^Applied: /);
    word.editParagraph(1, "Status: the user's own words.");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await screen.findByText(/Revert was not run/);
    expect(word.ooxml()).toContain("Status: the user's own words.");
    expect(
      screen.getByRole("button", { name: "Download original document" }),
    ).toBeInTheDocument();
  });
  it("offers the saved original and an in-place restore after Word stopped partway", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const word = installWordOoxmlHost(realisticWordPackageXml(), {
      profile: "word-pc-16.0.20326",
    });
    const original = wordDocumentFingerprint(word.ooxml());
    const messageId = String(mock.artifact.messageId);
    const snapshot = await captureRealisticSnapshot(messageId);
    const plan = statusRewritePlan(snapshot, "Status: two changes.");
    const closing = snapshot.blocks.findIndex(
      (b) => b.text === "Closing paragraph.",
    );
    plan.entries = snapshot.blocks.map((b, i) =>
      i === 1 || i === closing
        ? {
            kind: "replace",
            source: [b.ref],
            blocks: [
              {
                id: `n${i}`,
                type: "paragraph",
                text: i === 1 ? "Status: two changes." : "Goodbye.",
              },
            ],
          }
        : { kind: "keep", source: [b.ref] },
    );
    renderRealisticCard(snapshot, JSON.stringify(plan));
    word.failAtCommand(2);
    fireEvent.click(screen.getByRole("button", { name: APPLY_LABEL }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Word stopped after 1 of 2 changes. Your original is saved.",
      ),
    );
    expect(
      screen.getByRole("button", { name: "Download original document" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await screen.findByText(/^(Restored the document|Undone: )/);
    expect(wordDocumentFingerprint(word.ooxml())).toBe(original);
    expect(word.insert).not.toHaveBeenCalled();
  });
  it("respects the structural action permission independently of paragraph edits", () => {
    mock.decisions = {
      "word_document_authoring/word.apply_document_plan": "never",
      "word_document_authoring/word.apply_edits": "always",
    };
    const state = setup();
    state.mount();
    expect(screen.queryByRole("button", { name: "Apply changes" })).toBeNull();
    expect(state.insert).not.toHaveBeenCalled();
  });
  it("asks separately for a rewrite even when paragraph edits are always allowed", async () => {
    mock.artifact.clientActionPresentation = "auto_prompt";
    mock.artifact.proposedClientAction = "word.apply_document_plan";
    mock.decisions = { "word_document_authoring/word.apply_edits": "always" };
    const state = setup();
    state.mount();
    await screen.findByRole("button", { name: "Allow once" });
    expect(state.insert).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(
      screen.getByText("Proposal declined. Nothing was written."),
    ).toBeInTheDocument();
    expect(state.insert).not.toHaveBeenCalled();
  });
  it("shows only a spinner while the plan is still streaming", () => {
    mock.messageStatus = "sending";
    const state = setup();
    state.mount();
    expect(screen.getByText("Preparing document changes…")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
    expect(state.insert).not.toHaveBeenCalled();
  });
  it("reports an unreadable plan without offering to apply it", () => {
    const state = setup();
    const messageId = String(mock.artifact.messageId);
    render(
      <WordWriteProvider
        documentIdentity="doc-A"
        capturesByAssistantMessageId={new Map([[messageId, state.capture]])}
      >
        <WordHostCardRenderer
          language="erato-word-document-plan"
          content="{not a plan"
        />
      </WordWriteProvider>,
      { wrapper: Conversation },
    );
    expect(
      screen.getByText(
        "The proposed document plan is incomplete or invalid. Ask for a corrected plan; nothing was applied.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });
  it("greys out Always allow when the organization requires confirmation", async () => {
    mock.artifact.clientActionPresentation = "auto_prompt";
    mock.artifact.proposedClientAction = "word.apply_document_plan";
    mock.artifact.alwaysAskClientActions = ["word.apply_document_plan"];
    const state = setup();
    state.mount();
    const always = await screen.findByRole("button", { name: "Always allow" });
    expect(always).toBeDisabled();
    expect(
      screen.getByText(
        "Your organization requires confirmation each time this action runs automatically.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(always);
    expect(mock.setDecisions).not.toHaveBeenCalled();
    expect(state.insert).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Allow once" })).toBeEnabled();
  });
  it("shows a one-cell table edit as a small change with the new cell text", () => {
    const state = setup(
      packageXml(paragraph("Allocation") + TABLE),
      (snapshot) => {
        const table = snapshot.blocks[1];
        return bodyPlan(snapshot, [
          { kind: "keep", source: ["b1"] },
          {
            kind: "replace",
            source: [table.ref],
            blocks: [
              {
                id: "cell-edit",
                type: "table",
                text: "",
                sourceRef: table.ref,
                rows: table.content!.rows.map((row) => ({
                  sourceIndex: row.sourceIndex,
                  cells: row.cells.map((cell) => ({
                    sourceIndex: cell.sourceIndex,
                    ...(row.sourceIndex === 2 && cell.sourceIndex === 1
                      ? { textEdit: { expectedText: "18", text: "21" } }
                      : {}),
                  })),
                })),
              },
            ],
          },
        ]);
      },
    );
    const { container } = state.mount();
    expect(
      screen.getByRole("heading", { name: "Change 1 table cell" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Small")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Apply change" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Table/ }));
    expect(container.querySelector("ins")).toHaveTextContent("21");
    expect(container.querySelector("del")).toHaveTextContent("18");
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(container).not.toHaveTextContent(
      /Existing content retained|\d pt\b/,
    );
  });
  it("groups a large rewrite by section, hides unchanged ones and jumps to risks", async () => {
    const state = setup(CHAPTERS, (snapshot) =>
      bodyPlan(
        snapshot,
        [
          { kind: "keep", source: ["b1"] },
          {
            kind: "replace",
            source: ["b2"],
            blocks: [{ id: "n1", type: "paragraph", text: "New intro." }],
          },
          { kind: "keep", source: ["b3"] },
          {
            kind: "replace",
            source: ["b4"],
            blocks: [{ id: "n2", type: "paragraph", text: "New scope." }],
          },
          { kind: "keep", source: ["b7", "b8"] },
        ],
        [{ source: ["b5", "b6"], reason: "Plan moved elsewhere." }],
      ),
    );
    state.mount();
    expect(screen.getByText("Large")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Update 3 of 4 sections" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Only changed" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.queryByRole("button", { name: /^Notes/ })).toBeNull();
    const plan = screen.getByRole("button", { name: /^Plan/ });
    expect(plan).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(
      screen.getByRole("button", {
        name: "1 heading is no longer in the document",
      }),
    );
    expect(plan).toHaveAttribute("aria-expanded", "true");
    const row = document.querySelector('[data-row-key="deleted:b5"]')!;
    await waitFor(() =>
      expect(
        within(row as HTMLElement).getAllByRole("button")[0],
      ).toHaveFocus(),
    );
    fireEvent.click(screen.getByRole("tab", { name: "All" }));
    expect(screen.getByRole("button", { name: /^Notes/ })).toBeInTheDocument();
  });
  it("shows a summary across sections as one continuous preview", () => {
    const state = setup(CHAPTERS, (snapshot) =>
      bodyPlan(snapshot, [
        {
          kind: "replace",
          source: snapshot.blocks.map((block) => block.ref),
          blocks: [
            { id: "s1", type: "heading", level: 1, text: "Summary" },
            { id: "s2", type: "paragraph", text: "All four parts, briefly." },
          ],
        },
      ]),
    );
    state.mount();
    expect(screen.getByText("Restructured")).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Preview of the result" }),
    ).toHaveTextContent("All four parts, briefly.");
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Scope/ })).toBeNull();
  });
  it("caps a long restructured preview and points its risks at it", async () => {
    const state = setup(
      packageXml(
        heading("Intro") +
          paragraph("Intro body.") +
          heading("Rest") +
          paragraph("Rest body."),
      ),
      (snapshot) =>
        bodyPlan(snapshot, [
          {
            kind: "replace",
            source: snapshot.blocks.map((block) => block.ref),
            blocks: Array.from({ length: 60 }, (_, i) => ({
              id: `p${i}`,
              type: "paragraph" as const,
              text: `Line ${i + 1}.`,
            })),
          },
        ]),
    );
    state.mount();
    const preview = screen.getByRole("region", {
      name: "Preview of the result",
    });
    expect(preview).toHaveTextContent("Line 40.");
    expect(preview).not.toHaveTextContent("Line 41.");
    expect(preview).toHaveTextContent(
      "20 more blocks not shown here. Check them in Word after applying.",
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "2 headings are no longer in the document",
      }),
    );
    await waitFor(() => expect(preview).toHaveFocus());
  });
  it("offers nothing to apply when the plan keeps the document as it is", () => {
    const state = setup(undefined, (snapshot) =>
      bodyPlan(
        snapshot,
        snapshot.blocks.map((block) => ({ kind: "keep", source: [block.ref] })),
      ),
    );
    state.mount();
    expect(
      screen.getByRole("heading", { name: "Nothing to change" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Apply changes" }),
    ).toBeDisabled();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });
  it("says when the plan was written for another open document", () => {
    mock.artifact.itemIdentity = "doc-B";
    const state = setup();
    state.mount();
    expect(
      screen.getByText(/written about a different document/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Apply changes" }),
    ).toBeDisabled();
  });
  it("reports a stale plan without writing and without offering to apply again", async () => {
    const state = setup();
    state.mount();
    state.editSource();
    fireEvent.click(screen.getByRole("button", { name: "Apply changes" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "The document changed. Nothing was applied.",
      ),
    );
    expect(state.insert).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Apply changes" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });
  it("shows the restore in progress, then a receipt naming what was undone", async () => {
    const state = setup();
    state.mount();
    fireEvent.click(screen.getByRole("button", { name: "Apply changes" }));
    await screen.findByText(APPLIED);
    const release = holdWord();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(
      await screen.findByText("Checking and restoring the document…"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    release();
    expect(
      await screen.findByText("Undone: Change 5 items"),
    ).toBeInTheDocument();
    expect(state.insert).toHaveBeenCalledTimes(2);
  });
  it("notes an automatic run under Always allow on the receipt", async () => {
    mock.artifact.clientActionPresentation = "auto_prompt";
    mock.artifact.proposedClientAction = "word.apply_document_plan";
    mock.decisions = {
      "word_document_authoring/word.apply_document_plan": "always",
    };
    const state = setup();
    state.mount();
    await screen.findByText(APPLIED);
    expect(
      screen.getByText("Automatic action under your Always allow setting."),
    ).toBeInTheDocument();
    expect(state.insert).toHaveBeenCalledTimes(1);
  });
});

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const CLOSING = "Closing paragraph.";

/** The realistic document with an en-GB run in the closing paragraph, which a faulty
 * insertText "Replace" loses. */
function closingLanguageFixture(): string {
  return editWordPackage(realisticWordPackageXml(), (doc) => {
    const run = Array.from(doc.getElementsByTagNameNS(W, "t")).find(
      (t) => t.textContent === CLOSING,
    )!.parentElement!;
    const props = doc.createElementNS(W, "w:rPr");
    const lang = doc.createElementNS(W, "w:lang");
    lang.setAttributeNS(W, "w:val", "en-GB");
    props.append(lang);
    run.prepend(props);
  });
}

/** Keep everything and swap in `entry` for the block whose text starts with `prefix`. */
function replaceBlock(
  snapshot: WordAuthoringSnapshot,
  prefix: string,
  entry: (ref: string) => WordPlanEntry[],
  extra: Partial<WordDocumentPlan> = {},
): WordDocumentPlan {
  return {
    version: 1,
    snapshot: snapshot.token,
    readToken: "read-proof",
    scope: "document",
    deleted: [],
    entries: snapshot.blocks.flatMap((b) =>
      b.text.startsWith(prefix)
        ? entry(b.ref)
        : [{ kind: "keep", source: [b.ref] }],
    ),
    ...extra,
  };
}

async function mountRealistic(
  makePlan: (snapshot: WordAuthoringSnapshot) => WordDocumentPlan,
  options: WordOoxmlHostOptions & { tracking?: string; xml?: string } = {},
) {
  const {
    tracking = "Off",
    xml = realisticWordPackageXml(),
    ...host
  } = options;
  const word = installWordOoxmlHost(xml, {
    profile: "word-pc-16.0.20326",
    ...host,
  });
  if (tracking !== "Off") word.setTrackingMode(tracking);
  const snapshot = await captureRealisticSnapshot(
    String(mock.artifact.messageId),
    tracking,
  );
  renderRealisticCard(snapshot, JSON.stringify(makePlan(snapshot)));
  return { word, snapshot };
}

const routeText = () => screen.getByTestId("word-plan-route").textContent;
const apply = () =>
  fireEvent.click(screen.getByRole("button", { name: APPLY_LABEL }));

describe("route preview", () => {
  it("says an eligible rewrite edits its passages in place", async () => {
    await mountRealistic((s) => statusRewritePlan(s, "Status: revised."));
    expect(routeText()).toBe("Edits 1 passage in place.");
  });

  it("says the passages go in as tracked changes under the user's name", async () => {
    setWordInPlaceCapabilitiesForTests(ALL_WORD_IN_PLACE_CAPABILITIES);
    await mountRealistic((s) => statusRewritePlan(s, "Status: revised."), {
      trackChanges: true,
      tracking: "TrackAll",
    });
    expect(routeText()).toBe(
      "Edits 1 passage in place as tracked changes under your name.",
    );
  });

  it("warns before Apply that Track Changes blocks a full rewrite", async () => {
    setWordInPlaceCapabilitiesForTests(ALL_WORD_IN_PLACE_CAPABILITIES);
    const { word } = await mountRealistic(
      (s) => ({
        ...statusRewritePlan(s, "Status: revised."),
        sections: [
          {
            id: "final",
            source: "section-1",
            layout: { orientation: "landscape" },
          },
        ],
      }),
      { trackChanges: true, tracking: "TrackAll" },
    );
    expect(routeText()).toBe(
      "This change needs a full-document rewrite, which can't run while Track Changes is on. Turn off Track Changes or ask for a smaller edit.",
    );
    expect(word.insert).not.toHaveBeenCalled();
  });

  it.each<
    [string, (snapshot: WordAuthoringSnapshot) => WordDocumentPlan, string]
  >([
    [
      "sections",
      (s) => ({
        ...statusRewritePlan(s, "Status: revised."),
        sections: [
          {
            id: "final",
            source: "section-1",
            layout: { orientation: "landscape" },
          },
        ],
      }),
      "Replaces the whole document because it changes sections or page layout.",
    ],
    [
      "stories",
      (s) => ({
        ...statusRewritePlan(s, "Status: revised."),
        stories: [
          {
            kind: "upsert",
            type: "header",
            id: "header1",
            blocks: [{ id: "h0", type: "paragraph", text: "Revised header" }],
          },
        ],
      }),
      "Replaces the whole document because it changes headers, footers, notes or comments.",
    ],
    [
      "moves",
      (s) => {
        const refs = s.blocks.map((b) => b.ref);
        return {
          ...statusRewritePlan(s, "Status: revised."),
          entries: [
            { kind: "keep", source: [refs[0]] },
            { kind: "keep", source: [refs[2]] },
            { kind: "keep", source: [refs[1]] },
            { kind: "keep", source: refs.slice(3) },
          ],
        };
      },
      "Replaces the whole document because it moves content.",
    ],
    [
      "objects",
      (s) =>
        replaceBlock(s, "Region", (ref) => [
          {
            kind: "replace",
            source: [ref],
            blocks: [{ id: "t", type: "paragraph", text: "No table." }],
          },
        ]),
      "Replaces the whole document because it changes tables, images or other objects.",
    ],
    [
      "formatting",
      (s) =>
        replaceBlock(s, "Status", (ref) => [
          {
            kind: "replace",
            source: [ref],
            blocks: [
              {
                id: "c",
                type: "paragraph",
                text: "Status: centred.",
                format: { alignment: "center" },
              },
            ],
          },
        ]),
      "Replaces the whole document because it changes formatting or styles.",
    ],
    [
      "lists",
      (s) =>
        replaceBlock(s, "Open questions", (ref) => [
          {
            kind: "replace",
            source: [ref],
            blocks: [
              {
                id: "l",
                type: "list-item",
                text: "Open questions follow.",
                list: "fresh",
                level: 0,
                ordered: true,
              },
            ],
          },
        ]),
      "Replaces the whole document because it changes lists.",
    ],
  ])(
    "names why a %s change replaces the whole document",
    async (_, makePlan, text) => {
      await mountRealistic(makePlan);
      expect(routeText()).toBe(text);
    },
  );

  it("names why a paragraphs change replaces the whole document where inserting awaits its probe", async () => {
    setWordInPlaceCapabilitiesForTests({
      ...wordInPlaceCapabilities("PC"),
      insert: false,
    });
    await mountRealistic((s) =>
      replaceBlock(s, "Status", (ref) => [
        { kind: "keep", source: [ref] },
        {
          kind: "insert",
          blocks: [{ id: "a", type: "paragraph", text: "An added line." }],
        },
      ]),
    );
    expect(routeText()).toBe(
      "Replaces the whole document because it adds, removes or splits paragraphs.",
    );
  });

  it("says compatibility mode makes every rewrite a full replacement, and Apply follows it", async () => {
    localStorage.setItem(WORD_COMPATIBILITY_MODE_KEY, "1");
    const { word } = await mountRealistic(
      (s) => statusRewritePlan(s, "Status: revised."),
      { profile: "word-web" },
    );
    expect(routeText()).toBe(
      "Replaces the whole document because compatibility mode is on.",
    );
    apply();
    await screen.findByText(/^Applied: /);
    expect(word.insert).toHaveBeenCalledTimes(1);
  });

  it("does not blame the change when in-place writing is switched off", async () => {
    window.WORD_FORCE_IMPORT_APPLY = true;
    await mountRealistic((s) => statusRewritePlan(s, "Status: revised."));
    expect(routeText()).toBe(
      "Replaces the whole document (in-place editing is off).",
    );
  });

  it("keeps the general reason for a change the classifier cannot write in place", async () => {
    await mountRealistic((s) =>
      replaceBlock(s, "Status", (ref) => [
        {
          kind: "replace",
          source: [ref],
          blocks: [{ id: "e", type: "paragraph", text: "" }],
        },
      ]),
    );
    expect(routeText()).toBe(
      "Replaces the whole document because this change can't be written in place.",
    );
  });
});

describe("apply outcomes", () => {
  it("verified in place: headline, Undo and Show changes in Word", async () => {
    const { word } = await mountRealistic((s) =>
      statusRewritePlan(s, "Status: revised in place."),
    );
    apply();
    const receipt = await screen.findByTestId("word-review-receipt");
    expect(receipt).toHaveTextContent(/Applied: /);
    expect(receipt).toHaveTextContent(
      "Verified: the document matches the proposal.",
    );
    expect(screen.getByRole("button", { name: "Undo" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Copy details" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Download original document" }),
    ).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Show changes in Word" }),
    );
    await waitFor(() =>
      expect(
        word.events.filter((e) => e.startsWith("select:paragraphs:")),
      ).toHaveLength(1),
    );
    expect(screen.queryByText(/cannot be located/)).toBeNull();
  });

  it("verified as tracked changes: Show changes selects the first revision", async () => {
    setWordInPlaceCapabilitiesForTests(ALL_WORD_IN_PLACE_CAPABILITIES);
    const { word } = await mountRealistic(
      (s) => statusRewritePlan(s, "Status: revised as tracked."),
      { trackChanges: true, tracking: "TrackAll" },
    );
    apply();
    await screen.findByText(/^Applied: /);
    expect(
      screen.getByRole("button", { name: "Reject these tracked changes" }),
    ).toBeEnabled();
    fireEvent.click(
      screen.getByRole("button", { name: "Show changes in Word" }),
    );
    await waitFor(() =>
      expect(
        word.events.filter((e) => e.startsWith("select:tracked-change:")),
      ).toHaveLength(1),
    );
    expect(word.events.some((e) => e.startsWith("select:paragraphs:"))).toBe(
      false,
    );
  });

  it("says when the written passage can no longer be found", async () => {
    const { word } = await mountRealistic((s) =>
      statusRewritePlan(s, "Status: revised in place."),
    );
    apply();
    await screen.findByText(/^Applied: /);
    word.userEdit((ooxml) =>
      editWordPackage(ooxml, (doc) =>
        Array.from(doc.getElementsByTagNameNS(W, "p"))
          .find((p) => p.textContent?.startsWith("Status"))!
          .remove(),
      ),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Show changes in Word" }),
    );
    expect(
      await screen.findByText(
        "This source passage has changed or cannot be located reliably.",
      ),
    ).toBeInTheDocument();
    expect(word.events.some((e) => e.startsWith("select:"))).toBe(false);
  });

  it("applied with Word adjustments: headline, disclosure and a content-free Copy details", async () => {
    window.WORD_FORCE_IMPORT_APPLY = true;
    const writeText = vi.fn(async (_text: string) => {});
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    await mountRealistic((s) => statusRewritePlan(s, "Status: revised."), {
      spacingDrift: true,
    });
    apply();
    const receipt = await screen.findByTestId("word-review-receipt");
    expect(receipt).toHaveTextContent("Applied with Word adjustments");
    expect(receipt).not.toHaveTextContent("Verified");
    expect(screen.getByTestId("word-plan-adjustments")).toHaveTextContent(
      "Word adjusted some details on its own while writing; the content matches the proposal. Word also changed the spacing before the first paragraph.",
    );
    expect(screen.getByRole("button", { name: "Undo" })).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: "Show changes in Word" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Copy details" }));
    await screen.findByText("Details copied.");
    const report = writeText.mock.calls[0][0];
    expect(report.split("\n")[0]).toBe(
      "Word add-in apply succeeded with adjustments",
    );
    expect(report).toContain("Route: import");
    expect(report).toContain("Verify tier: content");
    expect(report).toMatch(/Adjustments: .*first-paragraph-spacing/);
    expect(report).not.toContain(SENTINEL);
    expect(report).not.toContain("Status:");
  });

  it("unverified: counts the passages that do not match and locates each", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { word } = await mountRealistic(
      (s) =>
        replaceBlock(s, CLOSING, (ref) => [
          {
            kind: "replace",
            source: [ref],
            blocks: [
              {
                id: "bye",
                type: "paragraph",
                text: "Bye.",
                runs: [{ text: "Bye.", language: "en-GB" }],
              },
            ],
          },
        ]),
      { xml: closingLanguageFixture(), replaceDropsRunProperties: true },
    );
    apply();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Word wrote the changes, but 1 passage doesn't match the proposal. Your original is saved for recovery.",
    );
    expect(
      screen.getByRole("button", { name: "Restore original document" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Download original document" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Show changes in Word" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Locate passage 1" }));
    await waitFor(() =>
      expect(
        word.events.filter((e) => e.startsWith("select:paragraphs:")),
      ).toHaveLength(1),
    );
  });

  it("partly written: counts changes, not regions, when Word stops inside one region", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const rewrites: Record<string, string> = {
      "Confirm the regions.": "Confirm every region.",
      "Schedule the pilot.": "Schedule the pilot for October.",
    };
    const { word } = await mountRealistic((s) => ({
      version: 1,
      snapshot: s.token,
      readToken: "read-proof",
      scope: "document",
      deleted: [],
      entries: s.blocks.map(
        (b): WordPlanEntry =>
          rewrites[b.text]
            ? {
                kind: "replace",
                source: [b.ref],
                blocks: [
                  {
                    id: b.ref,
                    type: "list-item",
                    text: rewrites[b.text],
                    list: b.list,
                    ordered: b.ordered,
                    level: b.level,
                    styleRef: b.styleRef,
                  },
                ],
              }
            : { kind: "keep", source: [b.ref] },
      ),
    }));
    expect(routeText()).toBe("Edits 2 passages in place.");
    word.failAtCommand(2);
    apply();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Word stopped after 1 of 2 changes. Your original is saved.",
    );
  });

  it("does not claim a partial write when Word wrote every change before stopping", async () => {
    setWordInPlaceCapabilitiesForTests(ALL_WORD_IN_PLACE_CAPABILITIES);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { word } = await mountRealistic((s) =>
      replaceBlock(s, "Status", (ref) => [
        { kind: "keep", source: [ref] },
        {
          kind: "insert",
          blocks: [{ id: "h", type: "heading", level: 2, text: "Next steps" }],
        },
      ]),
    );
    // insertParagraph, insertText, then the heading style Word rejects.
    word.failAtCommand(3);
    apply();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Word could not complete the operation. The document may be partially changed.",
    );
    expect(alert).not.toHaveTextContent(/Word stopped after/);
  });

  it("not written: a changed target stops before writing, with nothing to restore", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { word } = await mountRealistic((s) =>
      statusRewritePlan(s, "Status: revised in place."),
    );
    word.editParagraph(1, "Status: the user's own words.");
    apply();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The document changed. Nothing was applied.",
    );
    expect(word.events.some((e) => e.startsWith("mutation:"))).toBe(false);
    for (const name of [
      "Undo these changes",
      "Restore original document",
      "Download original document",
    ])
      expect(screen.queryByRole("button", { name })).toBeNull();
  });

  it("locates a written passage from its review row after an in-place Apply", async () => {
    const { word, snapshot } = await mountRealistic((s) => {
      const status = s.blocks.find((b) => b.text.startsWith("Status"))!;
      // Live captures number every paragraph; the review only offers Show in Word for those.
      status.paragraphOrdinal = 2;
      s.readScopes = new Map([
        [
          "read-proof",
          {
            kind: "objects",
            snapshot: s.token,
            identity: s.identity,
            fingerprint: s.fingerprint,
            targets: [
              {
                ref: status.ref,
                kind: "paragraph",
                text: "",
                bodyRef: status.ref,
                detail: {},
              },
            ],
            plans: new Set(),
          },
        ],
      ]);
      return statusRewritePlan(s, "Status: revised in place.");
    });
    expect(snapshot.readScopes?.size).toBe(1);
    apply();
    await screen.findByText(/^Applied: /);
    fireEvent.click(screen.getByRole("button", { name: "Show details" }));
    fireEvent.click(screen.getByRole("button", { name: /^Paragraph/ }));
    fireEvent.click(screen.getByRole("button", { name: "Show in Word" }));
    await waitFor(() =>
      expect(
        word.events.filter((e) => e.startsWith("select:paragraphs:")),
      ).toHaveLength(1),
    );
  });
});
