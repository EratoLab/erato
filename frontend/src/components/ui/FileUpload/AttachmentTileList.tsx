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
  className,
}) => {
  if (items.length === 0) {
    return null;
  }

  const showRemoveAll =
    Boolean(onRemoveAll) && items.length >= removeAllThreshold;

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
      {showRemoveAll && (
        <Button
          onClick={onRemoveAll}
          variant="ghost"
          size="sm"
          className="self-start px-0 text-xs text-[var(--theme-fg-muted)]"
          aria-label={t`Remove all attachments`}
          disabled={disabled}
        >
          {t`Remove all`}
        </Button>
      )}
    </div>
  );
};
