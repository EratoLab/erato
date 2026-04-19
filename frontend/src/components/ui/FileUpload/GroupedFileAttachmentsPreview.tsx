import { t } from "@lingui/core/macro";
import clsx from "clsx";
import { useState } from "react";

import { componentRegistry } from "@/config/componentRegistry";

import { getFileName, type FileResource } from "./FilePreviewBase";
import { FilePreviewButton } from "./FilePreviewButton";
import { FilePreviewLoading } from "./FilePreviewLoading";
import { FILE_PREVIEW_STYLES } from "./fileUploadStyles";
import { InteractiveContainer } from "../Container/InteractiveContainer";
import { Button } from "../Controls/Button";

import type React from "react";

export interface FileAttachmentGroupItem {
  id: string;
  file: FileResource;
  isLoading?: boolean;
  /**
   * Optional display label for the item's metadata row. When set, renderers
   * should show this verbatim instead of deriving a label from the file's
   * capability / extension. Useful for items synthesised client-side whose
   * backend capability id would not read well (e.g. email body rendered as
   * `.html` but meant to be labelled "Email").
   */
  labelOverride?: string;
}

export interface FileAttachmentGroup {
  id: string;
  label: string;
  items: FileAttachmentGroupItem[];
  metaLabel?: string;
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

function getFileKey(item: FileAttachmentGroupItem): string {
  if ("id" in item.file) {
    return item.file.id;
  }

  return `${item.id}:${item.file.name}`;
}

function getFileId(item: FileAttachmentGroupItem): string {
  if ("id" in item.file) {
    return item.file.id;
  }

  return item.id;
}

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

  const setGroupExpanded = (groupId: string, expanded: boolean) => {
    setExpandedGroupIds((previous) => {
      if (expanded) {
        return previous.includes(groupId) ? previous : [...previous, groupId];
      }

      return previous.filter((id) => id !== groupId);
    });
  };

  if (groups.length === 0) {
    return null;
  }

  return (
    <div className={clsx("mb-3 flex flex-col gap-3", className)}>
      {groups.map((group) => {
        const itemCount = group.items.length;
        const isExpanded = expandedGroupIds.includes(group.id);
        const shouldCollapse = itemCount > defaultVisibleItems;
        const visibleItems =
          shouldCollapse && !isExpanded
            ? group.items.slice(0, defaultVisibleItems)
            : group.items;
        const hiddenCount = itemCount - visibleItems.length;

        return (
          <section
            key={group.id}
            className={FILE_PREVIEW_STYLES.group.container}
          >
            <div className={FILE_PREVIEW_STYLES.group.header}>
              <div className="min-w-0">
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

            <div className="flex flex-col gap-2">
              {visibleItems.map((item) => {
                if (item.isLoading) {
                  return (
                    <FilePreviewLoading
                      key={item.id}
                      className="w-full"
                      label={t`Loading attachment...`}
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
