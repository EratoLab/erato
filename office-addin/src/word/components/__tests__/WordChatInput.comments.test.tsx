import {
  parseWordCommentEnvelope,
  parseWordCommentThread,
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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ComposerNoticeDouble,
  ContextLaneDouble,
} from "../../../test/helpers/contextLaneDouble";
import {
  V3C_COMMENT_DOCUMENT,
  installWordCommentHost,
  uninstallWordCommentHost,
} from "../../../test/mocks/word/commentHost";
import {
  V3C_PARAGRAPHS,
  v3cVisibleText,
} from "../../../test/mocks/word/commentPackages";
import { wordCommentGestureStore } from "../../hooks/wordCommentGestureStore";
import { wordContextStore } from "../../hooks/wordContextStore";
import { wordSelectionStore } from "../../hooks/wordSelectionStore";
import { resolveWordSelectionFacet } from "../../utils/wordActionFacet";
import { wordCommentReadSession } from "../../utils/wordCommentReadTool";
import {
  forgetWordCommentRefs,
  wordCommentRefRegistry,
} from "../../utils/wordCommentRefs";
import { wordCommentRefsOf } from "../../utils/wordCommentSend";
import { resolveWordDocumentName } from "../../utils/wordDocumentIdentity";
import { WORD_SELECTION_ARG_KEYS } from "../../utils/wordSelectionArgs";
import {
  WordChatInput,
  WORD_SEND_CAPTURE_DEADLINE_MS,
  WORD_SEND_SKIP_OFFER_MS,
} from "../WordChatInput";

import type { AddinChatInputRenderProps } from "../../../core/AddinChatCore";
import type {
  CommentHost,
  CommentHostOptions,
} from "../../../test/mocks/word/commentHost";
import type { WordDocumentBuild } from "../../utils/buildWordDocumentArgs";
import type { WordCommentReadResultJson } from "../../utils/wordCommentReadTool";
import type { WordCommentsCapture } from "../../utils/wordCommentSend";
import type { WordSelectionSnapshot } from "../../utils/wordSelectionAnchor";
import type {
  ComposerContextItem,
  ComposerNotice,
} from "@erato/frontend/library";
import type { WordCommentEnvelope } from "@erato/frontend/word-review";
import type { Ref } from "react";

const host = vi.hoisted(() => ({
  facets: [] as { id: string; allowed_args?: string[] }[],
  includeDocument: false,
  precedence: "selection",
  capture: vi.fn(),
  captureSelection: vi.fn(),
  budget: vi.fn(),
  previous: null as WordDocumentBuild | null,
  focusInput: vi.fn(),
}));

vi.mock("@erato/frontend/library", async () => {
  const mock = await import("../../../test/helpers/eratoLibraryMock");
  const { AlertMock } = await import("../../../test/helpers/contextLaneDouble");
  return mock.createEratoLibraryMock({
    useFacets: () => ({ data: { action_facets: host.facets } }),
    Alert: AlertMock,
  });
});

vi.mock("../../../core/AddinChatInputCore", async () => {
  const { useImperativeHandle } = await import("react");
  return {
    AddinChatInputCore: ({
      ref,
      onSendMessage,
      contextItems,
      composerNotice,
    }: {
      ref?: Ref<{ focusInput: () => void }>;
      onSendMessage: (message: string) => void;
      contextItems?: ComposerContextItem[];
      composerNotice?: ComposerNotice | null;
    }) => {
      useImperativeHandle(ref, () => ({ focusInput: host.focusInput }));
      return (
        <div data-testid="composer">
          <ComposerNoticeDouble notice={composerNotice} />
          <ContextLaneDouble items={contextItems} />
          <button
            type="button"
            data-testid="send"
            onClick={() => onSendMessage("What does the comment say?")}
          >
            send
          </button>
        </div>
      );
    },
  };
});

vi.mock("../../hooks/useWordDocumentSource", () => ({
  useWordDocumentSource: () => ({
    // As a read leaves it: an included document has content.
    preview: {
      status: "included",
      coverage: {
        paragraphsSent: 12,
        paragraphsTotal: 12,
        truncated: false,
        partialParagraph: false,
        hasContent: true,
      },
      changedSinceLastSend: false,
      reading: false,
    },
    capture: host.capture,
    captureExpectedSlow: () => false,
    previousCapture: () => host.previous,
    markSent: () => {},
    retry: () => {},
  }),
}));

const selectionChip = () => screen.getByTestId("context-chip-word.selection");
const documentChip = () => screen.getByTestId("context-chip-word.document");
const commentChip = () => screen.getByTestId("context-chip-word.comment");
const findCommentChip = () =>
  screen.findByTestId("context-chip-word.comment", {}, { timeout: 3000 });
const openCommentsChip = () =>
  screen.getByTestId("context-chip-word.openComments");
const metaOf = (chip: HTMLElement) =>
  within(chip).queryByTestId("context-chip-meta")?.textContent;
const labelOf = (chip: HTMLElement) =>
  within(chip).getByTestId("context-chip-label").textContent;
const detailOf = (
  kind:
    | "word.selection"
    | "word.document"
    | "word.comment"
    | "word.openComments",
) => screen.getByTestId(`context-detail-${kind}`);
/** The one-off send prompt in the composer's notice slot. */
const findNotice = () => screen.findByTestId("composer-notice");
const pressIn = (element: HTMLElement, name: string) =>
  fireEvent.click(within(element).getByRole("button", { name }));
/** Waits for the comment list's light read to reach the chips. */
const waitForMeta = (chip: () => HTMLElement, meta: string) =>
  waitFor(() => expect(metaOf(chip())).toBe(meta), { timeout: 3000 });
const excludeDocument = () =>
  fireEvent.click(
    within(documentChip()).getByRole("button", {
      name: "Don't include this document",
    }),
  );

vi.mock("../../hooks/useWordSelection", () => ({
  useWordSelection: () => {},
}));

vi.mock("../../utils/wordSelectionCapture", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  captureWordSelection: () => host.captureSelection(),
}));

vi.mock("../../utils/wordAuthoringBudget", () => ({
  checkWordAuthoringBudget: host.budget,
}));

vi.mock("../../utils/wordDocumentReadTool", () => ({
  WORD_READ_TOOL: "read_document_blocks",
  wordDocumentReadSession: { activate: vi.fn(), clear: vi.fn() },
}));

vi.mock("../../utils/wordDocumentReadRequest", () => ({
  bindWordDocumentReadRequest: () => () => {},
}));

vi.mock("../../utils/wordDocumentSubmission", () => ({
  WORD_SUBMIT_PLAN_TOOL: "submit_document_plan",
  createWordDocumentSubmissionExecutor: () => vi.fn(),
}));

vi.mock("../../wordPreferences", () => ({
  useWordIncludeDocumentByDefault: () => [host.includeDocument, () => {}],
  useWordCommentPrecedence: () => [host.precedence, () => {}],
}));

type SendCall = Parameters<AddinChatInputRenderProps["onSendMessage"]>;
type Prepared = Awaited<ReturnType<NonNullable<SendCall[11]>["run"]>>;

const IDENTITY = "https://contoso.sharepoint.com/Shared%20Documents/a.docx";
const DARK_SELECTION_KEYS = WORD_SELECTION_ARG_KEYS.filter(
  (key) => key !== "anchored_comments",
);
const REVIEW_KEYS = [
  "document_name",
  "document_text",
  "heading_outline",
  "paragraphs_sent",
  "paragraphs_total",
  "truncation_note",
  "document_identity",
];
const AUTHORING_KEYS = [
  "document_name",
  "document_identity",
  "document_text",
  "heading_outline",
  "paragraphs_sent",
  "paragraphs_total",
  "truncation_note",
  "document_snapshot",
  "authoring_status",
];
const THREAD_FACET = {
  id: "word_comment_thread",
  allowed_args: [
    "document_name",
    "document_identity",
    "thread_json",
    "comments_json",
  ],
};
const facet = (id: string, keys: readonly string[], comments?: string) => ({
  id,
  allowed_args: comments ? [...keys, comments] : [...keys],
});
const TAGS = [
  "H1",
  "T1P",
  "T2P",
  "H2",
  "T3A",
  "T3B",
  "T3C",
  "T4C",
  "CI1",
  "H3",
  "T5P",
  "T6P",
  "T8P",
  "T9P",
  "T10P",
  "T11P",
  "PB1",
  "XC1",
  "XC2",
  "END",
];

