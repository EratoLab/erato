import { i18n } from "@lingui/core";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TestTheme } from "../../../test/helpers/TestTheme";
import {
  examplePlan,
  packageXml,
  paragraph,
  readySnapshot,
  wordSerializationNoise,
} from "../../../test/mocks/word/authoringFixtures";
import { WordWriteProvider } from "../../providers/WordWriteProvider";
import { buildWordArtifact } from "../../utils/buildWordArtifact";
import { WordDocumentReadSession } from "../../utils/wordDocumentReadTool";
import {
  createWordDocumentSubmissionExecutor,
  WORD_SUBMIT_PLAN_TOOL,
} from "../../utils/wordDocumentSubmission";
import { wordDocumentFingerprint } from "../../utils/wordDocumentXml";
import { WordHostCardRenderer } from "../WordHostCardRenderer";

import type { WordDocumentCapture } from "../../utils/wordDocumentCapture";
import type {
  WordAuthoringSnapshot,
  WordDocumentPlan,
} from "../../utils/wordDocumentPlan";
import type * as EratoLibrary from "@erato/frontend/library";

const mock = vi.hoisted(() => {
  const artifact: Record<string, unknown> = {};
  return {
    artifact,
    decisions: {},
    setDecisions: vi.fn(),
    messageStatus: "completed",
  };
});
vi.mock("@erato/frontend/library", async (importOriginal) => ({
  ...(await importOriginal<typeof EratoLibrary>()),
  useHostArtifact: () => mock.artifact,
  useChatContext: () => ({
    messages: {
      [String(mock.artifact.messageId)]: {
        status: mock.messageStatus,
        role: "assistant",
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
      { wrapper: TestTheme },
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
beforeEach(() => {
  i18n.load("en", {});
  i18n.activate("en");
  mock.decisions = {};
  mock.setDecisions.mockClear();
  mock.messageStatus = "completed";
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
      { wrapper: TestTheme },
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
      { wrapper: TestTheme },
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
    expect(
      screen.getByText("Preparing a complete document rewrite…"),
    ).toBeInTheDocument();
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
      { wrapper: TestTheme },
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
