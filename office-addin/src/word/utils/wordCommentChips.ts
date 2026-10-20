import { plural, t } from "@lingui/core/macro";

import {
  wordCommentCoverageInfo,
  wordCommentCoverageLines,
  wordCommentWhatIsSentText,
} from "./wordCommentCoverage";
import { wordCommentMapListed } from "./wordCommentMap";
import {
  wordCommentByText,
  wordCommentDismissPickText,
  wordCommentIncludeText,
  wordCommentSendWithoutText,
  wordCommentUnknownText,
  wordCommentWhyText,
} from "./wordCommentText";

import type {
  WordCommentAdvertised,
  WordCommentOverride,
  WordCommentWhy,
} from "./wordCommentSend";
import type { WordContextNote } from "./wordContextChips";
import type { WordSendPreview } from "./wordSendPreview";
import type {
  WordCommentList,
  WordCommentListThread,
} from "../hooks/useWordComments";
import type {
  ComposerContextState,
  ComposerContextTone,
} from "@erato/frontend/library";

/**
 * The comment chips (design "Per-host mapping", Word), each read off the send preview, never off a
 * flag of its own: `preview` is what Send carries, `asIf` the same resolver with the one-message
 * "off" gestures undone, so a suggested chip names exactly what + brings back.
 */
export interface WordCommentChipsInput {
  preview: WordSendPreview;
  asIf: WordSendPreview;
  list: WordCommentList;
  pick: string | null;
  gestures: {
    withoutComments: boolean;
    override: WordCommentOverride | null;
    includeOpenComments: boolean;
    openCommentsDismissed: boolean;
  };
  /** The document chip is on and a document facet is advertised. */
  documentOn: boolean;
  /** A document facet is advertised, so the document chip shows, on or off. */
  documentAdvertised: boolean;
  threadAdvertised: boolean;
  /** The document facet this Send would use takes comment_map (`wordCommentMapFacet`). */
  mapFacet: boolean;
  /** A Send waits because Word did not hand over the comments it needs. */
  readFailed: boolean;
  /** The precedence setting exists and the host can open it. */
  canChangeDefault: boolean;
  /** The passage is shown, armed and advertised. */
  passageGoes: boolean;
}

export interface WordCommentCoverageSection {
  heading: string;
  lines: string[];
}

export type WordCommentChipAction =
  | "choose"
  | "passage-instead"
  | "change-default";

export interface WordCommentChipModel {
  /** One thread, the caret in several, or a pick that is gone. */
  variant: "thread" | "choose" | "gone";
  origin: "ambient" | "user";
  state: ComposerContextState;
  tone?: ComposerContextTone;
  label: string;
  spokenLabel: string;
  meta?: string;
  /** Names the (x) and the detail's remove button. */
  removeLabel: string;
  /** What (x) does: this message goes without comments, or the pick ends. */
  removeAction: "without" | "end-pick";
  /** While suggested: names the (+) and the detail's include button. */
  restoreLabel?: string;
  removedAnnouncement?: string;
  detail: {
    title: string;
    why: WordCommentWhy | null;
    /** Null while the live list has not seen the thread. */
    thread: WordCommentListThread | null;
    /** The caret's threads to choose from. */
    choices: WordCommentListThread[];
    intro?: string;
    coverage: WordCommentCoverageSection | null;
    lifetime: string;
    notes: WordContextNote[];
    /**
     * Show in Word moves Word's caret off the comment, so a thread that goes because of where the
     * caret is gets picked first to stay the target. Anything else is only shown.
     */
    showInWordPicks: boolean;
  };
  actions: WordCommentChipAction[];
}

export type WordOpenCommentsChipAction = "choose" | "send-instead";

export interface WordOpenCommentsChipModel {
  state: ComposerContextState;
  tone?: ComposerContextTone;
  label: string;
  meta?: string;
  /** Present unless suggested. */
  removeLabel?: string;
  restoreLabel?: string;
  /**
   * What (+) does: turn them on for the chat (which also undoes "Send without comments"), undo
   * "Send without comments", or nothing, where none is open and the chip only leads to the picker.
   */
  restore: "include" | "restore-comments" | null;
  actions: WordOpenCommentsChipAction[];
  /** "Send this instead" also turns the passage off. */
  sendInsteadDismissesSelection: boolean;
  detail: {
    intro: string;
    coverage: WordCommentCoverageSection | null;
    lifetime?: string;
    notes: WordContextNote[];
  };
}

