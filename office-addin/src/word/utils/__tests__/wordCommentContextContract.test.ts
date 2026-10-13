import { wordCommentReadRows } from "@erato/frontend/word-review";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  parseWordCommentContext,
  parseWordCommentEnvelope,
  parseWordCommentThread,
  WORD_ANCHORED_COMMENTS_ARG,
  WORD_COMMENT_MAP_ARG,
  WORD_COMMENT_THREAD_FACET_ID,
  WORD_COMMENTS_JSON_ARG,
  WORD_READ_COMMENTS_TOOL,
  WORD_THREAD_JSON_ARG,
} from "../../../../../frontend/src/lib/wordReview/wordCommentContext";
import {
  generatedCommentDocument,
  installWordCommentHost,
  uninstallWordCommentHost,
} from "../../../test/mocks/word/commentHost";
import { WordCommentReadSession } from "../wordCommentReadTool";
import { readWordComments } from "../wordCommentReader";
import {
  createWordCommentRefRegistry,
  forgetWordCommentRefs,
} from "../wordCommentRefs";
import {
  wordAnchoredCommentsArg,
  wordCommentMapArg,
  wordCommentSendExact,
  wordCommentSendRead,
  wordCommentThreadArgs,
} from "../wordCommentSend";

import type {
  CommentHost,
  CommentHostOptions,
  CommentHostSelection,
} from "../../../test/mocks/word/commentHost";
import type { WordCommentReadResultJson } from "../wordCommentReadTool";
import type { WordCommentSendRead } from "../wordCommentSend";
import type { ContentPart } from "@erato/frontend/library";

const NOW = new Date("2026-10-12T09:30:00Z");
const REQUEST = { chatId: "chat-A", messageId: "message-A", toolCallId: "c" };

let host: CommentHost;

beforeEach(() => forgetWordCommentRefs());
afterEach(() => uninstallWordCommentHost());

async function sendRead(
  options: CommentHostOptions & { selection: CommentHostSelection },
  passage: (h: CommentHost) => {
    first: number;
    last: number;
    start: number;
    end: number;
  } | null = () => null,
): Promise<WordCommentSendRead> {
  host = installWordCommentHost(options);
  const at = passage(host);
  const result = await readWordComments({
    selection: true,
    replies: "requested",
    exact: (threads, live) =>
      wordCommentSendExact(threads, { passage: at, live, pickedId: null }),
    now: host.now,
  });
  if (!result.ok) throw new Error(result.error);
  return wordCommentSendRead({
    result,
    registry: createWordCommentRefRegistry("doc"),
    passage: at,
    people: { principalEmail: "maya.kruger@contoso.test" },
    now: NOW,
    userTz: "Europe/Berlin",
  });
}

const overT1 = (h: CommentHost) => ({
  first: h.ordinalOf("T1P"),
  last: h.ordinalOf("T1P"),
  start: 22,
  end: 33,
});

/** The web app's parser keeps every field the add-in writes. */
const roundTrips = (json: string) =>
  expect(parseWordCommentEnvelope(json)).toEqual(JSON.parse(json));

