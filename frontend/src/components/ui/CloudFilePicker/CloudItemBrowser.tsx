/**
 * CloudItemBrowser component
 *
 * Displays files and folders with selection support and disabled states
 */

import { t } from "@lingui/core/macro";
import { memo } from "react";

import { formatDate, formatFileSize } from "@/stories/ui/cloud/mockCloudData";

import { CloudFileTypeIcon } from "./CloudFileTypeIcon";
import { FolderIcon, InfoIcon } from "../icons";

import type { CloudItem } from "@/lib/api/cloudProviders/types";

interface CloudItemBrowserProps {
  items: CloudItem[];
  selectedIds: string[];
  onToggleItem: (item: CloudItem) => void;
  onOpenFolder: (item: CloudItem) => void;
  canSelect: (item: CloudItem) => boolean;
  getDisabledReason: (item: CloudItem) => string | null;
  isLoading?: boolean;
  multiple?: boolean;
  className?: string;
}

const ItemRowSkeleton = memo(() => (
  <div className="flex animate-pulse items-center gap-3 px-4 py-3">
    <div className="size-4 rounded bg-theme-bg-accent" />
    <div className="size-5 rounded bg-theme-bg-accent" />
    <div className="flex-1">
      <div className="h-4 w-1/3 rounded bg-theme-bg-accent" />
    </div>
    <div className="h-4 w-20 rounded bg-theme-bg-accent" />
    <div className="h-4 w-24 rounded bg-theme-bg-accent" />
  </div>
));

// eslint-disable-next-line lingui/no-unlocalized-strings
ItemRowSkeleton.displayName = "ItemRowSkeleton";

interface ItemRowProps {
  item: CloudItem;
  isSelected: boolean;
  onToggle: (item: CloudItem) => void;
  onOpen: (item: CloudItem) => void;
  canSelect: boolean;
  disabledReason: string | null;
  multiple: boolean;
}

const ItemRow = memo<ItemRowProps>(
  ({
    item,
    isSelected,
    onToggle,
    onOpen,
    canSelect,
    disabledReason,
    multiple,
  }) => {
    const isDisabled = !item.is_folder && disabledReason !== null;

    const handleClick = () => {
      if (item.is_folder) {
        onOpen(item);
      } else if (canSelect) {
        onToggle(item);
      }
    };

    const handleCheckboxChange = () => {
      if (!item.is_folder && canSelect) {
        onToggle(item);
      }
    };

    // Handle keyboard navigation
    const handleKeyDown = (e: React.KeyboardEvent) => {
      // Enter or Space to open folder or toggle selection
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handleClick();
      }
    };

    return (
      <div
        className={`theme-transition flex items-center gap-3 px-4 py-3 hover:bg-theme-bg-hover ${
          isDisabled ? "opacity-50" : ""
        }`}
        role="row"
        onKeyDown={handleKeyDown}
        tabIndex={0}
      >
        {/* Checkbox for files (multiple select mode) */}
        {multiple && !item.is_folder && (
          <input
            type="checkbox"
            checked={isSelected}
            onChange={handleCheckboxChange}
            disabled={isDisabled}
            className="size-4 rounded border-theme-border text-theme-fg-accent focus:ring-theme-focus disabled:cursor-not-allowed"
            aria-label={t({
              id: "cloudItemBrowser.select",
              message: "Select",
            })}
          />
        )}

        {/* Radio for files (single select mode) */}
        {!multiple && !item.is_folder && (
          <input
            type="radio"
            checked={isSelected}
            onChange={handleCheckboxChange}
            disabled={isDisabled}
            className="size-4 border-theme-border text-theme-fg-accent focus:ring-theme-focus disabled:cursor-not-allowed"
            aria-label={t({
              id: "cloudItemBrowser.select",
              message: "Select",
            })}
          />
        )}

        {/* Icon placeholder for folders */}
        {item.is_folder && <div className="size-4" />}

        {/* File/Folder icon */}
        <CloudFileTypeIcon
          isFolder={item.is_folder}
          mimeType={item.mime_type}
          fileName={item.name}
          className="size-5 shrink-0"
        />

        {/* Name (clickable for folders) */}
        <button
          type="button"
          onClick={handleClick}
          disabled={isDisabled && !item.is_folder}
          className={`flex-1 truncate text-left ${
            item.is_folder
              ? "font-medium text-theme-fg-primary hover:underline"
              : "text-theme-fg-primary"
          } ${isDisabled ? "cursor-not-allowed" : "cursor-pointer"} focus:underline focus:outline-none`}
          aria-label={
            item.is_folder
              ? t({ id: "cloudItemBrowser.openFolder", message: "Open folder" })
              : item.name
          }
        >
          {item.name}
        </button>

        {/* Disabled reason tooltip */}
        {isDisabled && disabledReason && (
          <div
            className="flex items-center gap-1 text-xs text-theme-fg-muted"
            title={disabledReason}
          >
            <InfoIcon className="size-4" />
            <span className="hidden sm:inline">{disabledReason}</span>
          </div>
        )}

        {/* Size */}
        <div className="hidden w-20 text-right text-sm text-theme-fg-muted sm:block">
          {formatFileSize(item.size)}
        </div>

        {/* Last modified */}
        <div className="hidden w-24 text-right text-sm text-theme-fg-muted md:block">
          {formatDate(item.last_modified)}
        </div>
      </div>
    );
  },
);

