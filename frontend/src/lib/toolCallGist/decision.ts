import { changeLayout, listReplaceIsUnknown } from "./change";

import type { GistChange } from "./change";
import type { ToolCallCard } from "./gist";
import type { ToolCallChangeNote } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

/**
 * How Allow once looks: filled only when the card states nothing to check,
 * plain when it does, outlined red when it states a loss. Read only from what
 * code found in the call, never from a model's mapping, and it changes no
 * button's behaviour.
 */
export type AllowOnceEmphasis = "filled" | "plain" | "loss";

/** Words found in a statement that remove what is there. */
const LOSS_WORDS = new Set([
  "delete",
  // eslint-disable-next-line lingui/no-unlocalized-strings -- a word the backend reports
  "-delete",
  "drop",
  "truncate",
  "rm",
  "mkfs",
  "remove",
]);

/* eslint-disable lingui/no-unlocalized-strings -- API enum values */
/** Notes the rules give a delete only. */
const DELETE_NOTES: readonly ToolCallChangeNote[] = [
  "delete_outcome_unknown",
  "tool_says_permanent",
  "tool_says_restorable",
];
/** Notes that say the card cannot tell what the call does. */
const UNKNOWN_NOTES: readonly ToolCallChangeNote[] = [
  "row_count_unknown",
  "instruction_outcome_unknown",
  "list_replace_unknown",
];
/* eslint-enable lingui/no-unlocalized-strings */

/** Whether the change states that something is lost. */
export const changeStatesLoss = (change: GistChange): boolean => {
  const layout = changeLayout(change);
  const batch = change.batch;
  return (
    change.counts.emptied > 0 ||
    layout.emptied.length > 0 ||
    change.counts.listRemoved > 0 ||
    (!listReplaceIsUnknown(change) &&
      layout.lists.some((effect) => effect.removed.length > 0)) ||
    (batch !== undefined &&
      (batch.deletions > 0 ||
        batch.rowsEmptying > 0 ||
        batch.rowsRemovingFromLists > 0)) ||
    change.opaque.some((opaque) =>
      opaque.found.some((word) => LOSS_WORDS.has(word.toLowerCase())),
    ) ||
    change.notes.some((note) => DELETE_NOTES.includes(note))
  );
};

/**
 * Whether the change asks the person to check something: a risk line, a
 * record nobody read, an outcome nobody knows, or a hand-off.
 */
export const changeAsksToCheck = (change: GistChange): boolean => {
  const { recipients } = change;
  return (
    !change.complete ||
    change.recordUnread ||
    change.hiddenCharacters ||
    change.consentLeftOut ||
    change.counts.unreadable > 0 ||
    (recipients !== undefined &&
      recipients.total > 0 &&
      (!recipients.outsideKnown ||
        recipients.outside.length > 0 ||
        recipients.outsideOmitted > 0 ||
        recipients.unchecked > 0)) ||
    change.filter?.everyRecord === true ||
    change.opaque.some(
      (opaque) =>
        opaque.found.length > 0 ||
        opaque.writeInsideRead ||
        opaque.kind === "instruction",
    ) ||
    (change.batch?.rowsReplacingLists ?? 0) > 0 ||
    change.notes.some((note) => UNKNOWN_NOTES.includes(note))
  );
};

const emphasisOfChange = (
  change: GistChange | undefined,
  loses: boolean,
  asks: boolean,
): AllowOnceEmphasis => {
  if (loses || (change !== undefined && changeStatesLoss(change))) {
    return "loss";
  }
  if (asks || (change !== undefined && changeAsksToCheck(change))) {
    return "plain";
  }
  return "filled";
};

/** How Allow once looks for the card a call gets. */
export const allowOnceEmphasisOf = (card: ToolCallCard): AllowOnceEmphasis => {
  try {
    switch (card.kind) {
      case "legacy":
        return "filled";
      case "generic":
        return emphasisOfChange(
          card.change,
          false,
          card.truncated ||
            card.notes.hiddenCharacters ||
            card.notes.leavesOutConsent,
        );
      case "gist": {
        const { gist } = card;
        const deletes = gist.action === "delete" || gist.action === "archive";
        // A model's mapping picks the verb: only what code found says loss,
        // and a delete it guessed is still something to check.
        const fromModel = gist.source === "model";
        return emphasisOfChange(
          gist.change,
          deletes && !fromModel,
          (deletes && fromModel) ||
            gist.warnings.length > 0 ||
            card.notes.hiddenCharacters ||
            card.notes.leavesOutConsent ||
            (card.rest.kind === "view" && card.rest.truncated),
        );
      }
    }
  } catch {
    return "plain";
  }
};

export interface ToolMarks {
  /** The tool's own annotation calls it destructive. */
  toolMarked: boolean;
  /** The operator marked the tool as destructive. */
  orgMarked: boolean;
}

/** What the change says about the tool itself, for the decision area. */
export const toolMarksOf = (card: ToolCallCard): ToolMarks => {
  const change =
    card.kind === "gist"
      ? card.gist.change
      : card.kind === "generic"
        ? card.change
        : undefined;
  const notes = change?.notes ?? [];
  return {
    // eslint-disable-next-line lingui/no-unlocalized-strings -- API enum value
    toolMarked: notes.includes("marked_destructive"),
    // eslint-disable-next-line lingui/no-unlocalized-strings -- API enum value
    orgMarked: notes.includes("operator_marked_destructive"),
  };
};
