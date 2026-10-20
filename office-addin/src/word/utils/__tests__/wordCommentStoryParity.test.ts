import { createHash } from "node:crypto";

import { WORD_COMMENT_THREAD_FACET_ID } from "@erato/frontend/word-review";
import { i18n } from "@lingui/core";
import { cleanup, renderHook } from "@testing-library/react";
import { format } from "prettier";
import { afterEach, beforeAll, expect, it } from "vitest";

import {
  WORD_COMMENT_STORIES,
  WORD_COMMENT_STORY_DOCUMENT,
  WORD_COMMENT_STORY_THREADS,
  wordCommentStoryId,
  wordCommentStoryPickable,
} from "../../../../../frontend/src/stories/chat/composerContextWordCommentScenarios";
import { NO_WORD_COMMENT_LIST } from "../../hooks/useWordComments";
import { useWordContextItems } from "../../hooks/useWordContextItems";
import {
  WORD_DOCUMENT_REVIEW_FACET_ID,
  WORD_SELECTION_FACET_ID,
} from "../wordActionFacet";
import {
  wordCommentChip,
  wordCommentMapFacet,
  wordDocumentComments,
  wordOpenCommentsChip,
  wordPassageComments,
} from "../wordCommentChips";
import { wordCommentsAdvertised } from "../wordCommentSend";
import {
  wordCommentActivityText,
  wordCommentByText,
  wordCommentChooseText,
  wordCommentQuoteText,
  wordCommentRepliesText,
  wordCommentStatusText,
  wordCommentWhyText,
} from "../wordCommentText";
import { wordComposerNotice } from "../wordComposerNotice";
import { wordDocumentChip, wordSelectionChip } from "../wordContextChips";
import { previewWordSend } from "../wordSendPreview";

import type {
  WordCommentStorySeed,
  WordCommentStorySelection,
  WordCommentStoryThread,
} from "../../../../../frontend/src/stories/chat/composerContextWordCommentScenarios";
import type {
  WordCommentList,
  WordCommentListThread,
} from "../../hooks/useWordComments";
import type { WordContextHandlers } from "../../hooks/useWordContextItems";
import type {
  WordCommentChipModel,
  WordCommentChipsInput,
  WordCommentCoverageSection,
  WordOpenCommentsChipModel,
  WordPassageCommentsModel,
} from "../wordCommentChips";
import type {
  WordCommentAdvertised,
  WordCommentBlock,
  WordCommentWhy,
} from "../wordCommentSend";
import type { WordComposerNoticeHandlers } from "../wordComposerNotice";
import type {
  WordContextNote,
  WordDocumentChipModel,
  WordSelectionChipModel,
} from "../wordContextChips";
import type { WordSendPreview } from "../wordSendPreview";
import type {
  ComposerContextItem,
  ComposerNotice,
} from "@erato/frontend/library";

// The Storybook stories play the Word composer's comment chips and send prompts from this file:
// the add-in's own resolvers run on every story's seed, and on what each gesture leads to, and
// the stories draw what they wrote. The test fails when the add-in no longer gives that file, so
// the stories cannot drift from it unnoticed. After a deliberate change, update the file with
// `pnpm exec vitest run src/word/utils/__tests__/wordCommentStoryParity.test.ts -u`.
const GENERATED =
  "../../../../../frontend/src/stories/chat/composerContextWordComments.generated.json";

/** Every gesture from a story's start, and every gesture after those. */
const EXPLORED_DEPTH = 2;

type Seed = WordCommentStorySeed;

/** What the Word composer holds between renders, as WordChatInput keeps it. */
interface Scene {
  selection: (WordCommentStorySelection & { dismissed: boolean }) | null;
  pick: string | null;
  override: "comment" | "passage" | null;
  withoutComments: boolean;
  includeOpenComments: boolean;
  openCommentsDismissed: boolean;
  documentIncluded: boolean;
  precedence: "selection" | "comment";
  advertised: "all" | "no-thread";
  locked: boolean;
  waiting: WordCommentBlock | null;
  slowCapture: boolean;
  commentProgress: { done: number; total: number } | null;
  selectionReadFailed: boolean;
  captureNotice: "previous-capture" | "not-included" | null;
  budgetIssue: "model-budget" | null;
  dismissedNotices: string[];
}

