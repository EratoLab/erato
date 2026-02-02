import { t } from "@lingui/core/macro";
import clsx from "clsx";
import { useState, useCallback, useEffect, useMemo } from "react";
import { useDebounce } from "use-debounce";

import { PageHeader } from "@/components/ui/Container/PageHeader";
import { MessageTimestamp } from "@/components/ui/Message/MessageTimestamp";
import { SearchIcon, CloseIcon } from "@/components/ui/icons";
import { usePageAlignment } from "@/hooks/ui";
import { useChatContext } from "@/providers/ChatProvider";
import { useChatInputFeature } from "@/providers/FeatureConfigProvider";
import { createLogger } from "@/utils/debugLogger";

const logger = createLogger("UI", "SearchPage");

interface SearchResult {
  id: string;
  chatId: string;
  chatTitle: string;
  messageContent: string;
  timestamp: string;
  context?: string;
}

export default function SearchPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // Get chat data from context
  const { chats: chatHistory, navigateToChat } = useChatContext();

  // Get feature configurations
  const { autofocus: shouldAutofocus } = useChatInputFeature();

  // Get alignment configuration for content
  const {
    containerClasses: contentContainerClasses,
    horizontalPadding: contentHorizontalPadding,
  } = usePageAlignment("search");

  // Debounce search query using use-debounce library for consistency
  const [debouncedSearchQuery] = useDebounce(searchQuery, 300);

  // Convert chat history to SearchResult format
  const allChats = useMemo(() => {
    if (!Array.isArray(chatHistory)) return [];

    return chatHistory
      .map(
        (chat): SearchResult => ({
          id: chat.id,
          chatId: chat.id,
          chatTitle: chat.title_by_summary || t`New Chat`,
          messageContent: chat.title_by_summary || t`New Chat`,
          timestamp: chat.last_message_at || new Date().toISOString(),
        }),
      )
      .sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      );
  }, [chatHistory]);

  // Get last 10 chats for default display
  const recentChats = useMemo(() => allChats.slice(0, 10), [allChats]);

  // Search function
  const handleSearch = useCallback(
    async (query: string) => {
      if (!query.trim()) {
        setSearchResults(recentChats);
        setIsSearching(false);
        return;
      }

      setIsSearching(true);
      logger.log("Performing search for:", query);

      // Simulate slight delay for better UX
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      try {
        // Search through chat titles
        const filteredChats = allChats.filter((chat) =>
          chat.chatTitle.toLowerCase().includes(query.toLowerCase()),
        );

        setSearchResults(filteredChats);
      } catch (error) {
        logger.log("Search error:", error);
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    },
    [allChats, recentChats],
  );

  // Effect to handle search when debounced query changes
  useEffect(() => {
    void handleSearch(debouncedSearchQuery);
  }, [debouncedSearchQuery, handleSearch]);

  // Initialize with recent chats only when there's no search query
  useEffect(() => {
    if (
      searchQuery.trim() === "" &&
      searchResults.length === 0 &&
      recentChats.length > 0
    ) {
      setSearchResults(recentChats);
    }
  }, [recentChats, searchResults.length, searchQuery]);

  const clearSearch = () => {
    setSearchQuery("");
    setSearchResults(recentChats);
  };

  const handleResultClick = (result: SearchResult) => {
    // Defensive check to prevent click handler issues
    if (!result.chatId) {
      return;
    }

    navigateToChat(result.chatId);
  };

  const resultsCount = searchResults.length;
  const isShowingRecent = !searchQuery.trim();

  return (
    <div className="flex h-full flex-col bg-theme-bg-secondary">
      {/* Search Header */}
      <PageHeader
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
          {isSearching && (
            <div className="flex items-center justify-center py-8">
              <div className="text-center">
                <div className="mx-auto mb-4 size-6 animate-spin rounded-full border-2 border-theme-border border-t-transparent"></div>
                <p className="text-sm text-theme-fg-secondary">{t`Searching...`}</p>
              </div>
            </div>
          )}

          {!isSearching && searchResults.length === 0 && (
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

          {!isSearching && searchResults.length > 0 && (
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
                    onClick={(e) => {
                      // Allow cmd/ctrl-click to open in new tab
                      if (e.metaKey || e.ctrlKey) {
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
                    </div>
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
