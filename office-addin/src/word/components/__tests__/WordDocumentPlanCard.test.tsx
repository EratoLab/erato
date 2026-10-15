import { ConversationMessagesProvider } from "@erato/frontend/library";
import {
  canonicalWordPlan,
  normalizeWordDocumentPlan,
  parseWordDocumentPlan,
} from "@erato/frontend/word-review";
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
import { useState } from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from "vitest";

import { messages as frontendMessages } from "../../../../../frontend/src/locales/en/messages.po";
import { TestTheme } from "../../../test/helpers/TestTheme";
import {
  allowWordWebImport,
  setWordWebImport,
} from "../../../test/mocks/word/applyPolicy";
import {
  examplePlan,
  packageXml,
  paragraph,
  readySnapshot,
  wordSerializationNoise,
} from "../../../test/mocks/word/authoringFixtures";
import {
  CHAPTER_COMMENTS,
  chapterCommentsBody,
  withComments,
} from "../../../test/mocks/word/commentFixtures";
import { ooxmlHostCommentStates } from "../../../test/mocks/word/commentStates";
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
import { WORD_CLIENT_ACTIONS } from "../../utils/wordClientActions";
import {
  captureWordDocumentPackage,
  wordPackageFingerprint,
} from "../../utils/wordDocumentPackage";
import { WordDocumentReadSession } from "../../utils/wordDocumentReadTool";
import {
  createWordDocumentSubmissionExecutor,
  WORD_SUBMIT_PLAN_TOOL,
} from "../../utils/wordDocumentSubmission";
import {
  captureWordAuthoringSnapshot,
  compileWordDocumentPlan,
} from "../../utils/wordDocumentXml";
import {
  ALL_WORD_IN_PLACE_CAPABILITIES,
  setWordInPlaceCapabilitiesForTests,
  wordInPlaceCapabilities,
} from "../../utils/wordInPlaceCapabilities";
import {
  WORD_COMPATIBILITY_MODE_KEY,
  latchWordInPlace,
  resetWordInPlaceLatchForTests,
} from "../../utils/wordInPlaceSwitch";
import { readWordCommentStates } from "../../utils/wordPlanCommentCheck";
import { wordPlanCommentConsequences } from "../../utils/wordPlanComments";
import { WordHostCardRenderer } from "../WordHostCardRenderer";

import type { WordOoxmlHostOptions } from "../../../test/mocks/word/ooxmlHost";
import type * as wordPlanCommentCheckModule from "../../utils/wordPlanCommentCheck";
import type * as EratoLibrary from "@erato/frontend/library";
import type {
  WordAuthoringSnapshot,
  WordDocumentCapture,
  WordDocumentPlan,
  WordPlanEntry,
} from "@erato/frontend/word-review";
import type { ReactNode } from "react";

vi.mock("../../utils/wordPlanCommentCheck", async (importOriginal) => {
  const { ooxmlHostCommentStates } = await import(
    "../../../test/mocks/word/commentStates"
  );
  return {
    ...(await importOriginal<typeof wordPlanCommentCheckModule>()),
    readWordCommentStates: vi.fn(ooxmlHostCommentStates),
  };
});

