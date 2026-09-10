import { plural, t } from "@lingui/core/macro";
import clsx from "clsx";
import { useState } from "react";

import { componentRegistry } from "@/config/componentRegistry";

import { AttachmentTile } from "./AttachmentTile";
import {
  FilePreviewBase,
  getFileName,
  type FileResource,
} from "./FilePreviewBase";
import { ThreadMessageCard } from "./ThreadMessageCard";
import { FILE_PREVIEW_STYLES } from "./fileUploadStyles";
import { Card } from "../Container/Card";
import { InteractiveContainer } from "../Container/InteractiveContainer";
import { Button } from "../Controls/Button";
import { SpinnerIcon } from "../Feedback/SpinnerIcon";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  ErrorIcon,
  InfoIcon,
} from "../icons";

import type React from "react";

/**
 * Discriminated union by `kind`:
 * - `attachment`: a normal managed attachment; renders as a removable chip.
 * - `selectableAttachment`: a file row with a checkbox. Used for the email
 *   grouped-preview where each attachment can be deselected pre-upload.
 *   Drives toggle-via-callback rather than the destructive remove flow.
 * - `context`: a read-only context chip (e.g. the Outlook add-in's "Reply
 *   context"); renderers must suppress the remove affordance.
 * - `loading`: an in-flight placeholder; rendered as a spinner. Has no
 *   `file` because no file has materialised yet.
 * - `status`: an inline non-file notice for grouped attachment state, such as
 *   a recoverable email-preview load failure.
 *
 * `labelOverride` lets callers force the metadata row text (e.g. label an
 * `.html` synthetic file as "Email") instead of deriving it from the file's
 * capability / extension.
 */
export type FileAttachmentGroupItem =
  | {
      kind: "attachment";
      id: string;
      file: FileResource;
      labelOverride?: string;
      /**
       * Opens something the file alone does not show — the conversation behind
       * a Teams transcript, say. Takes precedence over `onFilePreview`, which
       * can only ever offer the raw file.
       */
      onOpen?: () => void;
    }
  | {
      kind: "selectableAttachment";
      id: string;
      file: FileResource;
      selected: boolean;
      onToggle: () => void;
      labelOverride?: string;
      /**
       * Pre-upload validation result. When `ok` is false, the row renders
       * a red error badge with `reason` so the user sees the failure
       * inline instead of after upload. Selection state is left up to the
       * user — invalid rows can still be checked, but the user is warned.
       */
      validation?: { ok: boolean; reason?: string };
    }
  | {
      kind: "context";
      id: string;
      file: FileResource;
      labelOverride?: string;
    }
  | {
      kind: "loading";
      id: string;
      label?: string;
      description?: string;
    }
  | {
      kind: "status";
      id: string;
      label: string;
      description?: string;
      tone?: "neutral" | "error";
    }
  | {
      /**
       * Nested sub-section for a single message inside an Outlook conversation
       * thread. Renders as its own collapsible card *inside* the parent
       * group — keeps per-message attachments visually attached to their
       * message in the thread instead of flattening to siblings.
       *
       * The header checkbox toggles inclusion of the whole message (body +
       * its attachments). Individual attachment checkboxes inside override
       * the header for fine control.
       */
      kind: "threadMessageGroup";
      id: string;
      /** Primary label, typically sender display name. */
      label: string;
      /** Secondary line, typically date + subject. */
      sublabel?: string;
      /** Whether the whole message is included. Drives the header checkbox. */
      selected?: boolean;
      /**
       * Omit where inclusion is fixed: the card and its attachment rows then
       * render read-only. A checkbox that cannot change anything reads as
       * broken.
       */
      onToggle?: () => void;
      /** Initially collapsed when true. Default: true. */
      defaultCollapsed?: boolean;
      attachments: ThreadMessageAttachmentItem[];
    };

export interface ThreadMessageAttachmentItem {
  id: string;
  file: FileResource;
  selected?: boolean;
  /** Omit to render the attachment read-only, without a checkbox. */
  onToggle?: () => void;
  validation?: { ok: boolean; reason?: string };
}

