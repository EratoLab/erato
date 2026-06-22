import { t } from "@lingui/core/macro";
import clsx from "clsx";

import { Button } from "@/components/ui/Controls/Button";

import type {
  AssistantStoreCategory,
  AssistantStoreVersion,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type React from "react";

export const isAssistantStoreReviewAcceptedStatus = (status: string) =>
  status === "review_accepted" || status === "accepted";

export const isAssistantStoreReviewDeclinedStatus = (status: string) =>
  status === "review_declined" || status === "declined";

export const getAssistantStoreStatusLabel = (status: string) => {
  switch (status) {
    case "submitted":
      return t({
        id: "assistantStore.status.submitted",
        message: "In review",
      });
    case "review_accepted":
    case "accepted":
      return t({ id: "assistantStore.status.accepted", message: "Accepted" });
    case "review_declined":
    case "declined":
      return t({ id: "assistantStore.status.declined", message: "Declined" });
    case "withdrawn":
      return t({
        id: "assistantStore.status.withdrawn",
        message: "Withdrawn",
      });
    default:
      return status;
  }
};

export const getAssistantStoreStatusClassName = (status: string) =>
  clsx(
    // eslint-disable-next-line lingui/no-unlocalized-strings -- Tailwind class list
    "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
    isAssistantStoreReviewAcceptedStatus(status) &&
      "border border-theme-success-border bg-theme-success-bg text-theme-success-fg",
    isAssistantStoreReviewDeclinedStatus(status) &&
      "border border-theme-error-border bg-theme-error-bg text-theme-error-fg",
    status === "withdrawn" &&
      "border border-theme-border bg-theme-bg-secondary text-theme-fg-muted",
    status === "submitted" &&
      "border border-theme-warning-border bg-theme-warning-bg text-theme-warning-fg",
  );

export function AssistantStoreBreadcrumb({
  children,
  icon,
  onClick,
}: {
  children: React.ReactNode;
  icon?: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="focus-ring theme-transition inline-flex items-center gap-2 text-sm text-theme-fg-muted hover:text-theme-fg-primary hover:underline"
    >
      {icon}
      <span>{children}</span>
    </button>
  );
}

const formatFileDiffValue = (value: unknown): string => {
  if (!Array.isArray(value) || value.length === 0) return t`None`;

  return value
    .map((item) => {
      if (typeof item === "string") return item;
      if (isRecord(item)) {
        const filename = item.filename;
        const id = item.id;
        if (typeof filename === "string" && filename.length > 0) {
          return filename;
        }
        if (typeof id === "string") return id;
      }

      return formatDiffValue(item);
    })
    .join(", ");
};

const formatDiffValue = (value: unknown, field?: string): string => {
  if (value === null || value === undefined) return t`Not set`;
  if (field === "files" || field === "file_ids") {
    return formatFileDiffValue(value);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return t`None`;
    if (
      value.every(
        (item) =>
          item === null ||
          ["boolean", "number", "string"].includes(typeof item),
      )
    ) {
      return value.map((item) => formatDiffValue(item)).join(", ");
    }

    return JSON.stringify(value, null, 2);
  }
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  if (typeof value === "boolean") return value ? t`Yes` : t`No`;
  return String(value);
};

const normalizeDiffLabel = (key: string) => {
  if (key === "files" || key === "file_ids") {
    return t({ id: "assistantStore.diff.files", message: "Files" });
  }

  return key
    .replaceAll("_", " ")
    .replace(/^\w/, (first) => first.toUpperCase());
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

type NormalizedDiffChange = {
  field: string;
  before: unknown;
  after: unknown;
  changed: boolean;
};

const normalizeDiffChanges = (
  diffSummary: Record<string, unknown>,
): NormalizedDiffChange[] => {
  const changes = diffSummary.changes;

  if (Array.isArray(changes)) {
    return changes
      .filter(isRecord)
      .map((change, index) => {
        const field =
          typeof change.field === "string" ? change.field : String(index + 1);

        return {
          field,
          before: change.before,
          after: change.after,
          changed: change.changed !== false,
        };
      })
      .filter((change) => change.changed);
  }

  return Object.entries(diffSummary)
    .filter(([field]) => field !== "baseline_version_id")
    .map(([field, value]) => {
      if (isRecord(value)) {
        const hasBeforeAfter =
          "before" in value ||
          "previous" in value ||
          "after" in value ||
          "current" in value;

        if (hasBeforeAfter) {
          return {
            field,
            before: value.before ?? value.previous,
            after: value.after ?? value.current,
            changed: value.changed !== false,
          };
        }
      }

      return {
        field,
        before: undefined,
        after: value,
        changed: true,
      };
    })
    .filter((change) => change.changed);
};

export function AssistantStoreDiff({
  diffSummary,
}: {
  diffSummary: Record<string, unknown>;
}) {
  const changes = normalizeDiffChanges(diffSummary);

  if (changes.length === 0) {
    return (
      <p className="text-sm text-theme-fg-secondary">
        {t({
          id: "assistantStore.diff.noChanges",
          message: "No changes compared with the previous accepted version.",
        })}
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-theme-border">
      <div className="divide-y divide-theme-border">
        {changes.map((change) => {
          return (
            <div
              key={change.field}
              className="grid gap-3 bg-theme-bg-primary p-4 md:grid-cols-[180px_1fr]"
            >
              <div className="text-sm font-medium text-theme-fg-primary">
                {normalizeDiffLabel(change.field)}
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <div className="mb-1 text-xs font-medium uppercase text-theme-fg-muted">
                    {t({
                      id: "assistantStore.diff.previous",
                      message: "Previous",
                    })}
                  </div>
                  <pre className="whitespace-pre-wrap break-words rounded bg-theme-bg-secondary p-3 text-sm text-theme-fg-secondary">
                    {formatDiffValue(change.before, change.field)}
                  </pre>
                </div>
                <div>
                  <div className="mb-1 text-xs font-medium uppercase text-theme-fg-muted">
                    {t({
                      id: "assistantStore.diff.current",
                      message: "Current",
                    })}
                  </div>
                  <pre className="whitespace-pre-wrap break-words rounded bg-theme-bg-secondary p-3 text-sm text-theme-fg-primary">
                    {formatDiffValue(change.after, change.field)}
                  </pre>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function AssistantStoreVersionCard({
  version,
  categories,
  onOpen,
  actions,
}: {
  version: AssistantStoreVersion;
  categories: AssistantStoreCategory[];
  onOpen?: () => void;
  actions?: React.ReactNode;
}) {
  const categoryNames = version.category_ids
    .map((categoryId) =>
      categories.find((category) => category.id === categoryId),
    )
    .filter(Boolean)
    .map((category) => category?.display_name);
  const creatorName = version.creator.display_name;

  return (
    <div className="rounded-lg border border-theme-border bg-theme-bg-primary p-4">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          onClick={onOpen}
          disabled={!onOpen}
        >
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-theme-fg-primary">
              {version.assistant.name}
            </h3>
            <span className={getAssistantStoreStatusClassName(version.status)}>
              {getAssistantStoreStatusLabel(version.status)}
            </span>
            {version.featured && (
              <span className="inline-flex items-center rounded-full border border-theme-border bg-theme-bg-secondary px-2 py-0.5 text-xs font-medium text-theme-fg-secondary">
                {t({
                  id: "assistantStore.badge.featured",
                  message: "Featured",
                })}
              </span>
            )}
            {version.is_current_published_version && (
              <span className="inline-flex items-center rounded-full border border-theme-border bg-theme-bg-secondary px-2 py-0.5 text-xs font-medium text-theme-fg-secondary">
                {t({
                  id: "assistantStore.badge.current",
                  message: "Current",
                })}
              </span>
            )}
            {version.is_published && (
              <span className="inline-flex items-center rounded-full border border-theme-border bg-theme-bg-secondary px-2 py-0.5 text-xs font-medium text-theme-fg-secondary">
                {t({
                  id: "assistantStore.badge.published",
                  message: "Published",
                })}
              </span>
            )}
          </div>
          <p className="line-clamp-2 text-sm text-theme-fg-secondary">
            {version.long_description.length > 0
              ? version.long_description
              : (version.assistant.description ?? "")}
          </p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-theme-fg-muted">
            {(() => {
              const versionNumber = version.version_number;

              return <span>{t`Version ${versionNumber}`}</span>;
            })()}
            {creatorName && (
              <span>
                {t({
                  id: "assistantStore.card.creator",
                  message: "By {creatorName}",
                  values: { creatorName },
                })}
              </span>
            )}
            {categoryNames.map((categoryName) => (
              <span key={categoryName}>{categoryName}</span>
            ))}
          </div>
        </button>
        <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>
      </div>
    </div>
  );
}

export function EmptyAssistantStoreState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="max-w-md text-center">
        <h2 className="mb-2 text-xl font-semibold text-theme-fg-primary">
          {title}
        </h2>
        <p className="mb-6 text-theme-fg-secondary">{description}</p>
        {action}
      </div>
    </div>
  );
}

export const RefreshButton = ({
  onClick,
  loading,
}: {
  onClick: () => void;
  loading?: boolean;
}) => (
  <Button variant="secondary" size="sm" loading={loading} onClick={onClick}>
    {t({ id: "assistantStore.action.refresh", message: "Refresh" })}
  </Button>
);