const mock = vi.hoisted(() => {
  const artifact: Record<string, unknown> = {};
  /** Consent cards holding the chat's queued messages, as `${chatId}:${id}`. */
  const pendingConfirmations = new Set<string>();
  return {
    artifact,
    decisions: {},
    setDecisions: vi.fn(),
    messageStatus: "completed",
    content: [] as unknown[],
    request: "",
    restoreRequest: vi.fn(),
    pendingConfirmations,
    registerConfirmation: (chatId: string, id: string) =>
      void pendingConfirmations.add(`${chatId}:${id}`),
    unregisterConfirmation: (chatId: string, id: string) =>
      void pendingConfirmations.delete(`${chatId}:${id}`),
  };
});
vi.mock("@erato/frontend/library", async (importOriginal) => ({
  ...(await importOriginal<typeof EratoLibrary>()),
  CopyErrorButton: () => null,
  useHostArtifact: () => mock.artifact,
  useChatContext: () => ({
    messages: {
      request: {
        id: "request",
        role: "user",
        content: [{ content_type: "text", text: mock.request }],
      },
      [String(mock.artifact.messageId)]: {
        id: String(mock.artifact.messageId),
        status: mock.messageStatus,
        role: "assistant",
        content: mock.content,
        previous_message_id: "request",
      },
    },
    messageOrder: [String(mock.artifact.messageId)],
    currentChatId: "chat-A",
  }),
  usePersistedState: () => [mock.decisions, mock.setDecisions],
  useConfirmationRegistryStore: (select: (value: unknown) => unknown) =>
    select({
      registerConfirmation: mock.registerConfirmation,
      unregisterConfirmation: mock.unregisterConfirmation,
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
        restoreRequest={mock.restoreRequest}
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
    fingerprint: () => wordPackageFingerprint(current),
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
  const captures = new Map([[messageId, capture]]);
  const card = () => (
    <WordWriteProvider
      documentIdentity="doc-A"
      capturesByAssistantMessageId={captures}
      restoreRequest={mock.restoreRequest}
    >
      <WordHostCardRenderer
        language="erato-word-document-plan"
        content={content}
      />
    </WordWriteProvider>
  );
  const view = render(card(), { wrapper: TestTheme });
  return { ...view, refresh: () => view.rerender(card()) };
}
beforeEach(() => {
  i18n.load("en", frontendMessages);
  i18n.activate("en");
  mock.decisions = {};
  mock.setDecisions.mockClear();
  mock.messageStatus = "completed";
  mock.content = [];
  mock.request = "";
  mock.restoreRequest.mockClear();
  mock.pendingConfirmations.clear();
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
    const original = wordPackageFingerprint(word.ooxml());
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
    expect(wordPackageFingerprint(word.ooxml())).toBe(original);
    expect(word.insert).not.toHaveBeenCalled();
  });
  it("says the rewrite went in as tracked changes, then rejects them on Revert", async () => {
    setWordInPlaceCapabilitiesForTests(ALL_WORD_IN_PLACE_CAPABILITIES);
    const word = installWordOoxmlHost(realisticWordPackageXml(), {
      profile: "word-pc-16.0.20326",
      trackChanges: true,
    });
    word.setTrackingMode("TrackAll");
    const original = wordPackageFingerprint(word.ooxml());
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
    expect(wordPackageFingerprint(word.ooxml())).toBe(original);
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
    const original = wordPackageFingerprint(word.ooxml());
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
    expect(wordPackageFingerprint(word.ooxml())).toBe(original);
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
  it("says Word was still checking the language when the plan's capture was taken mid-pass", async () => {
    const state = setup();
    state.snapshot.proofingPending = true;
    state.mount();
    state.editSource();
    fireEvent.click(screen.getByRole("button", { name: "Apply changes" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Word was still checking the document's language when Erato read it. Nothing was applied.",
      ),
    );
    expect(state.insert).not.toHaveBeenCalled();
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
  options: WordOoxmlHostOptions & {
    tracking?: string;
    xml?: string;
    /** Everyone Word.Coauthoring lists, the user included; the host has no such object otherwise. */
    coauthors?: number;
    pendingUpdates?: boolean;
    platform?: "Mac";
  } = {},
) {
  const {
    tracking = "Off",
    xml = realisticWordPackageXml(),
    coauthors,
    pendingUpdates = false,
    platform,
    ...host
  } = options;
  const word = installWordOoxmlHost(xml, {
    profile: "word-pc-16.0.20326",
    ...host,
  });
  if (platform)
    (
      globalThis as unknown as {
        Office: { context: { diagnostics: { platform: string } } };
      }
    ).Office.context.diagnostics.platform = platform;
  const coauthoringRead = vi.fn();
  if (coauthors !== undefined)
    Object.defineProperty(word.document, "coauthoring", {
      configurable: true,
      value: {
        pendingUpdates,
        load: coauthoringRead,
        authors: {
          items: Array.from({ length: coauthors }, (_, i) => ({
            id: `author-${i}`,
          })),
          load: () => {},
        },
      },
    });
  if (tracking !== "Off") word.setTrackingMode(tracking);
  const snapshot = await captureRealisticSnapshot(
    String(mock.artifact.messageId),
    tracking,
  );
  const { refresh } = renderRealisticCard(
    snapshot,
    JSON.stringify(makePlan(snapshot)),
  );
  return { word, snapshot, coauthoringRead, refresh };
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
    onTestFinished(allowWordWebImport());
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

  it("unverified on Word for the web: points to Word's Undo instead of an unconfirmed whole-document restore", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { word } = await mountRealistic(
      (s) => statusRewritePlan(s, "Status: revised."),
      { profile: "word-web" },
    );
    expect(routeText()).toBe("Edits 1 passage in place.");
    word.setReplaceFault("edits-next");
    apply();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your original is saved for recovery.",
    );
    expect(screen.getByTestId("word-plan-revert-refused")).toHaveTextContent(
      "Erato can't undo this change here without replacing the whole document. Use Word's Undo to reverse it, or download the original document.",
    );
    expect(
      screen.queryByRole("button", { name: "Restore original document" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Download original document" }),
    ).toBeInTheDocument();
    expect(word.insert).not.toHaveBeenCalled();
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

const sectionsPlan = (s: WordAuthoringSnapshot): WordDocumentPlan => ({
  ...statusRewritePlan(s, "Status: revised."),
  sections: [
    { id: "final", source: "section-1", layout: { orientation: "landscape" } },
  ],
});
const SECTIONS_ROUTE =
  "Replaces the whole document because it changes sections or page layout.";
const WEB_IMPORT_STATEMENTS = [
  "Word's Undo can't reverse this change. Erato can't verify the result on Word for the web, and its Restore may not bring back the exact original, which stays available to download.",
  "People editing at the same time may lose their latest changes.",
  "Rebuilds 1 comment thread (dates and resolved flags may change).",
];
const confirmBox = () =>
  screen.getByRole("checkbox", {
    name: "I understand. Replace the whole document.",
  });
const applyButton = () => screen.getByRole("button", { name: APPLY_LABEL });
const spyOnApply = () =>
  vi.spyOn(WORD_CLIENT_ACTIONS.get("word.apply_document_plan")!, "execute");
const autoPrompt = (decision?: "always") => {
  mock.artifact.clientActionPresentation = "auto_prompt";
  mock.artifact.proposedClientAction = "word.apply_document_plan";
  if (decision)
    mock.decisions = {
      "word_document_authoring/word.apply_document_plan": decision,
    };
};

/** The status rewrite submitted under a scoped read of that paragraph alone. */
function scopedStatusPlan(s: WordAuthoringSnapshot): WordDocumentPlan {
  const plan = {
    ...statusRewritePlan(s, "Status: revised."),
    readToken: "scope-1",
  };
  const status = s.blocks.find((b) => b.text.startsWith("Status"))!;
  const normalized = normalizeWordDocumentPlan(
    parseWordDocumentPlan(JSON.stringify(plan))!,
    s,
  );
  s.readScopes = new Map([
    [
      "scope-1",
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
        plans: new Set([canonicalWordPlan(normalized)]),
      },
    ],
  ]);
  return plan;
}

/** body.paragraphs on the web also lists this text box's paragraph, so in place falls back live. */
function textBoxPackageXml(): string {
  return editWordPackage(realisticWordPackageXml(), (doc) => {
    const body = doc.getElementsByTagNameNS(W, "body")[0];
    const holder = new DOMParser().parseFromString(
      `<w:p xmlns:w="${W}"><w:r><w:pict><v:shape xmlns:v="urn:schemas-microsoft-com:vml"><v:textbox><w:txbxContent><w:p><w:r><w:t>Boxed</w:t></w:r></w:p></w:txbxContent></v:textbox></v:shape></w:pict></w:r></w:p>`,
      "application/xml",
    ).documentElement;
    body.insertBefore(doc.importNode(holder, true), body.firstChild);
  });
}

const WEB_IMPORT_REFUSAL =
  "This change needs a full-document rewrite, which Erato can't verify on Word for the web, so it isn't applied here. Copy the draft and apply it in Word for Windows or Mac, or ask again for edits that can be made in place.";

describe("whole-document plans on Word for the web by default", () => {
  it("are refused before Apply, with Copy draft and Word for Windows or Mac, and never import", async () => {
    autoPrompt("always");
    const execute = spyOnApply();
    const { word } = await mountRealistic(sectionsPlan, {
      profile: "word-web",
    });
    await act(async () => {});
    expect(screen.getByText(WEB_IMPORT_REFUSAL)).toBeVisible();
    expect(screen.queryByRole("button", { name: APPLY_LABEL })).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByRole("button", { name: "Copy draft" })).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Ask again for in-place edits" }),
    ).toBeVisible();
    expect(execute).not.toHaveBeenCalled();
    expect(word.insert).not.toHaveBeenCalled();
  });

  it("keeps the organization wording where a desktop deployment turns the import off", async () => {
    window.MS_OFFICE_ADDIN_DEFAULT_SETTINGS = {
      word_apply: { pc: { whole_document_import: "off" } },
    };
    onTestFinished(() => {
      delete window.MS_OFFICE_ADDIN_DEFAULT_SETTINGS;
    });
    await mountRealistic(sectionsPlan);
    await act(async () => {});
    expect(
      screen.getByText(
        "This change needs a full-document rewrite, which your organization has turned off for this version of Word.",
      ),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: APPLY_LABEL })).toBeNull();
  });
});

describe("confirmed whole-document replacement on Word for the web", () => {
  beforeEach(() => setWordWebImport("confirm"));
  afterEach(() => {
    delete window.MS_OFFICE_ADDIN_DEFAULT_SETTINGS;
  });

  it("replaces Apply with an unticked confirmation naming the costs, then imports once ticked", async () => {
    mock.decisions = {
      "word_document_authoring/word.apply_document_plan": "always",
    };
    const execute = spyOnApply();
    const { word } = await mountRealistic(sectionsPlan, {
      profile: "word-web",
    });
    expect(routeText()).toBe(SECTIONS_ROUTE);
    for (const statement of WEB_IMPORT_STATEMENTS)
      expect(screen.getByText(statement)).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Copy these threads" }),
    ).toBeVisible();
    expect(confirmBox()).not.toBeChecked();
    expect(applyButton()).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Always allow" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Allow once" })).toBeNull();
    fireEvent.click(applyButton());
    expect(execute).not.toHaveBeenCalled();

    fireEvent.click(confirmBox());
    expect(applyButton()).toBeEnabled();
    apply();
    await screen.findByText(/^Applied: /);
    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0][0]).toMatchObject({ importConfirmed: true });
    expect(word.insert).toHaveBeenCalledOnce();
  });

  it("never imports automatically under Always allow, and asks for the tick instead", async () => {
    autoPrompt("always");
    const execute = spyOnApply();
    const { word } = await mountRealistic(sectionsPlan, {
      profile: "word-web",
    });
    await act(async () => {});
    expect(execute).not.toHaveBeenCalled();
    expect(word.insert).not.toHaveBeenCalled();
    expect(confirmBox()).not.toBeChecked();
    expect(applyButton()).toBeDisabled();

    fireEvent.click(confirmBox());
    apply();
    await screen.findByText(/^Applied: /);
    expect(execute.mock.calls).toEqual([
      [expect.objectContaining({ importConfirmed: true })],
    ]);
    expect(
      screen.queryByText("Automatic action under your Always allow setting."),
    ).toBeNull();
  });

  it("stands in for the consent card, and Cancel declines the plan", async () => {
    autoPrompt();
    const { word } = await mountRealistic(sectionsPlan, {
      profile: "word-web",
    });
    expect(confirmBox()).not.toBeChecked();
    expect(screen.queryByRole("button", { name: "Allow once" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Always allow" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(
      await screen.findByText("Proposal declined. Nothing was written."),
    ).toBeVisible();
    expect(word.insert).not.toHaveBeenCalled();
  });

  it("asks again for in-place edits with the previous request, and copies the draft", async () => {
    mock.request = "Make the last section landscape.";
    const writeText = vi.fn(async (_text: string) => {});
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    const { word } = await mountRealistic(sectionsPlan, {
      profile: "word-web",
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Ask again for in-place edits" }),
    );
    expect(mock.restoreRequest).toHaveBeenCalledWith(
      "Make the last section landscape.\n\nPlease make only changes that can be edited in place, without replacing the whole document.",
    );
    expect(
      screen.getByText(
        "Your request is back in the message box, asking for in-place edits only. Review it, then send.",
      ),
    ).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Copy draft" }));
    await screen.findByText("Draft copied.");
    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText.mock.calls[0][0]).toContain("Status: revised.");
    expect(confirmBox()).not.toBeChecked();
    expect(word.insert).not.toHaveBeenCalled();
  });

  it("turns a live fallback to the import back into the confirmation, not an error", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "debug").mockImplementation(() => {});
    const execute = spyOnApply();
    const { word } = await mountRealistic(
      (s) => statusRewritePlan(s, "Status: revised."),
      {
        profile: "word-web",
        includeTextBoxParagraphs: true,
        xml: textBoxPackageXml(),
      },
    );
    expect(routeText()).toBe("Edits 1 passage in place.");
    expect(screen.queryByRole("checkbox")).toBeNull();
    apply();
    expect(await screen.findByRole("checkbox")).not.toBeChecked();
    expect(routeText()).toBe(
      "Replaces the whole document because this change can't be written in place.",
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(applyButton()).toBeDisabled();
    expect(word.insert).not.toHaveBeenCalled();

    fireEvent.click(confirmBox());
    apply();
    await screen.findByText(/^Applied: /);
    expect(
      execute.mock.calls.map(([context]) => context.importConfirmed),
    ).toEqual([false, true]);
    expect(word.insert).toHaveBeenCalledOnce();
  });

  it("refuses a scoped edit that would need the import, with Copy draft and Ask again but no Apply", async () => {
    window.WORD_FORCE_IMPORT_APPLY = true;
    const execute = spyOnApply();
    await mountRealistic(scopedStatusPlan, { profile: "word-web" });
    expect(
      screen.getByText(
        "This targeted edit can't be written in place in this version of Word, and a targeted edit never replaces the whole document.",
      ),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: APPLY_LABEL })).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByTestId("word-plan-route")).toBeNull();
    expect(screen.getByRole("button", { name: "Copy draft" })).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Ask again for in-place edits" }),
    ).toBeVisible();
    expect(execute).not.toHaveBeenCalled();
  });

  it("opens no consent card behind a refusal, so the chat's queued messages are not held", async () => {
    window.WORD_FORCE_IMPORT_APPLY = true;
    autoPrompt();
    await mountRealistic(scopedStatusPlan, { profile: "word-web" });
    await act(async () => {});
    expect(
      screen.getByRole("button", { name: "Ask again for in-place edits" }),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: "Allow once" })).toBeNull();
    expect(mock.pendingConfirmations.size).toBe(0);
  });

  it("releases a consent card once a refusal takes its place", async () => {
    autoPrompt();
    const { refresh } = await mountRealistic(scopedStatusPlan, {
      profile: "word-web",
    });
    expect(
      await screen.findByRole("button", { name: "Allow once" }),
    ).toBeVisible();
    expect(mock.pendingConfirmations.size).toBe(1);

    latchWordInPlace("verify-mismatch");
    refresh();
    expect(
      screen.getByRole("button", { name: "Ask again for in-place edits" }),
    ).toBeVisible();
    expect(mock.pendingConfirmations.size).toBe(0);
  });

  it("releases the consent card the confirmation stands in for when the user asks again", async () => {
    autoPrompt();
    await mountRealistic(sectionsPlan, { profile: "word-web" });
    await act(async () => {});
    expect(confirmBox()).not.toBeChecked();
    expect(mock.pendingConfirmations.size).toBe(1);
    fireEvent.click(
      screen.getByRole("button", { name: "Ask again for in-place edits" }),
    );
    expect(mock.pendingConfirmations.size).toBe(0);
    expect(confirmBox()).not.toBeChecked();
  });

  it("offers no Apply where the deployment turned the import off", async () => {
    onTestFinished(setWordWebImport("off"));
    autoPrompt("always");
    const execute = spyOnApply();
    await mountRealistic(sectionsPlan, { profile: "word-web" });
    await act(async () => {});
    expect(screen.getByText(WEB_IMPORT_REFUSAL)).toBeVisible();
    expect(screen.queryByRole("button", { name: APPLY_LABEL })).toBeNull();
    expect(execute).not.toHaveBeenCalled();
  });

  it("needs the tick for the body route as well", async () => {
    const state = setup();
    vi.stubGlobal("Office", {
      context: { diagnostics: { platform: "OfficeOnline" } },
    });
    state.mount();
    expect(routeText()).toBe("Replaces the document body.");
    expect(applyButton()).toBeDisabled();
    fireEvent.click(confirmBox());
    apply();
    await screen.findByText(APPLIED);
    expect(state.insert).toHaveBeenCalledOnce();
  });

  it("says Word for the web refused the replacement and nothing changed, with Copy draft and nothing to retry", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { word } = await mountRealistic(sectionsPlan, {
      profile: "word-web",
    });
    word.refuseImport();
    fireEvent.click(confirmBox());
    apply();
    expect(
      await screen.findByText(
        "Word for the web can't replace this document because it contains content it can't edit, for example a date picker. Nothing was changed. Copy the draft, open the document in Word for Windows or Mac, or ask for a smaller edit.",
      ),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: APPLY_LABEL })).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByRole("button", { name: "Copy draft" })).toBeVisible();
    expect(word.insert).toHaveBeenCalledOnce();
  });

  it("names the refusal when it stopped a replacement that had changed the document", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { word } = await mountRealistic(sectionsPlan, {
      profile: "word-web",
    });
    word.failAfterWrite("Word refused part of the write.", "NotAllowed");
    fireEvent.click(confirmBox());
    apply();
    expect(
      await screen.findByText(
        "Word stopped because this document contains content it can't edit. The document may be partially changed. Your original is saved for recovery.",
      ),
    ).toBeVisible();
  });

  it("keeps Apply and Always allow for the same import on Word PC", async () => {
    autoPrompt();
    const { word } = await mountRealistic(sectionsPlan);
    expect(routeText()).toBe(SECTIONS_ROUTE);
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByRole("button", { name: "Always allow" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Allow once" }));
    expect(await screen.findByTestId("word-review-receipt")).toHaveTextContent(
      /^Applied/,
    );
    expect(word.insert).toHaveBeenCalledOnce();
  });
});

