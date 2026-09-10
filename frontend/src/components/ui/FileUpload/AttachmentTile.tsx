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
import { InteractiveContainer } from "../Container/InteractiveContainer";
import { ExpandMediaButton } from "../Controls/ExpandMediaButton";
import { CloseIcon, ResolvedIcon } from "../icons";

import type React from "react";

/**
 * Compact for the composer, where vertical space is the scarce resource;
 * medium for the transcript, where the tile is the only thing standing in for
 * the file's contents.
 */
export type AttachmentTileSize = "compact" | "medium";

/**
 * `tile` is the chip standing on its own: a thumbnail, or an icon pill that
 * sizes to its name. `row` stretches the same chip across a list, where a
 * leading checkbox and a validation line have somewhere to sit. `bare` drops
 * the frame so a surface that draws its own chrome can hold the contents.
 */
export type AttachmentTileVariant = "tile" | "row" | "bare";

/**
 * Which reading of the type the meta line carries. `extension` distinguishes a
 * `.csv` from an `.xlsx`, both of which are "Spreadsheet"; `family` is the
 * coarser name, for a surface that would rather group than distinguish;
 * `none` drops the type from the line. Only `extension` repeats the tail of
 * the filename, so it is also the only one under which the name stops pinning
 * its own extension.
 */
export type AttachmentTileTypeLabel = "extension" | "family" | "none";

export interface AttachmentTileSelection {
  selected: boolean;
  onToggle: () => void;
  /** Verb for the checkbox label. Defaults to including the file. */
  label?: string;
}

