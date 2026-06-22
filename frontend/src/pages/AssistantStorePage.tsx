import { t } from "@lingui/core/macro";
import clsx from "clsx";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { PageHeader } from "@/components/ui/Container/PageHeader";
import { Button } from "@/components/ui/Controls/Button";
import { Alert } from "@/components/ui/Feedback/Alert";
import { Input } from "@/components/ui/Input";
import {
  ArrowLeftIcon,
  FileTextIcon,
  SearchIcon,
  ResolvedIcon,
} from "@/components/ui/icons";
import { usePageAlignment } from "@/hooks/ui";
import {
  useAssistantStoreConfig,
  useListAssistantStoreAssistants,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";

import {
  AssistantStoreBreadcrumb,
  AssistantStoreVersionCard,
  EmptyAssistantStoreState,
} from "./assistantStoreUtils";

import type {
  AssistantStoreCategory,
  AssistantStoreVersion,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const sortStoreVersions = (versions: AssistantStoreVersion[]) =>
  [...versions].sort((left, right) => {
    if (left.featured !== right.featured) return left.featured ? -1 : 1;
    return (
      new Date(right.published_at ?? right.updated_at).getTime() -
      new Date(left.published_at ?? left.updated_at).getTime()
    );
  });

const versionMatchesSearch = (
  version: AssistantStoreVersion,
  categories: AssistantStoreCategory[],
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

function CategoryTile({
  category,
  count,
  onOpen,
}: {
  category: AssistantStoreCategory;
  count: number;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="focus-ring theme-transition group rounded-lg border border-theme-border bg-theme-bg-primary p-4 text-left hover:border-theme-border-focus hover:bg-theme-bg-hover"
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
              id: "assistantStore.category.count.one",
              message: "1 assistant",
            })
          : t({
              id: "assistantStore.category.count.many",
              message: `${count} assistants`,
            })}
      </p>
    </button>
  );
}

function StoreSearch({
  searchQuery,
  setSearchQuery,
}: {
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
          id: "assistantStore.search.placeholder",
          message: "Search assistants...",
        })}
        aria-label={t({
          id: "assistantStore.search.aria",
          message: "Search assistant store",
        })}
      />
    </div>
  );
}