describe("WordChatInput comment context", () => {
  let word: CommentHost;
  let handedOver: SendCall[];
  let staged: (WordCommentsCapture | null)[];
  const openSettings = vi.fn();

  const install = (options: CommentHostOptions = {}) => {
    word = installWordCommentHost(options);
  };
  const props = (): AddinChatInputRenderProps =>
    ({
      chatId: "chat-1",
      onSendMessage: (...args: SendCall) => handedOver.push(args),
    }) as unknown as AddinChatInputRenderProps;
  const renderInput = () =>
    render(
      <WordChatInput
        chatInputProps={props()}
        documentIdentity={IDENTITY}
        stagePendingCapture={(capture) => staged.push(capture)}
        onOpenWordSettings={openSettings}
      />,
    );
  const lastSend = () => {
    const call = handedOver.at(-1);
    if (!call) throw new Error("nothing was sent");
    return call;
  };
  const send = () => fireEvent.click(screen.getByTestId("send"));
  /** Starts the prepared send; it may wait for the user. */
  const start = (signal = new AbortController().signal) => {
    const prepare = lastSend()[11];
    if (!prepare) throw new Error("the send was not prepared");
    let run!: Promise<Prepared>;
    act(() => {
      run = prepare.run(signal);
    });
    return run;
  };
  const finish = async (run: Promise<Prepared>): Promise<Prepared> => {
    let result: Prepared = null;
    await act(async () => {
      result = await run;
    });
    return result;
  };
  const prepared = () => finish(start());
  const envelope = (json: string | undefined): WordCommentEnvelope => {
    const parsed = parseWordCommentEnvelope(json);
    if (!parsed) throw new Error(`not an envelope: ${json}`);
    return parsed;
  };
  const refOf = (key: string) => {
    const refs = wordCommentRefsOf(
      staged.findLast((capture) => wordCommentRefsOf(capture)),
    );
    const ref = refs?.threads.find(
      (t) => t.commentId === word.commentId(key),
    )?.ref;
    if (!ref) throw new Error(`no ref for ${key}`);
    return ref;
  };

  const passageOverT1 = (
    over: Partial<WordSelectionSnapshot> = {},
  ): WordSelectionSnapshot => ({
    role: "rewrite",
    reasonCode: null,
    shape: "inline",
    story: "main",
    origin: "user",
    selectedText: "alpha bravo",
    truncated: false,
    paragraphCount: 1,
    paragraphs: [
      {
        id: "{0000-T1P}",
        text: "T1P Thread one anchor alpha bravo charlie.",
        rangeText: "T1P Thread one anchor alpha bravo charlie.",
        index: word.ordinalOf("T1P") - 1,
        styleName: "Normal",
        tableNestingLevel: 0,
      },
    ],
    startOffset: 22,
    endOffset: 33,
    occurrence: 0,
    anchor: null,
    contextBefore: "T1P Thread one anchor ",
    contextAfter: " charlie.",
    ...over,
  });
  const publishSelection = (
    key: string,
    origin: "user" | "erato" = "user",
    shape: WordSelectionSnapshot["shape"] = "inline",
  ) =>
    act(() =>
      wordSelectionStore.publish({
        preview: {
          key,
          text: "alpha bravo",
          paragraphCount: 1,
          shape,
          story: "main",
          truncated: false,
          mayRewrite: shape !== "table",
        },
        origin,
        armed: origin === "user",
        pending: false,
      }),
    );
  /** The chip's light read sees the passage's shape; Send's full read also finds `captured`. */
  const selectT1 = ({
    captured = {},
    shape = "inline",
  }: {
    captured?: Partial<WordSelectionSnapshot>;
    shape?: WordSelectionSnapshot["shape"];
  } = {}) => {
    install({
      selection: {
        tag: "T1P",
        offset: 22,
        to: { tag: "T1P", offset: 33 },
      },
    });
    host.captureSelection.mockResolvedValue({
      status: "ok",
      value: passageOverT1({ shape, ...captured }),
    });
    publishSelection("T1P:alpha bravo", "user", shape);
  };
  const documentBuild = (authoring = false): WordDocumentBuild =>
    ({
      args: {
        document_text: "[1] Introduction",
        heading_outline: "",
        paragraphs_sent: String(TAGS.length),
        paragraphs_total: String(TAGS.length),
        truncation_note: "",
      },
      coverage: { hasContent: true, paragraphsSent: TAGS.length },
      ordinalMap: new Map(
        TAGS.map((tag) => [
          word.ordinalOf(tag),
          { uniqueLocalId: `{0000-${tag}}`, text: tag },
        ]),
      ),
      headings: new Map([
        [word.ordinalOf("H1"), { level: 1, text: "Introduction" }],
        [word.ordinalOf("H2"), { level: 1, text: "Spans and cells" }],
        [word.ordinalOf("H3"), { level: 1, text: "Inline anchors" }],
      ]),
      renderedOrdinals: new Set(TAGS.map((tag) => word.ordinalOf(tag))),
      partialOrdinal: null,
      ...(authoring ? { authoring: { token: "snapshot-1" } } : {}),
    }) as unknown as WordDocumentBuild;

  beforeEach(() => {
    i18n.activate("en");
    host.facets = [];
    host.includeDocument = false;
    host.precedence = "selection";
    host.capture.mockReset();
    host.captureSelection.mockReset();
    host.budget.mockReset().mockResolvedValue({ ok: true });
    host.previous = null;
    host.focusInput.mockReset();
    openSettings.mockReset();
    handedOver = [];
    staged = [];
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    uninstallWordCommentHost();
    wordContextStore.resetForTests();
    wordSelectionStore.resetForTests();
    wordCommentGestureStore.resetForTests();
    forgetWordCommentRefs();
    wordCommentReadSession.clear();
  });

  describe("with nothing advertised", () => {
    it("sends a passage exactly as before, without reading a comment", async () => {
      host.facets = [
        facet("word_selection", DARK_SELECTION_KEYS),
        facet("word_document_review", REVIEW_KEYS),
      ];
      selectT1();
      renderInput();
      send();
      expect(lastSend()[11]?.label).toBe("Reading selection…");
      const result = await prepared();

      expect(Object.keys(result?.actionFacet?.args ?? {})).toEqual(
        DARK_SELECTION_KEYS,
      );
      expect(JSON.stringify(result?.actionFacet)).toBe(
        JSON.stringify(
          resolveWordSelectionFacet({
            selection: passageOverT1(),
            documentName: resolveWordDocumentName(),
            documentIdentity: IDENTITY,
            availableFacetIds: new Set(host.facets.map((f) => f.id)),
            availableFacetArgs: new Map(
              host.facets.map((f) => [f.id, new Set(f.allowed_args)]),
            ),
          }),
        ),
      );
      expect(staged.at(-1)).not.toHaveProperty("commentRefs");
      expect(word.calls()).toEqual([]);
      expect(word.syncCount()).toBe(0);
    });

    it("sends the document exactly as before, without reading a comment", async () => {
      host.facets = [facet("word_document_review", REVIEW_KEYS)];
      host.includeDocument = true;
      install();
      host.capture.mockResolvedValue(documentBuild());
      renderInput();
      send();
      expect(lastSend()[11]?.label).toBeUndefined();
      const result = await prepared();

      expect(result?.actionFacet?.id).toBe("word_document_review");
      expect(Object.keys(result?.actionFacet?.args ?? {})).toEqual(REVIEW_KEYS);
      expect(staged.at(-1)).not.toHaveProperty("commentRefs");
      expect(word.calls()).toEqual([]);
    });

    it("prepares nothing for a send without the document or a selection", () => {
      host.facets = [facet("word_document_review", REVIEW_KEYS)];
      install({ selection: { tag: "T1P", offset: 25 } });
      renderInput();
      send();
      expect(lastSend()[11]).toBeUndefined();
      expect(word.calls()).toEqual([]);
    });
  });

  describe("a passage", () => {
    beforeEach(() => {
      host.facets = [
        facet("word_selection", WORD_SELECTION_ARG_KEYS),
        facet("word_document_review", REVIEW_KEYS, "comment_map"),
        THREAD_FACET,
      ];
    });

    it("carries exactly its own threads and the coverage line in anchored_comments", async () => {
      selectT1();
      renderInput();
      send();
      expect(lastSend()[11]?.label).toBe("Reading selection…");
      const result = await prepared();

      expect(result?.actionFacet?.id).toBe("word_selection");
      const { anchored_comments: anchored, ...rest } =
        result?.actionFacet?.args ?? {};
      expect(Object.keys(rest)).toEqual(DARK_SELECTION_KEYS);
      expect(rest.selected_text).toBe("alpha bravo");
      const sent = envelope(anchored);
      expect(sent.scope).toBe("selection");
      expect(sent.threads.map((t) => t.id)).toEqual([refOf("T1")]);
      expect(sent.threads[0].where.vs).toBe("inside");
      expect(sent.threads[0].entries.map((e) => e.by)).toEqual([
        "Maya Krüger",
        "Jonas Weber",
        "Maya Krüger",
      ]);
      expect(sent.index).toEqual([]);
      expect(sent.coverage).toMatchObject({
        threads_total: 14,
        sent_full: 1,
        not_shown: 13,
      });
      expect(sent.coverage.line).toMatch(/^14 comment threads in the document/);
      expect(wordCommentRefsOf(staged.at(-1))?.threads).toHaveLength(14);
      expect(staged.at(-1)).toMatchObject({
        selection: { selectedText: "alpha bravo" },
      });
      expect(word.calls()).not.toContain("range.getComments");
    });

    it("sends the thread instead when the setting works on the comment", async () => {
      host.precedence = "comment";
      selectT1();
      renderInput();
      send();
      const result = await prepared();

      expect(result?.actionFacet?.id).toBe("word_comment_thread");
      const thread = parseWordCommentThread(
        result?.actionFacet?.args?.thread_json,
      );
      expect(thread?.id).toBe(refOf("T1"));
      const around = envelope(result?.actionFacet?.args?.comments_json);
      expect(around.scope).toBe("thread");
      expect(around.why).toBe("default");
      expect(around.threads).toEqual([thread]);
      expect(result?.hostContextIdentity).toBe(IDENTITY);
      expect(staged.at(-1)).not.toHaveProperty("selection");
      expect(wordCommentRefsOf(staged.at(-1))).not.toBeNull();
    });

    it("switches to the comment for one message", async () => {
      selectT1();
      renderInput();
      act(() => wordCommentGestureStore.set({ override: "comment" }));
      send();
      const switched = (await prepared())?.actionFacet;
      expect(switched?.id).toBe("word_comment_thread");
      expect(envelope(switched?.args?.comments_json).why).toBe("chosen");

      send();
      expect((await prepared())?.actionFacet?.id).toBe("word_selection");
    });

    it("blocks on a failed read until the user sends without comments", async () => {
      selectT1();
      install({
        failList: true,
        selection: { tag: "T1P", offset: 22, to: { tag: "T1P", offset: 33 } },
      });
      renderInput();
      const activate = vi.spyOn(wordCommentReadSession, "activate");
      send();
      const run = start();

      const notice = await findNotice();
      expect(notice).toHaveTextContent(
        "Erato could not read the comments in Word.",
      );
      expect(notice).toHaveAttribute("role", "alert");
      expect(
        within(notice).queryByRole("button", { name: "Choose comment…" }),
      ).toBeNull();
      expect(
        within(notice).queryByRole("button", { name: "Dismiss" }),
      ).toBeNull();
      pressIn(notice, "Send without comments");
      const result = await finish(run);

      expect(result?.actionFacet?.id).toBe("word_selection");
      expect(result?.actionFacet?.args?.anchored_comments).toBe("");
      expect(staged.at(-1)).not.toHaveProperty("commentRefs");
      expect(screen.queryByTestId("composer-notice")).toBeNull();
      expect(activate).toHaveBeenLastCalledWith(
        expect.objectContaining({ withheld: true }),
      );
      activate.mockRestore();
    });
  });

  describe("the document", () => {
    beforeEach(() => {
      host.includeDocument = true;
      install();
    });

    it("carries the comment map on the review facet", async () => {
      host.facets = [facet("word_document_review", REVIEW_KEYS, "comment_map")];
      host.capture.mockResolvedValue(documentBuild());
      renderInput();
      send();
      expect(lastSend()[11]?.label).toBe("Reading comments…");
      const result = await prepared();

      expect(result?.actionFacet?.id).toBe("word_document_review");
      const map = envelope(result?.actionFacet?.args?.comment_map);
      expect(map.scope).toBe("document");
      expect(map.threads).toEqual([]);
      expect(map.index).toHaveLength(14);
      expect(map.index[0]).toMatchObject({
        sec: "Introduction",
        para: word.ordinalOf("T1P"),
        by: "Maya Krüger",
        r: 2,
      });
      expect(map.coverage).toMatchObject({ threads_total: 14, not_shown: 0 });
      expect(wordCommentRefsOf(staged.at(-1))?.threads).toHaveLength(14);
    });

    it("lists the comment map in the document's detail while the map goes", async () => {
      host.facets = [facet("word_document_review", REVIEW_KEYS, "comment_map")];
      renderInput();

      const comments = await waitFor(() => {
        const section = detailOf("word.document").querySelector(
          '[data-ui="word-context-detail-comments"]',
        );
        expect(section).not.toBeNull();
        return section!;
      });
      expect(documentChip()).toHaveAttribute("data-state", "included");
      expect(
        within(comments as HTMLElement).getAllByRole("listitem")[0],
      ).toHaveTextContent(
        "A list of the 14 comments in the document: each one's author, place, status and how it starts.",
      );
    });

    it("carries the comment map on the authoring facet", async () => {
      host.facets = [
        facet("word_document_authoring", AUTHORING_KEYS, "comment_map"),
      ];
      host.capture.mockResolvedValue(documentBuild(true));
      renderInput();
      send();
      const result = await prepared();

      expect(result?.actionFacet?.id).toBe("word_document_authoring");
      expect(Object.keys(result?.actionFacet?.args ?? {})).toEqual([
        ...AUTHORING_KEYS,
        "comment_map",
      ]);
      expect(
        envelope(result?.actionFacet?.args?.comment_map).index,
      ).toHaveLength(14);
    });

    it("leaves comment_map off a document facet that does not take it", async () => {
      host.facets = [facet("word_document_review", REVIEW_KEYS), THREAD_FACET];
      host.capture.mockResolvedValue(documentBuild());
      renderInput();
      send();
      const result = await prepared();

      expect(Object.keys(result?.actionFacet?.args ?? {})).toEqual(REVIEW_KEYS);
    });
  });

  describe("the caret and the pick", () => {
    beforeEach(() => {
      host.facets = [THREAD_FACET];
    });

    it("sends the thread at the caret", async () => {
      install({ selection: { tag: "T1P", offset: 25 } });
      renderInput();
      send();
      expect(lastSend()[11]?.label).toBe("Reading comments…");
      const result = await prepared();

      expect(result?.actionFacet?.id).toBe("word_comment_thread");
      const thread = parseWordCommentThread(
        result?.actionFacet?.args?.thread_json,
      );
      expect(thread?.id).toBe(refOf("T1"));
      expect(thread?.where.vs).toBe("at_caret");
      expect(envelope(result?.actionFacet?.args?.comments_json).why).toBe(
        "cursor",
      );
    });

    it("sends nothing for a caret in two anchors until the user decides", async () => {
      install({ selection: { tag: "T6P", offset: 20 } });
      renderInput();
      send();
      const run = start();

      const notice = await findNotice();
      expect(notice).toHaveTextContent(
        "Your cursor is in more than one comment",
      );
      expect(notice).toHaveAttribute("data-tone", "warning");
      pressIn(notice, "Send without comments");
      expect(await finish(run)).toEqual({
        actionFacet: undefined,
        hostContextIdentity: null,
      });
    });

    it("drops the send when the user stops it while it waits", async () => {
      install({ selection: { tag: "T6P", offset: 20 } });
      renderInput();
      send();
      const stop = new AbortController();
      const run = start(stop.signal);
      await findNotice();

      act(() => stop.abort());
      expect(await finish(run)).toBeNull();
      expect(screen.queryByTestId("composer-notice")).toBeNull();
    });

    it("keeps sending a picked thread, and blocks once it is gone", async () => {
      install({ selection: { tag: "T1P", offset: 25 } });
      renderInput();
      send();
      await prepared();
      const t1 = refOf("T1");

      install({ selection: { tag: "END", offset: 0 } });
      act(() =>
        wordCommentGestureStore.pick({
          kind: "pick",
          ref: t1,
          selectionKey: null,
        }),
      );
      for (let i = 0; i < 2; i += 1) {
        send();
        const result = await prepared();
        expect(
          parseWordCommentThread(result?.actionFacet?.args?.thread_json)?.id,
        ).toBe(t1);
        expect(envelope(result?.actionFacet?.args?.comments_json).why).toBe(
          "chosen",
        );
      }

      act(() =>
        wordCommentGestureStore.pick({
          kind: "pick",
          ref: "tzz",
          selectionKey: null,
        }),
      );
      send();
      const run = start();
      const notice = await findNotice();
      expect(notice).toHaveTextContent(
        "The comment you chose is no longer in the document.",
      );
      pressIn(notice, "Send without comments");
      expect((await finish(run))?.actionFacet).toBeUndefined();
    });

    it("blocks a picked thread Word lists but the read cannot place, never sending an empty one", async () => {
      install({ selection: { tag: "T1P", offset: 25 } });
      renderInput();
      send();
      await prepared();
      const t6 = refOf("T6");

      install({ selection: { tag: "END", offset: 0 }, failRanges: ["T6"] });
      act(() =>
        wordCommentGestureStore.pick({
          kind: "pick",
          ref: t6,
          selectionKey: null,
        }),
      );
      send();
      const run = start();
      const notice = await findNotice();
      expect(notice).toHaveTextContent(
        "The comment you chose is no longer in the document.",
      );
      pressIn(notice, "Send without comments");
      expect((await finish(run))?.actionFacet).toBeUndefined();
    });

    it("sends every open thread with Include open comments", async () => {
      install({ selection: { tag: "END", offset: 0 } });
      renderInput();
      act(() => wordCommentGestureStore.set({ includeOpenComments: true }));
      send();
      const result = await prepared();

      expect(result?.actionFacet?.args?.thread_json).toBe("");
      const open = envelope(result?.actionFacet?.args?.comments_json);
      expect(open.scope).toBe("document");
      expect(open).not.toHaveProperty("why");
      expect(open.threads.length + open.index.length).toBe(13);
    });
  });

  describe("the chips", () => {
    beforeEach(() => {
      host.facets = [
        facet("word_selection", WORD_SELECTION_ARG_KEYS),
        THREAD_FACET,
      ];
    });
    /** The ref the chip's read gave a thread; refOf waits for a Send's capture. */
    const listedRef = (key: string) =>
      wordCommentRefRegistry(IDENTITY).refs.get(`id:${word.commentId(key)}`);

    it("sends the passage without comments from its detail's checkbox, and keeps the passage", async () => {
      selectT1();
      renderInput();
      await waitForMeta(selectionChip, "Selected · 1 ¶ · 1 comment");
      expect(screen.queryByTestId("context-chip-word.comment")).toBeNull();
      const checkbox = within(detailOf("word.selection")).getByRole(
        "checkbox",
        { name: "Send the comment in this passage" },
      );
      expect(checkbox).toBeChecked();
      expect(checkbox).toHaveAccessibleDescription(
        "Off lasts for this message only",
      );

      fireEvent.click(checkbox);
      expect(selectionChip()).toHaveAttribute("data-state", "included");
      expect(metaOf(selectionChip())).toBe("Selected · 1 ¶ · comments off");
      expect(
        within(detailOf("word.selection")).getByRole("checkbox"),
      ).not.toBeChecked();
      send();
      const result = await prepared();

      expect(result?.actionFacet?.id).toBe("word_selection");
      expect(result?.actionFacet?.args?.selected_text).toBe("alpha bravo");
      expect(result?.actionFacet?.args?.anchored_comments).toBe("");
    });

    it("keeps the comments when the selection's own × dismisses the passage", async () => {
      selectT1();
      renderInput();
      await waitForMeta(selectionChip, "Selected · 1 ¶ · 1 comment");

      fireEvent.click(
        within(selectionChip()).getByRole("button", {
          name: "Dismiss selection",
        }),
      );
      expect(selectionChip()).toHaveAttribute("data-state", "suggested");
      expect(wordCommentGestureStore.getSnapshot().withoutComments).toBe(false);
    });

    it("puts nothing above the composer: the choice is a chip, the waiting Send a notice", async () => {
      host.facets = [
        facet("word_selection", WORD_SELECTION_ARG_KEYS),
        THREAD_FACET,
      ];
      install({ selection: { tag: "T6P", offset: 20 } });
      const { container } = renderInput();
      const chip = await findCommentChip();
      expect(chip).toHaveAttribute("data-state", "attention");
      expect(chip).toHaveAttribute("data-tone", "warning");
      expect(chip).toHaveAttribute("data-origin", "ambient");
      expect(labelOf(chip)).toBe("Cursor is in 2 comments");
      expect(metaOf(chip)).toBe("Choose one");
      send();
      const run = start();
      const notice = await findNotice();

      expect(
        [...container.children].map((child) =>
          child.getAttribute("data-testid"),
        ),
      ).toEqual(["word-composer-announcer", "composer"]);
      expect(screen.getByTestId("composer")).toContainElement(notice);
      expect(screen.queryByTestId("word-comment-chip")).toBeNull();
      expect(screen.queryByTestId("word-one-off-rows")).toBeNull();
      expect(screen.queryByTestId("word-comment-options")).toBeNull();

      pressIn(notice, "Send without comments");
      await finish(run);
    });

    it("opens the Word settings from Change default", async () => {
      selectT1();
      renderInput();
      await waitForMeta(selectionChip, "Selected · 1 ¶ · 1 comment");
      expect(detailOf("word.selection")).toHaveTextContent("Your default");

      pressIn(detailOf("word.selection"), "Change default");
      expect(openSettings).toHaveBeenCalledTimes(1);
    });

    it("switches the next message to the comment from the chip", async () => {
      selectT1();
      renderInput();
      fireEvent.click(
        await screen.findByRole("button", {
          name: "Work on Maya Krüger's comment instead",
        }),
      );
      expect(selectionChip()).toHaveAttribute("data-state", "superseded");
      expect(metaOf(selectionChip())).toBe("Replaced by comment");
      expect(detailOf("word.selection")).toHaveTextContent(
        "A comment is sent instead of this passage.",
      );
      expect(labelOf(commentChip())).toBe("Comment by Maya Krüger");
      expect(metaOf(commentChip())).toBe("Chosen by you");
      expect(commentChip()).toHaveAttribute("data-origin", "ambient");
      expect(detailOf("word.comment")).toHaveTextContent("2 replies");
      send();

      expect((await prepared())?.actionFacet?.id).toBe("word_comment_thread");
    });

    it("keeps a pick until another pick, its × or a new selection of the user's", async () => {
      selectT1();
      renderInput();
      await waitForMeta(selectionChip, "Selected · 1 ¶ · 1 comment");
      const pick = (ref: string) =>
        act(() =>
          wordCommentGestureStore.pick({
            kind: "pick",
            ref,
            selectionKey: "T1P:alpha bravo",
          }),
        );
      const picked = () => wordCommentGestureStore.getSnapshot().pick?.ref;
      const [t5, t8, t9] = ["T5", "T8", "T9"].map((key) => listedRef(key)!);

      pick(t5);
      send();
      expect((await prepared())?.actionFacet?.id).toBe("word_comment_thread");
      expect(picked()).toBe(t5);

      publishSelection("T1P:alpha bravo", "erato");
      expect(picked()).toBe(t5);
      publishSelection("T1P:alpha bravo");
      expect(picked()).toBe(t5);

      pick(t8);
      expect(picked()).toBe(t8);
      publishSelection("T8P:kilo");
      expect(picked()).toBeUndefined();

      pick(t9);
      fireEvent.click(
        await screen.findByRole("button", {
          name: "Remove the chosen comment",
        }),
      );
      expect(picked()).toBeUndefined();
    });

    it("lets the user choose the thread a waiting send goes with", async () => {
      install({ selection: { tag: "T6P", offset: 20 } });
      host.facets = [THREAD_FACET];
      renderInput();
      send();
      const run = start();

      pressIn(await findNotice(), "Choose comment…");
      const t7 = listedRef("T7");
      const row = await waitFor(() => {
        const found = screen
          .getAllByTestId("word-comment-picker-row")
          .find((r) => r.getAttribute("data-ref") === t7);
        if (!found) throw new Error("T7 is not listed yet");
        return found;
      });
      expect(row).toHaveTextContent("In your selection");
      fireEvent.click(within(row).getByText("Jonas Weber"));
      const result = await finish(run);

      expect(result?.actionFacet?.id).toBe("word_comment_thread");
      expect(
        parseWordCommentThread(result?.actionFacet?.args?.thread_json)?.id,
      ).toBe(t7);
      expect(wordCommentGestureStore.getSnapshot().pick?.ref).toBe(t7);
      expect(screen.queryByTestId("word-comment-picker")).toBeNull();
    });

    it("shows nothing about comments while nothing is advertised", async () => {
      host.facets = [facet("word_selection", DARK_SELECTION_KEYS)];
      selectT1();
      renderInput();
      await screen.findByTestId("context-chip-word.selection");
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(screen.queryByTestId("context-chip-word.comment")).toBeNull();
      expect(screen.queryByTestId("context-chip-word.openComments")).toBeNull();
      expect(metaOf(selectionChip())).toBe("Selected passage · 1 ¶");
      expect(word.calls()).toEqual([]);
    });
  });

  describe("the comment chips and the notice", () => {
    beforeEach(() => {
      host.facets = [
        facet("word_selection", WORD_SELECTION_ARG_KEYS),
        THREAD_FACET,
      ];
    });
    const threadIdOf = (result: Prepared) =>
      parseWordCommentThread(result?.actionFacet?.args?.thread_json)?.id;
    const picked = () => wordCommentGestureStore.getSnapshot().pick?.ref;
    const announcer = () => screen.getByTestId("word-composer-announcer");
    const choiceButtons = () =>
      within(
        within(detailOf("word.comment")).getByRole("list", {
          name: "Comments at your cursor",
        }),
      ).getAllByRole("button");

    it("leaves the cursor's comment out for one message with its (x), and + brings it back", async () => {
      install({ selection: { tag: "T1P", offset: 25 } });
      renderInput();
      const chip = await findCommentChip();
      expect(labelOf(chip)).toBe("Comment by Maya Krüger");
      expect(metaOf(chip)).toBe("At your cursor");
      expect(chip).toHaveAttribute("data-origin", "ambient");
      expect(chip).toHaveAttribute("data-dismiss-scope", "message");

      pressIn(chip, "Send without comments");
      expect(commentChip()).toHaveAttribute("data-state", "suggested");
      pressIn(commentChip(), "Include comments");
      expect(commentChip()).toHaveAttribute("data-state", "included");

      pressIn(commentChip(), "Send without comments");
      send();
      // Nothing else goes, so nothing is prepared or read.
      expect(lastSend()[4]).toBeUndefined();
      expect(lastSend()[11]).toBeUndefined();
      // The Send spent it: the next message has the comment again.
      expect(commentChip()).toHaveAttribute("data-state", "included");
      send();
      expect(threadIdOf(await prepared())).toBe(refOf("T1"));
    });

    it("makes a choice in the attention chip's detail the next Send's thread", async () => {
      install({ selection: { tag: "T6P", offset: 20 } });
      renderInput();
      const chip = await findCommentChip();
      expect(chip).toHaveAttribute("data-state", "attention");
      expect(detailOf("word.comment")).toHaveTextContent(
        "Your cursor is in 2 comments",
      );
      const choices = choiceButtons();
      expect(choices).toHaveLength(2);
      expect(choices[1]).toHaveTextContent("Jonas Weber");

      fireEvent.click(choices[1]);
      expect(commentChip()).toHaveAttribute("data-origin", "user");
      expect(commentChip()).toHaveAttribute("data-state", "included");
      expect(labelOf(commentChip())).toBe("Comment by Jonas Weber");
      expect(metaOf(commentChip())).toBe("Chosen by you");
      send();
      const result = await prepared();
      expect(threadIdOf(result)).toBe(picked());
      expect(envelope(result?.actionFacet?.args?.comments_json).why).toBe(
        "chosen",
      );
    });

    it("lets a choice in the detail answer a Send already waiting on it", async () => {
      install({ selection: { tag: "T6P", offset: 20 } });
      renderInput();
      await findCommentChip();
      send();
      const run = start();
      await findNotice();

      fireEvent.click(choiceButtons()[0]);
      const result = await finish(run);
      expect(result?.actionFacet?.id).toBe("word_comment_thread");
      expect(threadIdOf(result)).toBe(picked());
      expect(screen.queryByTestId("composer-notice")).toBeNull();
    });

    it("answers a Send waiting on a choice from the chip's (x), leaving no gesture behind", async () => {
      install({ selection: { tag: "T6P", offset: 20 } });
      renderInput();
      await findCommentChip();
      send();
      const run = start();
      await findNotice();

      pressIn(commentChip(), "Send without comments");
      const result = await finish(run);
      expect(result?.actionFacet).toBeUndefined();
      expect(wordCommentGestureStore.getSnapshot().withoutComments).toBe(false);
      expect(commentChip()).toHaveAttribute("data-state", "attention");
    });

    it("answers a Send waiting on a gone pick from the chip's (x), and ends the pick", async () => {
      install({ selection: { tag: "END", offset: 0 } });
      renderInput();
      act(() =>
        wordCommentGestureStore.pick({
          kind: "pick",
          ref: "tzz",
          selectionKey: null,
        }),
      );
      const chip = await findCommentChip();
      await waitFor(() =>
        expect(commentChip()).toHaveAttribute("data-state", "error"),
      );
      expect(chip).toHaveAttribute("data-origin", "user");
      expect(metaOf(commentChip())).toBe("No longer in the document");
      send();
      const run = start();
      expect(await findNotice()).toHaveAttribute(
        "data-notice-id",
        "word.comments.block.gone",
      );

      pressIn(commentChip(), "Remove the chosen comment");
      expect((await finish(run))?.actionFacet).toBeUndefined();
      expect(picked()).toBeUndefined();
      expect(screen.queryByTestId("context-chip-word.comment")).toBeNull();
    });

    it("picks the cursor's comment before Show in Word selects it, so it stays the target", async () => {
      install({ selection: { tag: "T1P", offset: 25 } });
      renderInput();
      await findCommentChip();
      await act(async () => {
        pressIn(detailOf("word.comment"), "Show in Word");
      });

      expect(picked()).toBeDefined();
      expect(commentChip()).toHaveAttribute("data-origin", "user");
      expect(metaOf(commentChip())).toBe("Chosen by you");
      expect(announcer()).toHaveTextContent("Comment by Maya Krüger chosen.");
      send();
      expect(threadIdOf(await prepared())).toBe(picked());
    });

    it("includes a comment picked after the (x), says so, and hands focus back to the composer", async () => {
      install({ selection: { tag: "T1P", offset: 25 } });
      renderInput();
      await findCommentChip();
      pressIn(commentChip(), "Send without comments");
      pressIn(detailOf("word.comment"), "Choose comment…");
      const rows = await screen.findAllByTestId("word-comment-picker-row");
      const row = rows.find((r) => r.textContent?.includes("T8 root"));
      fireEvent.click(row!.querySelector("button")!);

      expect(commentChip()).toHaveAttribute("data-state", "included");
      expect(wordCommentGestureStore.getSnapshot().withoutComments).toBe(false);
      expect(announcer()).toHaveTextContent("Comment by Maya Krüger chosen.");
      expect(host.focusInput).toHaveBeenCalled();
      send();
      expect(threadIdOf(await prepared())).toBe(picked());
    });

    it("offers the open comments only while the document is off, starting suggested", async () => {
      host.facets = [facet("word_document_review", REVIEW_KEYS), THREAD_FACET];
      install({ selection: { tag: "END", offset: 0 } });
      renderInput();
      const chip = await screen.findByTestId(
        "context-chip-word.openComments",
        {},
        { timeout: 3000 },
      );
      expect(labelOf(chip)).toMatch(/^Open comments \(\d+\)$/);
      expect(chip).toHaveAttribute("data-state", "suggested");
      expect(metaOf(chip)).toBe("Not included");

      pressIn(chip, "Include open comments");
      expect(openCommentsChip()).toHaveAttribute("data-state", "included");
      expect(metaOf(openCommentsChip())).toBe("With their replies");
      send();
      const result = await prepared();
      expect(result?.actionFacet?.args?.thread_json).toBe("");
      expect(envelope(result?.actionFacet?.args?.comments_json).scope).toBe(
        "document",
      );

      pressIn(openCommentsChip(), "Don't include open comments");
      expect(openCommentsChip()).toHaveAttribute("data-state", "suggested");
      expect(metaOf(openCommentsChip())).toBeUndefined();
      expect(wordCommentGestureStore.getSnapshot()).toMatchObject({
        includeOpenComments: false,
        openCommentsDismissed: true,
      });

      pressIn(documentChip(), "Include this document");
      expect(screen.queryByTestId("context-chip-word.openComments")).toBeNull();
    });

    it("sends the open comments instead of the cursor's thread from their detail", async () => {
      install({ selection: { tag: "T1P", offset: 25 } });
      renderInput();
      act(() => wordCommentGestureStore.set({ includeOpenComments: true }));
      await findCommentChip();
      expect(openCommentsChip()).toHaveAttribute("data-state", "superseded");
      expect(metaOf(openCommentsChip())).toBe("Replaced by comment");

      pressIn(detailOf("word.openComments"), "Send this instead");
      expect(openCommentsChip()).toHaveAttribute("data-state", "included");
      expect(commentChip()).toHaveAttribute("data-state", "suggested");
      send();
      expect((await prepared())?.actionFacet?.args?.thread_json).toBe("");
    });

    it("counts the map on the document while it goes, and sends the document instead of a thread", async () => {
      host.includeDocument = true;
      host.facets = [
        facet("word_document_review", REVIEW_KEYS, "comment_map"),
        THREAD_FACET,
      ];
      host.capture.mockResolvedValue(documentBuild());
      install({ selection: { tag: "END", offset: 0 } });
      renderInput();
      await waitFor(
        () => expect(metaOf(documentChip())).toMatch(/^12 ¶ · \d+ comments$/),
        { timeout: 3000 },
      );
      expect(detailOf("word.document")).toHaveTextContent("A list of the");

      act(() => wordCommentGestureStore.set({ withoutComments: true }));
      expect(metaOf(documentChip())).toBe("12 ¶ · comments off");
      expect(detailOf("word.document")).toHaveTextContent(
        "Comments are off for this message.",
      );
      pressIn(detailOf("word.document"), "Include comments");
      expect(metaOf(documentChip())).toMatch(/^12 ¶ · \d+ comments$/);

      cleanup();
      install({ selection: { tag: "T1P", offset: 25 } });
      renderInput();
      await waitForMeta(documentChip, "Replaced by comment");
      pressIn(detailOf("word.document"), "Send this instead");
      expect(documentChip()).toHaveAttribute("data-state", "included");
      expect(commentChip()).toHaveAttribute("data-state", "suggested");
      send();
      expect((await prepared())?.actionFacet?.id).toBe("word_document_review");
    });
  });

  describe("comment reads after a send", () => {
    const REQUEST = {
      chatId: "chat-1",
      messageId: "message-1",
      toolCallId: "call-1",
    };
    let activate: ReturnType<typeof vi.spyOn>;
    /** The last Send's comment session, bound to a model request as the host binds it. */
    const reads = () => {
      const token = activate.mock.results.at(-1)?.value as string;
      expect(wordCommentReadSession.bindRequest(token, REQUEST)).toBe(true);
      return (args: unknown) => wordCommentReadSession.execute(args, REQUEST);
    };
    const gestures = () =>
      (activate.mock.calls.at(-1)?.[0] as { gestures: unknown }).gestures;
    const refusal = (result: Awaited<ReturnType<ReturnType<typeof reads>>>) =>
      result.ok ? null : result.validationErrors?.[0]?.code;

    beforeEach(() => {
      host.includeDocument = true;
      host.facets = [
        facet("word_selection", WORD_SELECTION_ARG_KEYS),
        facet("word_document_review", REVIEW_KEYS, "comment_map"),
        THREAD_FACET,
      ];
      host.capture.mockResolvedValue(null);
      activate = vi.spyOn(wordCommentReadSession, "activate");
    });
    afterEach(() => activate.mockRestore());

    it("reach only the passage's nearest threads when the passage replaces the document", async () => {
      selectT1();
      renderInput();
      expect(documentChip()).toHaveAttribute("data-state", "superseded");
      expect(metaOf(documentChip())).toBe("Replaced by selection");
      send();
      expect((await prepared())?.actionFacet?.id).toBe("word_selection");
      expect(host.capture).not.toHaveBeenCalled();
      expect(gestures()).toMatchObject({ document: false });
      const read = reads();

      expect(refusal(await read({ status: "all" }))).toBe(
        "document-not-included",
      );
      expect(refusal(await read({ cursor: "map:0" }))).toBe(
        "document-not-included",
      );
      const near = await read({
        near: { selection: true, above: 3, below: 3 },
        around: "text_before",
      });
      if (!near.ok || near.disposition === "local_only")
        throw new Error("the near read failed");
      const { threads } = near.result as WordCommentReadResultJson;
      expect(threads.map((t) => t.id)).toContain(refOf("T1"));
      expect(threads.length).toBeLessThanOrEqual(7);
      expect(threads.filter((t) => "text_before" in t)).toEqual([]);
    });

    it("reach no document-wide comment when the caret's thread replaces the document", async () => {
      install({ selection: { tag: "T1P", offset: 25 } });
      host.capture.mockResolvedValue(documentBuild());
      renderInput();
      send();
      expect((await prepared())?.actionFacet?.id).toBe("word_comment_thread");
      expect(gestures()).toMatchObject({ document: false, picked: null });
      expect(refusal(await reads()({ status: "all" }))).toBe(
        "document-not-included",
      );
    });

    it("says a comment goes instead of the document when the caret's thread does", async () => {
      install({ selection: { tag: "T1P", offset: 25 } });
      host.capture.mockResolvedValue(documentBuild());
      renderInput();
      await waitFor(() =>
        expect(metaOf(documentChip())).toBe("Replaced by comment"),
      );
      expect(documentChip()).toHaveAttribute("data-state", "superseded");
      expect(detailOf("word.document")).toHaveTextContent(
        "A comment is sent instead of the document",
      );
      expect(screen.queryByTestId("word-document-coverage-hint")).toBeNull();

      send();
      expect((await prepared())?.actionFacet?.id).toBe("word_comment_thread");
    });

    it("says a comment goes instead of the document and the passage when the setting picks it", async () => {
      host.precedence = "comment";
      selectT1();
      renderInput();
      await waitFor(() =>
        expect(metaOf(documentChip())).toBe("Replaced by comment"),
      );
      expect(selectionChip()).toHaveAttribute("data-state", "superseded");
      expect(metaOf(selectionChip())).toBe("Replaced by comment");

      send();
      expect((await prepared())?.actionFacet?.id).toBe("word_comment_thread");
    });

    it("reach the whole document when the document goes with its map", async () => {
      install({ selection: { tag: "END", offset: 0 } });
      host.capture.mockResolvedValue(documentBuild());
      renderInput();
      send();
      expect((await prepared())?.actionFacet?.id).toBe("word_document_review");
      expect(gestures()).toMatchObject({ document: true });
      const all = await reads()({ status: "all" });
      if (!all.ok || all.disposition === "local_only")
        throw new Error("the document read failed");
      expect((all.result as WordCommentReadResultJson).threads).toHaveLength(
        14,
      );
    });
  });

  describe("a document send that ends up without the document", () => {
    const neverSettles = () => new Promise<WordDocumentBuild>(() => {});
    const advance = (ms: number) =>
      act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
      });
    const threadOf = (result: Prepared) =>
      parseWordCommentThread(result?.actionFacet?.args?.thread_json)?.id;

    beforeEach(() => {
      host.includeDocument = true;
      host.facets = [facet("word_document_review", REVIEW_KEYS), THREAD_FACET];
      host.capture.mockReturnValue(neverSettles());
      install({ selection: { tag: "T1P", offset: 25 } });
    });

    it("still sends the caret's thread when the user drops the document mid-read", async () => {
      renderInput();
      send();
      const run = start();
      excludeDocument();
      const result = await finish(run);

      expect(result?.actionFacet?.id).toBe("word_comment_thread");
      expect(threadOf(result)).toBe(refOf("T1"));
    });

    it("still sends the caret's thread after Send without document", async () => {
      vi.useFakeTimers();
      renderInput();
      send();
      const run = start();
      await advance(WORD_SEND_SKIP_OFFER_MS);
      const notice = screen.getByTestId("composer-notice");
      expect(notice).toHaveAttribute("data-notice-id", "word.send.slowCapture");
      expect(notice).toHaveAttribute("data-busy", "true");
      pressIn(notice, "Send without document");
      const result = await finish(run);

      expect(threadOf(result)).toBe(refOf("T1"));
    });

    it("still sends the caret's thread when the document read runs out of time", async () => {
      vi.useFakeTimers();
      renderInput();
      send();
      const run = start();
      await advance(WORD_SEND_CAPTURE_DEADLINE_MS);
      const result = await finish(run);

      expect(threadOf(result)).toBe(refOf("T1"));
      expect(screen.getByTestId("composer-notice")).toHaveTextContent(
        "Reading the document took too long, so this message was sent without it.",
      );
    });

    it("asks which comment for a caret in two anchors", async () => {
      install({ selection: { tag: "T6P", offset: 20 } });
      renderInput();
      send();
      const run = start();
      excludeDocument();

      const notice = await findNotice();
      expect(notice).toHaveTextContent(
        "Your cursor is in more than one comment",
      );
      pressIn(notice, "Send without comments");
      expect(await finish(run)).toEqual({
        actionFacet: undefined,
        hostContextIdentity: null,
      });
    });

    it("keeps sending the pick", async () => {
      host.includeDocument = false;
      const first = renderInput();
      send();
      await prepared();
      const t1 = refOf("T1");
      first.unmount();
      // A chat keeps the setting it started with; this one starts over with the document on.
      wordContextStore.resetForTests();

      host.includeDocument = true;
      install({ selection: { tag: "END", offset: 0 } });
      renderInput();
      act(() =>
        wordCommentGestureStore.pick({
          kind: "pick",
          ref: t1,
          selectionKey: null,
        }),
      );
      send();
      const run = start();
      excludeDocument();
      const result = await finish(run);

      expect(threadOf(result)).toBe(t1);
      expect(envelope(result?.actionFacet?.args?.comments_json).why).toBe(
        "chosen",
      );
    });

    it("sends the open comments when inclusion is switched off during the budget check", async () => {
      host.facets = [
        facet("word_document_authoring", AUTHORING_KEYS),
        THREAD_FACET,
      ];
      install({ selection: { tag: "END", offset: 0 } });
      host.capture.mockResolvedValue(documentBuild(true));
      let settleBudget!: (budget: { ok: true }) => void;
      host.budget.mockReturnValue(
        new Promise((resolve) => {
          settleBudget = resolve;
        }),
      );
      renderInput();
      act(() => wordCommentGestureStore.set({ includeOpenComments: true }));
      send();
      const run = start();
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      excludeDocument();
      settleBudget({ ok: true });
      const result = await finish(run);

      expect(result?.actionFacet?.id).toBe("word_comment_thread");
      expect(result?.actionFacet?.args?.thread_json).toBe("");
      expect(envelope(result?.actionFacet?.args?.comments_json).scope).toBe(
        "document",
      );
    });
  });

  describe("an earlier capture after a timeout", () => {
    const LIVE = V3C_COMMENT_DOCUMENT.body.flatMap((block) =>
      "table" in block ? block.table.flat() : [block],
    );
    const textOf = (tag: string) =>
      tag in V3C_PARAGRAPHS
        ? v3cVisibleText(tag)
        : String(LIVE.find((p) => p.tag === tag)!.segments[0]);
    /** Taken before T1P and its thread were added: every later paragraph sits one lower. */
    const earlierBuild = (): WordDocumentBuild => {
      const tags = LIVE.map((p) => p.tag).filter((tag) => tag !== "T1P");
      const at = (tag: string) => tags.indexOf(tag) + 1;
      return {
        args: {
          document_text: tags
            .map((tag, i) => `[${i + 1}] ${textOf(tag)}`)
            .join("\n"),
          heading_outline: "",
          paragraphs_sent: String(tags.length),
          paragraphs_total: String(tags.length),
          truncation_note: "",
        },
        coverage: { hasContent: true, paragraphsSent: tags.length },
        ordinalMap: new Map(
          tags.map((tag, i) => [
            i + 1,
            { uniqueLocalId: `{0000-${tag}}`, text: textOf(tag) },
          ]),
        ),
        headings: new Map([
          [at("H1"), { level: 1, text: "Introduction" }],
          [at("H2"), { level: 1, text: "Spans and cells" }],
          [at("H3"), { level: 1, text: "Inline anchors" }],
        ]),
        renderedOrdinals: new Set(tags.map((_, i) => i + 1)),
        partialOrdinal: null,
      } as unknown as WordDocumentBuild;
    };

    it("numbers the comment map as the document it sends, as later reads do", async () => {
      host.includeDocument = true;
      host.facets = [facet("word_document_review", REVIEW_KEYS, "comment_map")];
      host.capture.mockReturnValue(new Promise(() => {}));
      host.previous = earlierBuild();
      install();
      const activate = vi.spyOn(wordCommentReadSession, "activate");
      renderInput();
      send();
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const run = start();
      act(() => {
        vi.advanceTimersByTime(WORD_SEND_CAPTURE_DEADLINE_MS);
      });
      vi.useRealTimers();
      const args = (await finish(run))!.actionFacet!.args!;

      expect(args.document_text).toContain(`[2] ${textOf("T2P")}`);
      const map = envelope(args.comment_map);
      const row = (key: string) => map.index.find((r) => r.id === refOf(key));
      expect(row("T2")).toMatchObject({ para: 2, sec: "Introduction" });
      expect(row("T1")).toBeUndefined();
      expect(map.coverage.line).toContain("1 with no known paragraph.");

      const token = activate.mock.results.at(-1)!.value as string;
      const request = { chatId: "chat-1", messageId: "m-1", toolCallId: "c-1" };
      expect(wordCommentReadSession.bindRequest(token, request)).toBe(true);
      const later = await wordCommentReadSession.execute(
        { cursor: "map:0" },
        request,
      );
      if (!later.ok || later.disposition === "local_only")
        throw new Error("the map read failed");
      const rows = (r: {
        index: { id: string; para: number; sec?: string }[];
      }) => r.index.map(({ id, para, sec }) => [id, para, sec]);
      expect(rows(later.result as WordCommentReadResultJson)).toEqual(
        rows(map),
      );
      activate.mockRestore();
    });
  });

  describe("one-message gestures across a send that never went", () => {
    beforeEach(() => {
      host.facets = [
        facet("word_selection", WORD_SELECTION_ARG_KEYS),
        THREAD_FACET,
      ];
    });
    const anchoredThreads = (result: Prepared) => {
      const json = result?.actionFacet?.args?.anchored_comments;
      return json ? envelope(json).threads.length : 0;
    };
    const stopped = () => {
      const stop = new AbortController();
      stop.abort();
      return stop.signal;
    };
    const abandon = () => act(() => lastSend()[11]?.onAbandoned?.());

    it("keep Send without comments for the retry after a stop", async () => {
      selectT1();
      renderInput();
      act(() => wordCommentGestureStore.set({ withoutComments: true }));
      send();
      expect(await finish(start(stopped()))).toBeNull();
      abandon();
      await waitForMeta(selectionChip, "Selected · 1 ¶ · comments off");

      send();
      const retry = await prepared();
      expect(retry?.actionFacet?.id).toBe("word_selection");
      expect(anchoredThreads(retry)).toBe(0);

      send();
      expect(anchoredThreads(await prepared())).toBe(1);
    });

    it("keep Send without comments after the selection could not be read", async () => {
      selectT1();
      host.captureSelection.mockResolvedValueOnce({ status: "failed" });
      renderInput();
      act(() => wordCommentGestureStore.set({ withoutComments: true }));
      send();
      expect(await prepared()).toBeNull();
      abandon();

      send();
      expect(anchoredThreads(await prepared())).toBe(0);
    });

    it("keep the chip's switch to the comment for the retry", async () => {
      selectT1();
      renderInput();
      act(() => wordCommentGestureStore.set({ override: "comment" }));
      send();
      expect(await finish(start(stopped()))).toBeNull();
      abandon();

      send();
      expect((await prepared())?.actionFacet?.id).toBe("word_comment_thread");
    });
  });

  describe("the setting judged at Send as the chip judges it", () => {
    beforeEach(() => {
      host.precedence = "comment";
      host.facets = [
        facet("word_selection", WORD_SELECTION_ARG_KEYS),
        THREAD_FACET,
      ];
    });
    it("sends the thread the chip showed when Send finds a hazard in the passage", async () => {
      selectT1({
        captured: { role: "context_only", reasonCode: "hyperlink" },
      });
      renderInput();
      const chip = await findCommentChip();
      expect(metaOf(chip)).toBe("Your default");
      expect(
        within(detailOf("word.comment")).getByRole("button", {
          name: "Use selected passage instead",
        }),
      ).toBeInTheDocument();
      expect(selectionChip()).toHaveAttribute("data-state", "superseded");
      send();
      const result = await prepared();

      expect(result?.actionFacet?.id).toBe("word_comment_thread");
      expect(
        parseWordCommentThread(result?.actionFacet?.args?.thread_json)?.id,
      ).toBe(refOf("T1"));
      expect(envelope(result?.actionFacet?.args?.comments_json).why).toBe(
        "default",
      );
    });

    it("sends the passage the chip showed for a shape Replace cannot write", async () => {
      selectT1({
        shape: "table",
        captured: { role: "context_only", reasonCode: "multi_cell" },
      });
      renderInput();
      await waitForMeta(selectionChip, "Selected · 1 ¶ · 1 comment");
      expect(screen.queryByTestId("context-chip-word.comment")).toBeNull();
      expect(
        screen.queryByRole("button", { name: "Use selected passage instead" }),
      ).toBeNull();
      send();
      const result = await prepared();

      expect(result?.actionFacet?.id).toBe("word_selection");
      expect(anchoredThreads(result)).toBe(1);
    });

    const anchoredThreads = (result: Prepared) => {
      const json = result?.actionFacet?.args?.anchored_comments;
      return json ? envelope(json).threads.length : 0;
    };
  });

  describe("a thread whose replies were not read", () => {
    beforeEach(() => {
      host.facets = [THREAD_FACET];
    });

    it("goes flagged when the user picks it after the pick was gone", async () => {
      install({ selection: { tag: "END", offset: 0 } });
      renderInput();
      act(() => wordCommentGestureStore.set({ includeOpenComments: true }));
      send();
      await prepared();
      const t1 = refOf("T1");
      act(() => wordCommentGestureStore.set({ includeOpenComments: false }));

      act(() =>
        wordCommentGestureStore.pick({
          kind: "pick",
          ref: "tzz",
          selectionKey: null,
        }),
      );
      send();
      const run = start();
      pressIn(await findNotice(), "Choose comment…");
      const rows = await screen.findAllByTestId("word-comment-picker-row");
      const row = rows.find((r) => r.getAttribute("data-ref") === t1);
      fireEvent.click(row!.querySelector("button")!);
      const result = await finish(run);

      const thread = parseWordCommentThread(
        result?.actionFacet?.args?.thread_json,
      );
      expect(thread?.id).toBe(t1);
      expect(thread?.entries).toHaveLength(1);
      expect(thread?.replies_unread).toBe(true);
      const sent = envelope(result?.actionFacet?.args?.comments_json);
      expect(sent.coverage.complete).toBe(false);
      expect(sent.coverage.line).toContain(
        "Replies not read for 1 thread sent with their text",
      );
    });
  });

  it("sends the caret's thread without waiting for the budget call", async () => {
    host.includeDocument = true;
    host.facets = [
      facet("word_document_authoring", AUTHORING_KEYS, "comment_map"),
      THREAD_FACET,
    ];
    install({ selection: { tag: "T1P", offset: 25 } });
    host.capture.mockResolvedValue(documentBuild(true));
    let budgetSignal: AbortSignal | undefined;
    host.budget.mockImplementation(
      (_snapshot: unknown, options: { signal?: AbortSignal }) => {
        budgetSignal = options.signal;
        return new Promise(() => {});
      },
    );
    renderInput();
    send();
    const result = await prepared();

    expect(result?.actionFacet?.id).toBe("word_comment_thread");
    expect(
      parseWordCommentThread(result?.actionFacet?.args?.thread_json)?.where.vs,
    ).toBe("at_caret");
    expect(budgetSignal?.aborted).toBe(true);
  });
});