export interface AttachmentTileValidation {
  ok: boolean;
  /** Shown under the name while `ok` is false. */
  reason?: string;
}

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
  variant?: AttachmentTileVariant;
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
  /** Presence gives the chip a leading checkbox and a selected state to report. */
  selection?: AttachmentTileSelection;
  /** A failure marks the chip invalid and prints its reason under the name. */
  validation?: AttachmentTileValidation;
  /**
   * Icon id for the plate, replacing the one derived from the filename. The
   * plate keeps its own sizing and its per-type tint either way.
   */
  icon?: string;
  /** Drops the icon plate, for a surface that carries the file's identity itself. */
  hideIcon?: boolean;
  /** Replaces the whole derived meta line. An empty string removes it. */
  metaLabel?: string;
  showType?: AttachmentTileTypeLabel;
  /** Only locally staged files carry a size at all; this suppresses it where they do. */
  showSize?: boolean;
  /** Filename under a media tile. Document tiles always carry their name inline. */
  showCaption?: boolean;
  /**
   * Offers a middle tier between the tile and the full preview: an image grows
   * in place, capped at the chat image bounds. Only meaningful for media —
   * a document tile has nothing larger to show without loading a renderer.
   */
  expandable?: boolean;
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
    data-ui="attachment-remove"
    aria-label={`${t({ id: "common.remove", message: "Remove" })} ${filename}`}
    className={clsx(
      // Overhangs just far enough to clear the tile's own content without
      // reaching into the neighbouring tile across the gap.
      "attachment-badge-geometry absolute -right-1 -top-1 z-10 inline-flex size-5 items-center justify-center",
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
  variant = "tile",
  onRemove,
  onActivate,
  activateLabel,
  labelOverride,
  selection,
  validation,
  icon,
  hideIcon = false,
  metaLabel,
  showType = "extension",
  showSize = true,
  showCaption = false,
  expandable = false,
  disabled = false,
  className,
}) => {
  const { iconMappings } = useTheme();
  const [imageFailed, setImageFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const filename = useMemo(() => getFileName(file), [file]);
  const fileType = useMemo(() => getFileType(filename), [filename]);
  const iconId = useMemo(
    () => icon ?? getFileTypeIcon(fileType, iconMappings?.fileTypes),
    [icon, fileType, iconMappings],
  );

  const { iconColor } = FILE_TYPES[fileType];
  // The extension beats the family name by default: it is what distinguishes a
  // .csv from an .xlsx, both of which are "Spreadsheet". It also frees the
  // filename to truncate plainly, instead of pinning a tail this line already
  // carries.
  const typeLabel = useMemo(() => {
    if (showType === "none") {
      return null;
    }
    if (labelOverride) {
      return labelOverride;
    }
    const familyName = FILE_TYPES[fileType].displayName || t`File`;
    if (showType === "family") {
      return familyName.toUpperCase();
    }
    const { extension } = splitFilenameForDisplay(filename);
    return extension ? extension.slice(1).toUpperCase() : familyName;
  }, [showType, labelOverride, filename, fileType]);
  // Only locally staged files carry a size — the API type has no such field —
  // so the separator has to survive its absence, and so does the whole line.
  const meta = useMemo(() => {
    if (metaLabel !== undefined) {
      return metaLabel;
    }
    const fileSize = showSize ? getFileSize(file) : null;
    if (typeLabel && fileSize) {
      return `${typeLabel} · ${fileSize}`;
    }
    return typeLabel ?? fileSize;
  }, [metaLabel, showSize, file, typeLabel]);
  const geometry = TILE_GEOMETRY[size];
  const invalid = validation?.ok === false;
  // Every upload carries a `preview_url`, including PDFs and spreadsheets —
  // it proxies the raw bytes, not a rendered thumbnail. Only an image can be
  // pointed at an <img>, so the type gate lives here rather than asking every
  // caller to pre-filter what it passes. Only the standalone tile shows one at
  // all: a row lines up against its neighbours, and a selectable one has a
  // checkbox where the picture would go.
  const isMedia =
    variant === "tile" &&
    !selection &&
    Boolean(previewUrl) &&
    fileType === "image" &&
    !imageFailed;
  const activationName = meta
    ? `${activateLabel ?? t({ id: "chat.file.preview_attachment", message: "Preview attachment" })} ${filename}, ${meta}`
    : `${activateLabel ?? t({ id: "chat.file.preview_attachment", message: "Preview attachment" })} ${filename}`;

  // The extension earns a node of its own unless the meta line is set to name
  // the extension itself: pinned beside a truncating stem it survives a long
  // name, but it also splits the filename across two text nodes, and a query
  // for the whole name joins the direct text children of one element only.
  const nameParts = useMemo(
    () => splitFilenameForDisplay(filename),
    [filename],
  );
  const nameNode =
    showType !== "extension" ? (
      <span className="flex min-w-0 max-w-full items-baseline text-sm font-medium text-[var(--theme-fg-primary)]">
        <span className="min-w-0 truncate">{nameParts.stem}</span>
        {nameParts.extension && (
          <span className="shrink-0">{nameParts.extension}</span>
        )}
      </span>
    ) : (
      <span className="block truncate text-sm font-medium text-[var(--theme-fg-primary)]">
        {filename}
      </span>
    );

  const body = (
    <>
      {!hideIcon && (
        <span
          data-ui="attachment-tile-icon"
          className={clsx(
            geometry.iconBox,
            "attachment-tile-icon-geometry attachment-tile-icon-skin flex shrink-0 items-center justify-center",
          )}
        >
          <ResolvedIcon iconId={iconId} className={geometry.icon} aria-hidden />
        </span>
      )}
      <span className="min-w-0 flex-1">
        {nameNode}
        {meta && (
          <span className="block truncate text-xs text-[var(--theme-fg-muted)]">
            {meta}
          </span>
        )}
        {invalid && validation.reason && (
          <span className="mt-0.5 block text-xs text-[var(--theme-error-fg)]">
            {validation.reason}
          </span>
        )}
      </span>
    </>
  );

  const documentFaceProps = {
    "data-ui": "attachment-tile",
    "data-variant": variant,
    "data-media": "document",
    "data-selected": selection ? selection.selected || undefined : undefined,
    "data-invalid": invalid || undefined,
    title: selection ? filename : undefined,
    className: clsx(
      "attachment-tile-geometry flex w-full items-center gap-2 text-left",
      variant !== "bare" &&
        "border border-[var(--theme-border)] bg-[var(--theme-bg-secondary)] p-2",
      variant !== "bare" &&
        onActivate &&
        !selection &&
        "transition-colors group-hover:border-[var(--theme-border-focus)] group-hover:bg-[var(--theme-bg-accent)]",
      selection && !selection.selected && "opacity-50",
    ),
  };
  const documentFaceInner = (
    <>
      {selection && (
        <input
          type="checkbox"
          checked={selection.selected}
          onChange={selection.onToggle}
          disabled={disabled}
          className="size-4 shrink-0 rounded border-theme-border text-theme-fg-accent focus:ring-theme-focus disabled:cursor-not-allowed"
          aria-label={`${selection.label ?? t({ id: "chat.attachments.include", message: "Include" })} ${filename}`}
        />
      )}
      {selection && onActivate ? (
        <InteractiveContainer
          onClick={onActivate}
          useDiv={true}
          className="attachment-tile-geometry flex min-w-0 flex-1 cursor-pointer items-center gap-2 hover:bg-theme-bg-accent"
          aria-label={activationName}
        >
          {body}
        </InteractiveContainer>
      ) : (
        body
      )}
    </>
  );

  // A `label` forwards every click inside it to its control, so a selectable
  // chip that is also activatable would open the preview and deselect the file
  // in one gesture. Where both exist the frame stays a plain element and the
  // checkbox and the activatable body sit side by side.
  const face = isMedia ? (
    // A thumbnail carries no caption, so the filename has to reach assistive
    // tech some other way. Inside an activatable tile the button's own label
    // says it, and repeating it on the image would announce it twice; standalone,
    // the alt text is the only carrier.
    <img
      src={previewUrl ?? undefined}
      alt={onActivate ? "" : filename}
      onError={() => setImageFailed(true)}
      data-ui="attachment-tile"
      data-variant={variant}
      data-media="image"
      style={
        expanded
          ? {
              maxWidth: "var(--theme-layout-chat-image-preview-max-width)",
              maxHeight: "var(--theme-layout-chat-image-preview-max-height)",
            }
          : { width: geometry.mediaSize, height: geometry.mediaSize }
      }
      className={clsx(
        "attachment-tile-geometry border [border-color:var(--theme-border-media)]",
        // Cropping is right for a thumbnail standing in for the file, wrong
        // once the point is seeing what the image actually contains.
        expanded ? "w-full object-contain" : "object-cover",
      )}
    />
  ) : selection && !onActivate ? (
    <label {...documentFaceProps}>{documentFaceInner}</label>
  ) : (
    <div {...documentFaceProps}>{documentFaceInner}</div>
  );

  let content: React.ReactNode;
  if (selection) {
    // The chip is its own frame here: activation, where there is any, lives
    // inside it beside the checkbox rather than wrapping both.
    content = face;
  } else if (onActivate) {
    content = (
      // Opening a preview mutates nothing, so it stays available even while
      // the surface is disabled — `disabled` gates removal only.
      <button
        type="button"
        onClick={onActivate}
        title={filename}
        aria-label={activationName}
        className={clsx(
          "attachment-tile-geometry block w-full cursor-pointer text-left",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-theme-focus focus-visible:ring-offset-2",
          isMedia && "hover:opacity-90",
        )}
      >
        {face}
      </button>
    );
  } else {
    // Not interactive, so it cannot hold focus — the title serves hover and
    // the image's alt text serves assistive tech.
    content = <div title={filename}>{face}</div>;
  }

  return (
    <div
      className={clsx(
        "group relative",
        // Media keeps its square; a document pill sizes to its name but never
        // grows to fill the row — that stretch is what makes today's chips
        // read as list rows rather than tiles, and is exactly what `row` asks
        // for.
        variant === "row" && "w-full",
        !isMedia && "min-w-0",
        isMedia && (expanded ? "w-full" : "shrink-0"),
        className,
      )}
      style={
        {
          ...(variant === "tile" && !isMedia
            ? { maxWidth: geometry.docMaxWidth }
            : undefined),
          // The per-type colour already lives in FILE_TYPES; a tinted plate is
          // what makes it readable at tile size without shouting. It is handed
          // to the plate as a variable from here rather than declared on the
          // plate itself, where an inline value would outrank the theme rule
          // the hook exists to accept.
          "--attachment-tile-icon-tint": iconColor,
        } as React.CSSProperties
      }
      data-filetype={fileType}
    >
      {content}

      {expandable && isMedia && (
        <ExpandMediaButton
          expanded={expanded}
          onToggle={() => setExpanded((value) => !value)}
          label={filename}
        />
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
