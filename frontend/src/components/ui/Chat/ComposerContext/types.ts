import type { ReactNode } from "react";

/**
 * Where a context item stands against the next send. Hosts derive it from the
 * same resolver that builds the send, so a chip never says "included" when
 * nothing goes out.
 */
export type ComposerContextState =
  | "included"
  | "suggested"
  | "superseded"
  | "loading"
  | "error"
  | "attention";

export type ComposerContextTone = "neutral" | "warning" | "error";

/** How long an ambient item stays off after its (x). */
export type ComposerContextDismissScope =
  | "message"
  | "selection"
  | "item"
  | "chat";

/** Semantic glyph keys the host draws; any other string falls back to a page. */
export type ComposerContextIconName =
  | "document"
  | "selection"
  | "comment"
  | "comments"
  | "mail"
  | "draft"
  | "calendar"
  | "attachment"
  | "chats"
  | "file";

export interface ComposerContextDetailAction {
  id: string;
  label: string;
  onSelect: () => void;
  variant?: "primary" | "secondary";
}

export interface ComposerContextDetail {
  title: string;
  render: () => ReactNode;
  /** Host choices drawn in the footer, before the default include/leave-out action. */
  actions?: ComposerContextDetailAction[];
}

interface ComposerContextItemBase {
  id: string;
  /** Namespaced by host, e.g. "word.document", "outlook.thread". */
  kind: string;
  state: ComposerContextState;
  label: string;
  /** State and scope, e.g. "3 of 5 messages" or "Off for this message". */
  meta?: string;
  icon: ComposerContextIconName | (string & {});
  tone?: ComposerContextTone;
  /** Counts toward the token estimate while the item is included. */
  estimate?: File;
  /** Disables (x)/(+) only; the detail stays openable. */
  locked?: boolean;
  /** Ambient: back to suggested. User: removed. */
  onRemove?: () => void;
  /** Required while the item is suggested; without it the chip has no (+). */
  onRestore?: () => void;
  detail?: ComposerContextDetail;
  /** Why the item is locked: the disabled control's title, and what Delete announces. */
  lockReason?: string;
  /** Names the (x) and the detail's leave-out button, e.g. "Don't include this document". */
  removeLabel?: string;
  /** Names the (+) and the detail's include button, e.g. "Use this selection". */
  restoreLabel?: string;
  /** Replace the default outcome announcements. */
  announcements?: { removed?: string; restored?: string };
}

export type ComposerContextItem =
  | (ComposerContextItemBase & {
      origin: "ambient";
      dismissScope: ComposerContextDismissScope;
      /** Hidden from the file row; an ambient (x) never removes them. */
      claimsFileIds?: string[];
    })
  | (ComposerContextItemBase & {
      origin: "user";
      dismissScope?: never;
      /** Hidden from the file row and removed with the item. */
      claimsFileIds?: string[];
    });

/**
 * What a component kit's chip face receives. The face draws the chip's
 * content only: the host keeps the list, roving focus, the (x)/(+), the detail
 * and the announcements, and renders the face inside the chip's open button,
 * so it must not contain anything focusable or clickable of its own.
 */
export interface ComposerContextChipFaceProps {
  item: ComposerContextItem;
  /** Resolved from the item's tone, or from its state when it has none. */
  tone: ComposerContextTone;
  /** The host glyph for the item's icon and state, already hidden from screen readers. */
  icon: ReactNode;
  /** The item's meta, or the dismissal lifetime of a suggested ambient item without one. */
  meta?: string;
}

/** A one-off send prompt drawn above the lane, never a chip. */
export interface ComposerNotice {
  id: string;
  tone: "info" | "warning" | "error";
  text: string;
  /** Draws a spinner in place of the tone glyph. */
  busy?: boolean;
  actions?: { id: string; label: string; onSelect: () => void }[];
  onDismiss?: () => void;
}
