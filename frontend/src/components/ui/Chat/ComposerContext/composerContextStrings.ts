import { plural, t } from "@lingui/core/macro";

import type {
  ComposerContextDismissScope,
  ComposerContextState,
} from "./types";

export const laneLabel = () =>
  t({ id: "composer.context.lane.label", message: "Message context" });

/** Read after the chip's name, so each ends a sentence. */
export const stateWord = (state: ComposerContextState): string => {
  switch (state) {
    case "suggested":
      return t({
        id: "composer.context.state.suggested",
        message: "Not included.",
      });
    case "superseded":
      return t({
        id: "composer.context.state.superseded",
        message: "Not sent.",
      });
    case "loading":
      return t({ id: "composer.context.state.loading", message: "Loading." });
    case "error":
      return t({ id: "composer.context.state.error", message: "Error." });
    case "attention":
      return t({
        id: "composer.context.state.attention",
        message: "Needs your choice.",
      });
    default:
      return t({ id: "composer.context.state.included", message: "Included." });
  }
};

export const lockedWord = () =>
  t({ id: "composer.context.state.locked", message: "Locked." });

/** The detail's state pill. */
export const statePill = (state: ComposerContextState): string => {
  switch (state) {
    case "suggested":
      return t({ id: "composer.context.pill.suggested", message: "Suggested" });
    case "superseded":
      return t({ id: "composer.context.pill.superseded", message: "Not sent" });
    case "loading":
      return t({ id: "composer.context.pill.loading", message: "Loading" });
    case "error":
      return t({ id: "composer.context.pill.error", message: "Error" });
    case "attention":
      return t({
        id: "composer.context.pill.attention",
        message: "Needs a choice",
      });
    default:
      return t({ id: "composer.context.pill.included", message: "Included" });
  }
};

export const lockedPill = () =>
  t({ id: "composer.context.pill.locked", message: "Locked" });

export const removeLabelFor = (label: string) =>
  t({ id: "composer.context.remove", message: `Remove ${label}` });

export const restoreLabelFor = (label: string) =>
  t({ id: "composer.context.restore", message: `Include ${label}` });

export const leaveOutLabel = () =>
  t({ id: "composer.context.detail.leaveOut", message: "Leave out" });

export const includeLabel = () =>
  t({ id: "composer.context.detail.include", message: "Include" });

export const removeButtonLabel = () =>
  t({ id: "common.remove", message: "Remove" });

export const closeDetailLabel = () =>
  t({ id: "composer.context.detail.close", message: "Close details" });

export const announceRemovedAmbient = (label: string) =>
  t({
    id: "composer.context.announce.removedAmbient",
    message: `${label} removed. Include again with +`,
  });

export const announceRemoved = (label: string) =>
  t({ id: "composer.context.announce.removed", message: `${label} removed.` });

export const announceRestored = (label: string) =>
  t({
    id: "composer.context.announce.restored",
    message: `${label} included.`,
  });

export const announceNotIncluded = (label: string) =>
  t({
    id: "composer.context.announce.notIncluded",
    message: `${label} is not included. Press + to include it.`,
  });

export const announceCannotRemove = (label: string) =>
  t({
    id: "composer.context.announce.cannotRemove",
    message: `${label} can't be removed.`,
  });

export const announceLocked = (label: string) =>
  t({ id: "composer.context.announce.locked", message: `${label} is locked.` });

export const announceOutcome = (label: string, meta: string) =>
  t({ id: "composer.context.announce.outcome", message: `${label}: ${meta}` });

export const announceExpanded = () =>
  t({
    id: "composer.context.announce.expanded",
    message: "Showing every item.",
  });

export const moreChipText = (count: number) =>
  t({
    id: "composer.context.more",
    message: plural(count, { other: "+# more" }),
  });

export const moreChipLabel = (count: number) =>
  t({
    id: "chat.attachments.show_more.count",
    message: plural(count, {
      one: "Show # more item",
      other: "Show # more items",
    }),
  });

export const lessChipLabel = () =>
  t({ id: "chat.attachments.show_less", message: "Show less" });

/** The lifetime a suggested ambient chip states when the host gives no meta. */
export const dismissScopeMeta = (
  scope: ComposerContextDismissScope,
): string => {
  switch (scope) {
    case "message":
      return t({
        id: "composer.context.scope.message",
        message: "Off for this message",
      });
    case "selection":
      return t({
        id: "composer.context.scope.selection",
        message: "Off until the selection changes",
      });
    case "item":
      return t({
        id: "composer.context.scope.item",
        message: "Off until you switch items",
      });
    default:
      return t({
        id: "composer.context.scope.chat",
        message: "Off in this chat",
      });
  }
};