describe("Word comment context read in the Erato web app", () => {
  it("reads anchored_comments as the add-in writes it", async () => {
    const read = await sendRead(
      { selection: { tag: "T1P", offset: 22 } },
      overT1,
    );
    const arg = wordAnchoredCommentsArg(read, read.atSelection);
    roundTrips(arg);

    const context = parseWordCommentContext({
      selected_text: "alpha bravo",
      [WORD_ANCHORED_COMMENTS_ARG]: arg,
    });
    expect(context?.carrier).toBe(WORD_ANCHORED_COMMENTS_ARG);
    expect(context?.threads).toHaveLength(1);
  });

  it("reads a thread facet's thread and envelope, with why it went", async () => {
    const read = await sendRead({ selection: { tag: "T1P", offset: 25 } });
    const [ref] = read.atSelection;
    const { threadJson, commentsJson } = wordCommentThreadArgs(
      read,
      ref,
      "cursor",
    );
    roundTrips(commentsJson);
    expect(parseWordCommentThread(threadJson)).toEqual(JSON.parse(threadJson));

    const context = parseWordCommentContext({
      [WORD_THREAD_JSON_ARG]: threadJson,
      [WORD_COMMENTS_JSON_ARG]: commentsJson,
    });
    expect(context?.carrier).toBe(WORD_COMMENT_THREAD_FACET_ID);
    expect(context?.picked?.id).toBe(ref);
    expect(context?.envelope?.why).toBe("cursor");
  });

  it("reads the open comments an empty thread_json carries", async () => {
    const read = await sendRead({ selection: { tag: "END", offset: 0 } });
    const { threadJson, commentsJson } = wordCommentThreadArgs(read, null);
    roundTrips(commentsJson);

    const context = parseWordCommentContext({
      [WORD_THREAD_JSON_ARG]: threadJson,
      [WORD_COMMENTS_JSON_ARG]: commentsJson,
    });
    expect(context?.picked).toBeNull();
    expect(context?.envelope?.scope).toBe("document");
  });

  it("reads the comment map, and the not-shown count of a capped one", async () => {
    const headings = [{ ordinal: 1, level: 1, text: "Introduction" }];
    const read = await sendRead({ selection: { tag: "END", offset: 0 } });
    const arg = wordCommentMapArg(read, headings);
    roundTrips(arg);
    expect(
      parseWordCommentContext({ [WORD_COMMENT_MAP_ARG]: arg })?.envelope?.index,
    ).toHaveLength(14);

    const large = await sendRead({
      document: generatedCommentDocument({ paragraphs: 120 }),
      selection: { tag: "G1", offset: 0 },
    });
    const capped = wordCommentMapArg(large, []);
    roundTrips(capped);
    const context = parseWordCommentContext({ [WORD_COMMENT_MAP_ARG]: capped });
    expect(context?.envelope?.index).toHaveLength(100);
    expect(context?.notShown).toBe(20);
  });
});

describe("word_read_comments results read in the Erato web app", () => {
  let session: WordCommentReadSession;

  beforeEach(() => {
    session = new WordCommentReadSession({
      now: () => NOW,
      userTimeZone: () => "Europe/Berlin",
      readOptions: { now: () => host.now() },
    });
  });

  async function read(args: Record<string, unknown>) {
    const response = await session.execute(args, REQUEST);
    if (!response.ok) throw new Error(response.error);
    if (response.disposition === "local_only") throw new Error("local only");
    return response.result as WordCommentReadResultJson;
  }
  const rowsOf = (input: Record<string, unknown>, result: unknown) =>
    wordCommentReadRows([
      {
        content_type: "tool_use",
        tool_call_id: "call-1",
        tool_name: WORD_READ_COMMENTS_TOOL,
        status: "success",
        input,
        output: { status: "success", result },
      } as unknown as ContentPart,
    ]);

  it("parses a read as the shared envelope and shows it as one row", async () => {
    host = installWordCommentHost();
    session.activate(
      {
        identity: "doc",
        gestures: { document: false },
        selection: { first: 13, last: 13, start: 0, end: 5 },
      },
      { chatId: REQUEST.chatId, messageId: REQUEST.messageId },
    );
    const args = { near: { selection: true } };
    const result = await read(args);
    const {
      view: _view,
      cursor: _cursor,
      complete: _complete,
      capped: _capped,
      remaining: _remaining,
      coverage_line: _line,
      digest: _digest,
      contentNotice: _notice,
      ...envelope
    } = result;
    expect(parseWordCommentEnvelope(result)).toEqual(envelope);
    expect(rowsOf(args, result)).toEqual([
      {
        toolCallId: "call-1",
        state: "read",
        view: "near",
        status: "open",
        count: result.threads.length,
        notShown: 0,
      },
    ]);
  });

  it("counts a paged read's remaining threads and the map's rows", async () => {
    host = installWordCommentHost({
      document: generatedCommentDocument({
        paragraphs: 40,
        content: (i) => `Comment ${i}: ${"lorem ipsum ".repeat(75)}`,
      }),
    });
    session.activate(
      { identity: "doc", gestures: { document: true } },
      { chatId: REQUEST.chatId, messageId: REQUEST.messageId },
    );
    const first = await read({ status: "open" });
    expect(first.remaining).toBeGreaterThan(0);
    expect(rowsOf({ status: "open" }, first)).toMatchObject([
      {
        view: "document",
        status: "open",
        count: first.threads.length,
        notShown: first.remaining,
      },
    ]);
    expect(first.threads.length + first.remaining).toBe(32);

    const map = await read({ cursor: "map:0" });
    expect(rowsOf({ cursor: "map:0" }, map)).toMatchObject([
      { view: "map", count: 40, notShown: 0 },
    ]);
  });
});
