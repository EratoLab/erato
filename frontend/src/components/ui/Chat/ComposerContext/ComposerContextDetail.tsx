import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/Controls/Button";
import {
  PopoverPanel,
  resolvePopoverViewportPadding,
} from "@/components/ui/Controls/PopoverPanel";
import { ModalBase } from "@/components/ui/Modal/ModalBase";
import { CloseIcon } from "@/components/ui/icons";
import { isImeComposing } from "@/utils/isImeComposing";

import {
  composerContextControl,
  composerContextMeta,
  composerContextSpokenLabel,
} from "./ComposerContextChip";
import {
  announceLocked,
  closeDetailLabel,
  includeLabel,
  leaveOutLabel,
  lockedPill,
  removeButtonLabel,
  statePill,
} from "./composerContextStrings";

import type { ComposerContextDetailAction, ComposerContextItem } from "./types";
import type { CSSProperties } from "react";

// eslint-disable-next-line lingui/no-unlocalized-strings -- CSS media query, not user-facing
const SHEET_MEDIA_QUERY = "(max-width: 479.98px)";

const subscribeToSheet = (onStoreChange: () => void) => {
  if (typeof window === "undefined") {
    return () => {};
  }
  const mql = window.matchMedia(SHEET_MEDIA_QUERY);
  mql.addEventListener("change", onStoreChange);
  return () => mql.removeEventListener("change", onStoreChange);
};

const getSheetSnapshot = () =>
  typeof window !== "undefined" && window.matchMedia(SHEET_MEDIA_QUERY).matches;

/** Below about 480px the detail is a sheet; wider, a popover at the chip. */
export const useComposerContextSheet = () =>
  useSyncExternalStore(subscribeToSheet, getSheetSnapshot, () => false);

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Keeps Tab inside the detail; ModalBase has no trap of its own. */
const trapTab = (event: KeyboardEvent, root: HTMLElement) => {
  if (event.key !== "Tab") {
    return;
  }
  const focusable = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)];
  if (focusable.length === 0) {
    event.preventDefault();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !root.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || !root.contains(active))) {
    event.preventDefault();
    first.focus();
  }
};

const POPOVER_GAP_PX = 8;
const POPOVER_MIN_ABOVE_PX = 220;

interface ComposerContextDetailProps {
  item: ComposerContextItem;
  /** The chip the popover anchors to. */
  anchor: HTMLElement | null;
  /** The chip's open button, which toggles rather than counting as outside. */
  trigger: HTMLElement | null;
  onClose: (options: { restoreFocus: boolean }) => void;
  onRemove: (item: ComposerContextItem) => void;
  onRestore: (item: ComposerContextItem) => void;
  /** Called before a host action runs, so the lane can wait for its outcome. */
  onAction?: (
    item: ComposerContextItem,
    action: ComposerContextDetailAction,
  ) => void;
}

const DetailHeaderMeta = ({ item }: { item: ComposerContextItem }) => {
  const meta = composerContextMeta(item);
  return (
    <p
      className="flex flex-wrap items-center gap-1 text-xs text-theme-fg-secondary"
      data-ui="composer-context-detail-meta"
    >
      <span
        data-ui="composer-context-detail-state"
        data-state={item.state}
        className="pill-geometry border border-theme-border px-1.5 py-px font-medium text-theme-fg-primary"
      >
        {statePill(item.state)}
      </span>
      {meta ? <span>{meta}</span> : null}
      {item.locked ? <span>{`· ${lockedPill()}`}</span> : null}
    </p>
  );
};

const DetailFooter = ({
  item,
  onRemove,
  onRestore,
  onAction,
}: {
  item: ComposerContextItem;
  onRemove: (item: ComposerContextItem) => void;
  onRestore: (item: ComposerContextItem) => void;
  onAction: (action: ComposerContextDetailAction) => void;
}) => {
  const control = composerContextControl(item);
  const actions = item.detail?.actions ?? [];
  if (actions.length === 0 && control === null) {
    return null;
  }
  // The lane locks an item that stands for staged files while the composer
  // is locked; a host choice on it would change those files all the same.
  const actionsLocked =
    Boolean(item.locked) && (item.claimsFileIds?.length ?? 0) > 0;
  // The lane's own lock carries no reason; say what Delete on the chip says.
  const lockTitle = item.locked
    ? (item.lockReason ?? announceLocked(composerContextSpokenLabel(item)))
    : undefined;
  return (
    <div
      className="flex flex-wrap items-center justify-end gap-2"
      data-ui="composer-context-detail-actions"
    >
      {actions.map((action) => (
        <Button
          key={action.id}
          size="sm"
          variant={action.variant === "primary" ? "primary" : "secondary"}
          disabled={actionsLocked}
          title={actionsLocked ? lockTitle : undefined}
          onClick={() => onAction(action)}
        >
          {action.label}
        </Button>
      ))}
      {control === "remove" ? (
        <Button
          size="sm"
          variant="secondary"
          disabled={item.locked}
          title={lockTitle}
          onClick={() => onRemove(item)}
        >
          {item.removeActionLabel ??
            (item.origin === "user" ? removeButtonLabel() : leaveOutLabel())}
        </Button>
      ) : null}
      {control === "restore" ? (
        <Button
          size="sm"
          variant="primary"
          disabled={item.locked}
          title={lockTitle}
          onClick={() => onRestore(item)}
        >
          {item.restoreLabel ?? includeLabel()}
        </Button>
      ) : null}
    </div>
  );
};

/**
 * A chip's detail: a sheet through ModalBase in a narrow pane, an anchored
 * popover beside the chip on the wide web app. Portalled, so it never opens
 * inside the composer's scroll cap.
 */