export interface FileAttachmentGroup {
  id: string;
  label: string;
  items: FileAttachmentGroupItem[];
  metaLabel?: string;
  /**
   * When true, the group renders a chevron toggle on its header and items
   * are hidden until the user expands. Combined with `defaultCollapsed`
   * (defaults to `true` when `collapsible` is set), keeps long lists of
   * staged emails compact in tight task-pane layouts.
   */
  collapsible?: boolean;
  defaultCollapsed?: boolean;
}

export interface GroupedFileAttachmentsPreviewProps {
  groups: FileAttachmentGroup[];
  /**
   * Presence makes the items removable. A sent message passes nothing: there
   * is no longer anything to remove, and an inert control reads as broken.
   */
  onRemoveFile?: (fileId: string) => void;
  onFilePreview?: (file: FileResource) => void;
  disabled?: boolean;
  showFileTypes?: boolean;
  showFileSizes?: boolean;
  className?: string;
  filenameTruncateLength?: number;
  defaultVisibleItems?: number;
  stickyGroupHeaders?: boolean;
  /**
   * Optional per-group action row (keyed by group id), rendered at the end of
   * the group's items area — so it collapses with the group. Lets a caller add
   * a group-scoped control (e.g. "Attach to chat" on a found-email group)
   * without breaking out of the shared chip conventions.
   */
  groupActions?: Partial<Record<string, React.ReactNode>>;
}

type ItemWithFile = Extract<
  FileAttachmentGroupItem,
  { kind: "attachment" | "selectableAttachment" | "context" }
>;

// The placeholder must stay `count`: component-kit catalogs merge last and
// format these ids with {count, plural, …}.
const getItemCountLabel = (count: number) =>
  t({
    id: "chat.attachments.items.count",
    message: plural(count, { one: "# item", other: "# items" }),
  });

const getShowMoreItemsLabel = (count: number) =>
  t({
    id: "chat.attachments.show_more.count",
    message: plural(count, {
      one: "Show # more item",
      other: "Show # more items",
    }),
  });

function getFileKey(item: ItemWithFile): string {
  if ("id" in item.file) {
    return item.file.id;
  }

  return `${item.id}:${item.file.name}`;
}

/**
 * A stored upload can be shown as a thumbnail; a file that has not been
 * uploaded yet has no URL to point at and stays an icon tile.
 */
function getItemPreviewUrl(item: ItemWithFile): string | undefined {
  if (!("preview_url" in item.file)) {
    return undefined;
  }
  return typeof item.file.preview_url === "string"
    ? item.file.preview_url
    : undefined;
}

function getFileId(item: ItemWithFile): string {
  if ("id" in item.file) {
    return item.file.id;
  }

  return item.id;
}

interface SelectableAttachmentRowProps {
  file: FileResource;
  selected?: boolean;
  onToggle?: () => void;
  disabled: boolean;
  showFileType: boolean;
  showSize: boolean;
  filenameTruncateLength: number;
  validation?: { ok: boolean; reason?: string };
  /**
   * When present, the chip body becomes a click-to-preview target (the same
   * mechanic as plain attachment items) while the checkbox stays a separate
   * control. Without it, the whole row is one toggle label as before.
   */
  onPreview?: () => void;
}

const SELECTABLE_ROW_CLASS =
  "flex w-full items-center gap-2 rounded-[var(--attachment-tile-radius,var(--theme-radius-base))] border border-[var(--theme-border)] bg-[var(--theme-bg-secondary)] p-2";