/** What the selection chip says about the passage's own threads. */
export interface WordPassageCommentsModel {
  count: number;
  /** Off: "Send without comments" holds for this message. */
  checked: boolean;
  threads: WordCommentListThread[];
  why: WordCommentWhy | null;
  coverage: WordCommentCoverageSection | null;
  /** The one thread "Work on X's comment instead" would send. */
  switchTo: WordCommentListThread | null;
  offerChoose: boolean;
  canChangeDefault: boolean;
  /** They were due with the waiting Send, and Word did not hand them over. */
  readFailed: boolean;
}

/** What the document chip says about the comment map. */
export interface WordDocumentCommentsModel {
  /** The map's rows while the map goes; the meta's third fact. */
  count: number | null;
  lines: string[];
  /** "Send without comments" holds while the document goes. */
  off: boolean;
  /** The map is what that gesture turned off, so the meta says it and + is offered. */
  mapOff: boolean;
  /** The map was due with the waiting Send, and Word did not hand the comments over. */
  readFailed: boolean;
  offerChoose: boolean;
}

/** Whether the document facet this Send would use takes the comment map, as the Send adds it. */
export const wordCommentMapFacet = (
  preview: WordSendPreview,
  advertised: WordCommentAdvertised,
): boolean => preview.facetId !== null && advertised.map.has(preview.facetId);

const lifetimeMessage = () =>
  t({
    id: "officeAddin.word.context.comment.lifetime.message",
    message: "Leaving comments out lasts for the next message only.",
  });

const lifetimePick = () =>
  t({
    id: "officeAddin.word.context.comment.lifetime.pick",
    message:
      "A chosen comment stays until you choose another, remove it or select other text.",
  });

const offForMessage = () =>
  t({
    id: "officeAddin.word.context.comment.meta.offForMessage",
    message: "Off for this message",
  });

const removedForMessage = () =>
  t({
    id: "officeAddin.word.context.comment.announce.removed",
    message: "Comments removed for this message. Include again with +",
  });

const ifIncludedHeading = () =>
  t({
    id: "officeAddin.word.context.comment.ifIncluded",
    message: "If included",
  });

const spokenComments = () =>
  t({ id: "officeAddin.word.context.comment.spoken", message: "Comments" });

/** "Open comments (9)": the open-comments chip's label, composer and sent alike. */
export const wordOpenCommentsLabelText = (count: number) =>
  t({
    id: "officeAddin.word.context.openComments.label",
    message: `Open comments (${count})`,
  });

const readFailedMeta = () =>
  t({
    id: "officeAddin.word.context.comment.meta.readFailed",
    message: "Couldn't read comments",
  });

const spokenPicked = () =>
  t({
    id: "officeAddin.word.context.comment.spokenPicked",
    message: "Chosen comment",
  });

/** What a comment chip is called aloud: the user's pick, or the comments Erato found. */
export const wordCommentSpokenText = (picked: boolean) =>
  picked ? spokenPicked() : spokenComments();

const byRef = (list: WordCommentList) =>
  new Map(list.threads.map((thread) => [thread.ref, thread]));

/** The caret's threads, from the list the preview's selection came from. */
function caretThreads(list: WordCommentList): WordCommentListThread[] {
  if (list.selection.kind !== "caret") return [];
  const known = byRef(list);
  return list.selection.threads.flatMap((ref) => {
    const thread = known.get(ref);
    return thread ? [thread] : [];
  });
}

function caretCount(list: WordCommentList): number {
  return list.selection.kind === "caret"
    ? Math.max(2, list.selection.threads.length)
    : 2;
}

function coverageOf(
  input: WordCommentChipsInput,
  plan: WordSendPreview["comments"],
  heading: string,
  openComments = input.gestures.includeOpenComments,
): WordCommentCoverageSection | null {
  const info = wordCommentCoverageInfo(plan, input.list, {
    // A passage or a thread goes instead of the document, and reads follow what went.
    document:
      input.documentOn && !input.passageGoes && plan.carrier.kind !== "thread",
    picked: input.pick !== null,
    openComments,
  });
  return info ? { heading, lines: wordCommentCoverageLines(info) } : null;
}

/**
 * The comment chip, id `word-comment` in every variant so focus and an open detail survive a
 * choice: one thread (the caret's, the pick, or the passage's under the setting or the switch),
 * the caret in several threads (a choice), or a pick that is gone. Passage threads and the map
 * are no chip of their own; they ride on the selection and the document.
 */
