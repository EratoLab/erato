import { t } from "@lingui/core/macro";
import clsx from "clsx";
import { useMemo, useState } from "react";

import { useTheme } from "@/components/providers/ThemeProvider";
import { FILE_TYPES, getFileTypeIcon, type FileType } from "@/utils/fileTypes";

import {
  getFileName,
  getFileSize,
  getFileType,
  splitFilenameForDisplay,
  type FileResource,
} from "./FilePreviewBase";
import { InteractiveContainer } from "../Container/InteractiveContainer";
import { Button } from "../Controls/Button";
import { ExpandMediaButton } from "../Controls/ExpandMediaButton";
import { SpinnerIcon } from "../Feedback/SpinnerIcon";
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

/**
 * A file still being worked on (a recording that transcribes) or one that
 * failed: a spinner in the icon plate, error colours, and one action drawn
 * inside the frame beside the activation, never inside it.
 */
export interface AttachmentTileStatus {
  busy?: boolean;
  tone?: "error";
  /** Shown on hover under the file name, e.g. the error. */
  title?: string;
  action?: {
    label: string;
    /** Names the button when the label alone does not say which file. */
    accessibleName?: string;
    onSelect: () => void;
    disabled?: boolean;
  };
  /** What the remove control does instead, e.g. canceling a transcription. */
  remove?: { label: string; accessibleName: string };
  /**
   * Draws a recording by its words instead of its generated file name, which
   * stays the tooltip and accessible name. With neither an excerpt nor a
   * placeholder the meta line stands alone.
   */
  transcript?: {
    /** The first words, clamped to two lines. */
    excerpt?: string;
    /** Holds the excerpt's two lines until words arrive. */
    placeholder?: string;
    /**
     * A button beside the meta line that opens the preview, drawn only with
     * an excerpt and an `onActivate`; the rest of the tile still opens it.
     */
    more?: { label: string; accessibleName: string };
  };
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

const TITLE_TYPE = "text-sm font-medium text-[var(--theme-fg-primary)]";

export interface AttachmentTileTitleProps {
  children: React.ReactNode;
  /** Kept in view after the truncating text, e.g. a lock mark. */
  end?: React.ReactNode;
  /**
   * `2` holds two lines from the start and ends the second with an ellipsis,
   * for words rather than a name (a recording's transcript).
   */
  lines?: 1 | 2;
  /** Muted italic: stands in for words that have not arrived yet. */
  placeholder?: boolean;
  /** Names the element that carries the text. */
  "data-ui"?: string;
}

/** Line one of a tile: the name, cut with an ellipsis. */
export const AttachmentTileTitle = ({
  children,
  end,
  lines = 1,
  placeholder = false,
  "data-ui": hook,
}: AttachmentTileTitleProps) =>
  lines === 2 ? (
    <span
      data-ui={hook}
      data-placeholder={placeholder || undefined}
      className={clsx(
        // Running words, so the name's weight would make two lines heavy.
        "line-clamp-2 h-10 break-words text-sm leading-5",
        placeholder
          ? "italic text-[var(--theme-fg-muted)]"
          : "text-[var(--theme-fg-primary)]",
      )}
    >
      {children}
    </span>
  ) : end ? (
    <span className={clsx("flex min-w-0 items-center gap-1", TITLE_TYPE)}>
      <span data-ui={hook} className="min-w-0 truncate">
        {children}
      </span>
      {end}
    </span>
  ) : (
    <span data-ui={hook} className={clsx("block truncate", TITLE_TYPE)}>
      {children}
    </span>
  );

export interface AttachmentTileFaceProps {
  size?: AttachmentTileSize;
  /** The plate's glyph, hidden from assistive tech; omitted, no plate is drawn. */
  icon?: React.ReactNode;
  /** A spinner in the plate instead of the glyph. */
  busy?: boolean;
  /** Line one, usually an `AttachmentTileTitle`. */
  title: React.ReactNode;
  /** Line two: the type and size, or what the item is doing. */
  meta?: React.ReactNode;
  /** Kept in view at the end of line two, e.g. a "More". */
  metaEnd?: React.ReactNode;
  /** Error colours on line two. */
  tone?: "error";
  /** Below line two, e.g. why the file cannot be sent. */
  note?: React.ReactNode;
  /** Hook names for the plate and line two, so a host keeps its own. */
  parts?: { icon?: string; meta?: string };
}

/**
 * The anatomy every tile in an attachment row shares: a tinted plate, the
 * name on line one, the meta on line two. Spans only, so a host can draw it
 * inside its own button; the caller lays the two parts out in a row.
 */
export const AttachmentTileFace = ({
  size = "compact",
  icon,
  busy = false,
  title,
  meta,
  metaEnd,
  tone,
  note,
  parts,
}: AttachmentTileFaceProps) => {
  const geometry = TILE_GEOMETRY[size];
  return (
    <>
      {icon !== undefined && (
        <span
          data-ui={parts?.icon ?? "attachment-tile-icon"}
          className={clsx(
            geometry.iconBox,
            "attachment-tile-icon-geometry attachment-tile-icon-skin flex shrink-0 items-center justify-center",
          )}
        >
          {busy ? <SpinnerIcon size="md" aria-hidden="true" /> : icon}
        </span>
      )}
      <span className="min-w-0 flex-1">
        {title}
        {(Boolean(meta) || Boolean(metaEnd)) && (
          <span
            data-ui={parts?.meta ?? "attachment-tile-meta"}
            className={clsx(
              "text-xs",
              metaEnd ? "flex items-baseline gap-2" : "block truncate",
              tone === "error"
                ? "text-[var(--theme-error-fg)]"
                : "text-[var(--theme-fg-muted)]",
            )}
          >
            {metaEnd ? (
              <>
                <span className="min-w-0 truncate">{meta}</span>
                {metaEnd}
              </>
            ) : (
              meta
            )}
          </span>
        )}
        {note}
      </span>
    </>
  );
};

/** A custom face uses host metadata and image failure handling. */
export interface AttachmentTilePresentation {
  filename: string;
  imageProps: React.ImgHTMLAttributes<HTMLImageElement> | null;
}

export interface AttachmentTileProps {
  file: FileResource;
  /** Without it every file renders as a document tile. */
  previewUrl?: string | null;
  /**
   * Overrides extension-based media detection, e.g. an API image capability.
   * `true` also gives the tile the image icon and family label, for a file
   * whose display name carries no extension.
   */
  isImage?: boolean;
  /** Replaces the face and its chrome, retaining activation/removal/selection. */
  renderContent?: (presentation: AttachmentTilePresentation) => React.ReactNode;
  /** Replaces the default remove badge classes; its behaviour stays with the host. */
  removeButtonClassName?: string;
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
  /** Document tiles only; a thumbnail draws no status. */
  status?: AttachmentTileStatus;
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
  className?: string;
  label?: AttachmentTileStatus["remove"];
}> = ({ onRemove, filename, disabled, className, label }) => (
  <button
    type="button"
    onClick={(event) => {
      event.stopPropagation();
      onRemove();
    }}
    disabled={disabled}
    data-ui="attachment-remove"
    aria-label={
      label?.accessibleName ??
      `${t({ id: "common.remove", message: "Remove" })} ${filename}`
    }
    title={label?.label}
    className={
      className ??
      clsx(
        // Overhangs enough to clear its own tile without reaching the next one.
        "attachment-badge-geometry absolute -right-1 -top-1 z-10 inline-flex size-5 items-center justify-center",
        "border border-[var(--theme-border)] bg-[var(--theme-bg-primary)] text-[var(--theme-fg-muted)] shadow-sm",
        "hover:text-[var(--theme-fg-primary)] disabled:cursor-not-allowed",
        // Hidden until hover or focus, but always shown where there is no hover.
        "opacity-0 transition-opacity focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100",
        "[@media(hover:none)]:opacity-100",
      )
    }
  >
    <CloseIcon className="size-3" />
  </button>
);

/** One attached file: images as a thumbnail, everything else as an icon pill. */
export const AttachmentTile: React.FC<AttachmentTileProps> = ({
  file,
  previewUrl,
  isImage,
  renderContent,
  removeButtonClassName,
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
  status,
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
  const fileType = useMemo<FileType>(
    () => (isImage === true ? "image" : getFileType(filename)),
    [isImage, filename],
  );
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
    const { extension } = splitFilenameForDisplay(filename);
    const label =
      showType === "family"
        ? familyName.toUpperCase()
        : extension
          ? extension.slice(1).toUpperCase()
          : familyName;
    // A display name such as "Image" already says it.
    return label.toLowerCase() === filename.trim().toLowerCase() ? null : label;
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
    (isImage ?? fileType === "image") &&
    !imageFailed;
  // A tile has no room inside it for a control, so the badge overhangs a
  // corner; a row draws the caller's inline, where a disabled one stays visible.
  const inlineRemoveControl = isMedia ? null : removeControl;
  const failed = !isMedia && status?.tone === "error";
  const busy = !isMedia && Boolean(status?.busy);
  const statusAttr = failed ? "error" : busy ? "busy" : undefined;
  const tileAction =
    !isMedia && !selection && !renderContent ? status?.action : undefined;
  const hoverTitle =
    !isMedia && status?.title ? `${filename}\n${status.title}` : filename;
  const transcriptFace = isMedia ? undefined : status?.transcript;
  const excerpt = transcriptFace?.excerpt;
  const excerptPlaceholder = excerpt ? undefined : transcriptFace?.placeholder;
  const excerptText = excerpt ?? excerptPlaceholder;
  const more =
    transcriptFace?.excerpt && onActivate ? transcriptFace.more : undefined;
  // A custom face draws its own More, and a selectable row wraps the face in
  // its own activation, which a button cannot sit inside.
  const moreButton = Boolean(more) && !renderContent && !selection;
  const activationName = more
    ? meta
      ? `${more.accessibleName}, ${meta}`
      : more.accessibleName
    : meta
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
      <span
        className={clsx("flex min-w-0 max-w-full items-baseline", TITLE_TYPE)}
      >
        <span className="min-w-0 truncate">{nameParts.stem}</span>
        {nameParts.extension && (
          <span className="shrink-0">{nameParts.extension}</span>
        )}
      </span>
    ) : (
      <AttachmentTileTitle>{filename}</AttachmentTileTitle>
    );

  const imageProps: React.ImgHTMLAttributes<HTMLImageElement> = {
    src: previewUrl ?? undefined,
    alt: onActivate ? "" : filename,
    onError: () => setImageFailed(true),
  };
  const customContent = renderContent?.({
    filename,
    imageProps: isMedia ? imageProps : null,
  });

  const body = customContent ?? (
    <AttachmentTileFace
      size={size}
      icon={
        hideIcon ? undefined : (
          <ResolvedIcon iconId={iconId} className={geometry.icon} aria-hidden />
        )
      }
      busy={busy}
      title={
        transcriptFace
          ? excerptText && (
              <AttachmentTileTitle
                lines={2}
                placeholder={!excerpt}
                data-ui="attachment-tile-excerpt"
              >
                {excerptText}
              </AttachmentTileTitle>
            )
          : nameNode
      }
      meta={meta}
      metaEnd={
        moreButton &&
        more &&
        onActivate && (
          <Button
            variant="link"
            data-ui="attachment-tile-more"
            onClick={onActivate}
            title={hoverTitle}
            aria-label={activationName}
            // Stretched over the tile, which stays one control that opens the
            // preview wherever it is clicked.
            className="ml-auto shrink-0 after:absolute after:inset-0"
          >
            {more.label}
          </Button>
        )
      }
      tone={failed ? "error" : undefined}
      note={
        invalid &&
        validation.reason && (
          <span className="mt-0.5 block text-xs text-[var(--theme-error-fg)]">
            {validation.reason}
          </span>
        )
      }
    />
  );

  const documentFaceProps = {
    "data-ui": "attachment-tile",
    "data-variant": variant,
    "data-media": "document",
    "data-selected": selection ? selection.selected || undefined : undefined,
    "data-invalid": invalid || undefined,
    "data-status": statusAttr,
    title: selection ? filename : undefined,
    className: renderContent
      ? undefined
      : clsx(
          "attachment-tile-geometry flex w-full gap-2 text-left",
          tileAction ? "flex-col items-stretch" : "items-center",
          variant !== "bare" &&
            (failed
              ? "border border-[var(--theme-error-border)] bg-[var(--theme-error-bg)] p-2"
              : "border border-[var(--theme-border-attachment)] bg-[var(--theme-bg-secondary)] p-2"),
          variant !== "bare" &&
            onActivate &&
            !selection &&
            !failed &&
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
          className="size-4 shrink-0 accent-[var(--theme-fg-accent)] focus:ring-theme-focus disabled:cursor-not-allowed"
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
    (customContent ?? (
      // Inside an activatable tile the button already names the file, so alt text
      // would announce it twice; standalone, the alt text is the only carrier.
      <img
        {...imageProps}
        alt={imageProps.alt}
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
    ))
  ) : selection && !onActivate ? (
    <label {...documentFaceProps}>{documentFaceInner}</label>
  ) : (
    <div {...documentFaceProps}>{documentFaceInner}</div>
  );

  let content: React.ReactNode;
  if (tileAction) {
    // The frame wraps both buttons, so the action is never nested in the
    // activation (a control inside a button is unreachable).
    const actionButton = (
      <Button
        size="sm"
        variant="secondary"
        data-ui="attachment-tile-action"
        aria-label={tileAction.accessibleName}
        disabled={tileAction.disabled}
        onClick={tileAction.onSelect}
        // Positioned, so it stays above a stretched More.
        className="relative self-start"
      >
        {tileAction.label}
      </Button>
    );
    content = (
      <div {...documentFaceProps}>
        {moreButton ? (
          <div className="flex min-w-0 items-center gap-2">{body}</div>
        ) : onActivate ? (
          <button
            type="button"
            onClick={onActivate}
            title={hoverTitle}
            aria-label={activationName}
            className="attachment-tile-geometry flex w-full min-w-0 cursor-pointer items-center gap-2 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-theme-focus focus-visible:ring-offset-2"
          >
            {body}
          </button>
        ) : (
          <div title={hoverTitle} className="flex min-w-0 items-center gap-2">
            {body}
          </div>
        )}
        {inlineRemoveControl}
        {actionButton}
      </div>
    );
  } else if (selection || moreButton) {
    // Activation lives inside the frame: beside the checkbox, or in More.
    content = face;
  } else if (onActivate) {
    content = (
      // A preview mutates nothing, so `disabled` gates removal only.
      <button
        type="button"
        onClick={onActivate}
        title={hoverTitle}
        aria-label={activationName}
        className={clsx(
          "attachment-tile-geometry block w-full cursor-pointer text-left",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-theme-focus focus-visible:ring-offset-2",
          // A bare chip has no face to tint, so hover lives on the button.
          !renderContent &&
            variant === "bare" &&
            "hover:bg-[var(--theme-bg-accent)]",
          !renderContent && isMedia && "hover:opacity-90",
        )}
      >
        {face}
      </button>
    );
  } else {
    // Not interactive: the title serves hover, the alt text assistive tech.
    content = <div title={hoverTitle}>{face}</div>;
  }

  const tileWidth: React.CSSProperties | undefined =
    !renderContent && variant === "tile" && !isMedia
      ? excerptText
        ? {
            // Two lines of words need more room than a file name does, and a
            // fixed width keeps arriving words from widening it.
            width: `min(100%, calc(${geometry.docMaxWidth} * 1.5))`,
          }
        : { maxWidth: geometry.docMaxWidth }
      : undefined;

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
          ...tileWidth,
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
          className={removeButtonClassName}
          label={status?.remove}
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