const sceneOf = (seed: Seed): Scene => ({
  selection: seed.selection ? { ...seed.selection, dismissed: false } : null,
  pick: seed.pick ?? null,
  override: seed.override ?? null,
  withoutComments: seed.withoutComments ?? false,
  includeOpenComments: seed.includeOpenComments ?? false,
  openCommentsDismissed: seed.openCommentsDismissed ?? false,
  documentIncluded: !seed.documentOff,
  precedence: seed.precedence ?? "selection",
  advertised: seed.advertised ?? "all",
  locked: seed.locked ?? false,
  waiting: seed.waiting ?? null,
  slowCapture: seed.slowCapture ?? false,
  commentProgress: seed.commentProgress ?? null,
  selectionReadFailed: seed.selectionReadFailed ?? false,
  captureNotice: seed.captureNotice ?? null,
  budgetIssue: seed.budgetIssue ?? null,
  dismissedNotices: [],
});

const listThread = (
  thread: WordCommentStoryThread,
  pos: number,
): WordCommentListThread => ({
  ref: thread.ref,
  commentId: thread.commentId,
  author: thread.author,
  status: thread.status,
  quote: thread.quote,
  text: thread.text,
  replies: thread.replies,
  lastActivity: thread.lastActivity
    ? new Date(
        thread.lastActivity[0],
        thread.lastActivity[1] - 1,
        thread.lastActivity[2],
        thread.lastActivity[3],
        thread.lastActivity[4],
      )
    : null,
  pos,
  para: thread.para,
  inSelection: false,
});
const THREADS = WORD_COMMENT_STORY_THREADS.map((thread, index) =>
  listThread(thread, index + 1),
);

const FACETS = new Set([
  WORD_DOCUMENT_REVIEW_FACET_ID,
  WORD_SELECTION_FACET_ID,
  WORD_COMMENT_THREAD_FACET_ID,
]);
const advertisedOf = (scene: Scene): WordCommentAdvertised => ({
  anchored: true,
  thread: scene.advertised === "all",
  map: new Set([WORD_DOCUMENT_REVIEW_FACET_ID]),
});

const listOf = (scene: Scene): WordCommentList => {
  const selection = scene.selection;
  const inSelection = new Set(selection?.threads ?? []);
  const threads = THREADS.map((thread) => ({
    ...thread,
    inSelection: inSelection.has(thread.ref),
  }));
  return {
    ...NO_WORD_COMMENT_LIST,
    status: "ready",
    threads,
    counts: {
      open: threads.filter((thread) => thread.status === "open").length,
      resolved: threads.filter((thread) => thread.status === "resolved").length,
    },
    selection: selection
      ? { kind: selection.kind, threads: selection.threads }
      : { kind: "none" },
  };
};

/** Each handler records its name, so a chip's control can be followed to what it changes. */
function recordingHandlers(calls: [string, unknown?][]): WordContextHandlers {
  const record =
    (name: string) =>
    (arg?: unknown): void => {
      calls.push(arg === undefined ? [name] : [name, arg]);
    };
  return {
    dismissSelection: record("dismissSelection"),
    rearmSelection: record("rearmSelection"),
    armSelection: record("armSelection"),
    excludeDocument: record("excludeDocument"),
    includeDocument: record("includeDocument"),
    retryDocument: record("retryDocument"),
    sendDocumentInstead: record("sendDocumentInstead"),
    withoutComments: record("withoutComments"),
    restoreComments: record("restoreComments"),
    endPick: record("endPick"),
    sendPassageInstead: record("sendPassageInstead"),
    sendCommentInstead: record("sendCommentInstead"),
    sendInsteadOfComment: record("sendInsteadOfComment"),
    pickComment: record("pickComment"),
    openPicker: record("openPicker"),
    changeDefault: record("changeDefault"),
    includeOpenComments: record("includeOpenComments"),
    excludeOpenComments: record("excludeOpenComments"),
    setPassageComments: record("setPassageComments"),
    showComment: async (thread, pickFirst) => {
      calls.push(["showComment", { ref: thread.ref, pickFirst }]);
      return "selected";
    },
  };
}

