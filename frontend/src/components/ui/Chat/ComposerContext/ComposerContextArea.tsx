import clsx from "clsx";
import { useCallback, useLayoutEffect, useRef, useState } from "react";

import { ComposerContextLane } from "./ComposerContextLane";
import { chipBudgetInStagedArea } from "./composerContextLayout";
import { useLiveAnnouncement } from "./useLiveAnnouncement";

import type {
  ComposerContextChipFaceProps,
  ComposerContextItem,
} from "./types";
import type { ComponentType, ReactNode } from "react";

export interface ComposerContextAreaProps {
  items: ComposerContextItem[];
  /** The staged-files slot, rendered after the chips in the same capped area. */
  files: ReactNode;
  /** Whether the slot has files to draw; with no chips either, the area takes no space. */
  hasFiles: boolean;
  onFocusComposer?: () => void;
  onRemoveClaimedFiles?: (fileIds: string[]) => void;
  /** Wins over `componentRegistry.ComposerContextChipFace`. */
  chipFace?: ComponentType<ComposerContextChipFaceProps>;
  /** Names the chip list; defaults to "Message context". */
  label?: string;
}

const px = (value: string) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * Chips and staged files under one height cap and one scroll container, with
 * the lane's live region outside it so an announcement outlives the last chip.
 * Stays mounted while the host passes items, even none, so the files slot
 * never remounts when the first chip arrives.
 */
export const ComposerContextArea = ({
  items,
  files,
  hasFiles,
  onFocusComposer,
  onRemoveClaimedFiles,
  chipFace,
  label,
}: ComposerContextAreaProps) => {
  const [announcement, announce] = useLiveAnnouncement();
  const areaRef = useRef<HTMLDivElement>(null);
  const filesRef = useRef<HTMLDivElement>(null);
  const [budget, setBudget] = useState<number | undefined>(undefined);
  const [overflowBelow, setOverflowBelow] = useState(false);
  const empty = items.length === 0 && !hasFiles;

  // Marks content past the fold, so the tile the cap cuts fades into the
  // pinned "Remove all" row instead of reading as a rendering glitch.
  const readOverflow = useCallback(() => {
    const area = areaRef.current;
    if (!area) {
      return;
    }
    const next = area.scrollTop + area.clientHeight < area.scrollHeight - 1;
    setOverflowBelow((current) => (current === next ? current : next));
  }, []);

  useLayoutEffect(readOverflow);

  useLayoutEffect(() => {
    const area = areaRef.current;
    const filesNode = filesRef.current;
    if (!area || !filesNode) {
      return;
    }
    const read = () => {
      const style = window.getComputedStyle(area);
      const cap = px(style.maxHeight);
      if (cap === null) {
        setBudget(undefined);
        return;
      }
      const firstTile = filesNode.querySelector<HTMLElement>(
        '[data-ui="attachment-tile"]',
      );
      const bulk = filesNode.querySelector<HTMLElement>(
        '[data-ui="attachment-bulk-controls"]',
      );
      const next = chipBudgetInStagedArea({
        inner:
          cap - (px(style.paddingTop) ?? 0) - (px(style.paddingBottom) ?? 0),
        gap: px(style.rowGap) ?? 0,
        filesHeight: filesNode.getBoundingClientRect().height,
        firstTileHeight: firstTile
          ? firstTile.getBoundingClientRect().height
          : null,
        pinnedHeight: bulk ? bulk.getBoundingClientRect().height : 0,
      });
      setBudget((current) => (current === next ? current : next));
      readOverflow();
    };
    read();
    const observer = new ResizeObserver(read);
    observer.observe(area);
    observer.observe(filesNode);
    return () => observer.disconnect();
  }, [readOverflow]);

  return (
    <>
      <div
        ref={areaRef}
        data-ui="composer-staged-area"
        data-overflow-below={overflowBelow ? "true" : undefined}
        onScroll={readOverflow}
        // The overhang pays for focus rings and corner controls in padding and
        // takes it back in margin; overflow-y-auto would clip them otherwise.
        // A file tile's ring sits outside its frame, so the left needs it too.
        className={clsx(
          "-mx-1 -mt-1 flex-col gap-2 overflow-y-auto overflow-x-hidden px-1 pt-1",
          empty ? "hidden" : "flex",
        )}
        style={{
          // Chips are tiles too, so the area makes room for them; files alone
          // keep the web composer's cap.
          maxHeight:
            items.length > 0
              ? "var(--theme-layout-composer-context-area-max-height)"
              : "var(--theme-layout-attachment-tile-staged-max-height)",
        }}
      >
        <ComposerContextLane
          items={items}
          budget={budget}
          announce={announce}
          onFocusComposer={onFocusComposer}
          onRemoveClaimedFiles={onRemoveClaimedFiles}
          chipFace={chipFace}
          label={label}
        />
        <div
          ref={filesRef}
          data-ui="composer-staged-files"
          className="empty:hidden"
        >
          {files}
        </div>
      </div>
      <div
        className="sr-only"
        aria-live="polite"
        aria-atomic="true"
        data-ui="composer-context-live"
      >
        {announcement}
      </div>
    </>
  );
};