const SelectableAttachmentRow: React.FC<SelectableAttachmentRowProps> = ({
  file,
  selected = true,
  onToggle,
  disabled,
  showFileType,
  showSize,
  filenameTruncateLength,
  validation,
  onPreview,
}) => {
  const filename = getFileName(file);
  const invalid = validation?.ok === false;
  const rowClassName = clsx(SELECTABLE_ROW_CLASS, !selected && "opacity-50");
  // A row without a toggle is read-only, so it has no selection to report and
  // must not look selected to a theme rule.
  const rowSelected = onToggle ? selected || undefined : undefined;
  const chip = (
    <div className="min-w-0 flex-1">
      <FilePreviewBase
        file={file}
        onRemove={() => onToggle?.()}
        disabled={disabled}
        showRemoveButton={false}
        showSize={showSize}
        showFileType={showFileType}
        filenameTruncateLength={filenameTruncateLength}
        filenameClassName="max-w-full"
        chromeless
      />
      {invalid && validation.reason && (
        <p className="mt-0.5 text-xs text-[var(--theme-error-fg)]">
          {validation.reason}
        </p>
      )}
    </div>
  );
  const checkbox = onToggle ? (
    <input
      type="checkbox"
      checked={selected}
      onChange={onToggle}
      disabled={disabled}
      className="size-4 shrink-0 rounded border-theme-border text-theme-fg-accent focus:ring-theme-focus disabled:cursor-not-allowed"
      aria-label={`${t({ id: "chat.attachments.include", message: "Include" })} ${filename}`}
    />
  ) : null;

  if (onPreview) {
    return (
      <div
        className={rowClassName}
        data-selected={rowSelected}
        data-ui="attachment-tile"
      >
        {checkbox}
        <InteractiveContainer
          onClick={onPreview}
          useDiv={true}
          className="min-w-0 flex-1 cursor-pointer rounded-[var(--attachment-tile-radius,var(--theme-radius-base))] hover:bg-theme-bg-accent"
          aria-label={`${t({ id: "chat.file.preview_attachment", message: "Preview attachment" })} ${filename}`}
        >
          {chip}
        </InteractiveContainer>
      </div>
    );
  }

  // Without a toggle there is nothing to label, so the row is a plain
  // container rather than a `label` pointing at a control that isn't there.
  if (!onToggle) {
    return (
      <div className={rowClassName} data-ui="attachment-tile">
        {chip}
      </div>
    );
  }

  return (
    <label
      className={rowClassName}
      data-selected={rowSelected}
      data-ui="attachment-tile"
    >
      {checkbox}
      {chip}
    </label>
  );
};

const StatusRow: React.FC<{
  label: string;
  description?: string;
  tone?: "neutral" | "error";
}> = ({ label, description, tone = "neutral" }) => {
  const isError = tone === "error";
  const Icon = isError ? ErrorIcon : InfoIcon;
  return (
    // `data-tone` carries the error state into CSS so the overrides below can
    // be `data-[tone=error]:` variants. `FILE_PREVIEW_STYLES` is shared with
    // FilePreviewBase/FilePreviewLoading and already sets a border colour and a
    // filename colour; without tailwind-merge an `isError && "…"` branch raced
    // those on generated-stylesheet position, and the filename override lost —
    // an error filename rendered in the ordinary foreground colour. The variant
    // compiles to `.data-\[tone\=error\]\:…[data-tone="error"]`, specificity
    // (0,2,0) against the shared constant's (0,1,0), so it wins by rule.
    <div
      data-tone={tone}
      className={clsx(
        FILE_PREVIEW_STYLES.container,
        "data-[tone=error]:border-[var(--theme-error-border)]",
      )}
      role={isError ? "alert" : "status"}
      aria-live={isError ? undefined : "polite"}
    >
      <div
        className={clsx(
          "mr-2 shrink-0",
          isError
            ? "text-[var(--theme-error-fg)]"
            : "text-[var(--theme-fg-muted)]",
        )}
      >
        <Icon className={FILE_PREVIEW_STYLES.icon} aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <div
          data-tone={tone}
          className={clsx(
            FILE_PREVIEW_STYLES.name,
            "data-[tone=error]:text-[var(--theme-error-fg)]",
          )}
          title={label}
        >
          {label}
        </div>
        {description && (
          <div className="text-xs text-[var(--theme-fg-muted)]">
            {description}
          </div>
        )}
      </div>
    </div>
  );
};

export const DefaultGroupedFileAttachmentsPreview: React.FC<
  GroupedFileAttachmentsPreviewProps