function noticeHandlers(
  calls: [string, unknown?][],
): WordComposerNoticeHandlers {
  return {
    openPicker: () => calls.push(["openPicker"]),
    // The notice's button is the chip's (x) gesture: both answer the waiting Send.
    sendWithoutComments: () => calls.push(["withoutComments"]),
    sendWithoutDocument: () => calls.push(["sendWithoutDocument"]),
    dismissSelectionReadFailed: () =>
      calls.push(["dismissSelectionReadFailed"]),
    dismiss: (id) => calls.push(["dismissNotice", id]),
  };
}

interface Resolved {
  preview: WordSendPreview;
  models: {
    selection: WordSelectionChipModel | null;
    document: WordDocumentChipModel | null;
    comment: WordCommentChipModel | null;
    openComments: WordOpenCommentsChipModel | null;
  };
  items: ComposerContextItem[];
  notice: ComposerNotice | null;
  calls: [string, unknown?][];
}

/** WordChatInput's render: the preview, its as-if twin, the chip models, the lane items and the notice. */
function resolve(scene: Scene): Resolved {
  const advertised = advertisedOf(scene);
  const list = listOf(scene);
  const selection = scene.selection;
  const passageGoes =
    selection?.kind === "passage" && !selection.dismissed ? true : false;
  const commentSelection =
    passageGoes && selection?.kind === "passage"
      ? {
          kind: "passage" as const,
          threads: selection.threads,
          rewritable: selection.rewritable ?? false,
        }
      : selection?.kind === "caret"
        ? { kind: "caret" as const, threads: selection.threads }
        : { kind: "none" as const };
  const pickFound =
    scene.pick === null ||
    list.threads.some((thread) => thread.ref === scene.pick);
  const base = {
    advertised,
    precedence: scene.precedence,
    pick: scene.pick,
    pickFound,
    includeOpenComments: scene.includeOpenComments,
    documentIncluded: scene.documentIncluded,
    passageGoes,
    commentSelection,
    authoring: false,
    hasContent: true,
    unreadable: false,
    availableFacetIds: FACETS,
  };
  const preview = previewWordSend({
    ...base,
    override: scene.override,
    withoutComments: scene.withoutComments,
  });
  const asIf = previewWordSend({
    ...base,
    override: scene.override === "passage" ? null : scene.override,
    withoutComments: false,
  });
  const commentInput: WordCommentChipsInput = {
    preview,
    asIf,
    list,
    pick: scene.pick,
    gestures: {
      withoutComments: scene.withoutComments,
      override: scene.override,
      includeOpenComments: scene.includeOpenComments,
      openCommentsDismissed: scene.openCommentsDismissed,
    },
    documentOn: scene.documentIncluded,
    documentAdvertised: true,
    threadAdvertised: advertised.thread,
    mapFacet: wordCommentMapFacet(preview, advertised),
    readFailed: scene.waiting === "read-failed",
    canChangeDefault: advertised.thread,
    passageGoes,
  };
  const chipInput = {
    preview,
    selection:
      selection?.kind === "passage"
        ? {
            text: selection.text,
            paragraphCount: selection.paragraphs,
            truncated: false,
            armed: true,
            dismissed: selection.dismissed,
            readFailed: selection.readFailed ?? false,
            comments: wordPassageComments(commentInput),
          }
        : null,
    document: {
      available: true,
      included: scene.documentIncluded,
      status: "included" as const,
      // Word is slow to hand the document over: the chip reads it while the notice offers to skip.
      reading: scene.slowCapture,
      coverage: {
        paragraphsSent: 86,
        paragraphsTotal: 86,
        truncated: false,
        partialParagraph: false,
        hasContent: true,
      },
      changed: false,
      authoringRoute: false,
      readInParts: false,
      trackChanges: false,
      lastingIssue: null,
      bodyOnly: false,
      comments: wordDocumentComments(commentInput),
    },
  };
  const shown = wordCommentsAdvertised(advertised);
  const models = {
    selection: wordSelectionChip(chipInput),
    document: wordDocumentChip(chipInput),
    comment: shown ? wordCommentChip(commentInput) : null,
    openComments: shown ? wordOpenCommentsChip(commentInput) : null,
  };
  const calls: [string, unknown?][] = [];
  const { result, unmount } = renderHook(() =>
    useWordContextItems({
      ...models,
      documentName: WORD_COMMENT_STORY_DOCUMENT,
      locked: scene.locked,
      reportOptions: { chatId: "story" },
      handlers: recordingHandlers(calls),
    }),
  );
  const items = result.current;
  unmount();
  const notice = wordComposerNotice(
    {
      commentBlock: scene.waiting,
      threadAdvertised: advertised.thread,
      chipEnabled: scene.documentIncluded,
      slowCapture: scene.slowCapture,
      commentProgress: scene.commentProgress,
      selectionReadFailed: scene.selectionReadFailed,
      captureNotice: scene.captureNotice,
      budgetIssue: scene.budgetIssue ?? undefined,
      dismissed: new Set(scene.dismissedNotices),
    },
    noticeHandlers(calls),
  );
  return { preview, models, items, notice, calls };
}

