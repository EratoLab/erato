import { t } from "@lingui/core/macro";
import clsx from "clsx";
import { useMemo } from "react";

import { getFacetDisplayName } from "@/components/ui/Chat/FacetSelector";
import { ModelSelectorOptionContent } from "@/components/ui/Chat/ModelSelector";
import { Button } from "@/components/ui/Controls/Button";
import { FileTextIcon, ResolvedIcon } from "@/components/ui/icons";
import {
  useAvailableModels,
  useFacets,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";

import type {
  AssistantHubCategory,
  AssistantHubVersion,
  AssistantWithFiles,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type React from "react";

export const isAssistantHubReviewAcceptedStatus = (status: string) =>
  status === "review_accepted" || status === "accepted";

export const isAssistantHubReviewDeclinedStatus = (status: string) =>
  status === "review_declined" || status === "declined";

export const getAssistantHubStatusLabel = (status: string) => {
  switch (status) {
    case "submitted":
      return t({
        id: "assistantHub.status.submitted",
        message: "In review",
      });
    case "review_accepted":
    case "accepted":
      return t({ id: "assistantHub.status.accepted", message: "Accepted" });
    case "review_declined":
    case "declined":
      return t({ id: "assistantHub.status.declined", message: "Declined" });
    case "withdrawn":
      return t({
        id: "assistantHub.status.withdrawn",
        message: "Withdrawn",
      });
    default:
      return status;
  }
};

export const getAssistantHubStatusClassName = (status: string) =>
  clsx(
    // eslint-disable-next-line lingui/no-unlocalized-strings -- Tailwind class list
    "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
    isAssistantHubReviewAcceptedStatus(status) &&
      "border border-theme-success-border bg-theme-success-bg text-theme-success-fg",
    isAssistantHubReviewDeclinedStatus(status) &&
      "border border-theme-error-border bg-theme-error-bg text-theme-error-fg",
    status === "withdrawn" &&
      "border border-theme-border bg-theme-bg-secondary text-theme-fg-muted",
    status === "submitted" &&
      "border border-theme-warning-border bg-theme-warning-bg text-theme-warning-fg",
  );

export const getAssistantHubRatingLabel = (version: AssistantHubVersion) => {
  const averageScore = version.review_average_score;

  if (version.review_count === 0 || averageScore == null) {
    return t({
      id: "assistantHub.rating.none",
      message: "No ratings yet",
    });
  }

  const formattedScore = averageScore.toFixed(1);
  const reviewCount = version.review_count;

  if (reviewCount === 1) {
    return t({
      id: "assistantHub.rating.summary.one",
      message: `${formattedScore} / 10 (1 rating)`,
    });
  }

  return t({
    id: "assistantHub.rating.summary.many",
    message: `${formattedScore} / 10 (${reviewCount} ratings)`,
  });
};

export function AssistantHubCurrentPublishedIndicator() {
  return (
    <span className="inline-flex min-h-6 items-center rounded-full border border-theme-info-border bg-theme-info-bg px-2 py-0.5 text-xs font-medium text-theme-info-fg">
      {t({
        id: "assistantHub.my.currentPublished",
        message: "Current published version",
      })}
    </span>
  );
}

export function AssistantHubBreadcrumb({
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
  if (!Array.isArray(value) || value.length === 0) {
    return t({ id: "common.none", message: "None" });
  }

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
  if (value === null || value === undefined) {
    return t({ id: "common.notSet", message: "Not set" });
  }
  if (field === "files" || field === "file_ids") {
    return formatFileDiffValue(value);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return t({ id: "common.none", message: "None" });
    }
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
  if (typeof value === "boolean") {
    return value
      ? t({ id: "common.yes", message: "Yes" })
      : t({ id: "common.no", message: "No" });
  }
  return String(value);
};

const normalizeDiffLabel = (key: string) => {
  if (key === "files" || key === "file_ids") {
    return t({ id: "assistantHub.diff.files", message: "Files" });
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

export function AssistantHubDiff({
  diffSummary,
}: {
  diffSummary: Record<string, unknown>;
}) {
  const changes = normalizeDiffChanges(diffSummary);

  if (changes.length === 0) {
    return (
      <p className="text-sm text-theme-fg-secondary">
        {t({
          id: "assistantHub.diff.noChanges",
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
                      id: "assistantHub.diff.previous",
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
                      id: "assistantHub.diff.current",
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

export function AssistantHubVersionCard({
  version,
  categories,
  onOpen,
  actions,
  showStatusBadge = false,
  showCurrentPublishedIndicator = false,
}: {
  version: AssistantHubVersion;
  categories: AssistantHubCategory[];
  onOpen?: () => void;
  actions?: React.ReactNode;
  showStatusBadge?: boolean;
  showCurrentPublishedIndicator?: boolean;
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
          </div>
          <p className="line-clamp-2 text-sm text-theme-fg-secondary">
            {version.long_description.length > 0
              ? version.long_description
              : (version.assistant.description ?? "")}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-theme-fg-muted">
            {(() => {
              const versionNumber = version.version_number;

              return (
                <span className="inline-flex min-h-6 items-center">
                  {t({
                    id: "assistantHub.version.label",
                    message: `Version ${versionNumber}`,
                  })}
                </span>
              );
            })()}
            {showStatusBadge ? (
              <span className={getAssistantHubStatusClassName(version.status)}>
                {getAssistantHubStatusLabel(version.status)}
              </span>
            ) : (
              <span className="inline-flex min-h-6 items-center">
                {getAssistantHubStatusLabel(version.status)}
              </span>
            )}
            {showCurrentPublishedIndicator &&
              version.is_current_published_version && (
                <AssistantHubCurrentPublishedIndicator />
              )}
            {creatorName && (
              <span className="inline-flex min-h-6 items-center">
                {`${t({
                  id: "assistantHub.card.creator",
                  message: "By",
                })} ${creatorName}`}
              </span>
            )}
            {categoryNames.map((categoryName) => (
              <span
                key={categoryName}
                className="inline-flex min-h-6 items-center"
              >
                {categoryName}
              </span>
            ))}
            <span className="inline-flex min-h-6 items-center font-medium text-theme-fg-secondary">
              {getAssistantHubRatingLabel(version)}
            </span>
          </div>
        </button>
        <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>
      </div>
    </div>
  );
}

export function AssistantHubVersionOverviewSection({
  version,
  categories,
  onStartChat,
}: {
  version: AssistantHubVersion;
  categories: AssistantHubCategory[];
  onStartChat?: () => void;
}) {
  const categoryNames = version.category_ids
    .map((categoryId) =>
      categories.find((category) => category.id === categoryId),
    )
    .filter(Boolean)
    .map((category) => category?.display_name);
  const creatorName = version.creator.display_name;

  return (
    <section className="rounded-lg border border-theme-border bg-theme-bg-primary p-6">
      <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-theme-fg-primary">
            {version.assistant.name}
          </h1>
          {version.assistant.description && (
            <p className="mt-2 text-sm text-theme-fg-secondary">
              {version.assistant.description}
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-theme-fg-muted">
            {creatorName && (
              <span>
                {`${t({
                  id: "assistantHub.card.creator",
                  message: "By",
                })} ${creatorName}`}
              </span>
            )}
            {categoryNames.map((categoryName) => (
              <span key={categoryName}>{categoryName}</span>
            ))}
            <span className="font-medium text-theme-fg-secondary">
              {getAssistantHubRatingLabel(version)}
            </span>
          </div>
        </div>
        {onStartChat && (
          <Button variant="primary" onClick={onStartChat}>
            {t({
              id: "assistantHub.action.startChat",
              message: "Start chat",
            })}
          </Button>
        )}
      </div>

      <p className="mt-5 whitespace-pre-wrap text-theme-fg-primary">
        {version.long_description}
      </p>
      {version.keywords.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {version.keywords.map((keyword) => (
            <span
              key={keyword}
              className="rounded border border-theme-border bg-theme-bg-secondary px-2 py-1 text-xs text-theme-fg-secondary"
            >
              {keyword}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

export function AssistantHubVersionConfigurationSection({
  version,
  assistantDetails,
}: {
  version: AssistantHubVersion;
  assistantDetails?: AssistantWithFiles;
}) {
  const { data: availableModels = [], isLoading: isLoadingModels } =
    useAvailableModels({});
  const { data: facetsData, isLoading: isLoadingFacets } = useFacets({});
  const defaultModelId = version.assistant.default_chat_provider;
  const defaultModel = useMemo(
    () =>
      defaultModelId
        ? (availableModels.find(
            (model) => model.chat_provider_id === defaultModelId,
          ) ?? null)
        : null,
    [availableModels, defaultModelId],
  );
  const availableFacets = useMemo(() => facetsData?.facets ?? [], [facetsData]);
  const configuredFacetIds = useMemo(
    () => version.assistant.facet_ids ?? [],
    [version.assistant.facet_ids],
  );
  const configuredFacets = useMemo(
    () =>
      configuredFacetIds.map((facetId) => ({
        facetId,
        facet:
          availableFacets.find(
            (availableFacet) => availableFacet.id === facetId,
          ) ?? null,
      })),
    [availableFacets, configuredFacetIds],
  );

  return (
    <section className="rounded-lg border border-theme-border bg-theme-bg-primary p-6">
      <h2 className="mb-4 text-lg font-semibold text-theme-fg-primary">
        {t({
          id: "assistantHub.detail.configuration",
          message: "Configuration",
        })}
      </h2>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <div className="mb-1 text-sm font-medium text-theme-fg-primary">
            {t({
              id: "assistantHub.detail.model",
              message: "Default model",
            })}
          </div>
          <div className="text-sm text-theme-fg-secondary">
            {defaultModel ? (
              <ModelSelectorOptionContent model={defaultModel} compact />
            ) : defaultModelId && isLoadingModels ? (
              t({ id: "common.loadingEllipsis", message: "Loading..." })
            ) : (
              (defaultModelId ?? t({ id: "common.notSet", message: "Not set" }))
            )}
          </div>
        </div>
        <div>
          <div className="mb-1 text-sm font-medium text-theme-fg-primary">
            {t({
              id: "assistantHub.detail.facets",
              message: "Tools",
            })}
          </div>
          {configuredFacets.length > 0 ? (
            <ul className="space-y-1 text-sm text-theme-fg-secondary">
              {configuredFacets.map(({ facetId, facet }) => (
                <li key={facetId} className="flex items-center gap-2">
                  {facet?.icon ? (
                    <ResolvedIcon
                      iconId={facet.icon}
                      className="size-4 shrink-0"
                    />
                  ) : null}
                  <span>
                    {facet
                      ? getFacetDisplayName(facet)
                      : isLoadingFacets
                        ? t({
                            id: "common.loadingEllipsis",
                            message: "Loading...",
                          })
                        : facetId}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-theme-fg-secondary">
              {t({ id: "common.none", message: "None" })}
            </p>
          )}
        </div>
        <div>
          <div className="mb-1 text-sm font-medium text-theme-fg-primary">
            {t({
              id: "assistantHub.detail.files",
              message: "Files",
            })}
          </div>
          {assistantDetails?.files.length ? (
            <ul className="space-y-1 text-sm text-theme-fg-secondary">
              {assistantDetails.files.map((file) => (
                <li key={file.id} className="flex items-center gap-2">
                  <FileTextIcon className="size-4 shrink-0" />
                  <span>{file.filename}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-theme-fg-secondary">
              {t({ id: "common.none", message: "None" })}
            </p>
          )}
        </div>
      </div>
      <div className="mt-6">
        <div className="mb-2 text-sm font-medium text-theme-fg-primary">
          {t({
            id: "assistantHub.detail.prompt",
            message: "System prompt",
          })}
        </div>
        <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-theme-border bg-theme-bg-secondary p-4 text-sm text-theme-fg-primary">
          {version.assistant.prompt}
        </pre>
      </div>
    </section>
  );
}

export function EmptyAssistantHubState({
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
    {t({ id: "assistantHub.action.refresh", message: "Refresh" })}
  </Button>
);