> = ({
  groups,
  onRemoveFile,
  onFilePreview,
  disabled = false,
  showFileTypes = false,
  showFileSizes = true,
  className = "",
  filenameTruncateLength = 25,
  defaultVisibleItems = 3,
  stickyGroupHeaders = false,
  groupActions,
}) => {
  const [expandedGroupIds, setExpandedGroupIds] = useState<string[]>([]);
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<
    Partial<Record<string, boolean>>
  >(() => {
    const initial: Record<string, boolean> = {};
    for (const group of groups) {
      if (group.collapsible && group.defaultCollapsed !== false) {
        initial[group.id] = true;
      }
    }
    return initial;
  });

  const setGroupExpanded = (groupId: string, expanded: boolean) => {
    setExpandedGroupIds((previous) => {
      if (expanded) {
        return previous.includes(groupId) ? previous : [...previous, groupId];
      }

      return previous.filter((id) => id !== groupId);
    });
  };

  const getGroupDefaultCollapsed = (group: FileAttachmentGroup): boolean =>
    group.defaultCollapsed !== false;

  const getGroupCollapsed = (group: FileAttachmentGroup): boolean => {
    if (!group.collapsible) {
      return false;
    }

    return collapsedGroupIds[group.id] ?? getGroupDefaultCollapsed(group);
  };

  const toggleGroupCollapsed = (group: FileAttachmentGroup) => {
    setCollapsedGroupIds((previous) => {
      const currentlyCollapsed =
        previous[group.id] ?? getGroupDefaultCollapsed(group);

      return {
        ...previous,
        [group.id]: !currentlyCollapsed,
      };
    });
  };

  if (groups.length === 0) {
    return null;
  }

  return (
    <div className={clsx("mb-3 flex flex-col gap-3", className)}>
      {groups.map((group) => {
        const itemCount = group.items.length;
        const collapsible = group.collapsible === true;
        const isCollapsed = getGroupCollapsed(group);
        const isExpanded = expandedGroupIds.includes(group.id);
        const shouldCollapse = itemCount > defaultVisibleItems;
        const baseItems = isCollapsed ? [] : group.items;
        const visibleItems =
          !isCollapsed && shouldCollapse && !isExpanded
            ? baseItems.slice(0, defaultVisibleItems)
            : baseItems;
        const hiddenCount = isCollapsed ? 0 : itemCount - visibleItems.length;
        // Two inset regimes. Without sticky headers the frame carries the
        // inset and the bands sit inside it; with them the frame stays bare so
        // the header can span its full width, and header and items carry the
        // inset instead.
        const sectionClassName = stickyGroupHeaders
          ? "attachment-group-geometry overflow-clip"
          : "attachment-group-geometry attachment-group-frame-geometry";
        const headerClassName = clsx(
          stickyGroupHeaders
            ? "flex min-w-0 items-start gap-2"
            : FILE_PREVIEW_STYLES.group.header,
          stickyGroupHeaders &&
            "attachment-group-header-geometry sticky top-0 z-10 border-b border-[var(--theme-border)] bg-[var(--theme-bg-primary)]",
        );
        // Tiles wrap into rows; checkbox rows and notices stay a column. In
        // practice a group is homogeneous — staged emails are all selectable,
        // compose-mode attachments all plain — so this never mixes.
        const tilesOnly =
          visibleItems.length > 0 &&
          visibleItems.every(
            (item) => item.kind === "attachment" || item.kind === "context",
          );
        const itemsClassName = clsx(
          tilesOnly
            ? "flex flex-wrap items-start gap-2"
            : "flex flex-col gap-2",
          stickyGroupHeaders
            ? "attachment-group-items-geometry bg-[var(--theme-bg-primary)]"
            : "p-0",
        );

        const headerInner = (
          <>
            {collapsible && (
              <span
                className="mr-1 inline-flex shrink-0 items-center text-theme-fg-muted"
                aria-hidden="true"
              >
                {isCollapsed ? (
                  <ChevronRightIcon className="size-4" />
                ) : (
                  <ChevronDownIcon className="size-4" />
                )}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <h3
                className={FILE_PREVIEW_STYLES.group.title}
                title={group.label}
              >
                {group.label}
              </h3>
              {group.metaLabel !== "" && (
                <p className={FILE_PREVIEW_STYLES.group.meta}>
                  {group.metaLabel ?? getItemCountLabel(itemCount)}
                </p>
              )}
            </div>
          </>
        );

        return (
          <Card
            key={group.id}
            // A group that cannot collapse has nothing to disclose, and the
            // wrapper an expandable card animates its body in would clip the
            // focus ring of a chip sitting against the body's edge.
            variant={collapsible ? "expandable" : "surface"}
            as="section"
            size="sm"
            expanded={collapsible && !isCollapsed}
            unmountOnCollapse
            className={sectionClassName}
            bodyClassName={itemsClassName}
            data-ui="attachment-group"
            header={
              collapsible ? (
                <button
                  type="button"
                  onClick={() => toggleGroupCollapsed(group)}
                  className={clsx(headerClassName, "w-full text-left")}
                  aria-expanded={!isCollapsed}
                >
                  {headerInner}
                </button>
              ) : (
                <div className={clsx(headerClassName, "justify-between")}>
                  {headerInner}
                  {shouldCollapse && isExpanded && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setGroupExpanded(group.id, false)}
                      className={FILE_PREVIEW_STYLES.group.toggleButton}
                    >
                      {t({
                        id: "chat.attachments.show_less",
                        message: "Show less",
                      })}
                    </Button>
                  )}
                </div>
              )
            }
          >
            {visibleItems.map((item) => {
              if (item.kind === "loading") {
                // Inside a group the placeholder is a bare centred
                // spinner; the framed loading chip belongs to the
                // composer, where a loading file stands in a row of files.
                return (
                  <div
                    key={item.id}
                    className="flex w-full justify-center py-2"
                    data-ui="attachment-loading"
                  >
                    <SpinnerIcon
                      size="md"
                      srText={
                        item.label ??
                        t({
                          id: "chat.attachments.loading",
                          message: "Loading attachment...",
                        })
                      }
                    />
                    {item.description ? (
                      <span className="sr-only">{item.description}</span>
                    ) : null}
                  </div>
                );
              }

              if (item.kind === "status") {
                return (
                  <StatusRow
                    key={item.id}
                    label={item.label}
                    description={item.description}
                    tone={item.tone}
                  />
                );
              }

              if (item.kind === "threadMessageGroup") {
                return (
                  <ThreadMessageCard
                    key={item.id}
                    label={item.label}
                    sublabel={item.sublabel}
                    selected={item.selected}
                    onToggle={item.onToggle}
                    disabled={disabled}
                    defaultCollapsed={item.defaultCollapsed}
                    attachmentCount={item.attachments.length}
                  >
                    {item.attachments.map((attachment) => (
                      <SelectableAttachmentRow
                        key={attachment.id}
                        file={attachment.file}
                        selected={attachment.selected}
                        onToggle={attachment.onToggle}
                        disabled={disabled}
                        showFileType={showFileTypes}
                        showSize={showFileSizes}
                        filenameTruncateLength={filenameTruncateLength}
                        validation={attachment.validation}
                        onPreview={
                          onFilePreview && "id" in attachment.file
                            ? () => onFilePreview(attachment.file)
                            : undefined
                        }
                      />
                    ))}
                  </ThreadMessageCard>
                );
              }

              if (item.kind === "selectableAttachment") {
                return (
                  <SelectableAttachmentRow
                    key={getFileKey(item)}
                    file={item.file}
                    selected={item.selected}
                    onToggle={item.onToggle}
                    disabled={disabled}
                    showFileType={showFileTypes}
                    showSize={showFileSizes}
                    filenameTruncateLength={filenameTruncateLength}
                    validation={item.validation}
                  />
                );
              }

              const onOpen =
                item.kind === "attachment" ? item.onOpen : undefined;
              const activate =
                onOpen ??
                (onFilePreview ? () => onFilePreview(item.file) : undefined);

              // `context` chips are read-only by contract — no remove
              // affordance (there is nothing staged to remove).
              return (
                <AttachmentTile
                  key={getFileKey(item)}
                  file={item.file}
                  previewUrl={getItemPreviewUrl(item)}
                  labelOverride={item.labelOverride}
                  disabled={disabled}
                  onRemove={
                    item.kind === "context" || !onRemoveFile
                      ? undefined
                      : () => onRemoveFile(getFileId(item))
                  }
                  onActivate={activate}
                  activateLabel={onOpen ? t`Open` : undefined}
                />
              );
            })}

            {hiddenCount > 0 && !isExpanded && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setGroupExpanded(group.id, true)}
                className={FILE_PREVIEW_STYLES.group.moreButton}
              >
                {getShowMoreItemsLabel(hiddenCount)}
              </Button>
            )}

            {!isCollapsed && groupActions?.[group.id]}
          </Card>
        );
      })}
    </div>
  );
};

export const GroupedFileAttachmentsPreview: React.FC<
  GroupedFileAttachmentsPreviewProps
> = (props) => {
  const Override = componentRegistry.ChatGroupedAttachmentsPreview;
  if (Override) {
    return <Override {...props} />;
  }
  return <DefaultGroupedFileAttachmentsPreview {...props} />;
};
