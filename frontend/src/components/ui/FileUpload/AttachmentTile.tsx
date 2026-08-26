import { t } from "@lingui/core/macro";
import clsx from "clsx";
import { useMemo, useState } from "react";

import { useTheme } from "@/components/providers/ThemeProvider";
import { FILE_TYPES, getFileTypeIcon } from "@/utils/fileTypes";

import {
  getFileName,
  getFileSize,
  getFileType,
  splitFilenameForDisplay,
  type FileResource,
} from "./FilePreviewBase";
import { CloseIcon, ResolvedIcon } from "../icons";

import type React from "react";

/**
 * Compact for the composer, where vertical space is the scarce resource;
 * medium for the transcript, where the tile is the only thing standing in for
 * the file's contents.
 */
export type AttachmentTileSize = "compact" | "medium";

/**
 * Tile dimensions come from theme tokens so a customer theme can retune them;
 * the icon plate stays a class because it is proportional chrome, not a
 * dimension anyone would want to override on its own.
 */
const TILE_GEOMETRY = {
  compact: {
    mediaSize: "var(--theme-layout-attachment-tile-compact-media-size)",
    docMaxWidth: "var(--theme-layout-attachment-tile-compact-doc-max-width)",
    iconBox: "size-8",
    icon: "size-4",
  },
  medium: {
    mediaSize: "var(--theme-layout-attachment-tile-medium-media-size)",
    docMaxWidth: "var(--theme-layout-attachment-tile-medium-doc-max-width)",
    iconBox: "size-10",
    icon: "size-5",
  },
} as const satisfies Record<AttachmentTileSize, Record<string, string>>;

export interface AttachmentTileProps {
  file: FileResource;
  /** Image source for the media form. Without it every file renders as a document tile. */
  previewUrl?: string | null;
  size?: AttachmentTileSize;
  /** Presence makes the tile removable; absence renders it read-only. */
  onRemove?: () => void;
  /** Presence makes the tile activatable — typically opening the file preview. */
  onActivate?: () => void;
  /**
   * Verb for the activation label. Defaults to previewing the file; an item
   * whose activation goes somewhere else (the conversation behind a Teams
   * transcript, say) should say so instead.
   */
  activateLabel?: string;
  /** Overrides the type label under the filename, e.g. labelling an `.html` synthetic file as "Email". */
  labelOverride?: string;
  /** Filename under a media tile. Document tiles always carry their name inline. */
  showCaption?: boolean;
  disabled?: boolean;
  className?: string;
}

const RemoveButton: React.FC<{
  onRemove: () => void;
  filename: string;
  disabled: boolean;
}> = ({ onRemove, filename, disabled }) => (
  <button
    type="button"
    onClick={(event) => {
      event.stopPropagation();
      onRemove();
    }}
    disabled={disabled}
    aria-label={`${t`Remove`} ${filename}`}
    className={clsx(
      // Overhangs just far enough to clear the tile's own content without
      // reaching into the neighbouring tile across the gap.
      "absolute -right-1 -top-1 z-10 inline-flex size-5 items-center justify-center rounded-full",
      "border border-[var(--theme-border)] bg-[var(--theme-bg-primary)] text-[var(--theme-fg-muted)] shadow-sm",
      "hover:text-[var(--theme-fg-primary)] disabled:cursor-not-allowed",
      // Hidden until the tile is hovered or holds focus, so a staged row stays
      // calm — but always shown where there is no hover to reveal it.
      "opacity-0 transition-opacity focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100",
      "[@media(hover:none)]:opacity-100",
    )}
  >
    <CloseIcon className="size-3" />
  </button>
);

/**
 * One attached file, drawn the same way wherever it appears. Images render as
 * a thumbnail; everything else as an icon pill carrying name and type.
 */
