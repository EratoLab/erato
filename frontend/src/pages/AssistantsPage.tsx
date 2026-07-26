import { t } from "@lingui/core/macro";
import clsx from "clsx";
import { formatDistanceToNow } from "date-fns";
import { useEffect, useMemo, useState } from "react";
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
} from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { createLogger } from "@/utils/debugLogger";

import {
  AssistantHubBreadcrumb,
  AssistantHubVersionCard,
  EmptyAssistantHubState,
} from "./assistantHubUtils";

import type {
  Assistant,
  AssistantHubCategory,
  AssistantHubConfigResponse,
  AssistantHubVersion,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const logger = createLogger("UI", "AssistantsPage");

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
    <div className="mx-auto w-full max-w-xl">
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
}: {
  categoryId?: string;
  config: AssistantHubConfigResponse;
}) {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
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

  return (
    <>
      {isCategoryPage && (
        <AssistantHubBreadcrumb
          icon={<ArrowLeftIcon className="size-4" />}
          onClick={() => navigate("/assistant-hub")}
        >
          {t({
            id: "assistantHub.action.backToHub",
            message: "Back to hub",
          })}
        </AssistantHubBreadcrumb>
      )}

      <AssistantsSearch
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        ariaLabel={t({
          id: "assistantHub.search.aria",
          message: "Search assistant hub",
        })}
      />

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
            <section>
              <div className="mb-4">
                <h2 className="text-lg font-semibold text-theme-fg-primary">
                  {t({
                    id: "assistantHub.featured.title",
                    message: "Featured assistants",
                  })}
                </h2>
              </div>
              {featuredVersions.length > 0 ? (
                <div className="grid gap-3">
                  {featuredVersions.map((version) => (
                    <AssistantHubVersionCard
                      key={version.version_id}
                      version={version}
                      categories={config.categories}
                      onOpen={() =>
                        navigate(`/assistant-hub/${version.hub_assistant_id}`)
                      }
                      actions={
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() =>
                            navigate(
                              `/assistant-hub/${version.hub_assistant_id}`,
                            )
                          }
                        >
                          {t({
                            id: "assistantHub.action.view",
                            message: "View",
                          })}
                        </Button>
                      }
                    />
                  ))}
                </div>
              ) : (
                <p className="rounded-lg border border-theme-border bg-theme-bg-secondary p-4 text-sm text-theme-fg-secondary">
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
            <div className="grid gap-3">
              {filteredVersions.map((version) => (
                <AssistantHubVersionCard
                  key={version.version_id}
                  version={version}
                  categories={config.categories}
                  onOpen={() =>
                    navigate(`/assistant-hub/${version.hub_assistant_id}`)
                  }
                  actions={
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        navigate(`/assistant-hub/${version.hub_assistant_id}`)
                      }
                    >
                      {t({
                        id: "assistantHub.action.view",
                        message: "View",
                      })}
                    </Button>
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
  hubEnabled,
  onArchive,
  onEdit,
  onShare,
  onStartChat,
  onSubmitToHub,
}: {
  assistant: Assistant;
  hubEnabled: boolean;
  onArchive: () => void;
  onEdit: () => void;
  onShare: () => void;
  onStartChat: () => void;
  onSubmitToHub: () => void;
}) {
  const dateFnsLocale = useDateFnsLocale();
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
        >
          <h3 className="text-base font-semibold text-theme-fg-primary">
            {assistant.name}
          </h3>
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
                    message: "Are you sure you want to archive this assistant?",
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
      </div>
    </div>
  );
}

function AssistantListView({
  hubEnabled,
  view,
}: {
  hubEnabled: boolean;
  view: Exclude<AssistantsLandingView, "hub">;
}) {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  const [sharingAssistant, setSharingAssistant] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const { data, isLoading, error, refetch } = useListAssistants({
    queryParams: { sharing_relation: view },
  });
  const archiveAssistantMutation = useArchiveAssistant();
  const assistants = useMemo(() => data ?? [], [data]);
  const filteredAssistants = useMemo(
    () =>
      assistants.filter((assistant) =>
        assistantMatchesSearch(assistant, searchQuery),
      ),
    [assistants, searchQuery],
  );
  const isCreatedView = view === "owned_by_user";
  const listTitle = isCreatedView
    ? t({
        id: "assistants.list.title.owned_by_user",
        message: "Created by me",
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
      <div className="flex flex-wrap justify-center gap-2">
        <Button
          variant="primary"
          size="sm"
          icon={<PlusIcon />}
          onClick={() => navigate("/assistants/new")}
        >
          {t({
            id: "assistant.create.title",
            message: "Create Assistant",
          })}
        </Button>
      </div>

      <AssistantsSearch
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        ariaLabel={t({
          id: "assistants.search.aria",
          message: "Search assistants",
        })}
      />

      {isLoading && (
        <LoadingState
          message={t({
            id: "assistants.loading",
            message: "Loading assistants...",
          })}
        />
      )}

      {error && (
        <Alert type="error">
          {t({
            id: "assistants.error.load",
            message: "Failed to load assistants. Please try again.",
          })}
        </Alert>
      )}

      {!isLoading && !error && assistants.length === 0 && (
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
        !error &&
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

      {!isLoading && !error && filteredAssistants.length > 0 && (
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
  const { containerClasses, horizontalPadding } =
    usePageAlignment("assistants");
  const {
    data: hubConfig,
    isLoading: isLoadingHubConfig,
    error: hubConfigError,
  } = useAssistantHubConfig({});
  const hubEnabled = hubConfig?.enabled === true;
  const selectedCategory = hubConfig?.categories.find(
    (category) => category.id === categoryId,
  );

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
      value: "shared_with_user" as const,
      label: t({
        id: "assistants.filter.shared_with_user",
        message: "Shared with me",
      }),
    },
    {
      value: "owned_by_user" as const,
      label: t({
        id: "assistants.filter.owned_by_user",
        message: "Created by me",
      }),
    },
  ];

  const pageTitle =
    view === "hub"
      ? (selectedCategory?.display_name ??
        t({
          id: "assistantHub.title",
          message: "Assistant Hub",
        }))
      : t({ id: "assistants.title", message: "Assistants" });
  const pageSubtitle =
    view === "hub"
      ? categoryId != null
        ? t({
            id: "assistantHub.category.subtitle",
            message: "Browse assistants filtered by category",
          })
        : t({
            id: "assistantHub.subtitle",
            message:
              "Browse reviewed assistants that are available to your organization",
          })
      : t({
          id: "assistants.subtitle",
          message:
            "Create and manage custom assistants with specific instructions and capabilities",
        });
  const showHubActions =
    view === "hub" && categoryId == null && hubConfig != null;

  useEffect(() => {
    document.title = `${pageTitle} - ${t({
      id: "branding.page_title_suffix",
    })}`;
  }, [pageTitle]);

  if (isLoadingHubConfig) {
    return (
      <div className="flex h-full flex-col bg-theme-bg-primary">
        <PageHeader
          density="compact"
          title={pageTitle}
          subtitle={pageSubtitle}
        />
        <div className={clsx("flex-1 overflow-auto", horizontalPadding)}>
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
      <PageHeader density="compact" title={pageTitle} subtitle={pageSubtitle} />
      <div className={clsx("flex-1 overflow-auto", horizontalPadding)}>
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
            <HubLandingView categoryId={categoryId} config={hubConfig} />
          )}

          {view !== "hub" && (
            <AssistantListView hubEnabled={hubEnabled} view={view} />
          )}
        </div>
      </div>
    </div>
  );
}
