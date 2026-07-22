import { t } from "@lingui/core/macro";
import { useInfiniteQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useDebounce } from "use-debounce";

import { ChatShareDialog } from "@/components/ui/Chat/ChatShareDialog";
import { EditChatTitleDialog } from "@/components/ui/Chat/EditChatTitleDialog";
import { PageHeader } from "@/components/ui/Container/PageHeader";
import { DropdownMenu } from "@/components/ui/Controls/DropdownMenu";
import { MessageTimestamp } from "@/components/ui/Message/MessageTimestamp";
import {
  SearchIcon,
  CloseIcon,
  LogOutIcon,
  MultiplePagesIcon,
  ShareIcon,
} from "@/components/ui/icons";
import { usePageAlignment } from "@/hooks/ui";
import {
  fetchRecentChats,
  recentChatsQuery,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { useV1betaApiContext } from "@/lib/generated/v1betaApi/v1betaApiContext";
import { useChatContext } from "@/providers/ChatProvider";
import {
  useChatInputFeature,
  useChatSharingFeature,
} from "@/providers/FeatureConfigProvider";
import { getChatUrl } from "@/utils/chat/urlUtils";
import { createLogger } from "@/utils/debugLogger";

const logger = createLogger("UI", "SearchPage");
const SEARCH_PAGE_SIZE = 20;

interface SearchResult {
  id: string;
  chatId: string;
  assistantId?: string;
  chatTitle: string;
  titleBySummary?: string | null;
  titleByUserProvided?: string | null;
  canEdit: boolean;
  messageContent: string;
  timestamp: string;
  context?: string;
}

export default function SearchPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [titleDialogChatId, setTitleDialogChatId] = useState<string | null>(
    null,
  );
  const [shareDialogChatId, setShareDialogChatId] = useState<string | null>(
    null,
  );
  const [isUpdatingChatTitle, setIsUpdatingChatTitle] = useState(false);
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);
  const navigate = useNavigate();
  const { fetcherOptions } = useV1betaApiContext();
  const { archiveChat, updateChatTitle, refetchHistory } = useChatContext();

  // Get feature configurations
  const { autofocus: shouldAutofocus } = useChatInputFeature();
  const { enabled: chatSharingEnabled } = useChatSharingFeature();

  // Get alignment configuration for content
  const {
    containerClasses: contentContainerClasses,
    horizontalPadding: contentHorizontalPadding,
  } = usePageAlignment("search");

  // Debounce search query using use-debounce library for consistency
  const [debouncedSearchQuery] = useDebounce(searchQuery, 300);
  const backendSearchQuery = debouncedSearchQuery.trim();
  const isShowingRecent = backendSearchQuery === "";

  const {
    data: recentChatsPages,
    isLoading,
    isFetching: isSearching,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refetch: refetchSearchResults,
    error: searchError,
  } = useInfiniteQuery({
    queryKey: [
      ...recentChatsQuery({
        queryParams: {
          limit: SEARCH_PAGE_SIZE,
          ...(backendSearchQuery ? { q: backendSearchQuery } : {}),
        },
      }).queryKey,
      "search-infinite",
    ],
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) => {
      const offset = typeof pageParam === "number" ? pageParam : 0;
      return fetchRecentChats(
        {
          ...fetcherOptions,
          queryParams: {
            limit: SEARCH_PAGE_SIZE,
            offset,
            ...(backendSearchQuery ? { q: backendSearchQuery } : {}),
          },
        },
        signal,
      );
    },
    getNextPageParam: (lastPage) => {
      if (!lastPage.stats.has_more || lastPage.stats.returned_count === 0) {
        return undefined;
      }
      return lastPage.stats.current_offset + lastPage.stats.returned_count;
    },
  });

  useEffect(() => {
    if (searchError) {
      logger.log("Search error:", searchError);
    }
  }, [searchError]);

  // Convert backend response to SearchResult format
  const searchResults = useMemo(() => {
    const chats = recentChatsPages?.pages.flatMap((page) => page.chats) ?? [];

    return chats
      .map(
        (chat): SearchResult => ({
          id: chat.id,
          chatId: chat.id,
          assistantId: chat.assistant_id,
          chatTitle: chat.title_resolved,
          titleBySummary: chat.title_by_summary,
          titleByUserProvided: chat.title_by_user_provided,
          canEdit: chat.can_edit,
          messageContent: chat.title_resolved,
          timestamp: chat.last_message_at,
        }),
      )
      .sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      );
  }, [recentChatsPages?.pages]);

  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current;
    if (!sentinel || !hasNextPage) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (
          entries.some((entry) => entry.isIntersecting) &&
          !isFetchingNextPage
        ) {
          void fetchNextPage();
        }
      },
      { rootMargin: "240px" }, // eslint-disable-line lingui/no-unlocalized-strings -- IntersectionObserver CSS length, not user-facing text
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  const clearSearch = () => {
    setSearchQuery("");
  };

  const handleResultClick = (result: SearchResult) => {
    // Defensive check to prevent click handler issues
    if (!result.chatId) {
      return;
    }

    navigate(getChatUrl(result.chatId, result.assistantId));
  };

  const activeTitleDialogResult =
    searchResults.find((result) => result.chatId === titleDialogChatId) ?? null;

  const handleArchiveResult = async (chatId: string) => {
    await archiveChat(chatId);
    await Promise.all([refetchHistory(), refetchSearchResults()]);
  };

  const handleSubmitEditTitleDialog = async (title: string) => {
    if (!titleDialogChatId) {
      return;
    }

    try {
      setIsUpdatingChatTitle(true);
      // updateChatTitle already invalidates the recent-chats query, which
      // refetches every loaded page. Only the separate search-results query
      // still needs an explicit refetch to reflect the new title.
      await updateChatTitle(titleDialogChatId, title);
      await refetchSearchResults();
      setTitleDialogChatId(null);
    } finally {
      setIsUpdatingChatTitle(false);
    }
  };

  const handleCloseEditTitleDialog = () => {
    if (isUpdatingChatTitle) {
      return;
    }
    setTitleDialogChatId(null);
  };

  const totalResultsCount =
    recentChatsPages?.pages[0]?.stats.total_count ?? searchResults.length;
  const resultsCount = isShowingRecent
    ? searchResults.length
    : totalResultsCount;
  const showInitialLoading = isLoading && searchResults.length === 0;

  return (
    <div className="flex h-full flex-col bg-theme-bg-primary">
      {/* Search Header */}
      <PageHeader
        density="compact"
        title={t`Search Your Chats`}
        subtitle={t({
          id: "search.page.subtitle",
          message: "Find conversations and messages across your chat history",
        })}
      >
        {/* Match search input width to results width */}
        <div className={clsx("w-full", contentContainerClasses)}>
          <div className="relative">
            <SearchIcon className="absolute left-4 top-1/2 size-5 -translate-y-1/2 text-theme-fg-muted" />
            <input
              data-ui="search-input"
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  clearSearch();
                }
              }}
              placeholder={t`Search chat titles...`}
              autoFocus={shouldAutofocus} // eslint-disable-line jsx-a11y/no-autofocus -- Controlled by feature config to prevent unwanted scrolling
              className="w-full rounded-xl border border-theme-border bg-theme-bg-secondary px-12 py-4 text-lg text-theme-fg-primary placeholder:text-theme-fg-muted focus:border-theme-border-focus focus:outline-none focus:ring-2 focus:ring-theme-focus"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={clearSearch}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-theme-fg-muted hover:text-theme-fg-primary"
                aria-label={t`Clear search`}
              >
                <CloseIcon className="size-5" />
              </button>
            )}
          </div>
        </div>
      </PageHeader>

      {/* Search Results */}
      <div className={clsx("flex-1 overflow-auto", contentHorizontalPadding)}>
        <div className={clsx("py-6", contentContainerClasses)}>
          {showInitialLoading && (
            <div className="flex items-center justify-center py-8">
              <div className="text-center">
                <div className="mx-auto mb-4 size-6 animate-spin rounded-full border-2 border-theme-border border-t-transparent"></div>
                <p className="text-sm text-theme-fg-secondary">{t`Searching...`}</p>
              </div>
            </div>
          )}

          {!showInitialLoading && searchResults.length === 0 && (
            <div className="flex items-center justify-center py-12">
              <div className="text-center">
                <SearchIcon className="mx-auto mb-4 size-12 text-theme-fg-muted" />
                <h2 className="mb-2 text-xl font-semibold text-theme-fg-primary">
                  {t`No chats found`}
                </h2>
                <p className="text-theme-fg-secondary">
                  {t`Try different keywords or check your spelling`}
                </p>
              </div>
            </div>
          )}

          {!showInitialLoading && searchResults.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-medium text-theme-fg-primary">
                  {isShowingRecent ? t`Recent Chats` : t`Search Results`}
                </h2>
                <p className="text-sm text-theme-fg-secondary">
                  {isShowingRecent
                    ? t`Showing ${resultsCount} recent chats`
                    : t`Found ${resultsCount} results`}
                </p>
              </div>

              <div className="grid gap-3">
                {searchResults.map((result) => (
                  <a
                    key={result.id}
                    href={`/chat/${result.chatId}`}
                    data-ui="search-result-card"
                    onClick={(e) => {
                      // Allow cmd/ctrl-click to open in new tab
                      if (e.metaKey || e.ctrlKey) {
                        return;
                      }
                      if (e.defaultPrevented) {
                        return;
                      }
                      // Prevent default navigation for normal clicks
                      e.preventDefault();
                      handleResultClick(result);
                    }}
                    className="block cursor-pointer rounded-lg border border-theme-border bg-theme-bg-primary p-4 transition-all hover:border-theme-border-focus hover:bg-theme-bg-hover focus:bg-theme-bg-hover focus:outline-none focus:ring-2 focus:ring-theme-focus"
                    aria-label={result.chatTitle}
                  >
                    <div className="flex items-center gap-4">
                      <h3 className="line-clamp-1 min-w-0 flex-1 font-medium text-theme-fg-primary">
                        {result.chatTitle}
                      </h3>
                      <div className="shrink-0 text-xs text-theme-fg-muted">
                        <MessageTimestamp
                          createdAt={new Date(result.timestamp)}
                        />
                      </div>
                      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events -- div exists to prevent anchor navigation from menu clicks */}
                      <div
                        className="shrink-0"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                      >
                        <DropdownMenu
                          items={[
                            ...(chatSharingEnabled
                              ? [
                                  {
                                    label: t({
                                      id: "chat.share.button",
                                      message: "Share",
                                    }),
                                    icon: <ShareIcon className="size-4" />,
                                    onClick: () =>
                                      setShareDialogChatId(result.chatId),
                                    disabled: !result.canEdit,
                                  },
                                ]
                              : []),
                            {
                              label: t({
                                id: "chat.history.menu.rename",
                                message: "Rename",
                              }),
                              icon: <MultiplePagesIcon className="size-4" />,
                              onClick: () =>
                                setTitleDialogChatId(result.chatId),
                              disabled: !result.canEdit,
                            },
                            {
                              label: t`Remove`,
                              icon: <LogOutIcon className="size-4" />,
                              onClick: () => {
                                void handleArchiveResult(result.chatId);
                              },
                              confirmAction: true,
                              confirmTitle: t`Confirm Removal`,
                              confirmMessage: t`Are you sure you want to remove this chat?`,
                            },
                          ]}
                        />
                      </div>
                    </div>
                  </a>
                ))}
              </div>

              {hasNextPage && (
                <div
                  ref={loadMoreSentinelRef}
                  className="flex justify-center py-6"
                  data-ui="search-load-more-sentinel"
                  aria-label={t`Loading...`}
                >
                  {(isFetchingNextPage || isSearching) && (
                    <div className="size-5 animate-spin rounded-full border-2 border-theme-border border-t-transparent" />
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <EditChatTitleDialog
        isOpen={titleDialogChatId !== null && activeTitleDialogResult !== null}
        generatedTitle={
          activeTitleDialogResult?.titleBySummary ??
          t({
            id: "chat.history.rename.generated.fallback",
            message: "Untitled Chat",
          })
        }
        initialUserProvidedTitle={
          activeTitleDialogResult?.titleByUserProvided ?? null
        }
        isSubmitting={isUpdatingChatTitle}
        onClose={handleCloseEditTitleDialog}
        onSubmit={handleSubmitEditTitleDialog}
      />

      <ChatShareDialog
        isOpen={shareDialogChatId !== null}
        chatId={shareDialogChatId}
        onClose={() => setShareDialogChatId(null)}
      />
    </div>
  );
}