describe("co-author warning on Word for Windows", () => {
  const COAUTHORS_WARNING =
    "Someone else is editing this document. Replacing the whole document can discard the changes they make while it runs, and their cursor moves to the start.";

  it("warns before Apply when Word lists another author, and Apply still replaces the document", async () => {
    const { word, coauthoringRead } = await mountRealistic(sectionsPlan, {
      coauthors: 2,
    });
    expect(routeText()).toBe(SECTIONS_ROUTE);
    expect(await screen.findByTestId("word-plan-coauthors")).toHaveTextContent(
      COAUTHORS_WARNING,
    );
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(applyButton()).toBeEnabled();
    apply();
    expect(await screen.findByTestId("word-review-receipt")).toHaveTextContent(
      /^Applied/,
    );
    expect(word.insert).toHaveBeenCalledOnce();
    expect(coauthoringRead).toHaveBeenCalledTimes(2);
  });

  it("reads co-authors again at Apply and shows one who joined before replacing anything", async () => {
    const { word } = await mountRealistic(sectionsPlan, { coauthors: 1 });
    await act(async () => {});
    expect(screen.queryByTestId("word-plan-coauthors")).toBeNull();
    (
      word.document as unknown as {
        coauthoring: { authors: { items: { id: string }[] } };
      }
    ).coauthoring.authors.items.push({ id: "author-joined" });
    apply();
    expect(await screen.findByTestId("word-plan-coauthors")).toHaveTextContent(
      COAUTHORS_WARNING,
    );
    expect(word.insert).not.toHaveBeenCalled();
    apply();
    expect(await screen.findByTestId("word-review-receipt")).toHaveTextContent(
      /^Applied/,
    );
    expect(word.insert).toHaveBeenCalledOnce();
  });

  it("warns above the consent card as well", async () => {
    autoPrompt();
    await mountRealistic(sectionsPlan, { coauthors: 2 });
    expect(await screen.findByTestId("word-plan-coauthors")).toBeVisible();
    expect(screen.getByRole("button", { name: "Allow once" })).toBeEnabled();
  });

  it("warns inside the confirmation where the deployment asks first on Word PC", async () => {
    window.MS_OFFICE_ADDIN_DEFAULT_SETTINGS = {
      word_apply: { pc: { whole_document_import: "confirm" } },
    };
    onTestFinished(() => {
      delete window.MS_OFFICE_ADDIN_DEFAULT_SETTINGS;
    });
    await mountRealistic(sectionsPlan, { coauthors: 2 });
    const group = screen.getByRole("group", {
      name: "Confirm replacing the whole document",
    });
    expect(
      await within(group).findByTestId("word-plan-coauthors"),
    ).toBeVisible();
    expect(confirmBox()).not.toBeChecked();
  });

  it("stays as today when the user is the only author", async () => {
    const { coauthoringRead } = await mountRealistic(sectionsPlan, {
      coauthors: 1,
    });
    await waitFor(() => expect(coauthoringRead).toHaveBeenCalledOnce());
    await act(async () => {});
    expect(screen.queryByTestId("word-plan-coauthors")).toBeNull();
    expect(applyButton()).toBeEnabled();
  });

  it("says only that changes wait to merge when Word lists no other author", async () => {
    await mountRealistic(sectionsPlan, { coauthors: 1, pendingUpdates: true });
    expect(await screen.findByTestId("word-plan-coauthors")).toHaveTextContent(
      "Word holds co-authors' changes that are not merged into your copy yet; replacing the whole document can discard them.",
    );
    expect(applyButton()).toBeEnabled();
  });

  it("leaves Word for Mac as today until its co-author probe has run", async () => {
    const { word, coauthoringRead } = await mountRealistic(sectionsPlan, {
      coauthors: 2,
      platform: "Mac",
    });
    await act(async () => {});
    expect(coauthoringRead).not.toHaveBeenCalled();
    expect(screen.queryByTestId("word-plan-coauthors")).toBeNull();
    apply();
    expect(await screen.findByTestId("word-review-receipt")).toHaveTextContent(
      /^Applied/,
    );
    expect(word.insert).toHaveBeenCalledOnce();
  });

  it("stays as today where Word cannot report co-authors", async () => {
    const { word, coauthoringRead } = await mountRealistic(sectionsPlan, {
      coauthors: 2,
      isSetSupported: (name, version) =>
        !(name === "WordApiDesktop" && version === "1.4"),
    });
    await act(async () => {});
    expect(coauthoringRead).not.toHaveBeenCalled();
    expect(screen.queryByTestId("word-plan-coauthors")).toBeNull();
    apply();
    expect(await screen.findByTestId("word-review-receipt")).toHaveTextContent(
      /^Applied/,
    );
    expect(word.insert).toHaveBeenCalledOnce();
  });

  it("does not ask Word for a plan written in place", async () => {
    const { coauthoringRead } = await mountRealistic(
      (s) => statusRewritePlan(s, "Status: revised."),
      { coauthors: 2 },
    );
    await act(async () => {});
    expect(routeText()).toBe("Edits 1 passage in place.");
    expect(coauthoringRead).not.toHaveBeenCalled();
    expect(screen.queryByTestId("word-plan-coauthors")).toBeNull();
  });

  it("leaves Word for the web to its confirmation", async () => {
    onTestFinished(setWordWebImport("confirm"));
    const { coauthoringRead } = await mountRealistic(sectionsPlan, {
      profile: "word-web",
      coauthors: 2,
    });
    await act(async () => {});
    expect(coauthoringRead).not.toHaveBeenCalled();
    expect(screen.queryByTestId("word-plan-coauthors")).toBeNull();
    expect(confirmBox()).not.toBeChecked();
  });
});