export function wordCommentChip(
  input: WordCommentChipsInput,
): WordCommentChipModel | null {
  const { preview, asIf, list, pick } = input;
  const known = byRef(list);

  if (
    preview.comments.block === "picked-gone" ||
    asIf.comments.block === "picked-gone"
  )
    return {
      variant: "gone",
      origin: "user",
      state: "error",
      tone: "error",
      label: wordCommentUnknownText(),
      spokenLabel: spokenPicked(),
      meta: t({
        id: "officeAddin.word.context.comment.meta.gone",
        message: "No longer in the document",
      }),
      removeLabel: wordCommentDismissPickText(),
      removeAction: "end-pick",
      detail: {
        title: wordCommentUnknownText(),
        why: null,
        thread: null,
        choices: [],
        coverage: null,
        lifetime: lifetimePick(),
        showInWordPicks: false,
        notes: [
          {
            tone: "error",
            text: t({
              id: "officeAddin.word.comments.blocked.pickedGone",
              message: "The comment you chose is no longer in the document.",
            }),
          },
        ],
      },
      actions: input.threadAdvertised ? ["choose"] : [],
    };

  const chooseVariant = (suggested: boolean): WordCommentChipModel | null => {
    const count = caretCount(list);
    return {
      variant: "choose",
      origin: "ambient",
      state: suggested ? "suggested" : "attention",
      ...(suggested ? {} : { tone: "warning" as const }),
      label: suggested
        ? t({
            id: "officeAddin.word.context.comment.atCursor",
            message: "Comments at your cursor",
          })
        : t({
            id: "officeAddin.word.context.comment.attention",
            message: plural(count, {
              one: "Cursor is in # comment",
              other: "Cursor is in # comments",
            }),
          }),
      spokenLabel: spokenComments(),
      ...(suggested
        ? {}
        : {
            meta: t({
              id: "officeAddin.word.context.comment.meta.chooseOne",
              message: "Choose one",
            }),
          }),
      removeLabel: wordCommentSendWithoutText(),
      removeAction: "without",
      ...(suggested ? { restoreLabel: wordCommentIncludeText() } : {}),
      removedAnnouncement: removedForMessage(),
      detail: {
        title: t({
          id: "officeAddin.word.comments.atCursorMany",
          message: plural(count, {
            one: "Your cursor is in # comment",
            other: "Your cursor is in # comments",
          }),
        }),
        why: null,
        thread: null,
        choices: caretThreads(list),
        intro: t({
          id: "officeAddin.word.comments.blocked.chooseComment",
          message:
            "Your cursor is in more than one comment, so Erato does not know which one you mean.",
        }),
        coverage: null,
        lifetime: lifetimeMessage(),
        notes: [],
        showInWordPicks: false,
      },
      actions: [],
    };
  };

  const threadVariant = (
    plan: WordSendPreview["comments"],
    suggested: boolean,
  ): WordCommentChipModel | null => {
    const { carrier } = plan;
    if (carrier.kind !== "thread") return null;
    const thread = known.get(carrier.ref) ?? null;
    const picked = pick !== null && carrier.ref === pick;
    const label = thread
      ? wordCommentByText(thread.author)
      : wordCommentUnknownText();
    const why = plan.why;
    const actions: WordCommentChipAction[] = [];
    if (input.threadAdvertised) actions.push("choose");
    if (input.passageGoes && (picked || plan.switchTo === "passage"))
      actions.push("passage-instead");
    if (!picked && why === "default" && input.canChangeDefault)
      actions.push("change-default");
    // The waiting Send cannot carry it until the user sends without comments.
    const unread = !suggested && input.readFailed;
    return {
      variant: "thread",
      origin: picked ? "user" : "ambient",
      state: suggested ? "suggested" : unread ? "error" : "included",
      ...(unread ? { tone: "error" as const } : {}),
      label,
      spokenLabel: picked ? spokenPicked() : spokenComments(),
      ...(unread
        ? { meta: readFailedMeta() }
        : why && !suggested
          ? { meta: wordCommentWhyText(why) }
          : suggested && picked
            ? { meta: offForMessage() }
            : {}),
      removeLabel: picked
        ? wordCommentDismissPickText()
        : wordCommentSendWithoutText(),
      removeAction: picked ? "end-pick" : "without",
      ...(suggested ? { restoreLabel: wordCommentIncludeText() } : {}),
      ...(picked ? {} : { removedAnnouncement: removedForMessage() }),
      detail: {
        title: label,
        why,
        thread,
        choices: [],
        coverage: coverageOf(
          input,
          plan,
          suggested ? ifIncludedHeading() : wordCommentWhatIsSentText(),
        ),
        lifetime: picked ? lifetimePick() : lifetimeMessage(),
        notes: [],
        showInWordPicks: !picked && !suggested,
      },
      actions,
    };
  };

  if (preview.comments.block === "choose-comment") return chooseVariant(false);
  if (preview.carrier === "comment")
    return threadVariant(preview.comments, false);
  // A one-message gesture turned off what would otherwise go: + brings it back.
  if (asIf.comments.block === "choose-comment") return chooseVariant(true);
  if (asIf.carrier === "comment") return threadVariant(asIf.comments, true);
  return null;
}

