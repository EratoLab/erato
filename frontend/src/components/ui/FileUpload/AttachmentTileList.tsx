import { t } from "@lingui/core/macro";
import clsx from "clsx";

import { AttachmentTile, type AttachmentTileSize } from "./AttachmentTile";
import { getFileName, getFileType } from "./FilePreviewBase";
import { Button } from "../Controls/Button";

import type { FileResource } from "./FilePreviewBase";
import type React from "react";

export interface AttachmentTileItem {
  id: string;
  file: FileResource;
  previewUrl?: string | null;
  labelOverride?: string;
}

/** Mirrors the tile's own media test, so banding matches what each tile draws. */
const isMediaItem = (item: AttachmentTileItem) =>
  Boolean(item.previewUrl) && getFileType(getFileName(item.file)) === "image";

export interface AttachmentTileListProps {
  items: AttachmentTileItem[];
  size?: AttachmentTileSize;
  onRemove?: (id: string) => void;
  onRemoveAll?: () => void;
  onActivate?: (item: AttachmentTileItem) => void;
  showCaptions?: boolean;
  disabled?: boolean;
  /**
   * Below this count the tiles speak for themselves, so the bulk control stays
   * out of the way. Only meaningful together with `onRemoveAll`.
   */
  removeAllThreshold?: number;
  /**
   * Caps the tile area and scrolls past it. Staging needs this — hosts raise
   * the file limit well beyond the web default (the Outlook pane allows 50),
   * and an uncapped list pushes the composer off screen. A sent message is
   * deliberately left uncapped: a scroll area nested inside the transcript is
   * worse than a tall message.
   */
  capHeight?: boolean;
  /** Shows the staged count against the host's limit, e.g. "3/50". */
  maxFiles?: number;
  className?: string;
}

export const AttachmentTileList: React.FC<AttachmentTileListProps> = ({
  items,
  size = "compact",
  onRemove,
  onRemoveAll,
  onActivate,
  showCaptions = false,
  disabled = false,
  removeAllThreshold = 3,
  capHeight = false,
  maxFiles,
  className,
}) => {
  if (items.length === 0) {
    return null;
  }

  const showRemoveAll =
    Boolean(onRemoveAll) && items.length >= removeAllThreshold;
  const count = items.length;
  const countLabel = maxFiles
    ? `${count}/${maxFiles}`
    : count === 1
      ? t`1 file`
      : t`${count} files`;

  // Thumbnails and pills have different heights, so interleaving them leaves
  // ragged holes wherever the wrap breaks. Banding by kind keeps each row one
  // height and lets several thumbnails share a line in a narrow pane.
  const media = items.filter(isMediaItem);
  const documents = items.filter((item) => !isMediaItem(item));

  const renderTile = (item: AttachmentTileItem) => (
    <AttachmentTile
      key={item.id}
      file={item.file}
      previewUrl={item.previewUrl}
      size={size}
      labelOverride={item.labelOverride}
      showCaption={showCaptions}
      disabled={disabled}
      onRemove={onRemove ? () => onRemove(item.id) : undefined}
      onActivate={onActivate ? () => onActivate(item) : undefined}
    />
  );

  return (
    <div className={clsx("flex flex-col gap-2", className)}>
      <div
        className={clsx(
          "flex flex-col gap-2",
          // `overflow-y-auto` silently promotes `overflow-x` from `visible` to
          // `auto` per spec, which clips the remove button's overhang and can
          // raise a phantom horizontal scrollbar. So the cap pays for the
          // overhang in padding, takes it back in margin to leave the tiles
          // where they were, and pins `overflow-x` explicitly.
          capHeight &&
            "-mr-1 -mt-1 overflow-y-auto overflow-x-hidden pr-1 pt-1",
        )}
        style={
          capHeight
            ? {
                maxHeight:
                  "var(--theme-layout-attachment-tile-staged-max-height)",
              }
            : undefined
        }
      >
        {media.length > 0 && (
          <div className="flex flex-wrap items-start gap-2">
            {media.map(renderTile)}
          </div>
        )}
        {documents.length > 0 && (
          <div className="flex flex-wrap items-start gap-2">
            {documents.map(renderTile)}
          </div>
        )}
      </div>
      {/* The count rides along with the bulk control rather than appearing
          on its own: a list short enough not to need one is also too short to
          overflow the cap, so there is nothing the count would warn about. */}
      {showRemoveAll && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-[var(--theme-fg-muted)]">
            {countLabel}
          </span>
          <Button
            onClick={onRemoveAll}
            variant="ghost"
            size="sm"
            className="px-0 text-xs text-[var(--theme-fg-muted)]"
            aria-label={t`Remove all attachments`}
            disabled={disabled}
          >
            {t`Remove all`}
          </Button>
        </div>
      )}
    </div>
  );
};
