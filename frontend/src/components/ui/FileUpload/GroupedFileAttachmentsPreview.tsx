import { t } from "@lingui/core/macro";
import clsx from "clsx";
import { useState } from "react";

import { componentRegistry } from "@/config/componentRegistry";

import {
  FilePreviewBase,
  getFileName,
  type FileResource,
} from "./FilePreviewBase";
import { FilePreviewButton } from "./FilePreviewButton";
import { FilePreviewLoading } from "./FilePreviewLoading";
import { FILE_PREVIEW_STYLES } from "./fileUploadStyles";
import { InteractiveContainer } from "../Container/InteractiveContainer";
import { Button } from "../Controls/Button";
import { ChevronDownIcon, ChevronRightIcon } from "../icons";

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
    };

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
  onRemoveFile: (fileId: string) => void;
  onFilePreview?: (file: FileResource) => void;
  disabled?: boolean;
  showFileTypes?: boolean;
  showFileSizes?: boolean;
  className?: string;
  filenameTruncateLength?: number;
  defaultVisibleItems?: number;
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

function getFileId(item: ItemWithFile): string {
  if ("id" in item.file) {
    return item.file.id;
  }

  return item.id;
}

interface SelectableAttachmentRowProps {
  file: FileResource;
  selected: boolean;
  onToggle: () => void;
  disabled: boolean;
  showFileType: boolean;
  showSize: boolean;
  filenameTruncateLength: number;
  validation?: { ok: boolean; reason?: string };
}

const SelectableAttachmentRow: React.FC<SelectableAttachmentRowProps> = ({
  file,
  selected,
  onToggle,
  disabled,
  showFileType,
  showSize,
  filenameTruncateLength,
  validation,
}) => {
  const filename = getFileName(file);
  const invalid = validation?.ok === false;
  return (
    <label
      className={clsx(
        "flex w-full items-start gap-2",
        !selected && "opacity-50",
      )}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        disabled={disabled}
        className="mt-1 size-4 shrink-0 rounded border-theme-border text-theme-fg-accent focus:ring-theme-focus disabled:cursor-not-allowed"
        aria-label={`${t`Include`} ${filename}`}
      />
      <div className="min-w-0 flex-1">
        <FilePreviewBase
          file={file}
          onRemove={() => onToggle()}
          disabled={disabled}
          showRemoveButton={false}
          showSize={showSize}
          showFileType={showFileType}
          filenameTruncateLength={filenameTruncateLength}
          filenameClassName="max-w-full"
        />
        {invalid && validation.reason && (
          <p className="mt-0.5 text-xs text-[var(--theme-error-fg)]">
            {validation.reason}
          </p>
        )}
      </div>
    </label>
  );
};

const DefaultGroupedFileAttachmentsPreview: React.FC<
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
}) => {
  const [expandedGroupIds, setExpandedGroupIds] = useState<string[]>([]);
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<
    Record<string, boolean>
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

  const toggleGroupCollapsed = (groupId: string) => {
    setCollapsedGroupIds((previous) => ({
      ...previous,
      [groupId]: !previous[groupId],
    }));
  };

  if (groups.length === 0) {
    return null;
  }

  return (
    <div className={clsx("mb-3 flex flex-col gap-3", className)}>
      {groups.map((group) => {
        const itemCount = group.items.length;
        const isCollapsed = group.collapsible && collapsedGroupIds[group.id];
        const isExpanded = expandedGroupIds.includes(group.id);
        const shouldCollapse = itemCount > defaultVisibleItems;
        const baseItems = isCollapsed ? [] : group.items;
        const visibleItems =
          !isCollapsed && shouldCollapse && !isExpanded
            ? baseItems.slice(0, defaultVisibleItems)
            : baseItems;
        const hiddenCount = isCollapsed ? 0 : itemCount - visibleItems.length;

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
          <section
            key={group.id}
            className={FILE_PREVIEW_STYLES.group.container}
          >
            {group.collapsible ? (
              <button
                type="button"
                onClick={() => toggleGroupCollapsed(group.id)}
                className={clsx(
                  FILE_PREVIEW_STYLES.group.header,
                  "flex w-full items-center text-left",
                )}
                aria-expanded={!isCollapsed}
              >
                {headerInner}
              </button>
            ) : (
              <div className={FILE_PREVIEW_STYLES.group.header}>
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

            <div className="flex flex-col gap-2">
              {visibleItems.map((item) => {
                if (item.kind === "loading") {
                  return (
                    <FilePreviewLoading
                      key={item.id}
                      className="w-full"
                      label={t`Loading attachment...`}
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

                const content = (
                  <FilePreviewButton
                    file={item.file}
                    onRemove={() => onRemoveFile(getFileId(item))}
                    disabled={disabled}
                    className="w-full"
                    showFileType={showFileTypes}
                    showSize={showFileSizes}
                    filenameTruncateLength={filenameTruncateLength}
                    filenameClassName="max-w-full"
                  />
                );

                if (!onFilePreview) {
                  return <div key={getFileKey(item)}>{content}</div>;
                }

                return (
                  <InteractiveContainer
                    key={getFileKey(item)}
                    onClick={() => onFilePreview(item.file)}
                    useDiv={true}
                    className="w-full cursor-pointer hover:bg-theme-bg-accent"
                    aria-label={`${t`Preview attachment`} ${getFileName(item.file)}`}
                  >
                    {content}
                  </InteractiveContainer>
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
            </div>
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
