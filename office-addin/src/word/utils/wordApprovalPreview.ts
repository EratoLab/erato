import { wordPlanTitleText } from "@erato/frontend/library";
import { buildWordPlanReview } from "@erato/frontend/word-review";
import { plural, t } from "@lingui/core/macro";

import { wordCommentAlwaysBlock } from "./wordCommentCard";
import { resolveWordDocumentName } from "./wordDocumentIdentity";
import { wordPlanRouting } from "./wordPlanApply";

import type { WordCommentDraft } from "./wordCommentChanges";
import type {
  WordAuthoringSnapshot,
  WordDocumentPlan,
} from "@erato/frontend/word-review";

/**
 * What the decision place shows for a change before the pane's own card is drawn, and the facts
 * the server decides from: which actions the change uses, and whether it needs a tick on screen.
 */
export interface WordApprovalPreview {
  title: string;
  summary: string;
  actions: string[];
  decide_on_screen: boolean;
}

const MAX_LISTED = 20;
const MAX_NAME_CHARS = 80;
const MAX_SUMMARY_CHARS = 500;

export const wordListedNames = (names: readonly string[]): string[] =>
  names
    .slice(0, MAX_LISTED)
    .map((name) =>
      name.length > MAX_NAME_CHARS
        ? `${name.slice(0, MAX_NAME_CHARS - 1)}…`
        : name,
    );

/** The sections a plan changes, by heading, as the review groups them. */
export function wordPlanChangedSections(
  plan: WordDocumentPlan,
  snapshot: WordAuthoringSnapshot,
): string[] {
  try {
    const review = buildWordPlanReview(plan, snapshot);
    return wordListedNames(
      review.groups
        .filter((group) => group.status !== "unchanged")
        .map((group, index) => group.heading?.text.trim() || `#${index + 1}`),
    );
  } catch {
    return [];
  }
}

export function wordChangeTitle(): string {
  const name = resolveWordDocumentName();
  return name
    ? t({
        id: "officeAddin.word.apply.previewTitle",
        message: `Change “${name}”`,
      })
    : t({
        id: "officeAddin.word.apply.previewTitleUnnamed",
        message: "Change the document",
      });
}

const bounded = (text: string) =>
  text.length > MAX_SUMMARY_CHARS
    ? `${text.slice(0, MAX_SUMMARY_CHARS - 1)}…`
    : text;

/** What a comment card proposes, in one line. */
export function wordCommentChangesTitle(draft: WordCommentDraft): string {
  const n = draft.rows.length;
  switch (draft.action) {
    case "word.add_comments":
      return t({
        id: "officeAddin.word.comments.title.add",
        message: plural(n, { one: "Add a comment", other: "Add # comments" }),
      });
    case "word.respond_to_comments":
      return t({
        id: "officeAddin.word.comments.title.respond",
        message: "Reply to, resolve or reopen comments",
      });
    case "word.modify_comments":
      return t({
        id: "officeAddin.word.comments.title.modify",
        message: "Edit or delete comments",
      });
  }
}

/** Comment changes ask on screen where the card would not run on its own. */
export function wordCommentApprovalPreview(
  draft: WordCommentDraft,
  tainted: boolean,
): WordApprovalPreview {
  return {
    title: wordChangeTitle(),
    summary: bounded(wordCommentChangesTitle(draft)),
    actions: [draft.action],
    decide_on_screen: wordCommentAlwaysBlock(draft, tainted) !== null,
  };
}

export function wordPlanApprovalPreview(
  plan: WordDocumentPlan,
  snapshot: WordAuthoringSnapshot,
  content: string,
  action: string,
): WordApprovalPreview {
  let summary = "";
  try {
    summary = wordPlanTitleText(buildWordPlanReview(plan, snapshot).title);
  } catch {
    summary = "";
  }
  const sections = wordPlanChangedSections(plan, snapshot);
  const routing = wordPlanRouting(plan, snapshot, content);
  return {
    title: wordChangeTitle(),
    summary: bounded(
      sections.length ? `${summary}: ${sections.join(", ")}` : summary,
    ),
    actions: [action],
    decide_on_screen:
      routing?.write.write === "confirm" ||
      !!routing?.comments?.removals.length,
  };
}