describe("comment threads a plan deletes", () => {
  afterEach(() => {
    vi.mocked(readWordCommentStates).mockImplementation(ooxmlHostCommentStates);
  });
  const CHAPTERS_WITH_COMMENTS = () =>
    withComments(packageXml(chapterCommentsBody()), CHAPTER_COMMENTS);
  /** Replaces chapter 3's four body paragraphs, two of which hold comment threads. */
  const shortenChapter3 = (s: WordAuthoringSnapshot): WordDocumentPlan => {
    const refs = s.blocks.map((b) => b.ref);
    return {
      version: 1,
      snapshot: s.token,
      readToken: "read-proof",
      scope: "document",
      entries: [
        { kind: "keep", source: refs.slice(0, 5) },
        {
          kind: "replace",
          source: refs.slice(5, 9),
          blocks: [
            {
              id: "short",
              type: "paragraph",
              text: "Chapter three, in short.",
            },
          ],
        },
        { kind: "keep", source: refs.slice(9) },
      ],
      deleted: [],
    };
  };
  const tickBox = () =>
    screen.getByRole("checkbox", { name: "Also delete 2 comment threads" });
  const threadRows = () =>
    screen
      .getAllByTestId("word-plan-comment-thread")
      .map((row) => row.textContent);
  const fingerprintOf = (s: WordAuthoringSnapshot) => {
    const xml = compileWordDocumentPlan(
      normalizeWordDocumentPlan(shortenChapter3(s), s),
      s,
    );
    return wordPlanCommentConsequences(
      s,
      xml,
      captureWordAuthoringSnapshot(xml, s.identity, "Off", true, "verify"),
    ).fingerprint;
  };
  const liveComments = async () =>
    ((await captureWordDocumentPackage()).ooxml.match(/<w:comment /g) ?? [])
      .length;

  it("lists each thread once and applies only with the unticked box ticked", async () => {
    const execute = spyOnApply();
    const { word, snapshot } = await mountRealistic(shortenChapter3, {
      xml: CHAPTERS_WITH_COMMENTS(),
    });
    expect(
      screen.getByText(
        "Removing this text also deletes 2 comment threads, with their replies:",
      ),
    ).toBeVisible();
    expect(threadRows()).toEqual([
      "Lee Chen · Resolved · 1 reply“KPI”",
      "Daniel Person · Open · No replies“second pilot”",
    ]);
    expect(tickBox()).not.toBeChecked();
    expect(applyButton()).toBeDisabled();
    fireEvent.click(applyButton());
    expect(execute).not.toHaveBeenCalled();

    fireEvent.click(tickBox());
    expect(applyButton()).toBeEnabled();
    apply();
    await screen.findByText(/^Applied: /);
    expect(execute.mock.calls).toEqual([
      [
        expect.objectContaining({
          commentRemovalsConfirmed: fingerprintOf(snapshot),
        }),
      ],
    ]);
    expect(word.insert).toHaveBeenCalledOnce();
    expect(await liveComments()).toBe(3);
    expect(screen.getByTestId("word-plan-adjustments")).toHaveTextContent(
      "Deleted 2 comment threads, as you confirmed.",
    );
    expect(screen.queryByTestId("word-plan-comment-check")).toBeNull();
  });

  it("says when Word changed a thread beyond the plan, with Word's Undo, even folded", async () => {
    const { snapshot } = await mountRealistic(shortenChapter3, {
      xml: CHAPTERS_WITH_COMMENTS(),
    });
    vi.mocked(readWordCommentStates)
      .mockImplementationOnce(ooxmlHostCommentStates)
      .mockImplementationOnce(async () =>
        (await ooxmlHostCommentStates())!.filter(
          (t) => t.id !== String(0x6d5c0001),
        ),
      );
    fireEvent.click(tickBox());
    apply();
    await screen.findByText(/^Applied: /);
    expect(screen.getByTestId("word-plan-comment-check")).toHaveTextContent(
      "Applied — 1 comment thread changed unexpectedly. Word's Undo brings a removed comment back.",
    );
    expect(snapshot.used).toBe(true);
  });

  it("points Word for the web to Version History, which its Undo cannot replace", async () => {
    await mountRealistic(
      (s) => {
        const refs = s.blocks.map((b) => b.ref);
        return {
          ...shortenChapter3(s),
          entries: [
            { kind: "keep", source: refs.slice(0, 10) },
            {
              kind: "replace",
              source: [refs[10]],
              blocks: [{ id: "end", type: "paragraph", text: "Fin." }],
            },
          ],
        };
      },
      { xml: CHAPTERS_WITH_COMMENTS(), profile: "word-web" },
    );
    vi.mocked(readWordCommentStates)
      .mockImplementationOnce(ooxmlHostCommentStates)
      .mockImplementation(async () =>
        (await ooxmlHostCommentStates())!.map((t) =>
          t.id === String(0x6d5c0004) ? { ...t, resolved: false } : t,
        ),
      );
    apply();
    await screen.findByText(/^Applied: /, undefined, { timeout: 5000 });
    expect(screen.getByTestId("word-plan-comment-check")).toHaveTextContent(
      "Applied — 1 comment thread changed unexpectedly. Word for the web's Undo can't bring it back; restore an earlier version from Version History.",
    );
  });

  it("asks for the tick even under Always allow, and never runs on its own", async () => {
    autoPrompt("always");
    const execute = spyOnApply();
    const { word } = await mountRealistic(shortenChapter3, {
      xml: CHAPTERS_WITH_COMMENTS(),
    });
    await act(async () => {});
    expect(execute).not.toHaveBeenCalled();
    expect(word.insert).not.toHaveBeenCalled();
    expect(tickBox()).not.toBeChecked();
    expect(screen.queryByRole("button", { name: "Always allow" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Allow once" })).toBeNull();
    expect(mock.pendingConfirmations.size).toBe(1);

    fireEvent.click(tickBox());
    apply();
    await screen.findByText(/^Applied: /);
    expect(execute).toHaveBeenCalledOnce();
    expect(
      screen.queryByText("Automatic action under your Always allow setting."),
    ).toBeNull();
    expect(mock.pendingConfirmations.size).toBe(0);
    expect(await liveComments()).toBe(3);
  });

  it("still runs a plan that deletes no comment thread under Always allow", async () => {
    autoPrompt("always");
    const { word } = await mountRealistic(
      (s) => {
        const plan = shortenChapter3(s);
        const refs = s.blocks.map((b) => b.ref);
        plan.entries = [
          { kind: "keep", source: refs.slice(0, 10) },
          {
            kind: "replace",
            source: [refs[10]],
            blocks: [{ id: "end", type: "paragraph", text: "Fin." }],
          },
        ];
        return plan;
      },
      { xml: CHAPTERS_WITH_COMMENTS() },
    );
    await screen.findByText(/^Applied: /);
    expect(screen.queryByTestId("word-plan-comment-removals")).toBeNull();
    expect(word.insert).not.toHaveBeenCalled();
    expect(await liveComments()).toBe(6);
  });

  it("puts the request back asking to keep the commented passages", async () => {
    autoPrompt();
    mock.request = "Shorten chapter 3.";
    const { word } = await mountRealistic(shortenChapter3, {
      xml: CHAPTERS_WITH_COMMENTS(),
    });
    expect(mock.pendingConfirmations.size).toBe(1);
    fireEvent.click(
      screen.getByRole("button", { name: "Keep commented passages" }),
    );
    expect(mock.restoreRequest).toHaveBeenCalledWith(
      "Shorten chapter 3.\n\nKeep the passages these comments are attached to, so their comment threads stay: “KPI”, “second pilot”.",
    );
    expect(
      screen.getByText(
        "Your request is back in the message box, asking to keep the commented passages. Review it, then send.",
      ),
    ).toBeVisible();
    expect(mock.pendingConfirmations.size).toBe(0);
    expect(word.insert).not.toHaveBeenCalled();
  });

  it("copies the threads, replies included, before anything is deleted", async () => {
    const writeText = vi.fn(async (_text: string) => {});
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    await mountRealistic(shortenChapter3, { xml: CHAPTERS_WITH_COMMENTS() });
    fireEvent.click(screen.getByRole("button", { name: "Copy these threads" }));
    await screen.findByText("Comment threads copied.");
    expect(writeText.mock.calls[0][0]).toBe(
      "Lee Chen (Resolved) on “KPI”:\nSpell out the acronym.\n  Reply from Maya Krüger: Done.\n\nDaniel Person (Open) on “second pilot”:\nShorten this?",
    );
    expect(tickBox()).not.toBeChecked();
  });
});

describe("whole-document imports of documents with comments", () => {
  // Earlier suites restore their policy after afterEach, so the default is set here.
  beforeEach(() => {
    delete window.MS_OFFICE_ADDIN_DEFAULT_SETTINGS;
  });
  const CHAPTERS_WITH_COMMENTS = () =>
    withComments(packageXml(chapterCommentsBody()), CHAPTER_COMMENTS);
  const shortenChapter3 = (s: WordAuthoringSnapshot): WordDocumentPlan => {
    const refs = s.blocks.map((b) => b.ref);
    return {
      version: 1,
      snapshot: s.token,
      readToken: "read-proof",
      scope: "document",
      entries: [
        { kind: "keep", source: refs.slice(0, 5) },
        {
          kind: "replace",
          source: refs.slice(5, 9),
          blocks: [
            {
              id: "short",
              type: "paragraph",
              text: "Chapter three, in short.",
            },
          ],
        },
        { kind: "keep", source: refs.slice(9) },
      ],
      deleted: [],
    };
  };
  const commentTick = () =>
    screen.getByRole("checkbox", { name: "Also delete 2 comment threads" });

  it("on Word for Windows: a plain verified route, with the co-author warning beside the threads", async () => {
    const { word } = await mountRealistic(shortenChapter3, {
      xml: CHAPTERS_WITH_COMMENTS(),
      coauthors: 2,
    });
    expect(await screen.findByTestId("word-plan-coauthors")).toHaveTextContent(
      "Someone else is editing this document.",
    );
    expect(
      within(screen.getByTestId("word-plan-comment-removals")).getAllByTestId(
        "word-plan-comment-thread",
      ),
    ).toHaveLength(2);
    expect(screen.getAllByRole("checkbox")).toEqual([commentTick()]);
    expect(
      screen.queryByText(/Rebuilds \d+ comment thread/),
    ).not.toBeInTheDocument();
    fireEvent.click(commentTick());
    apply();
    await screen.findByText(/^Applied: /);
    expect(word.insert).toHaveBeenCalledOnce();
    expect(screen.getByTestId("word-plan-adjustments")).toHaveTextContent(
      "Deleted 2 comment threads, as you confirmed.",
    );
  });

  it("on Word for Windows: an import that deletes no thread needs no comment tick", async () => {
    const { word } = await mountRealistic(
      (s) => ({
        ...shortenChapter3(s),
        entries: [{ kind: "keep", source: s.blocks.map((b) => b.ref) }],
        sections: [
          {
            id: "final",
            source: "section-1",
            layout: { orientation: "landscape" },
          },
        ],
      }),
      { xml: CHAPTERS_WITH_COMMENTS() },
    );
    expect(routeText()).toBe(SECTIONS_ROUTE);
    expect(screen.queryByRole("checkbox")).toBeNull();
    apply();
    await screen.findByText(/^Applied: /);
    expect(word.insert).toHaveBeenCalledOnce();
    expect(screen.queryByTestId("word-plan-comment-check")).toBeNull();
  });

  it("on Word for the web: the import stays off by default, so no thread is offered for deletion", async () => {
    const execute = spyOnApply();
    const { word } = await mountRealistic(shortenChapter3, {
      xml: CHAPTERS_WITH_COMMENTS(),
      profile: "word-web",
    });
    expect(screen.getByText(WEB_IMPORT_REFUSAL)).toBeVisible();
    expect(screen.queryByTestId("word-plan-comment-removals")).toBeNull();
    expect(screen.queryByRole("button", { name: APPLY_LABEL })).toBeNull();
    expect(execute).not.toHaveBeenCalled();
    expect(word.insert).not.toHaveBeenCalled();
  });

  describe("with the admin's confirm on Word for the web", () => {
    beforeEach(() => setWordWebImport("confirm"));
    afterEach(() => {
      delete window.MS_OFFICE_ADDIN_DEFAULT_SETTINGS;
    });

    it("names the threads it rebuilds and deletes, offers to copy them all, and needs both ticks", async () => {
      autoPrompt("always");
      const writeText = vi.fn(async (_text: string) => {});
      vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
      const execute = spyOnApply();
      const { word } = await mountRealistic(shortenChapter3, {
        xml: CHAPTERS_WITH_COMMENTS(),
        profile: "word-web",
      });
      await act(async () => {});
      expect(execute).not.toHaveBeenCalled();
      expect(
        screen.getByText(
          "Rebuilds 1 comment thread (dates and resolved flags may change).",
        ),
      ).toBeVisible();
      const removals = screen.getByTestId("word-plan-comment-removals");
      expect(
        within(removals).getAllByTestId("word-plan-comment-thread"),
      ).toHaveLength(2);
      expect(
        within(removals).queryByRole("button", { name: "Copy these threads" }),
      ).toBeNull();
      fireEvent.click(
        screen.getByRole("button", { name: "Copy these threads" }),
      );
      await screen.findByText("Comment threads copied.");
      expect(writeText.mock.calls[0][0]).toContain(
        "Maya Krüger (Open) on “twelve percent”:\nIs this figure current?\n  Reply from Daniel Person: Yes, from the September report.",
      );
      expect(writeText.mock.calls[0][0]).toContain("Lee Chen (Resolved)");

      expect(applyButton()).toBeDisabled();
      fireEvent.click(confirmBox());
      expect(applyButton()).toBeDisabled();
      fireEvent.click(commentTick());
      expect(applyButton()).toBeEnabled();
      apply();
      await screen.findByText(/^Applied: /, undefined, { timeout: 5000 });
      expect(execute.mock.calls).toEqual([
        [
          expect.objectContaining({
            importConfirmed: true,
            commentRemovalsConfirmed: expect.stringMatching(/^word-body-v2:/),
          }),
        ],
      ]);
      expect(word.insert).toHaveBeenCalledOnce();
    });
  });
});
