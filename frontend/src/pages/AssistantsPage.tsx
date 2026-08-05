import { t } from "@lingui/core/macro";
import { skipToken } from "@tanstack/react-query";
import clsx from "clsx";
import { formatDistanceToNow } from "date-fns";
import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";

import { PageHeader } from "@/components/ui/Container/PageHeader";
import { Button } from "@/components/ui/Controls/Button";
import { DropdownMenu } from "@/components/ui/Controls/DropdownMenu";
import { SegmentedControl } from "@/components/ui/Controls/SegmentedControl";
import { Alert } from "@/components/ui/Feedback/Alert";
import { Input } from "@/components/ui/Input";
import { SharingDialog, SharingErrorBoundary } from "@/components/ui/Sharing";
import {
  ArrowLeftIcon,
  CheckCircleIcon,
  EditIcon,
  FileTextIcon,
  LogOutIcon,
  PlusIcon,
  ResolvedIcon,
  SearchIcon,
  ShareIcon,
} from "@/components/ui/icons";
import { usePageAlignment } from "@/hooks/ui";
import { useDateFnsLocale } from "@/hooks/useDateFnsLocale";
import {
  useArchiveAssistant,
  useAssistantHubConfig,
  useListAssistantHubAssistants,
  useListAssistants,
  useListMyAssistantHubVersions,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { createLogger } from "@/utils/debugLogger";

import {
  AssistantHubBreadcrumb,
  AssistantHubVersionCard,
  EmptyAssistantHubState,
  isAssistantHubReviewAcceptedStatus,
  isAssistantHubReviewDeclinedStatus,
} from "./assistantHubUtils";

import type {
  Assistant,
  AssistantHubCategory,
  AssistantHubConfigResponse,
  AssistantHubVersion,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const logger = createLogger("UI", "AssistantsPage");
const ASSISTANT_HUB_PAGE_SIZE = 18;

export type AssistantsLandingView =
  | "hub"
  | "shared_with_user"
  | "owned_by_user";

interface AssistantsPageProps {
  view: AssistantsLandingView;
}

const viewRoutes: Record<AssistantsLandingView, string> = {
  // eslint-disable-next-line lingui/no-unlocalized-strings -- Internal route path
  hub: "/assistant-hub",
  // eslint-disable-next-line lingui/no-unlocalized-strings -- Internal route path
  shared_with_user: "/assistants",
  // eslint-disable-next-line lingui/no-unlocalized-strings -- Internal route path
  owned_by_user: "/assistants/created",
};

const sortHubVersions = (versions: AssistantHubVersion[]) =>
  [...versions].sort((left, right) => {
    if (left.featured !== right.featured) return left.featured ? -1 : 1;
    return (
      new Date(right.published_at ?? right.updated_at).getTime() -
      new Date(left.published_at ?? left.updated_at).getTime()
    );
  });

const versionMatchesSearch = (
  version: AssistantHubVersion,
  categories: AssistantHubCategory[],
  searchQuery: string,
) => {
  const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
  if (!normalizedQuery) return true;

  const categoryNames = version.category_ids
    .map((categoryId) =>
      categories.find((category) => category.id === categoryId),
    )
    .filter(Boolean)
    .map((category) => category?.display_name ?? "");
  const searchableValues = [
    version.assistant.name,
    version.assistant.description ?? "",
    version.long_description,
    version.version_number,
    version.version_comment ?? "",
    ...version.keywords,
    ...categoryNames,
  ];

  return searchableValues.some((value) =>
    value.toLocaleLowerCase().includes(normalizedQuery),
  );
};

const assistantMatchesSearch = (assistant: Assistant, searchQuery: string) => {
  const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
  if (!normalizedQuery) return true;

  return [assistant.name, assistant.description ?? ""].some((value) =>
    value.toLocaleLowerCase().includes(normalizedQuery),
  );
};

/* eslint-disable lingui/no-unlocalized-strings -- Internal Hub lifecycle identifiers and Tailwind class lists */
type OwnedAssistantStatus =
  | "in_review"
  | "published"
  | "unpublished"
  | "declined"
  | "not_submitted"
  | "archived";

type OwnedAssistantStatusFilter = "all" | OwnedAssistantStatus;

const OWNED_ASSISTANT_STATUS_FILTERS: OwnedAssistantStatusFilter[] = [
  "all",
  "not_submitted",
  "in_review",
  "published",
  "unpublished",
  "declined",
  "archived",
];

const getOwnedAssistantStatus = (
  assistant: Assistant,
  versions: AssistantHubVersion[],
): OwnedAssistantStatus => {
  if (assistant.archived_at) return "archived";

  const assistantVersions = versions
    .filter((version) => version.source_assistant_id === assistant.id)
    .sort(
      (left, right) =>
        new Date(right.submitted_at).getTime() -
        new Date(left.submitted_at).getTime(),
    );
  const latestVersion = assistantVersions.at(0);

  if (!latestVersion) return "not_submitted";
  if (latestVersion.status === "submitted") return "in_review";
  if (isAssistantHubReviewDeclinedStatus(latestVersion.status)) {
    return "declined";
  }
  if (isAssistantHubReviewAcceptedStatus(latestVersion.status)) {
    return latestVersion.is_published ? "published" : "unpublished";
  }
  if (assistantVersions.some((version) => version.is_published)) {
    return "published";
  }

  return "not_submitted";
};

const getOwnedAssistantStatusLabel = (status: OwnedAssistantStatusFilter) => {
  switch (status) {
    case "all":
      return t({ id: "assistants.status.all", message: "All" });
    case "in_review":
      return t({
        id: "assistants.status.inReview",
        message: "In review",
      });
    case "published":
      return t({
        id: "assistants.status.published",
        message: "Published",
      });
    case "unpublished":
      return t({
        id: "assistants.status.unpublished",
        message: "Unpublished",
      });
    case "declined":
      return t({
        id: "assistants.status.declined",
        message: "Declined",
      });
    case "not_submitted":
      return t({
        id: "assistants.status.notSubmitted",
        message: "Not submitted",
      });
    case "archived":
      return t({
        id: "assistants.status.archived",
        message: "Archived",
      });
  }
};

const getOwnedAssistantStatusClassName = (status: OwnedAssistantStatus) =>
  clsx(
    "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
    status === "in_review" &&
      "border-theme-info-border bg-theme-info-bg text-theme-info-fg",
    status === "published" &&
      "border-theme-success-border bg-theme-success-bg text-theme-success-fg",
    status === "declined" &&
      "border-theme-error-border bg-theme-error-bg text-theme-error-fg",
    ["archived", "not_submitted", "unpublished"].includes(status) &&
      "border-theme-border bg-theme-bg-secondary text-theme-fg-muted",
  );
/* eslint-enable lingui/no-unlocalized-strings */

function LoadingState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="text-center">
        <div className="mx-auto mb-4 size-8 animate-spin rounded-full border-2 border-theme-border border-t-transparent"></div>
        <p className="text-sm text-theme-fg-secondary">{message}</p>
      </div>
    </div>
  );
}

