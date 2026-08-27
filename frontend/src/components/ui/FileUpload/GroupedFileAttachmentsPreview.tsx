import { t } from "@lingui/core/macro";
import clsx from "clsx";
import { useId, useState } from "react";

import { componentRegistry } from "@/config/componentRegistry";

import { AttachmentTile } from "./AttachmentTile";
import {
  FilePreviewBase,
  getFileName,
  type FileResource,
} from "./FilePreviewBase";
import { FilePreviewLoading } from "./FilePreviewLoading";
import { FILE_PREVIEW_STYLES } from "./fileUploadStyles";
import { InteractiveContainer } from "../Container/InteractiveContainer";
import { Button } from "../Controls/Button";
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
  "flex w-full items-center gap-2 rounded-[var(--theme-radius-base)] border border-[var(--theme-border)] bg-[var(--theme-bg-secondary)] p-2";

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
      aria-label={`${t`Include`} ${filename}`}
    />
  ) : null;

  if (onPreview) {
    return (
      <div className={rowClassName}>
        {checkbox}
        <InteractiveContainer
          onClick={onPreview}
          useDiv={true}
          className="min-w-0 flex-1 cursor-pointer rounded-[var(--theme-radius-base)] hover:bg-theme-bg-accent"
          aria-label={`${t`Preview attachment`} ${filename}`}
        >
          {chip}
        </InteractiveContainer>
      </div>
    );
  }

  // Without a toggle there is nothing to label, so the row is a plain
  // container rather than a `label` pointing at a control that isn't there.
  if (!onToggle) {
    return <div className={rowClassName}>{chip}</div>;
  }

  return (
    <label className={rowClassName}>
      {checkbox}
      {chip}
    </label>
  );
};

interface ThreadMessageGroupSectionProps {
  label: string;
  sublabel?: string;
  selected?: boolean;
  onToggle?: () => void;
  attachments: ThreadMessageAttachmentItem[];
  defaultCollapsed?: boolean;
  disabled: boolean;
  showFileType: boolean;
  showSize: boolean;
  filenameTruncateLength: number;
  onFilePreview?: (file: FileResource) => void;
}

const ThreadMessageHeaderText: React.FC<{
  label: string;
  sublabel?: string;
  metaLabel?: string;
}> = ({ label, sublabel, metaLabel }) => {
  // Meta stays in the text stack (like the group header's "N messages")
  // instead of floating right-aligned on its own.
  const secondLine = [sublabel, metaLabel].filter(Boolean).join(" · ");
  return (
    <div className="min-w-0 flex-1">
      <p
        className="truncate text-sm font-medium text-theme-fg-primary"
        title={label}
      >
        {label}
      </p>
      {secondLine && (
        <p className="truncate text-xs text-theme-fg-muted" title={secondLine}>
          {secondLine}
        </p>
      )}
    </div>
  );
};