/**
 * "Open comments (9)", only while the document is off: with the document on, its map lists them
 * already. Included only while the Send carries the open threads, even none (they last for the
 * chat). With none open and no document chip, it stays the way to the picker.
 */
export function wordOpenCommentsChip(
  input: WordCommentChipsInput,
): WordOpenCommentsChipModel | null {
  const { preview, asIf, list, gestures } = input;
  if (input.documentOn || !input.threadAdvertised) return null;
  const count = list.counts.open;
  const carries =
    preview.carrier === "open-comments" ||
    asIf.carrier === "open-comments" ||
    gestures.includeOpenComments;
  // Nothing to include, but without a document chip nothing else may lead to a resolved thread.
  const pickerOnly = count === 0 && !carries;
  if (pickerOnly && (input.documentAdvertised || list.threads.length === 0))
    return null;
  const label =
    list.status === "ready"
      ? wordOpenCommentsLabelText(count)
      : t({
          id: "officeAddin.word.context.openComments.spoken",
          message: "Open comments",
        });
  const removeLabel = t({
    id: "officeAddin.word.context.openComments.remove",
    message: "Don't include open comments",
  });
  const includeOpenText = () =>
    t({
      id: "officeAddin.word.comments.includeOpen",
      message: "Include open comments",
    });
  const intro = input.documentAdvertised
    ? t({
        id: "officeAddin.word.context.openComments.intro",
        message:
          "Shown while the document is off, so you can still send its comments without its text.",
      })
    : t({
        id: "officeAddin.word.context.openComments.introNoDocument",
        message: "Sends the document's open comments with their replies.",
      });
  const lifetime = t({
    id: "officeAddin.word.context.openComments.lifetime",
    message: "Leaving them out lasts for this chat.",
  });
  // Lines for the message that carries them, so "If included" reads as "What is sent" will.
  const openPlan = (heading: string) =>
    coverageOf(
      input,
      {
        ...asIf.comments,
        carrier: { kind: "open-comments" },
      },
      heading,
      true,
    );
  const actions: WordOpenCommentsChipAction[] = ["choose"];

  if (pickerOnly)
    return {
      state: "suggested",
      label,
      meta: t({
        id: "officeAddin.word.context.openComments.meta.noneOpen",
        message: "None open",
      }),
      restore: null,
      actions,
      sendInsteadDismissesSelection: false,
      detail: {
        intro: t({
          id: "officeAddin.word.context.openComments.noneOpenIntro",
          message:
            "No comment in this document is open. Choose comment… to work on a resolved one.",
        }),
        coverage: null,
        notes: [],
      },
    };
  if (preview.carrier === "open-comments") {
    const unread = input.readFailed;
    return {
      state: unread ? "error" : "included",
      ...(unread ? { tone: "error" as const } : {}),
      label,
      meta: unread
        ? readFailedMeta()
        : t({
            id: "officeAddin.word.context.openComments.meta.included",
            message: "With their replies",
          }),
      removeLabel,
      restore: "include",
      actions,
      sendInsteadDismissesSelection: false,
      detail: {
        intro,
        coverage: openPlan(wordCommentWhatIsSentText()),
        lifetime,
        notes: [],
      },
    };
  }
  if (!gestures.includeOpenComments)
    return {
      state: "suggested",
      label,
      ...(gestures.openCommentsDismissed
        ? {}
        : {
            meta: t({
              id: "officeAddin.word.context.openComments.meta.notIncluded",
              message: "Not included",
            }),
          }),
      restoreLabel: includeOpenText(),
      restore: "include",
      actions,
      sendInsteadDismissesSelection: false,
      detail: {
        intro,
        coverage: openPlan(ifIncludedHeading()),
        lifetime,
        notes: [],
      },
    };
  // On for the chat, and the Send carries something else first: say what, from the same preview.
  const bySelection = preview.carrier === "selection";
  if (
    bySelection ||
    preview.carrier === "comment" ||
    preview.comments.block !== null
  )
    return {
      state: "superseded",
      label,
      meta: bySelection
        ? t({
            id: "officeAddin.word.context.document.meta.replacedBySelection",
            message: "Replaced by selection",
          })
        : t({
            id: "officeAddin.word.context.document.meta.replacedByComment",
            message: "Replaced by comment",
          }),
      removeLabel,
      restore: "include",
      actions: ["choose", "send-instead"],
      sendInsteadDismissesSelection: input.passageGoes,
      detail: {
        intro,
        coverage: openPlan(
          t({
            id: "officeAddin.word.context.document.coverageIfSentHeading",
            message: "If sent instead",
          }),
        ),
        lifetime,
        notes: [
          {
            tone: "info",
            text: bySelection
              ? t({
                  id: "officeAddin.word.context.openComments.selectionInstead",
                  message:
                    "Your selection is sent instead of the open comments.",
                })
              : t({
                  id: "officeAddin.word.context.openComments.commentInstead",
                  message:
                    "A comment at your cursor or one you chose is sent instead of the open comments.",
                }),
          },
        ],
      },
    };
  // Nothing goes only because "Send without comments" holds for this message.
  return {
    state: "suggested",
    label,
    meta: offForMessage(),
    restoreLabel: wordCommentIncludeText(),
    restore: "restore-comments",
    actions,
    sendInsteadDismissesSelection: false,
    detail: {
      intro,
      coverage: openPlan(ifIncludedHeading()),
      lifetime,
      notes: [],
    },
  };
}