export const ComposerContextDetail = ({
  item,
  anchor,
  trigger,
  onClose,
  onRemove,
  onRestore,
  onAction,
}: ComposerContextDetailProps) => {
  const sheet = useComposerContextSheet();
  const detail = item.detail;
  const titleId = useId();
  const bodyRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Placed in a layout effect, before the first paint; a hidden first frame
  // would refuse the focus that moves in on open.
  const [position, setPosition] = useState<CSSProperties>({});

  const closeAndRefocus = useCallback(
    () => onClose({ restoreFocus: true }),
    [onClose],
  );
  const runAction = useCallback(
    (action: ComposerContextDetailAction) => {
      onAction?.(item, action);
      action.onSelect();
      onClose({ restoreFocus: true });
    },
    [item, onAction, onClose],
  );

  const dialogNode = useCallback(
    () =>
      sheet
        ? (bodyRef.current?.closest<HTMLElement>('[role="dialog"]') ?? null)
        : panelRef.current,
    [sheet],
  );

  // Focus moves in once per opening and per surface switch.
  useEffect(() => {
    const dialog = dialogNode();
    dialog?.querySelector<HTMLElement>("button")?.focus();
  }, [dialogNode, item.id]);

  useEffect(() => {
    const dialog = dialogNode();
    if (!dialog) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      trapTab(event, dialog);
      // The sheet's ModalBase closes on Escape itself.
      if (!sheet && event.key === "Escape" && !isImeComposing(event)) {
        event.preventDefault();
        event.stopPropagation();
        closeAndRefocus();
      }
    };
    dialog.addEventListener("keydown", onKeyDown);
    return () => dialog.removeEventListener("keydown", onKeyDown);
  }, [dialogNode, sheet, closeAndRefocus]);

  useEffect(() => {
    if (sheet) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (
        !target ||
        panelRef.current?.contains(target) ||
        trigger?.contains(target) ||
        // A dialog the detail opened over itself, e.g. a file preview.
        (target instanceof Element &&
          target.closest('[data-ui="modal-overlay"]'))
      ) {
        return;
      }
      onClose({ restoreFocus: false });
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", onPointerDown, true);
  }, [sheet, trigger, onClose]);

  const place = useCallback(() => {
    if (sheet || !anchor) {
      return;
    }
    const rect = anchor.getBoundingClientRect();
    const margin = resolvePopoverViewportPadding(
      "var(--theme-layout-dropdown-viewport-margin)",
      anchor,
    );
    const preferred = resolvePopoverViewportPadding(
      "var(--theme-layout-composer-context-detail-width)",
      anchor,
      384,
    );
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const width = Math.min(preferred, viewportWidth - margin * 2);
    const left = Math.max(
      margin,
      Math.min(rect.left, viewportWidth - width - margin),
    );
    const spaceAbove = rect.top - POPOVER_GAP_PX - margin;
    const spaceBelow = viewportHeight - rect.bottom - POPOVER_GAP_PX - margin;
    const above =
      spaceAbove >= POPOVER_MIN_ABOVE_PX || spaceAbove >= spaceBelow;
    setPosition(
      above
        ? {
            left,
            width,
            bottom: viewportHeight - rect.top + POPOVER_GAP_PX,
            maxHeight: Math.max(0, spaceAbove),
          }
        : {
            left,
            width,
            top: rect.bottom + POPOVER_GAP_PX,
            maxHeight: Math.max(0, spaceBelow),
          },
    );
  }, [sheet, anchor]);

  useLayoutEffect(() => {
    place();
  }, [place]);

  useEffect(() => {
    if (sheet) {
      return;
    }
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [sheet, place]);

  if (!detail) {
    return null;
  }

  const renderContext = { locked: Boolean(item.locked), runAction };
  const hasFooter =
    composerContextControl(item) !== null || (detail.actions?.length ?? 0) > 0;
  const footer = (
    <DetailFooter
      item={item}
      onRemove={onRemove}
      onRestore={onRestore}
      onAction={runAction}
    />
  );

  if (sheet) {
    return (
      <ModalBase
        isOpen
        onClose={closeAndRefocus}
        title={detail.title}
        placement="bottom"
        footer={hasFooter ? footer : undefined}
      >
        <div
          ref={bodyRef}
          data-ui="composer-context-detail"
          data-placement="sheet"
          className="flex flex-col gap-3"
        >
          <DetailHeaderMeta item={item} />
          <div className="text-sm text-theme-fg-primary">
            {detail.render(renderContext)}
          </div>
        </div>
      </ModalBase>
    );
  }

  return createPortal(
    <PopoverPanel
      ref={panelRef}
      positioned="fixed"
      width="content"
      dataUi="composer-context-detail"
      data-placement="popover"
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      className="z-50 flex flex-col overflow-hidden"
      style={position}
    >
      <div className="flex shrink-0 items-start gap-2 border-b border-theme-border px-3.5 pb-2.5 pt-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2
            id={titleId}
            className="break-words text-[0.9375rem] font-semibold leading-snug text-theme-fg-primary"
          >
            {detail.title}
          </h2>
          <DetailHeaderMeta item={item} />
        </div>
        <Button
          variant="icon-only"
          size="sm"
          onClick={closeAndRefocus}
          aria-label={closeDetailLabel()}
          icon={<CloseIcon className="size-4" />}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3.5 py-3 text-sm text-theme-fg-primary">
        {detail.render(renderContext)}
      </div>
      {hasFooter ? (
        <div className="shrink-0 border-t border-theme-border px-3.5 py-2.5">
          {footer}
        </div>
      ) : null}
    </PopoverPanel>,
    document.body,
  );
};
