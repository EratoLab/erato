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
import { DecidedPlanCard } from "../../../test/helpers/decidedWordPlanCard";
import {
  heading,
  packageXml,
  paragraph,
} from "../../../test/mocks/word/authoringFixtures";
import {
  recordPartsTurn,
  wordCaptureJournal,
} from "../../../test/mocks/word/partsTurn";
import { WordWriteProvider } from "../../providers/WordWriteProvider";
import { captureWordAuthoringSnapshot } from "../../utils/wordDocumentXml";
import {
  setWordInPlaceCapabilitiesForTests,
  wordInPlaceCapabilities,
} from "../../utils/wordInPlaceCapabilities";
import { WordHostCardRenderer } from "../WordHostCardRenderer";

import type * as WordInPlaceSwitch from "../../utils/wordInPlaceSwitch";
import type * as wordPlanCommentCheckModule from "../../utils/wordPlanCommentCheck";
import type * as EratoLibrary from "@erato/frontend/library";
import type {
  WordAuthoringSnapshot,
  WordDocumentCapture,
} from "@erato/frontend/word-review";
import type { ReactNode } from "react";

const never = vi.hoisted(() => ({ actions: new Set<string>() }));
vi.mock("../../../core/clientActions/useNeverAllowedActions", () => ({
  useNeverAllowedActions: () => never.actions,
}));

vi.mock("../../utils/wordPlanCommentCheck", async (importOriginal) => {
  const { ooxmlHostCommentStates } = await import(
    "../../../test/mocks/word/commentStates"
  );
  return {
    ...(await importOriginal<typeof wordPlanCommentCheckModule>()),
    readWordCommentStates: vi.fn(ooxmlHostCommentStates),
  };
});

const inPlace = vi.hoisted(() => ({ on: false }));
vi.mock("../../utils/wordInPlaceSwitch", async (importOriginal) => {
  const actual = await importOriginal<typeof WordInPlaceSwitch>();
  return {
    ...actual,
    wordInPlaceAvailability: () =>
      inPlace.on ? { enabled: true } : actual.wordInPlaceAvailability(),
  };
});

const mock = vi.hoisted(() => {
  const artifact: Record<string, unknown> = {};
  return { artifact, messageStatus: "sending", content: [] as unknown[] };
});
vi.mock("@erato/frontend/library", async (importOriginal) => {
  const { chatHooksFrom } = await import(
    "../../../test/helpers/eratoLibraryMock"
  );
  const useChatContext = () => ({
    messages: {
      [String(mock.artifact.messageId)]: {
        id: String(mock.artifact.messageId),
        status: mock.messageStatus,
        role: "assistant",
        content: mock.content,
      },
    },
    messageOrder: [String(mock.artifact.messageId)],
    currentChatId: "chat-A",
  });
  return {
    ...(await importOriginal<typeof EratoLibrary>()),
    CopyErrorButton: () => null,
    useHostArtifact: () => mock.artifact,
    useChatContext,
    ...chatHooksFrom(useChatContext),
  };
});