/** The Send went: what one message spends is spent, and its prompts are settled. */
const sent = (scene: Scene): Scene => ({
  ...scene,
  override: null,
  withoutComments: false,
  waiting: null,
  slowCapture: false,
  commentProgress: null,
  selectionReadFailed: false,
  captureNotice: null,
  budgetIssue: null,
  dismissedNotices: [],
});

const waitsOnChoice = (scene: Scene) =>
  scene.waiting === "choose-comment" || scene.waiting === "picked-gone";

/** Showing a thread keeps it the target; it never answers a waiting Send. */
const keepTarget = (scene: Scene, ref: string): Scene =>
  scene.pick === ref ? scene : { ...scene, pick: ref, withoutComments: false };

/** WordChatInput's handlers, on the scene. */
function applyCall(scene: Scene, [name, arg]: [string, unknown?]): Scene {
  const passageGoes =
    scene.selection?.kind === "passage" && !scene.selection.dismissed;
  const dismissSelection = (current: Scene): Scene =>
    current.selection
      ? {
          ...current,
          selection: {
            ...current.selection,
            dismissed: true,
            ...(current.selection.kind === "passage"
              ? { readFailed: false }
              : {}),
          },
        }
      : current;
  const pickComment = (ref: string): Scene => {
    const next = { ...scene, pick: ref, withoutComments: false };
    return waitsOnChoice(scene) ? sent(next) : next;
  };
  switch (name) {
    case "dismissSelection":
    case "sendDocumentInstead":
      return dismissSelection(scene);
    case "rearmSelection":
      return scene.selection
        ? { ...scene, selection: { ...scene.selection, dismissed: false } }
        : scene;
    case "excludeDocument":
      return scene.locked ? scene : { ...scene, documentIncluded: false };
    case "includeDocument":
      return scene.locked ? scene : { ...scene, documentIncluded: true };
    case "withoutComments":
      if (scene.waiting)
        return sent({
          ...scene,
          pick: scene.waiting === "picked-gone" ? null : scene.pick,
        });
      return { ...scene, withoutComments: true };
    case "restoreComments":
      return {
        ...scene,
        withoutComments: false,
        override: scene.override === "passage" ? null : scene.override,
      };
    case "endPick": {
      const next = { ...scene, pick: null };
      return scene.waiting ? sent(next) : next;
    }
    case "sendPassageInstead":
      return { ...scene, pick: null, override: "passage" };
    case "sendCommentInstead":
      return { ...scene, override: "comment" };
    case "sendInsteadOfComment": {
      const next: Scene = {
        ...scene,
        pick: null,
        override: "passage",
        withoutComments: false,
      };
      return passageGoes ? dismissSelection(next) : next;
    }
    case "pickComment":
      return pickComment(arg as string);
    case "showComment": {
      const { ref, pickFirst } = arg as { ref: string; pickFirst: boolean };
      return pickFirst ? keepTarget(scene, ref) : scene;
    }
    case "includeOpenComments":
      return scene.locked
        ? scene
        : {
            ...scene,
            includeOpenComments: true,
            openCommentsDismissed: false,
            withoutComments: false,
          };
    case "excludeOpenComments": {
      if (scene.locked) return scene;
      const next = {
        ...scene,
        includeOpenComments: false,
        openCommentsDismissed: true,
      };
      return scene.waiting === "read-failed" ? sent(next) : next;
    }
    case "setPassageComments":
      if (!(arg as boolean) && scene.waiting === "read-failed")
        return sent(scene);
      return { ...scene, withoutComments: !(arg as boolean) };
    case "sendWithoutDocument":
      return sent(scene);
    case "dismissSelectionReadFailed":
      return { ...scene, selectionReadFailed: false };
    case "dismissNotice":
      return {
        ...scene,
        dismissedNotices: [...scene.dismissedNotices, arg as string],
      };
    // The picker, the settings and a document read change nothing that is sent.
    case "openPicker":
    case "changeDefault":
    case "retryDocument":
      return scene;
    default:
      throw new Error(`no story rule for the handler ${name}`);
  }
}

