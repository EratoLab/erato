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

export type AttachmentTileSize = "compact" | "medium";

/** `bare` drops the frame for a surface that draws its own chrome. */
export type AttachmentTileVariant = "tile" | "row" | "bare";

/**
 * `extension` separates a `.csv` from an `.xlsx` where `family` calls both
 * "Spreadsheet". Only `extension` repeats the filename's tail, so it is also
 * the only one under which the name stops pinning its own extension.
 */
export type AttachmentTileTypeLabel = "extension" | "family" | "none";

export interface AttachmentTileSelection {
  selected: boolean;
  onToggle: () => void;
  label?: string;
}

export interface AttachmentTileValidation {
  ok: boolean;
  reason?: string;
}

/** Sizes are tokens so a theme can retune them; the plate stays proportional chrome. */
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
  /** Without it every file renders as a document tile. */
  previewUrl?: string | null;
  size?: AttachmentTileSize;
  variant?: AttachmentTileVariant;
  onRemove?: () => void;
  onActivate?: () => void;
  /** Verb for the activation label; defaults to previewing the file. */
  activateLabel?: string;
  /** Overrides the derived type label, e.g. a synthetic `.html` file as "Email". */
  labelOverride?: string;
  selection?: AttachmentTileSelection;
  validation?: AttachmentTileValidation;
  /** Replaces the icon derived from the filename; sizing and tint are unchanged. */
  icon?: string;
  hideIcon?: boolean;
  /** Replaces the derived meta line. An empty string removes it. */
  metaLabel?: string;
  showType?: AttachmentTileTypeLabel;
  showSize?: boolean;
  /** Filename under a media tile; document tiles carry it inline. */
  showCaption?: boolean;
  /** Media only: grows the image in place, capped at the chat image bounds. */
  expandable?: boolean;
  disabled?: boolean;
  /**
   * Drawn inline instead of the corner badge. Not for a chip that is itself
   * the activation target: a control nested in that button is unreachable.
   */
  removeControl?: React.ReactNode;
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
      // Overhangs enough to clear its own tile without reaching the next one.
      "attachment-badge-geometry absolute -right-1 -top-1 z-10 inline-flex size-5 items-center justify-center",
      "border border-[var(--theme-border)] bg-[var(--theme-bg-primary)] text-[var(--theme-fg-muted)] shadow-sm",
      "hover:text-[var(--theme-fg-primary)] disabled:cursor-not-allowed",
      // Hidden until hover or focus, but always shown where there is no hover.
      "opacity-0 transition-opacity focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100",
      "[@media(hover:none)]:opacity-100",
    )}
  >
    <CloseIcon className="size-3" />
  </button>
);

/** One attached file: images as a thumbnail, everything else as an icon pill. */
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
  removeControl,
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
  // The extension beats the family name: it separates a .csv from an .xlsx,
  // both "Spreadsheet", and frees the filename to truncate plainly.
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
  // The API type carries no size, so the separator has to survive its absence.
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
  // Every upload carries a `preview_url` — it proxies the raw bytes, not a
  // thumbnail — so the image gate lives here rather than in every caller.
  const isMedia =
    variant === "tile" &&
    !selection &&
    Boolean(previewUrl) &&
    fileType === "image" &&
    !imageFailed;
  // A tile has no room inside it for a control, so the badge overhangs a
  // corner; a row draws the caller's inline, where a disabled one stays visible.
  const inlineRemoveControl = isMedia ? null : removeControl;
  const activationName = meta
    ? `${activateLabel ?? t({ id: "chat.file.preview_attachment", message: "Preview attachment" })} ${filename}, ${meta}`
    : `${activateLabel ?? t({ id: "chat.file.preview_attachment", message: "Preview attachment" })} ${filename}`;

  // Splitting the extension into its own node survives a truncating stem, but
  // a whole-name query joins the direct text children of one element only — so
  // the split only happens where the meta line does not already name the type.
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
        "border border-[var(--theme-border-attachment)] bg-[var(--theme-bg-secondary)] p-2",
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
      {inlineRemoveControl}
    </>
  );

  // A `label` forwards clicks to its control, so a chip that is selectable and
  // activatable would preview and deselect at once; there the frame stays plain.
  const face = isMedia ? (
    // Inside an activatable tile the button already names the file, so alt text
    // would announce it twice; standalone, the alt text is the only carrier.
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
        // Cropping suits a thumbnail, not an image opened to be looked at.
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
    // Activation lives inside the frame, beside the checkbox, not wrapping both.
    content = face;
  } else if (onActivate) {
    content = (
      // A preview mutates nothing, so `disabled` gates removal only.
      <button
        type="button"
        onClick={onActivate}
        title={filename}
        aria-label={activationName}
        className={clsx(
          "attachment-tile-geometry block w-full cursor-pointer text-left",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-theme-focus focus-visible:ring-offset-2",
          // A bare chip has no face to tint, so hover lives on the button.
          variant === "bare" && "hover:bg-[var(--theme-bg-accent)]",
          isMedia && "hover:opacity-90",
        )}
      >
        {face}
      </button>
    );
  } else {
    // Not interactive: the title serves hover, the alt text assistive tech.
    content = <div title={filename}>{face}</div>;
  }

  return (
    <div
      className={clsx(
        "group relative",
        // Only `row` stretches; that width is what reads as a list row.
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
          // Handed down as a variable rather than set on the plate, where an
          // inline value would outrank the theme rule the hook exists to accept.
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

      {onRemove && !inlineRemoveControl && (
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