function Conversation({ children }: { children: ReactNode }) {
  const id = String(mock.artifact.messageId);
  const [messages] = useState(() => ({
    [id]: {
      id,
      status: mock.messageStatus,
      role: "assistant",
      content: mock.content,
      createdAt: "2026-11-21T00:00:00Z",
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

const SECTIONS = ["§ 1 Gegenstand", "§ 2 Lieferung", "§ 3 Abnahme"];
const document = (sections = SECTIONS, fullDocument = false) =>
  captureWordAuthoringSnapshot(
    packageXml(
      sections
        .map((title) => heading(title) + paragraph(`${title}: Text.`))
        .join(""),
    ),
    "doc-A",
    "Off",
    fullDocument,
  );

function mount(
  snapshot: WordAuthoringSnapshot,
  language: string,
  content: string,
  {
    reloaded = false,
    decided = false,
  }: {
    reloaded?: boolean;
    /** The plan card in the chat's decision place instead of the answer's. */
    decided?: boolean;
  } = {},
) {
  const messageId = String(mock.artifact.messageId);
  snapshot.ownerMessageId = messageId;
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
      capturesByAssistantMessageId={
        new Map(reloaded ? [] : [[messageId, capture]])
      }
      restoreRequest={vi.fn()}
    >
      {decided ? (
        <DecidedPlanCard messageId={messageId} content={content} />
      ) : (
        <WordHostCardRenderer language={language} content={content} />
      )}
    </WordWriteProvider>,
    { wrapper: Conversation },
  );
}

function wordHost(snapshot: WordAuthoringSnapshot) {
  let current = snapshot.ooxml;
  const insert = vi.fn((value: string) => {
    current = value;
  });
  vi.stubGlobal("Word", {
    run: async (callback: (context: Word.RequestContext) => Promise<unknown>) =>
      callback({
        document: {
          changeTrackingMode: "Off",
          load: vi.fn(),
          body: {
            getOoxml: () => ({ value: current }),
            insertOoxml: insert,
          },
        },
        sync: async () => {},
      } as unknown as Word.RequestContext),
  });
  return insert;
}

const rowsList = () => screen.getByRole("list", { name: "Sections" });
const rowTexts = () =>
  within(rowsList())
    .getAllByRole("listitem")
    .map((item) => item.textContent);
const rowNamed = (name: string) =>
  within(rowsList())
    .getAllByRole("listitem")
    .find((item) => item.textContent.startsWith(name))!;

beforeEach(() => {
  i18n.load("en", frontendMessages);
  i18n.activate("en");
  mock.messageStatus = "sending";
  mock.content = [];
  mock.artifact = {
    facetId: "word_document_authoring",
    messageId: globalThis.crypto.randomUUID(),
    itemIdentity: "doc-A",
    allowedClientActions: ["word.apply_document_plan"],
  };
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  inPlace.on = false;
  setWordInPlaceCapabilitiesForTests(undefined);
});

const THREE = {
  intent: "Shorter § 1 and § 3.",
  rows: [
    { source: "b1-b2", action: "rewrite", change: "Shorter." },
    { source: "b3-b4", action: "keep" },
    { source: "b5-b6", action: "rewrite", change: "Shorter." },
  ],
};
const SHORTER_ONE = [
  { row: 1, ops: [{ keep: "b1" }, { replace: "b2", text: "Kurz." }] },
];
const planOf = (turn: { last: { ok: boolean; result?: unknown } }) =>
  JSON.stringify((turn.last.result as { plan: unknown }).plan);
const actions =
  /Leave out|Include|Redo|Write the missing|reordering|Copy draft|Copy details|Show changes/;

describe("the card of a change in parts", () => {
  it("says only that Erato plans the changes until the section plan is accepted", () => {
    const snapshot = document();
    mock.content = [
      {
        content_type: "tool_use",
        tool_call_id: "plan-1",
        tool_name: "plan_document_sections",
        status: "preparing",
        input: '{"snapshot":"s","readToken":"t","intent":"Shorter',
      },
    ];
    const { container } = mount(
      snapshot,
      "erato-word-document-parts",
      "plan-1",
    );
    expect(container).toHaveTextContent(/^Erato is planning the changes…$/);
    expect(screen.queryByRole("list", { name: "Sections" })).toBeNull();
  });

  it("shows the heading, the intent, the count and every section of a six-section request marked writing", async () => {
    const titles = [1, 2, 3, 4, 5, 6].map((n) => `§ ${n} Abschnitt ${n}`);
    const snapshot = document(titles);
    const turn = await recordPartsTurn(snapshot, {
      messageId: String(mock.artifact.messageId),
      plan: {
        intent: "Plain wording for warehouse staff.",
        rows: titles.map((_, k) => ({
          source: `b${2 * k + 1}-b${2 * k + 2}`,
          action: "rewrite",
          change: "Plain wording.",
        })),
      },
      parts: [],
      finish: false,
    });
    mock.content = turn.content;
    const { container } = mount(
      snapshot,
      "erato-word-document-parts",
      turn.sectionPlanCall,
    );

    expect(rowTexts()).toEqual(titles.map((title) => `${title}Writing…`));
    expect(container).toHaveTextContent(
      /^Changes in 6 sectionsPlain wording for warehouse staff\.0 of 6 sections ready/,
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("keeps the heading from writing, puts Apply on top, says once what the reordering means, and offers nothing per row", async () => {
    const snapshot = document();
    const turn = await recordPartsTurn(snapshot, {
      messageId: String(mock.artifact.messageId),
      plan: {
        intent: "§ 3 before § 2, and § 1 shorter.",
        rows: [
          { source: "b1-b2", action: "rewrite", change: "Shorter." },
          { source: "b5-b6", action: "keep" },
          { source: "b3-b4", action: "keep" },
        ],
      },
      parts: SHORTER_ONE,
    });
    if (!turn.last.ok) throw new Error(JSON.stringify(turn.last));
    mock.content = turn.content.filter(
      (part) =>
        part.content_type !== "tool_use" ||
        part.tool_name !== "submit_document_plan",
    );
    mount(snapshot, "erato-word-document-parts", turn.sectionPlanCall);
    expect(
      screen.getByRole("heading", { name: "Changes in 2 sections" }),
    ).toBeVisible();
    cleanup();

    mock.messageStatus = "completed";
    mock.content = turn.content;
    const insert = wordHost(snapshot);
    mount(snapshot, "erato-word-document-plan", planOf(turn), {
      decided: true,
    });

    const apply = await screen.findByRole("button", {
      name: /^(Apply|Replace)/,
    });
    expect(
      screen.getByRole("heading", { name: "Changes in 2 sections" }),
    ).toBeVisible();
    expect(screen.queryByText(/sections ready/)).toBeNull();
    expect(
      apply.compareDocumentPosition(rowsList()) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByTestId("word-plan-route")).toHaveTextContent(
      /^Reordering replaces the whole document; Undo takes it back only as a whole\.$/,
    );
    expect(rowTexts()).toEqual(["§ 1 Gegenstand", "§ 3 AbnahmeMoved"]);
    expect(screen.queryByRole("button", { name: actions })).toBeNull();
    fireEvent.click(within(rowNamed("§ 1 Gegenstand")).getByRole("button"));
    expect(rowNamed("§ 1 Gegenstand")).toHaveTextContent("Kurz.");

    fireEvent.click(apply);
    await waitFor(() => expect(insert).toHaveBeenCalledTimes(1));
    const written = insert.mock.calls[0][0];
    expect(written).toContain("Kurz.");
    expect(written.indexOf("§ 3 Abnahme")).toBeLessThan(
      written.indexOf("§ 2 Lieferung"),
    );
  });

  it("keeps Copy draft for a reordering Word for the web refuses, as its refusal says", async () => {
    const snapshot = document();
    const turn = await recordPartsTurn(snapshot, {
      messageId: String(mock.artifact.messageId),
      plan: {
        intent: "§ 3 before § 2, and § 1 shorter.",
        rows: [
          { source: "b1-b2", action: "rewrite", change: "Shorter." },
          { source: "b5-b6", action: "keep" },
          { source: "b3-b4", action: "keep" },
        ],
      },
      parts: SHORTER_ONE,
    });
    if (!turn.last.ok) throw new Error(JSON.stringify(turn.last));
    mock.messageStatus = "completed";
    mock.content = turn.content;
    wordHost(snapshot);
    vi.stubGlobal("Office", {
      context: { diagnostics: { platform: "OfficeOnline" } },
    });
    mount(snapshot, "erato-word-document-plan", planOf(turn), {
      decided: true,
    });

    expect(
      await screen.findByText(
        /Copy the draft and apply it in Word for Windows or Mac/,
      ),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /^(Apply|Replace)/ }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "Copy draft" })).toBeVisible();
  });

  it("names a section Erato didn't get to in the one line for what stays, and applies the rest", async () => {
    const snapshot = document();
    const finished = await recordPartsTurn(snapshot, {
      messageId: String(mock.artifact.messageId),
      plan: THREE,
      parts: SHORTER_ONE,
      finishes: 2,
    });
    if (!finished.last.ok) throw new Error(JSON.stringify(finished.last));
    mock.messageStatus = "completed";
    mock.content = finished.content;
    mount(snapshot, "erato-word-document-plan", planOf(finished), {
      decided: true,
    });

    expect(
      await screen.findByTestId("word-plan-not-changed"),
    ).toHaveTextContent(
      /^Not changed: § 3 Abnahme\. Ask for it in your next message\.$/,
    );
    expect(screen.getAllByTestId("word-plan-not-changed")).toHaveLength(1);
    expect(rowTexts()).toEqual(["§ 1 Gegenstand"]);
    expect(screen.queryByRole("button", { name: actions })).toBeNull();
    expect(screen.getByRole("button", { name: /^Apply/ })).toBeEnabled();
  });

  it("opens a ready row to its changes while Erato still writes the others", async () => {
    const snapshot = document();
    const turn = await recordPartsTurn(snapshot, {
      messageId: String(mock.artifact.messageId),
      plan: THREE,
      parts: SHORTER_ONE,
      finish: false,
    });
    mock.content = turn.content;
    mount(snapshot, "erato-word-document-parts", turn.sectionPlanCall);

    expect(rowNamed("§ 3 Abnahme")).toHaveTextContent("Writing…");
    expect(within(rowNamed("§ 3 Abnahme")).queryByRole("button")).toBeNull();
    fireEvent.click(within(rowNamed("§ 1 Gegenstand")).getByRole("button"));
    expect(rowNamed("§ 1 Gegenstand")).toHaveTextContent("Kurz.");
  });

  it("says once that Erato stopped and nothing applies, without rows or a count", async () => {
    const snapshot = document();
    const turn = await recordPartsTurn(snapshot, {
      messageId: String(mock.artifact.messageId),
      plan: THREE,
      parts: SHORTER_ONE,
      finish: false,
    });
    mock.messageStatus = "completed";
    mock.content = turn.content;
    const { container } = mount(
      snapshot,
      "erato-word-document-parts",
      turn.sectionPlanCall,
    );

    expect(container).toHaveTextContent(
      /^Changes not finishedShorter § 1 and § 3\.Erato stopped before finishing, so there is nothing to apply\. Send your request again to continue\.$/,
    );
    expect(screen.queryByRole("list", { name: "Sections" })).toBeNull();
  });

  it("folds an earlier stopped change to its one line once a later request took a new copy", async () => {
    const snapshot = document();
    const turn = await recordPartsTurn(snapshot, {
      messageId: String(mock.artifact.messageId),
      plan: THREE,
      parts: SHORTER_ONE,
      finish: false,
    });
    mock.messageStatus = "completed";
    mock.content = turn.content;
    snapshot.revoked = true;
    const { container } = mount(
      snapshot,
      "erato-word-document-parts",
      turn.sectionPlanCall,
    );

    expect(screen.getByTestId("word-review-receipt")).toHaveTextContent(
      /^Changes not finished$/,
    );
    expect(screen.getByText("Shorter § 1 and § 3.")).not.toBeVisible();
    expect(container).not.toHaveTextContent(/Erato stopped before finishing/);
  });

  it("keeps a parked proposal open while its copy binds after the message completes", async () => {
    const snapshot = document();
    const messageId = String(mock.artifact.messageId);
    const turn = await recordPartsTurn(snapshot, {
      messageId,
      plan: THREE,
      parts: SHORTER_ONE,
      finishes: 2,
    });
    if (!turn.last.ok) throw new Error(JSON.stringify(turn.last));
    mock.content = turn.content;
    snapshot.ownerMessageId = messageId;
    const capture: WordDocumentCapture = {
      identity: "doc-A",
      authoring: snapshot,
      ordinalMap: new Map(),
      paragraphsSent: snapshot.blocks.length,
      renderedOrdinals: new Set(),
      partialOrdinal: null,
    };
    const card = (captures: Map<string, WordDocumentCapture>) => (
      <WordWriteProvider
        documentIdentity="doc-A"
        capturesByAssistantMessageId={captures}
        restoreRequest={vi.fn()}
      >
        <DecidedPlanCard messageId={messageId} content={planOf(turn)} />
      </WordWriteProvider>
    );
    const { rerender } = render(card(new Map()), { wrapper: Conversation });
    mock.messageStatus = "completed";
    rerender(card(new Map()));
    expect(screen.queryByTestId("word-review-receipt")).toBeNull();

    rerender(card(new Map([[messageId, capture]])));
    expect(
      await screen.findByRole("button", { name: /^(Apply|Replace)/ }),
    ).toBeEnabled();
    expect(screen.queryByTestId("word-review-receipt")).toBeNull();
  });

  it("names a removal Word changed meanwhile once, with why", async () => {
    inPlace.on = true;
    setWordInPlaceCapabilitiesForTests(wordInPlaceCapabilities("PC"));
    const snapshot = document(SECTIONS, true);
    const { capture, edit } = wordCaptureJournal(snapshot);
    const turn = await recordPartsTurn(snapshot, {
      messageId: String(mock.artifact.messageId),
      plan: {
        intent: "Shorter § 1, and § 3 goes.",
        rows: [
          { source: "b1-b2", action: "rewrite", change: "Shorter." },
          { source: "b3-b4", action: "keep" },
          { source: "b5-b6", action: "delete", reason: "No longer needed." },
        ],
      },
      parts: SHORTER_ONE,
      capture,
      beforeFinish: () => edit("b6"),
    });
    if (!turn.last.ok) throw new Error(JSON.stringify(turn.last));
    mock.messageStatus = "completed";
    mock.content = turn.content;
    mount(snapshot, "erato-word-document-plan", planOf(turn), {
      decided: true,
    });

    expect(
      await screen.findByTestId("word-plan-not-changed"),
    ).toHaveTextContent(
      "Not changed: § 3 Abnahme (changed in Word). Ask for it in your next message.",
    );
    expect(screen.getAllByTestId("word-plan-not-changed")).toHaveLength(1);
    expect(rowTexts()).toEqual(["§ 1 Gegenstand"]);
  });

  it("folds a finished change in parts to what it proposed after a reload, without Apply", async () => {
    const snapshot = document();
    const turn = await recordPartsTurn(snapshot, {
      messageId: String(mock.artifact.messageId),
      plan: THREE,
      parts: SHORTER_ONE,
      finishes: 2,
    });
    if (!turn.last.ok) throw new Error(JSON.stringify(turn.last));
    mock.messageStatus = "completed";
    mock.content = turn.content;
    mock.artifact.isFreshCompletion = false;
    mount(snapshot, "erato-word-document-plan", planOf(turn), {
      reloaded: true,
    });

    const card = await screen.findByTestId("word-document-plan-card");
    expect(within(card).getByTestId("word-review-receipt")).toHaveTextContent(
      /^Proposed: /,
    );
    expect(within(card).queryByText(/^Applied/)).toBeNull();
    expect(within(card).queryByRole("button", { name: /^Apply/ })).toBeNull();
    expect(within(card).queryByRole("list", { name: "Sections" })).toBeNull();
    fireEvent.click(within(card).getByRole("button", { name: "Show details" }));
    expect(rowsList()).toBeVisible();
    expect(within(card).queryByRole("button", { name: /^Apply/ })).toBeNull();
  });

  it("lists twenty rows as one flat list that the chat scrolls, never a box of its own", async () => {
    const titles = Array.from({ length: 20 }, (_, k) => `§ ${k + 1} Abschnitt`);
    const snapshot = document(titles);
    const turn = await recordPartsTurn(snapshot, {
      messageId: String(mock.artifact.messageId),
      plan: {
        intent: "Plain wording.",
        rows: titles.map((_, k) => ({
          source: `b${2 * k + 1}-b${2 * k + 2}`,
          action: "rewrite",
          change: "Plain wording.",
        })),
      },
      parts: [],
      finish: false,
    });
    mock.content = turn.content;
    mount(snapshot, "erato-word-document-parts", turn.sectionPlanCall);

    const list = rowsList();
    expect(within(list).getAllByRole("listitem")).toHaveLength(20);
    expect(list).toHaveClass("word-parts__rows");
    expect(list.closest(".word-review__list")).toBeNull();
    expect(screen.getAllByRole("list")).toHaveLength(1);
  });
});