/** UI only: they open the picker or the settings, which the stories draw themselves. */
const UI_ACTIONS = new Set(["choose", "change-default", "retry"]);

const isSuggested = (item: ComposerContextItem) => item.state === "suggested";

/** The gestures a story offers in this state, in lane order. */
function gesturesOf(
  scene: Scene,
  resolved: Resolved,
  pickable: readonly string[],
): string[] {
  const gestures: string[] = [];
  for (const item of resolved.items) {
    if (!item.locked) {
      if (isSuggested(item) && item.onRestore) gestures.push(`+:${item.id}`);
      else if (item.onRemove) gestures.push(`x:${item.id}`);
    }
    for (const action of item.detail?.actions ?? [])
      if (!UI_ACTIONS.has(action.id))
        gestures.push(`action:${item.id}:${action.id}`);
  }
  const comment = resolved.models.comment;
  if (comment?.detail.thread)
    gestures.push(`show:${comment.detail.thread.ref}`);
  for (const choice of comment?.detail.choices ?? [])
    gestures.push(`pick:${choice.ref}`);
  const passage = resolved.models.selection?.comments;
  if (passage && !scene.locked)
    gestures.push(`passage-comments:${passage.checked ? "off" : "on"}`);
  if (scene.advertised === "all")
    for (const ref of pickable) gestures.push(`picker:${ref}`);
  for (const action of resolved.notice?.actions ?? [])
    if (action.id !== "choose-comment") gestures.push(`notice:${action.id}`);
  if (resolved.notice?.onDismiss) gestures.push("notice:dismiss");
  if (!scene.waiting) gestures.push("send");
  return gestures;
}

const byRef = new Map(THREADS.map((thread) => [thread.ref, thread]));

const chosenText = (ref: string) => {
  const thread = byRef.get(ref);
  if (!thread) return undefined;
  const { author } = thread;
  return i18n._({
    id: "officeAddin.word.context.comment.announce.chosen",
    message: `Comment by ${author} chosen.`,
  });
};

interface Step {
  to: Scene;
  /** What the Word announcer says; the lane speaks for itself. */
  announce?: string;
}