// eslint-disable-next-line lingui/no-unlocalized-strings
ItemRow.displayName = "ItemRow";

export const CloudItemBrowser = memo<CloudItemBrowserProps>(
  ({
    items,
    selectedIds,
    onToggleItem,
    onOpenFolder,
    canSelect,
    getDisabledReason,
    isLoading = false,
    multiple = false,
    className = "",
  }) => {
    if (isLoading) {
      return (
        <div className={`divide-y divide-theme-border ${className}`}>
          <ItemRowSkeleton />
          <ItemRowSkeleton />
          <ItemRowSkeleton />
          <ItemRowSkeleton />
          <ItemRowSkeleton />
        </div>
      );
    }

    if (items.length === 0) {
      return (
        <div
          className={`flex flex-col items-center justify-center py-12 text-center ${className}`}
        >
          <FolderIcon className="mb-3 size-12 text-theme-fg-muted" />
          <p className="text-sm text-theme-fg-muted">
            {t({
              id: "cloudItemBrowser.empty.noFiles",
              message: "No files in this folder",
            })}
          </p>
        </div>
      );
    }

    // Separate folders and files, sort alphabetically within each group
    const folders = items
      .filter((item) => item.is_folder)
      .sort((a, b) => a.name.localeCompare(b.name));

    const files = items
      .filter((item) => !item.is_folder)
      .sort((a, b) => a.name.localeCompare(b.name));

    const sortedItems = [...folders, ...files];

    return (
      <div className={`divide-y divide-theme-border ${className}`} role="table">
        {/* Header */}
        <div
          className="flex items-center gap-3 bg-theme-bg-secondary px-4 py-2 text-xs font-medium uppercase tracking-wider text-theme-fg-muted"
          role="row"
        >
          {multiple && <div className="size-4" />}
          {!multiple && <div className="size-4" />}
          <div className="size-5" />
          <div className="flex-1">
            {t({ id: "cloudItemBrowser.column.name", message: "Name" })}
          </div>
          <div className="hidden w-20 text-right sm:block">
            {t({ id: "cloudItemBrowser.column.size", message: "Size" })}
          </div>
          <div className="hidden w-24 text-right md:block">
            {t({ id: "cloudItemBrowser.column.modified", message: "Modified" })}
          </div>
        </div>

        {/* Items */}
        {sortedItems.map((item) => (
          <ItemRow
            key={item.id}
            item={item}
            isSelected={selectedIds.includes(item.id)}
            onToggle={onToggleItem}
            onOpen={onOpenFolder}
            canSelect={canSelect(item)}
            disabledReason={getDisabledReason(item)}
            multiple={multiple}
          />
        ))}
      </div>
    );
  },
);

// eslint-disable-next-line lingui/no-unlocalized-strings
CloudItemBrowser.displayName = "CloudItemBrowser";
