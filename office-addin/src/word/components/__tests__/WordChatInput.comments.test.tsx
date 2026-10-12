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
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  installWordCommentHost,
  uninstallWordCommentHost,
} from "../../../test/mocks/word/commentHost";
import { wordCommentGestureStore } from "../../hooks/wordCommentGestureStore";
import { wordSelectionStore } from "../../hooks/wordSelectionStore";
import { resolveWordSelectionFacet } from "../../utils/wordActionFacet";
import { wordCommentReadSession } from "../../utils/wordCommentReadTool";
import { forgetWordCommentRefs } from "../../utils/wordCommentRefs";
import { wordCommentRefsOf } from "../../utils/wordCommentSend";
import { resolveWordDocumentName } from "../../utils/wordDocumentIdentity";
import { WORD_SELECTION_ARG_KEYS } from "../../utils/wordSelectionArgs";
import { WordChatInput } from "../WordChatInput";

import type { AddinChatInputRenderProps } from "../../../core/AddinChatCore";
import type {
  CommentHost,
  CommentHostOptions,
} from "../../../test/mocks/word/commentHost";
import type { WordDocumentBuild } from "../../utils/buildWordDocumentArgs";
import type { WordCommentsCapture } from "../../utils/wordCommentSend";
import type { WordSelectionSnapshot } from "../../utils/wordSelectionAnchor";
import type { WordCommentEnvelope } from "@erato/frontend/word-review";
import type { ReactNode } from "react";

const host = vi.hoisted(() => ({
  facets: [] as { id: string; allowed_args?: string[] }[],
  includeDocument: false,
  precedence: "selection",
  capture: vi.fn(),
  captureSelection: vi.fn(),
  budget: vi.fn(),
}));

vi.mock("@erato/frontend/library", async () => {
  const mock = await import("../../../test/helpers/eratoLibraryMock");
  return mock.createEratoLibraryMock({
    useFacets: () => ({ data: { action_facets: host.facets } }),
    Alert: ({ children }: { children: ReactNode }) => (
      <div role="alert">{children}</div>
    ),
  });
});

vi.mock("../../../core/AddinChatInputCore", () => ({
  AddinChatInputCore: ({
    onSendMessage,
  }: {
    onSendMessage: (message: string) => void;
  }) => (
    <button
      type="button"
      data-testid="send"
      onClick={() => onSendMessage("What does the comment say?")}
    >
      send
    </button>
  ),
}));

vi.mock("../../hooks/useWordDocumentSource", () => ({
  useWordDocumentSource: () => ({
    preview: {
      status: "included",
      coverage: null,
      changedSinceLastSend: false,
      reading: false,
    },
    capture: host.capture,
    captureExpectedSlow: () => false,
    previousCapture: () => null,
    markSent: () => {},
  }),
}));

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

  const passageOverT1 = (): WordSelectionSnapshot => ({
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
  });
  const selectT1 = () => {
    install({
      selection: {
        tag: "T1P",
        offset: 22,
        to: { tag: "T1P", offset: 33 },
      },
    });
    host.captureSelection.mockResolvedValue({
      status: "ok",
      value: passageOverT1(),
    });
    wordSelectionStore.publish({
      preview: {
        key: "T1P:alpha bravo",
        text: "alpha bravo",
        paragraphCount: 1,
        shape: "inline",
        story: "main",
        truncated: false,
        mayRewrite: true,
      },
      origin: "user",
      armed: true,
      pending: false,
    });
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
    handedOver = [];
    staged = [];
  });

  afterEach(() => {
    cleanup();
    uninstallWordCommentHost();
    wordSelectionStore.resetForTests();
    wordCommentGestureStore.resetForTests();
    forgetWordCommentRefs();
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

      const block = await screen.findByTestId("word-comment-block");
      expect(block).toHaveTextContent(
        "Erato could not read the comments in Word.",
      );
      fireEvent.click(
        screen.getByRole("button", { name: "Send without comments" }),
      );
      const result = await finish(run);

      expect(result?.actionFacet?.id).toBe("word_selection");
      expect(result?.actionFacet?.args?.anchored_comments).toBe("");
      expect(staged.at(-1)).not.toHaveProperty("commentRefs");
      expect(screen.queryByTestId("word-comment-block")).toBeNull();
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

      expect(await screen.findByTestId("word-comment-block")).toHaveTextContent(
        "Your cursor is in more than one comment",
      );
      fireEvent.click(
        screen.getByRole("button", { name: "Send without comments" }),
      );
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
      await screen.findByTestId("word-comment-block");

      act(() => stop.abort());
      expect(await finish(run)).toBeNull();
      expect(screen.queryByTestId("word-comment-block")).toBeNull();
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
      expect(await screen.findByTestId("word-comment-block")).toHaveTextContent(
        "The comment you chose is no longer in the document.",
      );
      fireEvent.click(
        screen.getByRole("button", { name: "Send without comments" }),
      );
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
      expect(await screen.findByTestId("word-comment-block")).toHaveTextContent(
        "The comment you chose is no longer in the document.",
      );
      fireEvent.click(
        screen.getByRole("button", { name: "Send without comments" }),
      );
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
});