/** Follows one gesture through the item's real handlers, as the lane would call them. */
function applyGesture(scene: Scene, resolved: Resolved, gesture: string): Step {
  const calls = resolved.calls;
  calls.length = 0;
  const [kind, target, extra] = gesture.split(":");
  const itemOf = (id: string) => {
    const item = resolved.items.find((entry) => entry.id === id);
    if (!item) throw new Error(`${gesture}: no chip ${id}`);
    return item;
  };
  switch (kind) {
    case "x":
      itemOf(target).onRemove?.();
      break;
    case "+":
      itemOf(target).onRestore?.();
      break;
    case "action": {
      const action = itemOf(target).detail?.actions?.find(
        (entry) => entry.id === extra,
      );
      if (!action) throw new Error(`${gesture}: no action`);
      action.onSelect();
      break;
    }
    case "pick":
      calls.push(["pickComment", target]);
      break;
    case "picker":
      calls.push(["pickComment", target]);
      return {
        to: applyCall(scene, ["pickComment", target]),
        announce: chosenText(target),
      };
    case "show": {
      const pickFirst =
        resolved.models.comment?.detail.showInWordPicks ?? false;
      const picks = pickFirst && scene.pick !== target;
      return {
        to: applyCall(scene, ["showComment", { ref: target, pickFirst }]),
        ...(picks ? { announce: chosenText(target) } : {}),
      };
    }
    case "passage-comments":
      calls.push(["setPassageComments", target === "on"]);
      break;
    case "notice": {
      if (target === "dismiss") resolved.notice?.onDismiss?.();
      else
        resolved.notice?.actions
          ?.find((action) => action.id === target)
          ?.onSelect();
      break;
    }
    case "send": {
      // The Send spends one message's gestures first, then waits if the user has to choose.
      const spent = { ...scene, override: null, withoutComments: false };
      const block = resolved.preview.comments.block;
      return {
        to:
          block === "choose-comment" || block === "picked-gone"
            ? { ...spent, waiting: block }
            : sent(spent),
      };
    }
    default:
      throw new Error(`unknown gesture ${gesture}`);
  }
  if (calls.length === 0) throw new Error(`${gesture} called no handler`);
  return { to: calls.reduce(applyCall, scene) };
}

// --- What the stories read -------------------------------------------------------------------

const hashOf = (value: unknown) =>
  createHash("sha1").update(JSON.stringify(value)).digest("hex").slice(0, 10);

const note = (entry: WordContextNote) => ({
  tone: entry.tone,
  text: entry.text,
});
const coverage = (section: WordCommentCoverageSection | null) =>
  section ? { heading: section.heading, lines: section.lines } : null;
const why = (value: WordCommentWhy | null) =>
  value ? wordCommentWhyText(value) : null;

const passageBody = (comments: WordPassageCommentsModel) => ({
  count: comments.count,
  checked: comments.checked,
  threads: comments.threads.map((thread) => thread.ref),
  why: why(comments.why),
  coverage: coverage(comments.coverage),
  sendLabel: i18n._({
    id: "officeAddin.word.context.selection.sendComments",
    message:
      "{count, plural, one {Send the comment in this passage} other {Send the # comments in this passage}}",
    values: { count: comments.count },
  }),
});

function bodyOf(item: ComposerContextItem, models: Resolved["models"]) {
  switch (item.kind) {
    case "word.selection": {
      const model = models.selection!;
      return {
        kind: "selection",
        text: model.text,
        cut: model.cut,
        paragraphs: model.paragraphs,
        notes: model.notes.map(note),
        comments: model.comments ? passageBody(model.comments) : null,
        lifetime: model.lifetime,
      };
    }
    case "word.document": {
      const model = models.document!;
      return {
        kind: "document",
        notes: model.notes.map(note),
        coverage: model.coverage,
        comments: model.comments,
        ...(model.commentsNote ? { commentsNote: model.commentsNote } : {}),
        lifetime: model.lifetime,
      };
    }
    case "word.comment": {
      const model = models.comment!;
      return {
        kind: "comment",
        variant: model.variant,
        why: why(model.detail.why),
        thread: model.detail.thread?.ref ?? null,
        choices: model.detail.choices.map((thread) => thread.ref),
        ...(model.detail.intro ? { intro: model.detail.intro } : {}),
        notes: model.detail.notes.map(note),
        coverage: coverage(model.detail.coverage),
        lifetime: model.detail.lifetime,
      };
    }
    case "word.openComments": {
      const model = models.openComments!;
      return {
        kind: "openComments",
        intro: model.detail.intro,
        notes: model.detail.notes.map(note),
        coverage: coverage(model.detail.coverage),
        lifetime: model.detail.lifetime,
      };
    }
    default:
      throw new Error(`no story body for ${item.kind}`);
  }
}

