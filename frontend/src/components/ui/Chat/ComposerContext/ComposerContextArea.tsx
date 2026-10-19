import clsx from "clsx";
import { useLayoutEffect, useRef, useState } from "react";

import { ComposerContextLane } from "./ComposerContextLane";
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
}: ComposerContextAreaProps) => {
  const [announcement, announce] = useLiveAnnouncement();
  const areaRef = useRef<HTMLDivElement>(null);
  const filesRef = useRef<HTMLDivElement>(null);
  const [budget, setBudget] = useState<number | undefined>(undefined);
  const empty = items.length === 0 && !hasFiles;

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
      const inner =
        cap - (px(style.paddingTop) ?? 0) - (px(style.paddingBottom) ?? 0);
      const filesHeight = filesNode.getBoundingClientRect().height;
      let reserve = 0;
      if (filesHeight > 0) {
        // Chips fold before the first file row leaves the view. The pinned
        // "Remove all" would otherwise sit over that row, so it is reserved
        // too; a kit's files slot has no tile to measure and counts whole.
        const firstTile = filesNode.querySelector<HTMLElement>(
          '[data-ui="attachment-tile"]',
        );
        const bulk = filesNode.querySelector<HTMLElement>(
          '[data-ui="attachment-bulk-controls"]',
        );
        const row = firstTile?.getBoundingClientRect().height ?? filesHeight;
        const pinned = bulk ? bulk.getBoundingClientRect().height : 0;
        const gap = px(style.rowGap) ?? 0;
        reserve =
          Math.min(filesHeight, row + (pinned > 0 ? pinned + gap : 0)) + gap;
      }
      const next = Math.max(0, Math.round(inner - reserve));
      setBudget((current) => (current === next ? current : next));
    };
    read();
    const observer = new ResizeObserver(read);
    observer.observe(area);
    observer.observe(filesNode);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <div
        ref={areaRef}
        data-ui="composer-staged-area"
        // The overhang pays for focus rings and corner controls in padding and
        // takes it back in margin; overflow-y-auto would clip them otherwise.
        className={clsx(
          "-mr-1 -mt-1 flex-col gap-2 overflow-y-auto overflow-x-hidden pr-1 pt-1",
          empty ? "hidden" : "flex",
        )}
        style={{
          maxHeight: "var(--theme-layout-attachment-tile-staged-max-height)",
        }}
      >
        <ComposerContextLane
          items={items}
          budget={budget}
          announce={announce}
          onFocusComposer={onFocusComposer}
          onRemoveClaimedFiles={onRemoveClaimedFiles}
          chipFace={chipFace}
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
