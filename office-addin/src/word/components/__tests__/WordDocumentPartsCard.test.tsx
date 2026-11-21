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
  heading,
  packageXml,
  paragraph,
} from "../../../test/mocks/word/authoringFixtures";
import { recordPartsTurn } from "../../../test/mocks/word/partsTurn";
import { WordWriteProvider } from "../../providers/WordWriteProvider";
import { captureWordAuthoringSnapshot } from "../../utils/wordDocumentXml";
import { WordHostCardRenderer } from "../WordHostCardRenderer";

import type * as wordPlanCommentCheckModule from "../../utils/wordPlanCommentCheck";
import type * as EratoLibrary from "@erato/frontend/library";
import type {
  WordAuthoringSnapshot,
  WordDocumentCapture,
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
    usePersistedState: () => [{}, vi.fn()],
    useConfirmationRegistryStore: (select: (value: unknown) => unknown) =>
      select({
        registerConfirmation: vi.fn(),
        unregisterConfirmation: vi.fn(),
      }),
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
const document = (sections = SECTIONS) =>
  captureWordAuthoringSnapshot(
    packageXml(
      sections
        .map((title) => heading(title) + paragraph(`${title}: Text.`))
        .join(""),
    ),
    "doc-A",
    "Off",
  );

function mount(
  snapshot: WordAuthoringSnapshot,
  language: string,
  content: string,
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
      capturesByAssistantMessageId={new Map([[messageId, capture]])}
      restoreRequest={vi.fn()}
    >
      <WordHostCardRenderer language={language} content={content} />
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
    clientActionPresentation: "render_buttons",
  };
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("the card of a change in parts", () => {
  it("shows every section of a six-section request once the section plan is accepted", async () => {
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
    mount(snapshot, "erato-word-document-parts", turn.sectionPlanCall);

    expect(
      within(rowsList())
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(titles.map((title) => `${title}Waiting`));
    expect(screen.getByText("0 of 6 sections ready")).toBeInTheDocument();
    expect(
      screen.getByText("Plain wording for warehouse staff."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("You can apply the change once Erato has finished."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Apply/ })).toBeNull();
  });

  it("puts Apply on top and applies the rest in document order once the reordering is left out", async () => {
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
      parts: [
        { row: 1, ops: [{ keep: "b1" }, { replace: "b2", text: "Kurz." }] },
      ],
    });
    if (!turn.last.ok) throw new Error(JSON.stringify(turn.last));
    mock.messageStatus = "completed";
    mock.content = turn.content;
    const insert = wordHost(snapshot);
    mount(
      snapshot,
      "erato-word-document-plan",
      JSON.stringify((turn.last.result as { plan: unknown }).plan),
    );

    const apply = await screen.findByRole("button", { name: /^Apply/ });
    expect(
      apply.compareDocumentPosition(rowsList()) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(rowNamed("Structure")).toHaveTextContent("1 moveReady");
    expect(rowNamed("§ 1 Gegenstand")).toHaveTextContent("Ready");

    fireEvent.click(within(rowNamed("Structure")).getByRole("button"));
    expect(
      screen.getByText("§ 3 Abnahme now comes after § 1 Gegenstand."),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Leave out the reordering" }),
    );
    expect(rowNamed("Structure")).toHaveTextContent("Left out");
    fireEvent.click(within(rowNamed("§ 1 Gegenstand")).getByRole("button"));
    expect(rowNamed("§ 1 Gegenstand")).toHaveTextContent("Kurz.");

    fireEvent.click(screen.getByRole("button", { name: /^Apply/ }));
    await waitFor(() => expect(insert).toHaveBeenCalledTimes(1));
    const written = insert.mock.calls[0][0];
    expect(written).toContain("Kurz.");
    expect(written.indexOf("§ 2 Lieferung")).toBeLessThan(
      written.indexOf("§ 3 Abnahme"),
    );
  });

  it("names a section Erato didn't get to, and offers Leave out only for written rows", async () => {
    const snapshot = document();
    const finished = await recordPartsTurn(snapshot, {
      messageId: String(mock.artifact.messageId),
      plan: {
        intent: "Shorter § 1 and § 3.",
        rows: [
          { source: "b1-b2", action: "rewrite", change: "Shorter." },
          { source: "b3-b4", action: "keep" },
          { source: "b5-b6", action: "rewrite", change: "Shorter." },
        ],
      },
      parts: [
        { row: 1, ops: [{ keep: "b1" }, { replace: "b2", text: "Kurz." }] },
      ],
      finishes: 2,
    });
    if (!finished.last.ok) throw new Error(JSON.stringify(finished.last));
    mock.messageStatus = "completed";
    mock.content = finished.content;
    mount(
      snapshot,
      "erato-word-document-plan",
      JSON.stringify((finished.last.result as { plan: unknown }).plan),
    );

    expect(
      await screen.findByText("Erato didn't get to § 3 Abnahme."),
    ).toBeInTheDocument();
    expect(rowNamed("§ 3 Abnahme")).toHaveTextContent("Not written");
    expect(within(rowNamed("§ 3 Abnahme")).queryByRole("button")).toBeNull();
    expect(screen.queryByTestId("word-plan-not-in-proposal")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Write the missing sections" }),
    ).toBeNull();
    fireEvent.click(within(rowNamed("§ 1 Gegenstand")).getByRole("button"));
    fireEvent.click(screen.getByRole("button", { name: "Leave out" }));
    expect(rowNamed("§ 1 Gegenstand")).toHaveTextContent("Left out");
    expect(screen.getByRole("button", { name: /^Apply/ })).toBeDisabled();
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
