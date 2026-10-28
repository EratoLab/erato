/*
 * The Word comment stories as data, in the add-in's own terms: where Word's
 * selection is, what the user said about comments, and which one-off send
 * prompt is up. No imports, so the add-in's parity test
 * (office-addin/src/word/utils/__tests__/wordCommentStoryParity.test.ts) can
 * run its real resolvers on the same seeds and write what each story draws
 * to composerContextWordComments.generated.json.
 */

export interface WordCommentStoryThread {
  ref: string;
  commentId: string;
  author: string;
  status: "open" | "resolved";
  quote: string;
  text: string;
  replies: number | null;
  /** Year, month (1-12), day, hour, minute in local time, so the formatted date is the same in every time zone. */
  lastActivity: [number, number, number, number, number] | null;
  para: number;
}

export const WORD_COMMENT_STORY_DOCUMENT = "Supply agreement.docx";

export const WORD_COMMENT_STORY_THREADS: WordCommentStoryThread[] = [
  {
    ref: "t1",
    commentId: "1001",
    author: "Maya Krüger",
    status: "open",
    quote: "delivery dates set out in Schedule 2",
    text: "Can we commit to these delivery dates, or do we need a buffer week?",
    replies: 2,
    lastActivity: [2026, 10, 9, 9, 14],
    para: 9,
  },
  {
    ref: "t2",
    commentId: "1002",
    author: "Jonas Weber",
    status: "open",
    quote: "within 30 days of the invoice date",
    text: "Finance asked for 45 days instead of 30.",
    replies: 1,
    lastActivity: [2026, 10, 8, 16, 2],
    para: 14,
  },
  {
    ref: "t3",
    commentId: "1003",
    author: "Lena Fischer",
    status: "open",
    quote: "aggregate liability shall not exceed",
    text: "Is the cap per incident or per contract year?",
    replies: 0,
    lastActivity: [2026, 10, 7, 11, 30],
    para: 15,
  },
  {
    ref: "t4",
    commentId: "1004",
    author: "Tom Becker",
    status: "open",
    quote: "three (3) months' written notice",
    text: "Three months seems short for a supplier of this size.",
    replies: 3,
    lastActivity: [2026, 10, 6, 14, 45],
    para: 9,
  },
  {
    ref: "t5",
    commentId: "1005",
    author: "Sara Nowak",
    status: "open",
    quote: "adjusted once per calendar year",
    text: "Link the adjustment to the published index, not to the supplier's costs.",
    replies: 0,
    lastActivity: [2026, 10, 6, 10, 5],
    para: 31,
  },
  {
    ref: "t6",
    commentId: "1006",
    author: "Paul Martin",
    status: "open",
    quote: "Service Levels in Annex B",
    text: "Add response times for priority 1 incidents.",
    replies: 1,
    lastActivity: [2026, 10, 5, 15, 20],
    para: 9,
  },
  {
    ref: "t7",
    commentId: "1007",
    author: "Maya Krüger",
    status: "resolved",
    quote: "governed by the laws of",
    text: "Legal prefers German law here.",
    replies: 0,
    lastActivity: [2026, 10, 3, 9, 40],
    para: 52,
  },
  {
    ref: "t8",
    commentId: "1008",
    author: "Jonas Weber",
    status: "open",
    quote: "Confidential Information",
    text: "Does this cover the price list as well?",
    replies: 0,
    lastActivity: [2026, 10, 2, 13, 12],
    para: 58,
  },
  {
    ref: "t9",
    commentId: "1009",
    author: "Tom Becker",
    status: "open",
    quote: "warranty period of twelve (12) months",
    text: "Can we get 24 months for the hardware?",
    replies: 1,
    lastActivity: [2026, 10, 2, 11, 0],
    para: 63,
  },
  {
    ref: "t10",
    commentId: "1010",
    author: "Lena Fischer",
    status: "resolved",
    quote: "force majeure event",
    text: "Pandemics should be listed explicitly.",
    replies: 0,
    lastActivity: [2026, 9, 30, 16, 30],
    para: 70,
  },
  {
    ref: "t11",
    commentId: "1011",
    author: "Sara Nowak",
    status: "open",
    quote: "audit the Supplier's records",
    text: "Once a year with 30 days' notice?",
    // Replies are read only for the selection's threads and the pick.
    replies: null,
    lastActivity: null,
    para: 77,
  },
  {
    ref: "t12",
    commentId: "1012",
    author: "Paul Martin",
    status: "resolved",
    quote: "liquidated damages",
    text: "Cap the penalties at 10% of the order value.",
    replies: 0,
    lastActivity: [2026, 9, 28, 14, 0],
    para: 81,
  },
];