/** The passage's own threads, while the passage goes (or would, but for "Send without comments"). */
export function wordPassageComments(
  input: WordCommentChipsInput,
): WordPassageCommentsModel | null {
  const { preview, asIf, list } = input;
  const plan =
    preview.selection === "sent" &&
    preview.comments.carrier.kind === "selection" &&
    preview.comments.carrier.threads.length > 0
      ? preview.comments
      : preview.selection === "sent" &&
          input.gestures.withoutComments &&
          asIf.selection === "sent" &&
          asIf.comments.carrier.kind === "selection" &&
          asIf.comments.carrier.threads.length > 0
        ? asIf.comments
        : null;
  if (!plan || plan.carrier.kind !== "selection") return null;
  const checked = plan === preview.comments;
  const known = byRef(list);
  const threads = plan.carrier.threads.flatMap((ref) => {
    const thread = known.get(ref);
    return thread ? [thread] : [];
  });
  return {
    count: plan.carrier.threads.length,
    checked,
    threads,
    why: plan.why,
    coverage: coverageOf(
      input,
      plan,
      checked ? wordCommentWhatIsSentText() : ifIncludedHeading(),
    ),
    switchTo:
      plan.switchTo === "comment"
        ? (known.get(plan.carrier.threads[0]) ?? null)
        : null,
    offerChoose: input.threadAdvertised,
    canChangeDefault: input.canChangeDefault && plan.why === "default",
    readFailed: checked && input.readFailed,
  };
}

/** The comment map on the document chip, and what "Send without comments" took from it. */
export function wordDocumentComments(
  input: WordCommentChipsInput,
): WordDocumentCommentsModel | null {
  const { preview, asIf, list } = input;
  const offerChoose = input.threadAdvertised && list.threads.length > 0;
  const mapGoes =
    input.mapFacet &&
    preview.document === "sent" &&
    preview.comments.carrier.kind === "map" &&
    list.threads.length > 0;
  if (mapGoes) {
    const info = wordCommentCoverageInfo(preview.comments, list, {
      document: true,
      picked: input.pick !== null,
      openComments: input.gestures.includeOpenComments,
    });
    return {
      count: input.readFailed
        ? null
        : wordCommentMapListed(list.threads.length),
      lines: info ? wordCommentCoverageLines(info) : [],
      off: false,
      mapOff: false,
      readFailed: input.readFailed,
      offerChoose,
    };
  }
  const off =
    input.gestures.withoutComments &&
    input.mapFacet &&
    preview.document === "sent" &&
    list.threads.length > 0;
  if (off)
    return {
      count: null,
      lines: [],
      off: true,
      mapOff: asIf.document === "sent" && asIf.comments.carrier.kind === "map",
      readFailed: false,
      offerChoose,
    };
  return offerChoose
    ? {
        count: null,
        lines: [],
        off: false,
        mapOff: false,
        readFailed: false,
        offerChoose,
      }
    : null;
}
