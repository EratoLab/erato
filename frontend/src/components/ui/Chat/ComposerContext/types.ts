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
  | "file"
  | "clock";

export interface ComposerContextDetailAction {
  id: string;
  label: string;
  onSelect: () => void;
  variant?: "primary" | "secondary";
  /**
   * Spoken once the item's state changes after the action, e.g. "Document
   * included. Your selection is off until it changes." An item that lands in
   * an error or a choice says where it landed instead.
   */
  announcement?: string;
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
  /**
   * What announcements and default control names call the item when the
   * label is a quote or a long subject, e.g. "Selection" or "Email thread".
   */
  spokenLabel?: string;
  /** State and scope, e.g. "3 of 5 messages" or "Off for this message". */
  meta?: string;
  icon: ComposerContextIconName | (string & {});
  tone?: ComposerContextTone;
  /**
   * Which glyph a warning or error tone draws: the item's own icon (default),
   * or the tone's mark, for a fact that changes what is sent, e.g. a passage
   * cut to its beginning.
   */
  toneIcon?: "item" | "tone";
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
  /** Names the (x), e.g. "Don't include this document". */
  removeLabel?: string;
  /** The detail's remove button; defaults to "Leave out" (ambient) or "Remove" (user). */
  removeActionLabel?: string;
  /** Names the (+) and the detail's include button, e.g. "Use this selection". */
  restoreLabel?: string;
  /** Replace the default outcome announcements. */
  announcements?: { removed?: string; restored?: string };
}

export type ComposerContextItem =
  | (ComposerContextItemBase & {
      origin: "ambient";
      dismissScope: ComposerContextDismissScope;
      /**
       * Hidden from the file row while the item is included or loading, and
       * shown there again in any other state, because staged files still
       * send. An ambient (x) never removes them: the host unstages them in
       * `onRemove` and stages them again in `onRestore`.
       */
      claimsFileIds?: string[];
    })
  | (ComposerContextItemBase & {
      origin: "user";
      dismissScope?: never;
      /**
       * Hidden from the file row while the item is included or loading, and
       * unstaged once the host drops the item after its (x).
       */
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

/**
 * A mode the next send runs in, drawn in the controls row next to "+": not
 * content, and never in the lane. The host's resolver decides when it shows.
 */
export interface ComposerMode {
  /** Namespaced by host, e.g. "outlook.scheduling". */
  id: string;
  label: string;
  icon: ComposerContextIconName | (string & {});
  /** Why it is on and until when: the chip's title and its end button's description. */
  description?: string;
  /** Names the end button, e.g. "End scheduling". */
  endLabel: string;
  onEnd: () => void;
  /** Spoken once the mode has ended, e.g. "Scheduling ended. Your draft is sent again." */
  endedAnnouncement?: string;
  /** Disables the end button; the reason becomes its title. */
  locked?: boolean;
  lockReason?: string;
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