/** A ref the list no longer has: the comment was deleted after it was chosen. */
export const WORD_COMMENT_STORY_GONE_REF = "t13";

export type WordCommentStorySelection =
  /** The caret, inside the anchors of these threads. */
  | { kind: "caret"; threads: string[] }
  | {
      kind: "passage";
      text: string;
      paragraphs: number;
      /** The threads whose anchors reach the passage. */
      threads: string[];
      /** Erato may replace the passage, so the "Word behavior" setting applies. */
      rewritable?: boolean;
      /** The last Send could not read this very passage. */
      readFailed?: boolean;
    };

export interface WordCommentStorySeed {
  selection?: WordCommentStorySelection | null;
  pick?: string | null;
  override?: "comment" | "passage" | null;
  withoutComments?: boolean;
  includeOpenComments?: boolean;
  openCommentsDismissed?: boolean;
  documentOff?: boolean;
  precedence?: "selection" | "comment";
  /** Which comment arguments the chat's facets take. */
  advertised?: "all" | "no-thread";
  locked?: boolean;
  /** A Send that waits on the user. */
  waiting?: "choose-comment" | "picked-gone" | "read-failed" | null;
  slowCapture?: boolean;
  commentProgress?: { done: number; total: number } | null;
  selectionReadFailed?: boolean;
  captureNotice?: "previous-capture" | "not-included" | null;
  budgetIssue?: "model-budget" | null;
  /** Five staged files and a recording being transcribed. */
  busyFiles?: boolean;
  /** Threads the picker stand-in lists; defaults to the selection's and Sara Nowak's. */
  pickable?: string[];
  /** Gesture sequences followed from the start past the explored depth. */
  flows?: string[][];
  /** Simulate buttons that move Word's selection or start a slow send. */
  interactive?: boolean;
}

const CARET_ONE: WordCommentStorySelection = { kind: "caret", threads: ["t1"] };
const CARET_THREE: WordCommentStorySelection = {
  kind: "caret",
  threads: ["t1", "t4", "t6"],
};
const PASSAGE_ONE: WordCommentStorySelection = {
  kind: "passage",
  text: "Payment is due within 30 days of the invoice date. Late payments bear interest at the statutory rate.",
  paragraphs: 1,
  threads: ["t2"],
};
const PASSAGE_TWO: WordCommentStorySelection = {
  kind: "passage",
  text: "Payment is due within 30 days of the invoice date.\nThe Supplier's aggregate liability shall not exceed the total order value.",
  paragraphs: 2,
  threads: ["t2", "t3"],
};
const PASSAGE_PLAIN: WordCommentStorySelection = {
  kind: "passage",
  text: "The Supplier shall deliver the Goods no later than the delivery date stated in the Order.\nAny delay must be notified to the Buyer in writing without undue delay.",
  paragraphs: 2,
  threads: [],
};

/**
 * One seed per story, in the order the stories file exports them. Gestures:
 * `x:<chip>` and `+:<chip>` (word-selection, word-document, word-comment,
 * word-open-comments), `action:<chip>:<action>`, `pick:<ref>` (a choice in
 * the detail), `picker:<ref>`, `show:<ref>` (Show in Word),
 * `passage-comments:on|off`, `notice:<action>`, `notice:dismiss` and `send`.
 */