function AssistantsSearch({
  ariaLabel,
  searchQuery,
  setSearchQuery,
}: {
  ariaLabel: string;
  searchQuery: string;
  setSearchQuery: (value: string) => void;
}) {
  return (
    <div className="min-w-0 flex-1">
      <Input
        type="search"
        value={searchQuery}
        onChange={(event) => setSearchQuery(event.target.value)}
        placeholder={t({
          id: "assistantHub.search.placeholder",
          message: "Search assistants...",
        })}
        aria-label={ariaLabel}
      />
    </div>
  );
}

function CategoryTile({
  category,
  count,
  onOpen,
}: {
  category: AssistantHubCategory;
  count: number;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="focus-ring theme-transition group rounded-[var(--theme-radius-shell)] border border-theme-border bg-theme-bg-primary p-4 text-left hover:border-theme-border-focus hover:bg-theme-bg-hover"
    >
      <div className="mb-4 flex size-10 items-center justify-center rounded bg-theme-bg-secondary text-theme-fg-secondary group-hover:text-theme-fg-primary">
        <ResolvedIcon
          iconId={category.icon}
          fallbackIcon={FileTextIcon}
          className="size-5"
        />
      </div>
      <h3 className="mb-1 text-base font-semibold text-theme-fg-primary">
        {category.display_name}
      </h3>
      <p className="text-sm text-theme-fg-secondary">
        {count === 1
          ? t({
              id: "assistantHub.category.count.one",
              message: "1 assistant",
            })
          : t({
              id: "assistantHub.category.count.many",
              message: `${count} assistants`,
            })}
      </p>
    </button>
  );
}