export const AttachmentTile: React.FC<AttachmentTileProps> = ({
  file,
  previewUrl,
  size = "compact",
  onRemove,
  onActivate,
  activateLabel,
  labelOverride,
  showCaption = false,
  disabled = false,
  className,
}) => {
  const { iconMappings } = useTheme();
  const [imageFailed, setImageFailed] = useState(false);

  const filename = useMemo(() => getFileName(file), [file]);
  const fileType = useMemo(() => getFileType(filename), [filename]);
  const iconId = useMemo(
    () => getFileTypeIcon(fileType, iconMappings?.fileTypes),
    [fileType, iconMappings],
  );

  const { iconColor } = FILE_TYPES[fileType];
  // The extension beats the family name here: it is what distinguishes a .csv
  // from an .xlsx, both of which are "Spreadsheet". It also frees the filename
  // to truncate plainly, instead of pinning a tail that repeats this line.
  const typeLabel = useMemo(() => {
    if (labelOverride) {
      return labelOverride;
    }
    const { extension } = splitFilenameForDisplay(filename);
    return extension
      ? extension.slice(1).toUpperCase()
      : FILE_TYPES[fileType].displayName || t`File`;
  }, [labelOverride, filename, fileType]);
  // Only locally staged files carry a size — the API type has no such field —
  // so the separator has to survive its absence.
  const metaLabel = useMemo(() => {
    const fileSize = getFileSize(file);
    return fileSize ? `${typeLabel} · ${fileSize}` : typeLabel;
  }, [file, typeLabel]);
  const geometry = TILE_GEOMETRY[size];
  // Every upload carries a `preview_url`, including PDFs and spreadsheets —
  // it proxies the raw bytes, not a rendered thumbnail. Only an image can be
  // pointed at an <img>, so the type gate lives here rather than asking every
  // caller to pre-filter what it passes.
  const isMedia = Boolean(previewUrl) && fileType === "image" && !imageFailed;

  // A thumbnail carries no caption, so the filename has to reach assistive
  // tech some other way. Inside an activatable tile the button's own label
  // says it, and repeating it on the image would announce it twice; standalone,
  // the alt text is the only carrier.
  const face = isMedia ? (
    <img
      src={previewUrl ?? undefined}
      alt={onActivate ? "" : filename}
      onError={() => setImageFailed(true)}
      style={{ width: geometry.mediaSize, height: geometry.mediaSize }}
      className="rounded-[var(--theme-radius-base)] border object-cover [border-color:var(--theme-border-media)]"
    />
  ) : (
    <div
      className={clsx(
        "flex w-full items-center gap-2 rounded-[var(--theme-radius-base)] border p-2 text-left",
        "border-[var(--theme-border)] bg-[var(--theme-bg-secondary)]",
        onActivate &&
          "transition-colors group-hover:border-[var(--theme-border-focus)] group-hover:bg-[var(--theme-bg-accent)]",
      )}
    >
      <span
        className={clsx(
          geometry.iconBox,
          "flex shrink-0 items-center justify-center rounded-[var(--theme-radius-base)]",
        )}
        // The per-type colour already lives in FILE_TYPES; a tinted plate is
        // what makes it readable at tile size without shouting.
        style={{
          backgroundColor: `color-mix(in srgb, ${iconColor} 12%, transparent)`,
          color: iconColor,
        }}
      >
        <ResolvedIcon iconId={iconId} className={geometry.icon} aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-[var(--theme-fg-primary)]">
          {filename}
        </span>
        <span className="block truncate text-xs text-[var(--theme-fg-muted)]">
          {metaLabel}
        </span>
      </span>
    </div>
  );

  return (
    <div
      className={clsx(
        "group relative",
        // Media keeps its square; a document pill sizes to its name but never
        // grows to fill the row — that stretch is what makes today's chips
        // read as list rows rather than tiles.
        isMedia ? "shrink-0" : "min-w-0",
        className,
      )}
      style={isMedia ? undefined : { maxWidth: geometry.docMaxWidth }}
      data-filetype={fileType}
    >
      {onActivate ? (
        // Opening a preview mutates nothing, so it stays available even while
        // the surface is disabled — `disabled` gates removal only.
        <button
          type="button"
          onClick={onActivate}
          title={filename}
          aria-label={`${activateLabel ?? t`Preview attachment`} ${filename}, ${metaLabel}`}
          className={clsx(
            "block w-full cursor-pointer rounded-[var(--theme-radius-base)] text-left",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-theme-focus focus-visible:ring-offset-2",
            isMedia && "hover:opacity-90",
          )}
        >
          {face}
        </button>
      ) : (
        // Not interactive, so it cannot hold focus — the title serves hover and
        // the image's alt text serves assistive tech.
        <div title={filename}>{face}</div>
      )}

      {onRemove && (
        <RemoveButton
          onRemove={onRemove}
          filename={filename}
          disabled={disabled}
        />
      )}

      {isMedia && showCaption && (
        <p
          className="mt-1 truncate text-xs text-[var(--theme-fg-muted)]"
          style={{ width: geometry.mediaSize }}
          title={filename}
        >
          {filename}
        </p>
      )}
    </div>
  );
};
