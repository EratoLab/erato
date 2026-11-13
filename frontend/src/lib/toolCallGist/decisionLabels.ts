import { select, t } from "@lingui/core/macro";

import { changeNoteLabel } from "./changeLabels";

import type { ToolMarks } from "./decision";

/**
 * The words of a tool approval's decision area. Kept under `lib/` so the
 * component registry does not put them on the kit surface.
 */

/** The question, naming where the action runs; the verb is the headline's. */
export const toolQuestion = (server: string | undefined): string => {
  const name = server?.trim() ?? "";
  const placed = name.length > 0 ? "placed" : "other";
  return t({
    id: "mcpApproval.question",
    message: select(placed, {
      placed: `Run this action in ${name}?`,
      other: "Run this action?",
    }),
  });
};

export const toolDenyLabel = (): string =>
  t({ id: "mcpApproval.deny", message: "Deny" });

/** Before the standing answers, which cover the tool and not just this call. */
export const thisToolLabel = (): string =>
  t({ id: "mcpApproval.thisTool", message: "This tool:" });

export const alwaysAllowLockedLine = (): string =>
  t({
    id: "mcpApproval.alwaysAllowDisabled",
    message:
      "Locked: your organization requires confirmation each time this tool runs.",
  });

const openWorldLine = (): string =>
  t({
    id: "mcpApproval.openWorldWarning",
    message: "This tool may send data to an external service.",
  });

/**
 * The one quiet line of facts about the tool under the buttons: who marked
 * it destructive, the lock that greys out Always allow, and that it may send
 * data out. The organisation's mark and its lock read as one sentence.
 */
export const toolFactsLine = ({
  toolMarked,
  orgMarked,
  locked,
  openWorld,
}: ToolMarks & { locked: boolean; openWorld: boolean }): string | undefined => {
  const sentences: string[] = [];
  if (orgMarked && locked) {
    sentences.push(
      t({
        id: "mcpApproval.facts.orgMarkedLocked",
        message:
          "Your organisation has marked this tool as destructive and requires confirmation each time it runs.",
      }),
    );
  } else {
    if (orgMarked) {
      // eslint-disable-next-line lingui/no-unlocalized-strings -- API enum value
      sentences.push(changeNoteLabel("operator_marked_destructive"));
    } else if (toolMarked) {
      // eslint-disable-next-line lingui/no-unlocalized-strings -- API enum value
      sentences.push(changeNoteLabel("marked_destructive"));
    }
    if (locked) sentences.push(alwaysAllowLockedLine());
  }
  if (openWorld) sentences.push(openWorldLine());
  return sentences.length > 0 ? sentences.join(" ") : undefined;
};