const optional = <T>(key: string, value: T | undefined | null) =>
  value === undefined || value === null || value === false
    ? {}
    : { [key]: value };

function itemData(item: ComposerContextItem, models: Resolved["models"]) {
  return {
    id: item.id,
    kind: item.kind,
    origin: item.origin,
    ...optional("placement", item.placement),
    ...optional("dismissScope", item.dismissScope),
    icon: item.icon,
    state: item.state,
    ...optional("tone", item.tone),
    ...optional("toneIcon", item.toneIcon),
    label: item.label,
    ...optional("spokenLabel", item.spokenLabel),
    ...optional("meta", item.meta),
    ...optional("locked", item.locked),
    ...optional("lockReason", item.lockReason),
    ...optional("removeLabel", item.removeLabel),
    ...optional("removeActionLabel", item.removeActionLabel),
    ...optional("restoreLabel", item.restoreLabel),
    ...optional("announcements", item.announcements),
    remove: Boolean(item.onRemove),
    restore: Boolean(item.onRestore),
    detail: {
      title: item.detail!.title,
      actions: (item.detail!.actions ?? []).map((action) => ({
        id: action.id,
        label: action.label,
        ...optional("variant", action.variant),
        ...optional("announcement", action.announcement),
      })),
      body: bodyOf(item, models),
    },
  };
}

const noticeData = (notice: ComposerNotice | null) =>
  notice && {
    id: notice.id,
    tone: notice.tone,
    text: notice.text,
    ...optional("busy", notice.busy),
    ...optional("progressLabel", notice.progressLabel),
    actions: (notice.actions ?? []).map((action) => ({
      id: action.id,
      label: action.label,
    })),
    dismissible: Boolean(notice.onDismiss),
  };

/** What the next Send carries, as the preview the chips came from says. */
function sendData(preview: WordSendPreview) {
  const carrier = preview.comments.carrier;
  return {
    carrier: preview.carrier,
    document: preview.document,
    selection: preview.selection,
    comments:
      carrier.kind === "thread"
        ? `thread:${carrier.ref}`
        : carrier.kind === "selection"
          ? `selection:${carrier.threads.join(",")}`
          : carrier.kind,
    ...optional("block", preview.comments.block),
  };
}

/** The hard rule: no chip says "included" about something the Send does not carry. */
function assertAgrees(resolved: Resolved, scene: Scene, story: string) {
  const { preview } = resolved;
  const stateOf = (kind: string) =>
    resolved.items.find((item) => item.kind === kind)?.state;
  const included = (kind: string) => stateOf(kind) === "included";
  // Comments Word did not hand over wait on the user, so their chip is an error, not included.
  const unread = scene.waiting === "read-failed";
  // A passage whose last read failed still goes; its chip says to send again.
  if (included("word.selection")) expect(preview.selection, story).toBe("sent");
  if (included("word.document")) expect(preview.document, story).toBe("sent");
  expect(included("word.comment"), story).toBe(
    preview.carrier === "comment" && !unread,
  );
  expect(included("word.openComments"), story).toBe(
    preview.carrier === "open-comments" && !unread,
  );
  if (unread && preview.carrier === "comment")
    expect(stateOf("word.comment"), story).toBe("error");
  expect(stateOf("word.comment") === "attention", story).toBe(
    preview.comments.block === "choose-comment",
  );
}

function threadData(thread: WordCommentListThread) {
  return {
    author: thread.author,
    title: wordCommentByText(thread.author),
    status: wordCommentStatusText(thread.status),
    ...optional(
      "activity",
      thread.lastActivity ? wordCommentActivityText(thread.lastActivity) : null,
    ),
    ...optional("replies", wordCommentRepliesText(thread.replies)),
    text: thread.text,
    quote: wordCommentQuoteText(thread.quote),
    chosen: chosenText(thread.ref)!,
  };
}