export const WORD_COMMENT_STORIES = {
  CursorComment: {
    selection: CARET_ONE,
    flows: [
      ["x:word-comment", "+:word-comment", "send"],
      ["action:word-document:send-instead", "+:word-comment"],
    ],
  },
  CursorCommentOff: { selection: CARET_ONE, withoutComments: true },
  PickedComment: {
    pick: "t5",
    flows: [["x:word-comment", "picker:t5"]],
  },
  PickedWithPassage: { selection: PASSAGE_PLAIN, pick: "t5" },
  PickedGone: { pick: "t13" },
  CursorInThreeComments: {
    selection: CARET_THREE,
    flows: [
      ["pick:t6", "x:word-comment", "pick:t4"],
      ["send", "x:word-comment"],
      ["send", "picker:t4"],
      ["send", "notice:send-without-comments"],
    ],
  },
  CursorInThreeOff: { selection: CARET_THREE, withoutComments: true },
  PassageWithComment: {
    selection: PASSAGE_ONE,
    flows: [["passage-comments:off", "passage-comments:on"]],
  },
  PassageCommentsOff: { selection: PASSAGE_ONE, withoutComments: true },
  PassageTwoComments: { selection: PASSAGE_TWO },
  PassageDefaultComment: {
    selection: { ...PASSAGE_ONE, rewritable: true },
    precedence: "comment",
  },
  DocumentWithMap: {},
  DocumentMapOff: { withoutComments: true },
  OpenCommentsNew: {
    documentOff: true,
    flows: [
      ["+:word-open-comments", "x:word-open-comments", "+:word-document"],
    ],
  },
  OpenCommentsIncluded: { documentOff: true, includeOpenComments: true },
  OpenCommentsOff: { documentOff: true, openCommentsDismissed: true },
  OpenCommentsOffForMessage: {
    documentOff: true,
    includeOpenComments: true,
    withoutComments: true,
  },
  OpenCommentsReplaced: {
    documentOff: true,
    includeOpenComments: true,
    selection: CARET_ONE,
  },
  OpenCommentsCursorInThree: {
    documentOff: true,
    selection: CARET_THREE,
    flows: [["pick:t6", "x:word-comment"]],
  },
  OpenCommentsLocked: {
    documentOff: true,
    includeOpenComments: true,
    locked: true,
  },
  NoThreadFacet: { selection: CARET_THREE, advertised: "no-thread" },
  NoticeChooseComment: { selection: CARET_THREE, waiting: "choose-comment" },
  NoticePickedGone: { pick: "t13", waiting: "picked-gone" },
  NoticeCommentsReadFailed: {
    pick: "t5",
    waiting: "read-failed",
    flows: [["x:word-comment"]],
  },
  NoticeSlowCapture: { slowCapture: true },
  NoticeCommentProgress: { commentProgress: { done: 3, total: 12 } },
  NoticeSelectionReadFailed: {
    selection: { ...PASSAGE_PLAIN, readFailed: true },
    selectionReadFailed: true,
  },
  NoticePreviousCapture: { captureNotice: "previous-capture" },
  NoticeNotIncluded: { captureNotice: "not-included" },
  NoticeBudget: { budgetIssue: "model-budget" },
  Busy: {
    selection: { ...PASSAGE_ONE, rewritable: true },
    precedence: "comment",
    busyFiles: true,
  },
  Interactive: { selection: CARET_ONE, interactive: true },
} satisfies Record<string, WordCommentStorySeed>;

export type WordCommentStoryName = keyof typeof WORD_COMMENT_STORIES;

/**
 * What Interactive's Simulate buttons jump to: Word's side changes, so the
 * story starts over from that seed.
 */
export const WORD_COMMENT_STORY_SIMULATIONS: {
  label: string;
  story: WordCommentStoryName;
}[] = [
  { label: "Cursor into one comment", story: "CursorComment" },
  { label: "Cursor into three comments", story: "CursorInThreeComments" },
  { label: "Cursor out of comments", story: "DocumentWithMap" },
  { label: "Select a passage with a comment", story: "PassageWithComment" },
  { label: "Turn the document off", story: "OpenCommentsNew" },
  { label: "Send while Word is slow", story: "NoticeSlowCapture" },
  { label: "Reading comments", story: "NoticeCommentProgress" },
  { label: "Selection read fails", story: "NoticeSelectionReadFailed" },
];

/** The default picker list: the selection's threads and one elsewhere in the document. */
export function wordCommentStoryPickable(seed: WordCommentStorySeed): string[] {
  if (seed.pickable) return seed.pickable;
  const own = seed.selection?.threads ?? [];
  return [...new Set([...own, "t5"])];
}

export const wordCommentStoryId = (name: string) =>
  `chat-composercontextwordcomments--${name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
    .toLowerCase()}`;