export default function AssistantStorePage() {
  const navigate = useNavigate();
  const { categoryId } = useParams<{ categoryId?: string }>();
  const { containerClasses, horizontalPadding } =
    usePageAlignment("assistants");
  const [searchQuery, setSearchQuery] = useState("");
  const { data: config, isLoading: isLoadingConfig } = useAssistantStoreConfig(
    {},
  );
  const {
    data,
    isLoading: isLoadingAssistants,
    error,
  } = useListAssistantStoreAssistants({});

  const selectedCategory = useMemo(
    () => config?.categories.find((category) => category.id === categoryId),
    [categoryId, config?.categories],
  );
  const isCategoryPage = categoryId != null;

  useEffect(() => {
    document.title = `${
      selectedCategory?.display_name ??
      t({
        id: "assistantStore.title",
        message: "Assistant Store",
      })
    } - ${t({ id: "branding.page_title_suffix" })}`;
  }, [selectedCategory?.display_name]);

  const versions = useMemo(() => data?.versions ?? [], [data?.versions]);
  const sortedVersions = useMemo(() => sortStoreVersions(versions), [versions]);
  const featuredVersions = useMemo(
    () => sortedVersions.filter((version) => version.featured),
    [sortedVersions],
  );
  const categoryTiles = useMemo(
    () =>
      (config?.categories ?? []).map((category) => ({
        category,
        count: versions.filter((version) =>
          version.category_ids.includes(category.id),
        ).length,
      })),
    [config?.categories, versions],
  );
  const filteredVersions = useMemo(() => {
    const categoryFilteredVersions =
      categoryId == null
        ? sortedVersions
        : sortedVersions.filter((version) =>
            version.category_ids.includes(categoryId),
          );

    return categoryFilteredVersions.filter((version) =>
      versionMatchesSearch(version, config?.categories ?? [], searchQuery),
    );
  }, [categoryId, config?.categories, searchQuery, sortedVersions]);

  const isLoading = isLoadingConfig || isLoadingAssistants;
  const showSearchResults = !isCategoryPage && searchQuery.trim().length > 0;

  return (
    <div className="flex h-full flex-col bg-theme-bg-primary">
      <PageHeader
        title={
          selectedCategory?.display_name ??
          t({ id: "assistantStore.title", message: "Assistant Store" })
        }
        subtitle={
          isCategoryPage
            ? t({
                id: "assistantStore.category.subtitle",
                message: "Browse assistants filtered by category",
              })
            : t({
                id: "assistantStore.subtitle",
                message:
                  "Browse reviewed assistants that are available to your organization",
              })
        }
      />
      <div className={clsx("flex-1 overflow-auto", horizontalPadding)}>
        <div className={clsx("space-y-8 py-6", containerClasses)}>
          {isCategoryPage && (
            <AssistantStoreBreadcrumb
              icon={<ArrowLeftIcon className="size-4" />}
              onClick={() => navigate("/assistant-store")}
            >
              {t({
                id: "assistantStore.action.backToStore",
                message: "Back to store",
              })}
            </AssistantStoreBreadcrumb>
          )}

          {!isCategoryPage && (
            <div className="flex flex-wrap justify-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => navigate("/assistant-store/my")}
              >
                {t({
                  id: "assistantStore.action.mySubmissions",
                  message: "My submissions",
                })}
              </Button>
              {config?.can_review && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => navigate("/assistant-store/review")}
                >
                  {t({
                    id: "assistantStore.action.reviewQueue",
                    message: "Review queue",
                  })}
                </Button>
              )}
            </div>
          )}

          <StoreSearch
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
          />

          {config && !config.enabled && (
            <Alert type="info">
              {t({
                id: "assistantStore.disabled",
                message: "The assistant store is not enabled.",
              })}
            </Alert>
          )}

          {isLoading && (
            <div className="flex items-center justify-center py-12">
              <div className="text-center">
                <div className="mx-auto mb-4 size-8 animate-spin rounded-full border-2 border-theme-border border-t-transparent"></div>
                <p className="text-sm text-theme-fg-secondary">
                  {t({
                    id: "assistantStore.loading",
                    message: "Loading assistant store...",
                  })}
                </p>
              </div>
            </div>
          )}

          {error && (
            <Alert type="error">
              {t({
                id: "assistantStore.error.load",
                message: "Failed to load assistant store.",
              })}
            </Alert>
          )}

          {!isLoading && !error && config?.enabled && versions.length === 0 && (
            <EmptyAssistantStoreState
              title={t({
                id: "assistantStore.empty.title",
                message: "No published assistants yet",
              })}
              description={t({
                id: "assistantStore.empty.description",
                message:
                  "Accepted and published assistant versions will appear here.",
              })}
            />
          )}

          {!isLoading &&
            !error &&
            config?.enabled &&
            isCategoryPage &&
            selectedCategory == null && (
              <EmptyAssistantStoreState
                title={t({
                  id: "assistantStore.category.notFound.title",
                  message: "Category not found",
                })}
                description={t({
                  id: "assistantStore.category.notFound.description",
                  message:
                    "This assistant store category is not currently configured.",
                })}
              />
            )}

          {!isLoading &&
            !error &&
            config?.enabled &&
            (isCategoryPage || showSearchResults) &&
            (!isCategoryPage || selectedCategory != null) &&
            versions.length > 0 &&
            filteredVersions.length === 0 && (
              <EmptyAssistantStoreState
                title={t({
                  id: "assistantStore.search.empty.title",
                  message: "No matching assistants",
                })}
                description={t({
                  id: "assistantStore.search.empty.description",
                  message: "Try a different search term.",
                })}
              />
            )}

          {!isLoading &&
            !error &&
            config?.enabled &&
            !isCategoryPage &&
            !showSearchResults &&
            sortedVersions.length > 0 && (
              <div className="space-y-8">
                <section>
                  <div className="mb-4">
                    <h2 className="text-lg font-semibold text-theme-fg-primary">
                      {t({
                        id: "assistantStore.featured.title",
                        message: "Featured assistants",
                      })}
                    </h2>
                  </div>
                  {featuredVersions.length > 0 ? (
                    <div className="grid gap-3">
                      {featuredVersions.map((version) => (
                        <AssistantStoreVersionCard
                          key={version.version_id}
                          version={version}
                          categories={config.categories}
                          onOpen={() =>
                            navigate(
                              `/assistant-store/${version.store_assistant_id}`,
                            )
                          }
                          actions={
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() =>
                                navigate(
                                  `/assistant-store/${version.store_assistant_id}`,
                                )
                              }
                            >
                              {t({
                                id: "assistantStore.action.view",
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
                        id: "assistantStore.featured.empty",
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
                          id: "assistantStore.categories.title",
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
                            navigate(`/assistant-store/category/${category.id}`)
                          }
                        />
                      ))}
                    </div>
                  </section>
                )}
              </div>
            )}

          {!isLoading &&
            !error &&
            config?.enabled &&
            (isCategoryPage || showSearchResults) &&
            (!isCategoryPage || selectedCategory != null) &&
            filteredVersions.length > 0 && (
              <section>
                <div className="mb-4 flex items-center gap-2">
                  <SearchIcon className="size-5 text-theme-fg-muted" />
                  <h2 className="text-lg font-semibold text-theme-fg-primary">
                    {isCategoryPage
                      ? t({
                          id: "assistantStore.category.results",
                          message: "Assistants",
                        })
                      : t({
                          id: "assistantStore.search.results",
                          message: "Search results",
                        })}
                  </h2>
                </div>
                <div className="grid gap-3">
                  {filteredVersions.map((version) => (
                    <AssistantStoreVersionCard
                      key={version.version_id}
                      version={version}
                      categories={config.categories}
                      onOpen={() =>
                        navigate(
                          `/assistant-store/${version.store_assistant_id}`,
                        )
                      }
                      actions={
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() =>
                            navigate(
                              `/assistant-store/${version.store_assistant_id}`,
                            )
                          }
                        >
                          {t({
                            id: "assistantStore.action.view",
                            message: "View",
                          })}
                        </Button>
                      }
                    />
                  ))}
                </div>
              </section>
            )}
        </div>
      </div>
    </div>
  );
}