/** Copy the detail bodies and the picker draw inline (WordCommentDetails, WordContextDetails, WordCommentPicker). */
const stringsData = () => ({
  choose: wordCommentChooseText(),
  choices: i18n._({
    id: "officeAddin.word.context.comment.choices",
    message: "Comments at your cursor",
  }),
  passageHeading: i18n._({
    id: "officeAddin.word.context.selection.commentsHeading",
    message: "Comments in this passage",
  }),
  passageHint: i18n._({
    id: "officeAddin.word.context.selection.sendCommentsHint",
    message: "Off lasts for this message only",
  }),
  documentComments: i18n._({
    id: "officeAddin.word.context.document.commentsHeading",
    message: "Comments",
  }),
  selectedText: i18n._({
    id: "officeAddin.word.context.selection.quoteLabel",
    message: "Selected text",
  }),
  pickerTitle: i18n._({
    id: "officeAddin.word.comments.picker.title",
    message: "Choose a comment",
  }),
});

beforeAll(() => {
  i18n.loadAndActivate({ locale: "en", messages: {} });
});

afterEach(() => {
  cleanup();
});

it("writes what every Word comment story draws, and where each gesture leads", async () => {
  const items: Record<string, ReturnType<typeof itemData>> = {};
  const states: Record<
    string,
    {
      items: string[];
      notice: ReturnType<typeof noticeData>;
      send: ReturnType<typeof sendData>;
    }
  > = {};
  const transitions: Record<
    string,
    Record<string, { to: string; announce?: string }>
  > = {};
  const stories: Record<
    string,
    { id: string; start: string; pickable: string[] }
  > = {};

  const record = (scene: Scene, story: string) => {
    const key = hashOf(scene);
    if (states[key]) return { key, resolved: null };
    const resolved = resolve(scene);
    assertAgrees(resolved, scene, story);
    states[key] = {
      items: resolved.items.map((item) => {
        const data = itemData(item, resolved.models);
        const itemKey = hashOf(data);
        items[itemKey] = data;
        return itemKey;
      }),
      notice: noticeData(resolved.notice),
      send: sendData(resolved.preview),
    };
    return { key, resolved };
  };
  const step = (scene: Scene, gesture: string, story: string) => {
    const from = hashOf(scene);
    const resolved = resolve(scene);
    const { to, announce } = applyGesture(scene, resolved, gesture);
    const target = record(to, story).key;
    if (target !== from || announce)
      (transitions[from] ??= {})[gesture] = {
        to: target,
        ...optional("announce", announce),
      };
    return to;
  };

  for (const [name, seed] of Object.entries(WORD_COMMENT_STORIES) as [
    string,
    Seed,
  ][]) {
    const pickable = wordCommentStoryPickable(seed);
    const start = sceneOf(seed);
    stories[name] = {
      id: wordCommentStoryId(name),
      start: record(start, name).key,
      pickable,
    };
    let frontier = [start];
    for (let depth = 0; depth < EXPLORED_DEPTH; depth += 1) {
      const next: Scene[] = [];
      for (const scene of frontier)
        for (const gesture of gesturesOf(scene, resolve(scene), pickable))
          next.push(step(scene, gesture, `${name} ${gesture}`));
      frontier = next;
    }
    for (const flow of seed.flows ?? []) {
      let scene = start;
      for (const gesture of flow) {
        const offered = gesturesOf(scene, resolve(scene), pickable);
        expect(offered, `${name}: ${flow.join(" → ")}`).toContain(gesture);
        scene = step(scene, gesture, `${name} ${flow.join(" → ")}`);
      }
    }
  }

  const threads = Object.fromEntries(
    THREADS.map((thread) => [thread.ref, threadData(thread)]),
  );
  const json = await format(
    JSON.stringify({
      strings: stringsData(),
      threads,
      stories,
      states,
      items,
      transitions,
    }),
    { parser: "json" },
  );
  await expect(json).toMatchFileSnapshot(GENERATED);
});