function HubLandingView({
  categoryId,
  config,
  searchQuery,
}: {
  categoryId?: string;
  config: AssistantHubConfigResponse;
  searchQuery: string;
}) {
  const navigate = useNavigate();
  const loadMoreAssistantsRef = useRef<HTMLDivElement | null>(null);
  const [visibleAssistantCount, setVisibleAssistantCount] = useState(
    ASSISTANT_HUB_PAGE_SIZE,
  );
  const {
    data,
    isLoading: isLoadingAssistants,
    error,
  } = useListAssistantHubAssistants({});

  const selectedCategory = useMemo(
    () => config.categories.find((category) => category.id === categoryId),
    [categoryId, config.categories],
  );
  const isCategoryPage = categoryId != null;
  const versions = useMemo(() => data?.versions ?? [], [data?.versions]);
  const sortedVersions = useMemo(() => sortHubVersions(versions), [versions]);
  const featuredVersions = useMemo(
    () => sortedVersions.filter((version) => version.featured),
    [sortedVersions],
  );
  const categoryTiles = useMemo(
    () =>
      config.categories.map((category) => ({
        category,
        count: versions.filter((version) =>
          version.category_ids.includes(category.id),
        ).length,
      })),
    [config.categories, versions],
  );
  const filteredVersions = useMemo(() => {
    const categoryFilteredVersions =
      categoryId == null
        ? sortedVersions
        : sortedVersions.filter((version) =>
            version.category_ids.includes(categoryId),
          );

    return categoryFilteredVersions.filter((version) =>
      versionMatchesSearch(version, config.categories, searchQuery),
    );
  }, [categoryId, config.categories, searchQuery, sortedVersions]);

  const showSearchResults = !isCategoryPage && searchQuery.trim().length > 0;
  const visibleAllVersions = sortedVersions.slice(0, visibleAssistantCount);
  const hasMoreAssistants = visibleAssistantCount < sortedVersions.length;

  useEffect(() => {
    const sentinel = loadMoreAssistantsRef.current;
    if (
      !sentinel ||
      !hasMoreAssistants ||
      isCategoryPage ||
      showSearchResults
    ) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          setVisibleAssistantCount((currentCount) =>
            Math.min(
              currentCount + ASSISTANT_HUB_PAGE_SIZE,
              sortedVersions.length,
            ),
          );
        }
      },
      { rootMargin: "240px" }, // eslint-disable-line lingui/no-unlocalized-strings -- IntersectionObserver CSS length, not user-facing text
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [
    hasMoreAssistants,
    isCategoryPage,
    showSearchResults,
    sortedVersions.length,
    visibleAssistantCount,
  ]);

  return (
    <>
      {isCategoryPage && (
        <>
          <AssistantHubBreadcrumb
            icon={<ArrowLeftIcon className="size-4" />}
            onClick={() => navigate("/assistant-hub")}
          >
            {t({
              id: "assistantHub.action.backToHub",
              message: "Back to hub",
            })}
          </AssistantHubBreadcrumb>
          {selectedCategory && (
            <div>
              <h2 className="text-xl font-semibold text-theme-fg-primary">
                {selectedCategory.display_name}
              </h2>
              <p className="mt-1 text-sm text-theme-fg-secondary">
                {t({
                  id: "assistantHub.category.subtitle",
                  message: "Browse assistants filtered by category",
                })}
              </p>
            </div>
          )}
        </>
      )}

      {isLoadingAssistants && (
        <LoadingState
          message={t({
            id: "assistantHub.loading",
            message: "Loading assistant hub...",
          })}
        />
      )}

      {error && (
        <Alert type="error">
          {t({
            id: "assistantHub.error.load",
            message: "Failed to load assistant hub.",
          })}
        </Alert>
      )}

      {!isLoadingAssistants && !error && versions.length === 0 && (
        <EmptyAssistantHubState
          title={t({
            id: "assistantHub.empty.title",
            message: "No published assistants yet",
          })}
          description={t({
            id: "assistantHub.empty.description",
            message:
              "Accepted and published assistant versions will appear here.",
          })}
        />
      )}

      {!isLoadingAssistants &&
        !error &&
        isCategoryPage &&
        selectedCategory == null && (
          <EmptyAssistantHubState
            title={t({
              id: "assistantHub.category.notFound.title",
              message: "Category not found",
            })}
            description={t({
              id: "assistantHub.category.notFound.description",
              message:
                "This assistant hub category is not currently configured.",
            })}
          />
        )}

      {!isLoadingAssistants &&
        !error &&
        (isCategoryPage || showSearchResults) &&
        (!isCategoryPage || selectedCategory != null) &&
        versions.length > 0 &&
        filteredVersions.length === 0 && (
          <EmptyAssistantHubState
            title={t({
              id: "assistantHub.search.empty.title",
              message: "No matching assistants",
            })}
            description={t({
              id: "assistantHub.search.empty.description",
              message: "Try a different search term.",
            })}
          />
        )}

      {!isLoadingAssistants &&
        !error &&
        !isCategoryPage &&
        !showSearchResults &&
        sortedVersions.length > 0 && (
          <div className="space-y-8">
            <section className="rounded-xl border border-theme-info-border bg-theme-info-bg p-6">
              <div className="mb-4">
                <div className="flex items-center gap-2">
                  <span aria-hidden="true">✨</span>
                  <h2 className="text-lg font-semibold text-theme-fg-primary">
                    {t({
                      id: "assistantHub.featured.title",
                      message: "Featured assistants",
                    })}
                  </h2>
                </div>
                <p className="mt-1 text-sm text-theme-fg-secondary">
                  {t({
                    id: "assistantHub.featured.subtitle",
                    message:
                      "Hand-picked assistants that have proven useful to colleagues.",
                  })}
                </p>
              </div>
              {featuredVersions.length > 0 ? (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {featuredVersions.map((version) => (
                    <AssistantHubVersionCard
                      key={version.version_id}
                      version={version}
                      categories={config.categories}
                      ratingMode={config.rating_mode}
                      onOpen={() =>
                        navigate(`/assistant-hub/${version.hub_assistant_id}`)
                      }
                    />
                  ))}
                </div>
              ) : (
                <p className="rounded-lg border border-theme-border bg-theme-bg-primary p-4 text-sm text-theme-fg-secondary">
                  {t({
                    id: "assistantHub.featured.empty",
                    message: "No assistants are featured yet.",
                  })}
                </p>
              )}
            </section>

            {config.categories.length > 0 && (
              <section>
                <div className="mb-4">
                  <h2 className="text-lg font-semibold text-theme-fg-primary">
                    {t({
                      id: "assistantHub.categories.title",
                      message: "Categories",
                    })}
                  </h2>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {categoryTiles.map(({ category, count }) => (
                    <CategoryTile
                      key={category.id}
                      category={category}
                      count={count}
                      onOpen={() =>
                        navigate(`/assistant-hub/category/${category.id}`)
                      }
                    />
                  ))}
                </div>
              </section>
            )}

            <section data-ui="assistant-hub-all-assistants">
              <div className="mb-4">
                <h2 className="text-lg font-semibold text-theme-fg-primary">
                  {t({
                    id: "assistantHub.all.title",
                    message: "All assistants",
                  })}
                </h2>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {visibleAllVersions.map((version) => (
                  <AssistantHubVersionCard
                    key={version.version_id}
                    version={version}
                    categories={config.categories}
                    ratingMode={config.rating_mode}
                    onOpen={() =>
                      navigate(`/assistant-hub/${version.hub_assistant_id}`)
                    }
                  />
                ))}
              </div>
              {hasMoreAssistants && (
                <div
                  ref={loadMoreAssistantsRef}
                  aria-hidden="true"
                  className="h-px"
                  data-testid="assistant-hub-load-more-sentinel"
                />
              )}
            </section>
          </div>
        )}

      {!isLoadingAssistants &&
        !error &&
        (isCategoryPage || showSearchResults) &&
        (!isCategoryPage || selectedCategory != null) &&
        filteredVersions.length > 0 && (
          <section>
            <div className="mb-4 flex items-center gap-2">
              <SearchIcon className="size-5 text-theme-fg-muted" />
              <h2 className="text-lg font-semibold text-theme-fg-primary">
                {isCategoryPage
                  ? t({
                      id: "assistantHub.category.results",
                      message: "Assistants",
                    })
                  : t({
                      id: "assistantHub.search.results",
                      message: "Search results",
                    })}
              </h2>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {filteredVersions.map((version) => (
                <AssistantHubVersionCard
                  key={version.version_id}
                  version={version}
                  categories={config.categories}
                  ratingMode={config.rating_mode}
                  onOpen={() =>
                    navigate(`/assistant-hub/${version.hub_assistant_id}`)
                  }
                />
              ))}
            </div>
          </section>
        )}
    </>
  );
}