const ThreadMessageGroupSection: React.FC<ThreadMessageGroupSectionProps> = ({
  label,
  sublabel,
  selected = true,
  onToggle,
  attachments,
  defaultCollapsed = true,
  disabled,
  showFileType,
  showSize,
  filenameTruncateLength,
  onFilePreview,
}) => {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const panelId = useId();
  const hasAttachments = attachments.length > 0;
  const attachmentCount = attachments.length;
  return (
    <div
      className={clsx(
        "rounded-[var(--theme-radius-message)] border border-theme-border bg-theme-bg-secondary p-2",
        !selected && "opacity-60",
      )}
    >
      <div className="flex items-center gap-2">
        {/* Fixed columns across tree levels: disclosure, selection, text. */}
        {hasAttachments ? (
          // Only render the chevron when there's something to expand —
          // an empty thread message has no attachments to show, so a
          // disclosure toggle would dangle without any payload.
          <button
            type="button"
            onClick={() => setCollapsed((value) => !value)}
            className="inline-flex size-4 shrink-0 items-center justify-center text-theme-fg-muted"
            aria-expanded={!collapsed}
            aria-controls={panelId}
            aria-label={`${t`Toggle attachments`} ${label}`}
          >
            {collapsed ? (
              <ChevronRightIcon className="size-4" />
            ) : (
              <ChevronDownIcon className="size-4" />
            )}
          </button>
        ) : (
          <span className="size-4 shrink-0" aria-hidden="true" />
        )}
        {onToggle && (
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            disabled={disabled}
            className="size-4 shrink-0 rounded border-theme-border text-theme-fg-accent focus:ring-theme-focus disabled:cursor-not-allowed"
            aria-label={`${t`Include message`} ${label}`}
            onClick={(event) => event.stopPropagation()}
          />
        )}
        {hasAttachments ? (
          <button
            type="button"
            onClick={() => setCollapsed((value) => !value)}
            className="flex min-w-0 flex-1 items-start gap-2 text-left"
            tabIndex={-1}
          >
            <ThreadMessageHeaderText
              label={label}
              sublabel={sublabel}
              metaLabel={
                attachmentCount === 1 ? t`1 file` : t`${attachmentCount} files`
              }
            />
          </button>
        ) : (
          <div className="flex min-w-0 flex-1 items-start gap-2">
            <ThreadMessageHeaderText label={label} sublabel={sublabel} />
          </div>
        )}
      </div>
      {!collapsed && hasAttachments && (
        <div
          id={panelId}
          role="region"
          className="mt-2 flex flex-col gap-1 pl-6"
        >
          {attachments.map((attachment) => (
            <SelectableAttachmentRow
              key={attachment.id}
              file={attachment.file}
              selected={attachment.selected}
              onToggle={attachment.onToggle}
              disabled={disabled}
              showFileType={showFileType}
              showSize={showSize}
              filenameTruncateLength={filenameTruncateLength}
              validation={attachment.validation}
              onPreview={
                onFilePreview && "id" in attachment.file
                  ? () => onFilePreview(attachment.file)
                  : undefined
              }
            />
          ))}
        </div>
      )}
    </div>
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
        const isCollapsed = getGroupCollapsed(group);
        const isExpanded = expandedGroupIds.includes(group.id);
        const shouldCollapse = itemCount > defaultVisibleItems;
        const baseItems = isCollapsed ? [] : group.items;
        const visibleItems =
          !isCollapsed && shouldCollapse && !isExpanded
            ? baseItems.slice(0, defaultVisibleItems)
            : baseItems;
        const hiddenCount = isCollapsed ? 0 : itemCount - visibleItems.length;
        const sectionClassName = stickyGroupHeaders
          ? "rounded-[var(--theme-radius-input)] bg-[var(--theme-bg-primary)]"
          : FILE_PREVIEW_STYLES.group.container;
        const headerClassName = clsx(
          stickyGroupHeaders
            ? "flex min-w-0 items-start gap-2"
            : FILE_PREVIEW_STYLES.group.header,
          stickyGroupHeaders &&
            clsx(
              "sticky top-0 z-10 border border-[var(--theme-border)] bg-[var(--theme-bg-primary)] px-3 pb-2 pt-3",
              isCollapsed
                ? "rounded-[var(--theme-radius-input)]"
                : "rounded-t-[var(--theme-radius-input)]",
            ),
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
          stickyGroupHeaders &&
            "rounded-b-md border-x border-b border-[var(--theme-border)] bg-[var(--theme-bg-primary)] px-3 pb-3 pt-2",
        );

        const headerInner = (
          <>
            {group.collapsible && (
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
                  {group.metaLabel ??
                    (itemCount === 1 ? t`1 item` : t`${itemCount} items`)}
                </p>
              )}
            </div>
          </>
        );

        return (
          <section key={group.id} className={sectionClassName}>
            {group.collapsible ? (
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
                    {t`Show less`}
                  </Button>
                )}
              </div>
            )}

            {(!stickyGroupHeaders || !isCollapsed) && (
              <div className={itemsClassName}>
                {visibleItems.map((item) => {
                  if (item.kind === "loading") {
                    return (
                      <FilePreviewLoading
                        key={item.id}
                        className="w-full"
                        label={item.label ?? t`Loading attachment...`}
                        description={item.description}
                      />
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
                      <ThreadMessageGroupSection
                        key={item.id}
                        label={item.label}
                        sublabel={item.sublabel}
                        selected={item.selected}
                        onToggle={item.onToggle}
                        attachments={item.attachments}
                        defaultCollapsed={item.defaultCollapsed}
                        disabled={disabled}
                        showFileType={showFileTypes}
                        showSize={showFileSizes}
                        filenameTruncateLength={filenameTruncateLength}
                        onFilePreview={onFilePreview}
                      />
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
                    (onFilePreview
                      ? () => onFilePreview(item.file)
                      : undefined);

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
                    {hiddenCount === 1
                      ? t`Show 1 more item`
                      : t`Show ${hiddenCount} more items`}
                  </Button>
                )}

                {!isCollapsed && groupActions?.[group.id]}
              </div>
            )}
          </section>
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
