import clsx from "clsx";

import { CloseIcon, LockIcon, PlusIcon } from "@/components/ui/icons";

import {
  ComposerContextGlyph,
  resolveComposerContextTone,
} from "./composerContextIcons";
import {
  dismissScopeMeta,
  lockedWord,
  removeLabelFor,
  restoreLabelFor,
  stateWord,
} from "./composerContextStrings";

import type {
  ComposerContextChipFaceProps,
  ComposerContextItem,
} from "./types";
import type {
  ComponentType,
  KeyboardEvent as ReactKeyboardEvent,
  Ref,
} from "react";

export type ComposerContextControl = "remove" | "restore" | null;

/** At the chip's 13px label size, 13 characters ("This document") are about 7em wide. */
const SHORT_LABEL_CODE_POINTS = 13;

/**
 * Which control a chip draws, from its state alone: a suggested item offers
 * (+), every other state offers (x), and an item without the matching handler
 * offers nothing.
 */
export const composerContextControl = (
  item: ComposerContextItem,
): ComposerContextControl => {
  if (item.state === "suggested") {
    return item.onRestore ? "restore" : null;
  }
  return item.onRemove ? "remove" : null;
};

/** The meta a chip shows: a suggested ambient item always states its lifetime. */
export const composerContextMeta = (
  item: ComposerContextItem,
): string | undefined =>
  item.meta ??
  (item.state === "suggested" && item.origin === "ambient"
    ? dismissScopeMeta(item.dismissScope)
    : undefined);

/** What announcements and default control names call the item. */
export const composerContextSpokenLabel = (item: ComposerContextItem) =>
  item.spokenLabel ?? item.label;

export const composerContextControlLabel = (
  item: ComposerContextItem,
  control: Exclude<ComposerContextControl, null>,
) =>
  control === "remove"
    ? (item.removeLabel ?? removeLabelFor(composerContextSpokenLabel(item)))
    : (item.restoreLabel ?? restoreLabelFor(composerContextSpokenLabel(item)));

/** The host's own face: glyph, label, meta and a lock mark. Kits may wrap it. */
export const DefaultComposerContextChipFace = ({
  item,
  icon,
  meta,
}: ComposerContextChipFaceProps) => (
  <span
    data-ui="composer-context-chip-face"
    className="flex min-w-0 flex-1 items-center gap-1.5"
  >
    <span
      data-ui="composer-context-chip-icon"
      className="inline-flex size-4 shrink-0 items-center justify-center"
    >
      {icon}
    </span>
    <span
      data-ui="composer-context-chip-label"
      className={clsx(
        "shrink-[2] truncate text-[0.8125rem] leading-4",
        // A label narrower than the 7em floor would be padded out to it,
        // leaving a gap before the meta; it keeps its own width instead.
        meta &&
          ([...item.label].length <= SHORT_LABEL_CODE_POINTS
            ? "shrink-0"
            : "min-w-[7em]"),
      )}
    >
      {item.label}
    </span>
    {meta ? (
      <>
        <span aria-hidden="true" data-ui="composer-context-chip-separator">
          ·
        </span>
        <span
          data-ui="composer-context-chip-meta"
          className="min-w-[6em] shrink truncate text-xs leading-4"
        >
          {meta}
        </span>
      </>
    ) : null}
    {item.locked ? (
      <span
        aria-hidden="true"
        data-ui="composer-context-chip-lock"
        className="inline-flex shrink-0"
      >
        <LockIcon className="size-3.5" />
      </span>
    ) : null}
  </span>
);

interface ComposerContextChipProps {
  item: ComposerContextItem;
  face: ComponentType<ComposerContextChipFaceProps>;
  tabIndex: 0 | -1;
  openRef: Ref<HTMLButtonElement>;
  isDetailOpen: boolean;
  onOpen: (item: ComposerContextItem) => void;
  onRemove: (item: ComposerContextItem) => void;
  onRestore: (item: ComposerContextItem) => void;
  onFocus: (id: string) => void;
  onKeyDown: (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    item: ComposerContextItem,
  ) => void;
}

export const ComposerContextChip = ({
  item,
  face: Face,
  tabIndex,
  openRef,
  isDetailOpen,
  onOpen,
  onRemove,
  onRestore,
  onFocus,
  onKeyDown,
}: ComposerContextChipProps) => {
  const tone = resolveComposerContextTone(item.state, item.tone);
  const meta = composerContextMeta(item);
  const control = composerContextControl(item);
  const controlLabel = control
    ? composerContextControlLabel(item, control)
    : "";

  return (
    <div
      role="listitem"
      data-ui="composer-context-chip"
      data-kind={item.kind}
      data-state={item.state}
      data-tone={tone}
      data-origin={item.origin}
      data-locked={item.locked ? "true" : undefined}
      data-has-detail={item.detail ? "true" : undefined}
      className="composer-context-chip-geometry composer-context-chip-skin flex min-w-0 max-w-full items-center"
    >
      <button
        ref={openRef}
        type="button"
        data-ui="composer-context-chip-open"
        tabIndex={tabIndex}
        aria-haspopup={item.detail ? "dialog" : undefined}
        aria-expanded={item.detail ? isDetailOpen : undefined}
        title={[item.label, meta].filter(Boolean).join(" · ")}
        onClick={() => onOpen(item)}
        onFocus={() => onFocus(item.id)}
        onKeyDown={(event) => onKeyDown(event, item)}
        className={clsx(
          "flex h-full min-w-0 flex-1 items-center pl-2 text-left focus:outline-none",
          control ? "pr-0.5" : "pr-2",
          !item.detail && "cursor-default",
        )}
      >
        <Face
          item={item}
          tone={tone}
          meta={meta}
          icon={
            <ComposerContextGlyph
              icon={item.icon}
              state={item.state}
              tone={tone}
            />
          }
        />
        <span className="sr-only" data-ui="composer-context-chip-state">
          {` ${stateWord(item.state)}${item.locked ? ` ${lockedWord()}` : ""}`}
        </span>
      </button>
      {control ? (
        <button
          key={control}
          type="button"
          tabIndex={-1}
          data-ui={
            control === "remove"
              ? "composer-context-remove"
              : "composer-context-restore"
          }
          aria-label={controlLabel}
          title={
            item.locked && item.lockReason ? item.lockReason : controlLabel
          }
          disabled={item.locked}
          onClick={() =>
            control === "remove" ? onRemove(item) : onRestore(item)
          }
          className={clsx(
            "composer-context-control-geometry mr-1 inline-flex shrink-0 items-center justify-center",
            "text-theme-fg-muted hover:bg-theme-bg-hover hover:text-theme-fg-primary",
            "focus-ring-inset disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent",
          )}
        >
          <span aria-hidden="true" className="inline-flex">
            {control === "remove" ? (
              <CloseIcon className="size-3.5" />
            ) : (
              <PlusIcon className="size-3.5" />
            )}
          </span>
        </button>
      ) : null}
    </div>
  );
};