function AssistantListCard({
  assistant,
  hubStatus,
  hubEnabled,
  onArchive,
  onEdit,
  onShare,
  onStartChat,
  onSubmitToHub,
}: {
  assistant: Assistant;
  hubStatus?: OwnedAssistantStatus;
  hubEnabled: boolean;
  onArchive: () => void;
  onEdit: () => void;
  onShare: () => void;
  onStartChat: () => void;
  onSubmitToHub: () => void;
}) {
  const dateFnsLocale = useDateFnsLocale();
  const isArchived = assistant.archived_at != null;
  const updatedRelativeTime = formatDistanceToNow(
    new Date(assistant.updated_at),
    {
      addSuffix: true,
      includeSeconds: true,
      locale: dateFnsLocale,
    },
  );

  return (
    <div
      data-ui="assistant-list-card"
      data-testid="assistant-list-item"
      className="rounded-lg border border-theme-border bg-theme-bg-primary p-4"
    >
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          onClick={onStartChat}
          disabled={isArchived}
        >
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-theme-fg-primary">
              {assistant.name}
            </h3>
            {hubStatus && (
              <span className={getOwnedAssistantStatusClassName(hubStatus)}>
                {getOwnedAssistantStatusLabel(hubStatus)}
              </span>
            )}
          </div>
          {assistant.description && (
            <p className="mt-2 line-clamp-2 text-sm text-theme-fg-secondary">
              {assistant.description}
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-theme-fg-muted">
            <span className="inline-flex min-h-6 items-center">
              {t({
                id: "assistants.card.updated",
                message: `Updated ${updatedRelativeTime}`,
              })}
            </span>
          </div>
        </button>
        {!isArchived && (
          <div className="flex shrink-0 flex-wrap gap-2">
            {assistant.can_edit && (
              <DropdownMenu
                items={[
                  {
                    label: t({
                      id: "sharing.action.share",
                      message: "Share",
                    }),
                    icon: <ShareIcon className="size-4" />,
                    onClick: onShare,
                  },
                  {
                    label: t({
                      id: "assistants.action.edit",
                      message: "Edit",
                    }),
                    icon: <EditIcon className="size-4" />,
                    onClick: onEdit,
                  },
                  ...(hubEnabled
                    ? [
                        {
                          label: t({
                            id: "assistantHub.action.submit",
                            message: "Submit to Hub",
                          }),
                          icon: <CheckCircleIcon className="size-4" />,
                          onClick: onSubmitToHub,
                        },
                      ]
                    : []),
                  {
                    label: t({
                      id: "assistants.action.archive",
                      message: "Archive",
                    }),
                    icon: <LogOutIcon className="size-4" />,
                    onClick: onArchive,
                    confirmAction: true,
                    confirmTitle: t({
                      id: "assistants.archive.confirmTitle",
                      message: "Confirm Archive",
                    }),
                    confirmMessage: t({
                      id: "assistants.archive.confirmMessage",
                      message:
                        "Are you sure you want to archive this assistant?",
                    }),
                  },
                ]}
              />
            )}
            <Button variant="secondary" size="sm" onClick={onStartChat}>
              {t({
                id: "assistants.action.newChat",
                message: "New Chat",
              })}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function AssistantListView({
  hubEnabled,
  searchQuery,
  view,
}: {
  hubEnabled: boolean;
  searchQuery: string;
  view: Exclude<AssistantsLandingView, "hub">;
}) {
  const navigate = useNavigate();
  const isCreatedView = view === "owned_by_user";
  const [statusFilter, setStatusFilter] =
    useState<OwnedAssistantStatusFilter>("all");
  const [sharingAssistant, setSharingAssistant] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const { data, isLoading, error, refetch } = useListAssistants({
    queryParams: {
      sharing_relation: view,
      ...(isCreatedView && hubEnabled ? { include_archived: true } : {}),
    },
  });
  const {
    data: hubVersionsData,
    isLoading: isLoadingHubVersions,
    error: hubVersionsError,
  } = useListMyAssistantHubVersions(
    hubEnabled && isCreatedView ? {} : skipToken,
  );
  const archiveAssistantMutation = useArchiveAssistant();
  const assistants = useMemo(() => data ?? [], [data]);
  const hubVersions = useMemo(
    () => hubVersionsData?.versions ?? [],
    [hubVersionsData?.versions],
  );
  const assistantStatuses = useMemo(
    () =>
      new Map(
        assistants.map((assistant) => [
          assistant.id,
          getOwnedAssistantStatus(assistant, hubVersions),
        ]),
      ),
    [assistants, hubVersions],
  );
  const statusCounts = useMemo(() => {
    const counts: Record<OwnedAssistantStatusFilter, number> = {
      all: assistants.length,
      in_review: 0,
      published: 0,
      unpublished: 0,
      declined: 0,
      not_submitted: 0,
      archived: 0,
    };

    for (const status of assistantStatuses.values()) {
      counts[status] += 1;
    }

    return counts;
  }, [assistantStatuses, assistants.length]);
  const filteredAssistants = useMemo(
    () =>
      assistants.filter(
        (assistant) =>
          assistantMatchesSearch(assistant, searchQuery) &&
          (statusFilter === "all" ||
            assistantStatuses.get(assistant.id) === statusFilter),
      ),
    [assistantStatuses, assistants, searchQuery, statusFilter],
  );
  const listTitle = isCreatedView
    ? t({
        id: "assistants.list.title.owned_by_user",
        message: "My assistants",
      })
    : t({
        id: "assistants.list.title.shared_with_user",
        message: "Shared with me",
      });

  const handleArchive = async (assistantId: string) => {
    try {
      await archiveAssistantMutation.mutateAsync({
        pathParams: { assistantId },
        body: {},
      });
      await refetch();
    } catch (archiveError) {
      logger.error("Failed to archive assistant:", archiveError);
    }
  };

  return (
    <>
      {isCreatedView && hubEnabled && (
        <div
          className="flex flex-wrap items-center gap-2"
          role="group"
          aria-label={t({
            id: "assistants.status.filterAria",
            message: "Filter my assistants by Hub status",
          })}
        >
          <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-theme-fg-muted">
            {t({
              id: "assistants.status.filterLabel",
              message: "Hub status",
            })}
          </span>
          {OWNED_ASSISTANT_STATUS_FILTERS.map((status) => {
            const isActive = statusFilter === status;
            const label = getOwnedAssistantStatusLabel(status);
            const count = statusCounts[status];

            return (
              <button
                key={status}
                type="button"
                aria-pressed={isActive}
                onClick={() => setStatusFilter(status)}
                className={clsx(
                  "focus-ring theme-transition rounded-lg px-3 py-1.5 text-sm font-medium",
                  isActive
                    ? "bg-theme-bg-selected text-theme-fg-primary"
                    : "text-theme-fg-secondary hover:bg-theme-bg-hover hover:text-theme-fg-primary",
                )}
              >
                {`${label} (${count})`}
              </button>
            );
          })}
        </div>
      )}

      {(isLoading || (isCreatedView && isLoadingHubVersions)) && (
        <LoadingState
          message={t({
            id: "assistants.loading",
            message: "Loading assistants...",
          })}
        />
      )}

      {(error ?? hubVersionsError) && (
        <Alert type="error">
          {t({
            id: "assistants.error.load",
            message: "Failed to load assistants. Please try again.",
          })}
        </Alert>
      )}

      {!isLoading &&
        !isLoadingHubVersions &&
        !error &&
        !hubVersionsError &&
        assistants.length === 0 && (
          <EmptyAssistantHubState
            title={
              isCreatedView
                ? t({
                    id: "assistants.empty.owned_by_user",
                    message: "You haven't created any assistants yet",
                  })
                : t({
                    id: "assistants.empty.shared_with_user",
                    message: "No assistants have been shared with you",
                  })
            }
            description={
              isCreatedView
                ? t({
                    id: "assistants.empty.createFirst",
                    message: "Create your first assistant to get started",
                  })
                : t({
                    id: "assistants.empty.shared_with_user.description",
                    message:
                      "Assistants that others share with you will appear here",
                  })
            }
          />
        )}

      {!isLoading &&
        !isLoadingHubVersions &&
        !error &&
        !hubVersionsError &&
        assistants.length > 0 &&
        filteredAssistants.length === 0 && (
          <EmptyAssistantHubState
            title={t({
              id: "assistantHub.search.empty.title",
              message: "No matching assistants",
            })}
            description={t({
              id: "assistantHub.search.empty.description",
              message: "Try a different search term.",
            })}
          />
        )}

      {!isLoading &&
        !isLoadingHubVersions &&
        !error &&
        !hubVersionsError &&
        filteredAssistants.length > 0 && (
          <section>
            <div className="mb-4 flex items-center gap-2">
              <SearchIcon className="size-5 text-theme-fg-muted" />
              <h2 className="text-lg font-semibold text-theme-fg-primary">
                {listTitle}
              </h2>
            </div>
            <div className="grid gap-3">
              {filteredAssistants.map((assistant) => (
                <AssistantListCard
                  key={assistant.id}
                  assistant={assistant}
                  hubStatus={
                    isCreatedView && hubEnabled
                      ? assistantStatuses.get(assistant.id)
                      : undefined
                  }
                  hubEnabled={hubEnabled}
                  onStartChat={() => navigate(`/a/${assistant.id}`)}
                  onEdit={() => navigate(`/assistants/${assistant.id}/edit`)}
                  onShare={() =>
                    setSharingAssistant({
                      id: assistant.id,
                      name: assistant.name,
                    })
                  }
                  onSubmitToHub={() =>
                    navigate(`/assistant-hub/submit/${assistant.id}`)
                  }
                  onArchive={() => {
                    void handleArchive(assistant.id);
                  }}
                />
              ))}
            </div>
          </section>
        )}

      {sharingAssistant && (
        <SharingErrorBoundary onReset={() => setSharingAssistant(null)}>
          <SharingDialog
            isOpen={true}
            onClose={() => setSharingAssistant(null)}
            resourceType="assistant"
            resourceId={sharingAssistant.id}
            resourceName={sharingAssistant.name}
          />
        </SharingErrorBoundary>
      )}
    </>
  );
}

export default function AssistantsPage({ view }: AssistantsPageProps) {
  const navigate = useNavigate();
  const { categoryId } = useParams<{ categoryId?: string }>();
  const [searchQuery, setSearchQuery] = useState("");
  const { containerClasses, horizontalPadding } =
    usePageAlignment("assistants");
  const {
    data: hubConfig,
    isLoading: isLoadingHubConfig,
    error: hubConfigError,
  } = useAssistantHubConfig({});
  const hubEnabled = hubConfig?.enabled === true;

  const tabs = [
    ...(hubEnabled
      ? [
          {
            value: "hub" as const,
            label: t({
              id: "assistantHub.title",
              message: "Assistant Hub",
            }),
          },
        ]
      : []),
    {
      value: "owned_by_user" as const,
      label: t({
        id: "assistants.filter.owned_by_user",
        message: "My assistants",
      }),
    },
    {
      value: "shared_with_user" as const,
      label: t({
        id: "assistants.filter.shared_with_user",
        message: "Shared with me",
      }),
    },
  ];

  const pageTitle = t({ id: "assistants.title", message: "Assistants" });
  const pageSubtitle = t({
    id: "assistants.workspace.subtitle",
    message: "Discover, create, and use custom assistants.",
  });
  const showHubActions =
    view === "hub" && categoryId == null && hubConfig != null;
  const pageHeader = (
    <PageHeader density="compact" title={pageTitle} subtitle={pageSubtitle}>
      <div className="mx-auto flex w-full max-w-3xl items-stretch gap-3">
        <AssistantsSearch
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          ariaLabel={t({
            id: "assistants.search.aria",
            message: "Search assistants",
          })}
        />
        <Button
          variant="primary"
          size="sm"
          className="shrink-0 self-stretch whitespace-nowrap"
          icon={<PlusIcon />}
          onClick={() => navigate("/assistants/new")}
        >
          {t({
            id: "assistant.create.title",
            message: "Create Assistant",
          })}
        </Button>
      </div>
    </PageHeader>
  );

  useEffect(() => {
    document.title = `${pageTitle} - ${t({
      id: "branding.page_title_suffix",
    })}`;
  }, [pageTitle]);

  if (isLoadingHubConfig) {
    return (
      <div className="flex h-full flex-col bg-theme-bg-primary">
        {pageHeader}
        <div
          className={clsx(
            "flex-1 overflow-auto [scrollbar-gutter:stable_both-edges]",
            horizontalPadding,
          )}
          data-ui="assistants-page-scroll-container"
        >
          <div className={clsx("py-6", containerClasses)}>
            <LoadingState
              message={t({
                id: "assistants.loading",
                message: "Loading assistants...",
              })}
            />
          </div>
        </div>
      </div>
    );
  }

  if (view === "hub" && !hubEnabled) {
    return <Navigate to={viewRoutes.shared_with_user} replace />;
  }

  return (
    <div className="flex h-full flex-col bg-theme-bg-primary">
      {pageHeader}
      <div
        className={clsx(
          "flex-1 overflow-auto [scrollbar-gutter:stable_both-edges]",
          horizontalPadding,
        )}
        data-ui="assistants-page-scroll-container"
      >
        <div className={clsx("space-y-8 py-6", containerClasses)}>
          {(tabs.length > 1 || showHubActions) && (
            <div
              className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
              data-ui="assistants-page-toolbar"
            >
              {tabs.length > 1 && (
                <SegmentedControl
                  options={tabs}
                  value={view}
                  onChange={(nextView) => navigate(viewRoutes[nextView])}
                  aria-label={t({
                    id: "assistants.filter.aria",
                    message: "Filter assistants",
                  })}
                />
              )}
              {showHubActions && (
                <div className="flex flex-wrap justify-end gap-2 sm:ml-auto">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => navigate("/assistant-hub/my")}
                  >
                    {t({
                      id: "assistantHub.action.mySubmissions",
                      message: "My submissions",
                    })}
                  </Button>
                  {hubConfig.can_review && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => navigate("/assistant-hub/review")}
                    >
                      {t({
                        id: "assistantHub.action.reviewQueue",
                        message: "Review queue",
                      })}
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}

          {hubConfigError && view === "hub" && (
            <Alert type="error">
              {t({
                id: "assistantHub.error.load",
                message: "Failed to load assistant hub.",
              })}
            </Alert>
          )}

          {view === "hub" && hubConfig != null && (
            <HubLandingView
              categoryId={categoryId}
              config={hubConfig}
              searchQuery={searchQuery}
            />
          )}

          {view !== "hub" && (
            <AssistantListView
              hubEnabled={hubEnabled}
              searchQuery={searchQuery}
              view={view}
            />
          )}
        </div>
      </div>
    </div>
  );
}
