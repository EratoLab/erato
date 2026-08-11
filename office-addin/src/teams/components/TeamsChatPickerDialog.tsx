import {
  Alert,
  ArrowLeftIcon,
  Button,
  CloseIcon,
  FILE_PREVIEW_STYLES,
  FolderIcon,
  Input,
  ModalBase,
  PageIcon,
  SearchIcon,
} from "@erato/frontend/library";
import { plural, t } from "@lingui/core/macro";
import { useEffect, useMemo, useRef, useState } from "react";

import { TeamsPickerRow, TeamsPickerRowSkeleton } from "./TeamsPickerRow";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { useTeamsChannelHitProbe } from "../hooks/useTeamsChannelHitProbe";
import { useTeamsChannelMessages } from "../hooks/useTeamsChannelMessages";
import { useTeamsChatMessages } from "../hooks/useTeamsChatMessages";
import {
  MIN_SEARCH_QUERY_LENGTH,
  useTeamsChatSearch,
} from "../hooks/useTeamsChatSearch";
import { useTeamsChatTitles } from "../hooks/useTeamsChatTitles";
import { useTeamsChatPicker } from "../providers/TeamsChatPickerProvider";
import {
  filterTeamsChannels,
  filterTeamsChats,
} from "../utils/filterTeamsChats";
import { isRestrictedChannel } from "../utils/parsedTeamsChannel";
import { splitSearchSummaryHighlights } from "../utils/teamsChatGraph";
import { MAX_SELECTED_MESSAGES } from "../utils/teamsChatSelection";
import {
  channelRef,
  chatRef,
  conversationKey,
} from "../utils/teamsConversationRef";

import type { TeamsChatPickerContextValue } from "../providers/TeamsChatPickerProvider";
import type { ParsedTeamsChannel } from "../utils/parsedTeamsChannel";
import type {
  ParsedTeamsChat,
  TeamsSharedFileRef,
} from "../utils/parsedTeamsChat";
import type { TeamsFileFetcher } from "../utils/teamsChatFetcher";
import type { TeamsSearchHit } from "../utils/teamsChatGraph";
import type { TeamsMessageSelection } from "../utils/teamsChatSelection";
import type {
  TeamsChannelConversationRef,
  TeamsChatConversationRef,
} from "../utils/teamsConversationRef";
import type { ReactNode } from "react";

const SEARCH_DEBOUNCE_MS = 350;
const SKELETON_ROWS = 5;

export function TeamsChatPickerDialog() {
  const picker = useTeamsChatPicker();
  // Remounting per open is deliberate: the query text and the drill-down level
  // are ephemeral, while the selection lives in the provider and survives.
  return picker.isOpen ? <TeamsChatPickerDialogBody picker={picker} /> : null;
}

function TeamsChatPickerDialogBody({
  picker,
}: {
  picker: TeamsChatPickerContextValue;
}) {
  const [query, setQuery] = useState("");
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [activeChannel, setActiveChannel] = useState<{
    teamId: string;
    channelId: string;
    name: string;
    teamName: string;
  } | null>(null);
  const debouncedQuery = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);

  const trimmed = debouncedQuery.trim();
  const isSearching = trimmed.length >= MIN_SEARCH_QUERY_LENGTH;
  const liveLength = query.trim().length;
  const showShortQueryHint =
    liveLength > 0 && liveLength < MIN_SEARCH_QUERY_LENGTH;

  const messages = useTeamsChatMessages(
    picker.fetcher,
    isSearching ? null : activeChatId,
  );
  const channelMessages = useTeamsChannelMessages(
    picker.channelFetcher,
    isSearching ? null : activeChannel,
  );
  const search = useTeamsChatSearch(picker.fetcher, isSearching ? trimmed : "");
  const hitProbe = useTeamsChannelHitProbe(picker.channelFetcher);

  // A probe can resolve after the dialog is gone; a late auto-tick would
  // otherwise plant a selection into the next opening.
  const aliveRef = useRef(true);
  useEffect(
    () => () => {
      aliveRef.current = false;
    },
    [],
  );

  const chatMatches = useMemo(
    () => filterTeamsChats(picker.chatList.chats, query),
    [picker.chatList.chats, query],
  );
  const channelMatches = useMemo(
    () => filterTeamsChannels(picker.channelList.channels, query),
    [picker.channelList.channels, query],
  );

  const unknownChatIds = useMemo(
    () =>
      search.hits
        .map((hit) => (hit.ref.kind === "chat" ? hit.ref.chatId : null))
        .filter(
          (chatId): chatId is string =>
            chatId !== null && !picker.chatList.chatsById.has(chatId),
        ),
    [picker.chatList.chatsById, search.hits],
  );
  const resolvedChats = useTeamsChatTitles(
    picker.fetcher,
    unknownChatIds,
    picker.self,
  );

  const activeChat = activeChatId
    ? (picker.chatList.chatsById.get(activeChatId) ??
      resolvedChats.get(activeChatId) ??
      null)
    : null;

  const dialogTitle = t({
    id: "officeAddin.teams.picker.title",
    message: "Teams chats",
  });

  const chatTitleFor = (chatId: string): string | null =>
    picker.chatList.chatsById.get(chatId)?.title ??
    resolvedChats.get(chatId)?.title ??
    null;

  return (
    <ModalBase
      isOpen
      onClose={picker.close}
      title={dialogTitle}
      contentClassName="h-[80vh] max-h-[600px] max-w-xl"
    >
      <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden">
        <div className="flex shrink-0 items-center gap-2">
          {(activeChat || activeChannel) && !isSearching && (
            <Button
              variant="ghost"
              geometry="icon"
              icon={<ArrowLeftIcon className="size-4" />}
              onClick={() => {
                setActiveChatId(null);
                setActiveChannel(null);
              }}
              aria-label={t({
                id: "officeAddin.teams.picker.back",
                message: "Back to chats",
              })}
            />
          )}
          <SearchIcon
            className="size-4 shrink-0 text-theme-fg-muted"
            aria-hidden="true"
          />
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t({
              id: "officeAddin.teams.picker.searchPlaceholder",
              message: "Filter chats or search messages",
            })}
            aria-label={t({
              id: "officeAddin.teams.picker.searchLabel",
              message: "Filter Teams chats or search messages",
            })}
          />
          {query.length > 0 && (
            <Button
              variant="ghost"
              geometry="icon"
              icon={<CloseIcon className="size-4" />}
              onClick={() => setQuery("")}
              aria-label={t({
                id: "officeAddin.teams.picker.clearSearch",
                message: "Clear search",
              })}
            />
          )}
        </div>

        {activeChat && !isSearching && (
          <p className="shrink-0 truncate text-sm font-medium text-theme-fg-primary">
            {activeChat.title}
          </p>
        )}

        <div className="min-h-0 flex-1 divide-y divide-theme-border overflow-y-auto">
          {liveLength > 0
            ? renderQueryResults()
            : activeChannel
              ? renderChannelMessageList(activeChannel)
              : activeChatId
                ? renderMessageList(activeChatId)
                : renderChatList()}
        </div>

        {renderFooter()}
      </div>
    </ModalBase>
  );

  function renderQueryResults(): ReactNode {
    return (
      <>
        <SectionHeading>
          {t({ id: "officeAddin.teams.picker.chatsSection", message: "Chats" })}
        </SectionHeading>
        {chatMatches.length === 0 &&
        channelMatches.length === 0 &&
        !picker.channelList.isLoading ? (
          <p className="px-3 py-2 text-xs text-theme-fg-muted">
            {t({
              id: "officeAddin.teams.picker.noChatMatches",
              message: "No chat, channel or person matches that name.",
            })}
          </p>
        ) : (
          <>
            {chatMatches.map((chat) => renderChatRow(chat))}
            {channelMatches.map((channel) => renderChannelRow(channel))}
            {picker.channelList.isLoading && <ChannelListLoading />}
          </>
        )}
        <SectionHeading>
          {t({
            id: "officeAddin.teams.picker.messagesSection",
            message: "Messages",
          })}
        </SectionHeading>
        {showShortQueryHint ? (
          <p className="px-3 py-2 text-xs text-theme-fg-muted">
            {t({
              id: "officeAddin.teams.picker.shortQuery",
              message: "Type at least 3 characters to search messages.",
            })}
          </p>
        ) : (
          renderSearchList()
        )}
      </>
    );
  }

  function renderChatList(): ReactNode {
    const list = picker.chatList;
    if (list.isLoading) return <SkeletonRows />;
    if (list.isError) {
      return (
        <ListError
          message={t({
            id: "officeAddin.teams.picker.chatsError",
            message: "Couldn't load your Teams chats.",
          })}
          onRetry={list.refetch}
        />
      );
    }
    if (
      list.chats.length === 0 &&
      picker.channelList.channels.length === 0 &&
      !picker.channelList.isLoading
    ) {
      return (
        <EmptyState
          icon={<FolderIcon className="mb-3 size-10 text-theme-fg-muted" />}
          message={t({
            id: "officeAddin.teams.picker.noChats",
            message: "No Teams chats found.",
          })}
        />
      );
    }
    return (
      <>
        {list.chats.map((chat) => renderChatRow(chat))}
        {picker.channelList.channels.map((channel) =>
          renderChannelRow(channel),
        )}
        {picker.channelList.isLoading && <ChannelListLoading />}
        {(list.isPartial || picker.channelList.isPartial) && <PartialNote />}
        <LoadMoreRow
          visible={list.hasMore}
          busy={list.isLoadingMore}
          onClick={list.loadMore}
          label={t({
            id: "officeAddin.teams.picker.loadMoreChats",
            message: "Load more chats",
          })}
        />
      </>
    );
  }

  function renderChatRow(chat: ParsedTeamsChat): ReactNode {
    const chatTitle = chat.title;
    const selection = {
      kind: "conversation" as const,
      ref: chatRef(chat.chatId),
      title: chatTitle,
    };
    return (
      <TeamsPickerRow
        key={chat.chatId}
        checked={picker.isSelected(selection)}
        onToggle={() => picker.toggle(selection)}
        selectLabel={t({
          id: "officeAddin.teams.picker.selectChat",
          message: `Select ${chatTitle}`,
        })}
        title={chatTitle}
        subline={chat.previewText || undefined}
        onOpen={() => setActiveChatId(chat.chatId)}
        openLabel={t({
          id: "officeAddin.teams.picker.openChat",
          message: `Open ${chatTitle}`,
        })}
        createdAt={chat.lastActivityAt}
        senderName={chatTitle}
      />
    );
  }

  function renderChannelMessageList(channel: {
    teamId: string;
    channelId: string;
    name: string;
    teamName: string;
  }): ReactNode {
    if (channelMessages.isLoading) return <SkeletonRows />;
    if (channelMessages.isError) {
      return (
        <ListError
          message={t({
            id: "officeAddin.teams.picker.channelMessagesError",
            message: "Couldn't load this channel.",
          })}
          onRetry={channelMessages.refetch}
        />
      );
    }
    const ref = channelRef(channel.teamId, channel.channelId);
    return (
      <>
        {channelMessages.messages.length === 0 ? (
          // A page of system events parses to nothing renderable, so "empty"
          // is only a verdict once there is no older page left.
          <EmptyState
            icon={<FolderIcon className="mb-3 size-10 text-theme-fg-muted" />}
            message={
              channelMessages.hasMore
                ? emptyPageMessage()
                : t({
                    id: "officeAddin.teams.picker.noChannelMessages",
                    message: "No messages in this channel yet.",
                  })
            }
          />
        ) : (
          channelMessages.messages.map((message) => {
            const senderName = message.senderName;
            const selection = {
              kind: "message" as const,
              ref,
              messageId: message.messageId,
              parentMessageId: message.replyToId,
              conversationTitle: channel.name,
              senderName,
              createdAt: message.createdAt,
              message,
            };
            const checked = picker.isSelected(selection);
            return (
              <TeamsPickerRow
                key={message.messageId}
                checked={checked}
                onToggle={() => picker.toggle(selection)}
                disabled={!checked && picker.isMessageSelectionFull}
                selectLabel={t({
                  id: "officeAddin.teams.picker.selectMessage",
                  message: `Select message from ${senderName}`,
                })}
                title={senderName}
                subline={message.text}
                chips={
                  <SharedFileChips
                    files={message.sharedFiles}
                    fileFetcher={picker.fileFetcher}
                    maxFileBytes={picker.maxFileBytes}
                  />
                }
                createdAt={message.createdAt}
                senderName={senderName}
              />
            );
          })
        )}
        {channelMessages.isPartial && <PartialNote />}
        <LoadMoreRow
          visible={channelMessages.hasMore}
          busy={channelMessages.isLoadingMore}
          onClick={channelMessages.loadEarlier}
          label={t({
            id: "officeAddin.teams.picker.loadEarlierMessages",
            message: "Load earlier messages",
          })}
        />
      </>
    );
  }

  function renderChannelRow(channel: ParsedTeamsChannel): ReactNode {
    const selection = {
      kind: "conversation" as const,
      ref: channelRef(channel.teamId, channel.channelId),
      title: channel.name,
    };
    const restricted = isRestrictedChannel(channel);
    return (
      <TeamsPickerRow
        key={`${channel.teamId}/${channel.channelId}`}
        isChannel
        checked={picker.isSelected(selection)}
        onToggle={() => picker.toggle(selection)}
        selectLabel={t({
          id: "officeAddin.teams.picker.selectChannel",
          message: `Select ${channel.name}`,
        })}
        title={
          <>
            {channel.name}
            {restricted && (
              <span className="ml-2 rounded bg-theme-bg-accent px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-theme-fg-muted">
                {channel.membershipType === "shared"
                  ? t({
                      id: "officeAddin.teams.picker.sharedChannel",
                      message: "Shared",
                    })
                  : t({
                      id: "officeAddin.teams.picker.privateChannel",
                      message: "Private",
                    })}
              </span>
            )}
          </>
        }
        subline={channel.teamName || undefined}
        onOpen={() =>
          setActiveChannel({
            teamId: channel.teamId,
            channelId: channel.channelId,
            name: channel.name,
            teamName: channel.teamName,
          })
        }
        openLabel={t({
          id: "officeAddin.teams.picker.openChannel",
          message: `Open ${channel.name}`,
        })}
      />
    );
  }

  function renderMessageList(chatId: string): ReactNode {
    if (messages.isLoading) return <SkeletonRows />;
    if (messages.isError) {
      return (
        <ListError
          message={t({
            id: "officeAddin.teams.picker.messagesError",
            message: "Couldn't load this conversation.",
          })}
          onRetry={messages.refetch}
        />
      );
    }
    const chatTitle = chatTitleFor(chatId) ?? "";
    return (
      <>
        {messages.messages.length === 0 ? (
          // A page of joins, renames and calls parses to nothing renderable,
          // so an empty list is a dead end only once there is no older page.
          <EmptyState
            icon={<FolderIcon className="mb-3 size-10 text-theme-fg-muted" />}
            message={
              messages.hasMore
                ? emptyPageMessage()
                : t({
                    id: "officeAddin.teams.picker.noMessages",
                    message: "No messages in this conversation yet.",
                  })
            }
          />
        ) : (
          messages.messages.map((message) => {
            const senderName = message.senderName;
            const selection = {
              kind: "message" as const,
              ref: chatRef(message.chatId),
              messageId: message.messageId,
              conversationTitle: chatTitle,
              senderName,
              createdAt: message.createdAt,
              message,
            };
            const checked = picker.isSelected(selection);
            return (
              <TeamsPickerRow
                key={message.messageId}
                checked={checked}
                onToggle={() => picker.toggle(selection)}
                disabled={!checked && picker.isMessageSelectionFull}
                selectLabel={t({
                  id: "officeAddin.teams.picker.selectMessage",
                  message: `Select message from ${senderName}`,
                })}
                title={senderName}
                subline={message.text}
                chips={
                  <SharedFileChips
                    files={message.sharedFiles}
                    fileFetcher={picker.fileFetcher}
                    maxFileBytes={picker.maxFileBytes}
                  />
                }
                createdAt={message.createdAt}
                senderName={senderName}
              />
            );
          })
        )}
        {messages.isPartial && <PartialNote />}
        <LoadMoreRow
          visible={messages.hasMore}
          busy={messages.isLoadingMore}
          onClick={messages.loadEarlier}
          label={t({
            id: "officeAddin.teams.picker.loadEarlierMessages",
            message: "Load earlier messages",
          })}
        />
      </>
    );
  }

  function renderSearchList(): ReactNode {
    if (search.isLoading) return <SkeletonRows />;
    if (search.isError) {
      return (
        <ListError
          message={t({
            id: "officeAddin.teams.picker.searchError",
            message: "Couldn't search Teams messages.",
          })}
          onRetry={search.refetch}
        />
      );
    }
    const searchTerm = trimmed;
    return (
      <>
        {search.isRefreshing && (
          // `keepPreviousData` keeps the previous query's hits on screen while
          // the new one runs; without this line that reads as a finished search.
          <p className="px-3 py-1 text-xs text-theme-fg-muted" role="status">
            {t({
              id: "officeAddin.teams.picker.searchRefreshing",
              message: "Searching…",
            })}
          </p>
        )}
        {search.hits.length === 0 ? (
          // Hits without an addressable `(chatId, messageId)` are dropped, so
          // a page can come back empty while later pages still hold results.
          <EmptyState
            icon={<SearchIcon className="mb-3 size-10 text-theme-fg-muted" />}
            message={
              search.hasMore
                ? emptyPageMessage()
                : t({
                    id: "officeAddin.teams.picker.noSearchResults",
                    message: `No messages match “${searchTerm}”.`,
                  })
            }
            hint={
              search.hasMore
                ? undefined
                : t({
                    id: "officeAddin.teams.picker.searchScope",
                    message: "Search covers messages you can access in Teams.",
                  })
            }
          />
        ) : (
          search.hits.map((hit) => {
            const senderName =
              hit.senderName ||
              t({
                id: "officeAddin.teams.picker.unknownSender",
                message: "Unknown sender",
              });
            return hit.ref.kind === "chat"
              ? renderChatHitRow(hit, hit.ref, senderName)
              : renderChannelHitRow(hit, hit.ref, senderName);
          })
        )}
        <LoadMoreRow
          visible={search.hasMore}
          busy={search.isLoadingMore}
          onClick={search.loadMore}
          label={t({
            id: "officeAddin.teams.picker.loadMoreResults",
            message: "Load more results",
          })}
        />
      </>
    );
  }

  function renderChatHitRow(
    hit: TeamsSearchHit,
    ref: TeamsChatConversationRef,
    senderName: string,
  ): ReactNode {
    const chatTitle = chatTitleFor(ref.chatId);
    const selection: TeamsMessageSelection = {
      kind: "message",
      ref,
      messageId: hit.messageId,
      conversationTitle: chatTitle ?? "",
      senderName,
      createdAt: hit.createdAt,
    };
    const checked = picker.isSelected(selection);
    return (
      <TeamsPickerRow
        key={`${conversationKey(ref)}:${hit.messageId}`}
        checked={checked}
        onToggle={() => picker.toggle(selection)}
        disabled={!checked && picker.isMessageSelectionFull}
        selectLabel={t({
          id: "officeAddin.teams.picker.selectMessage",
          message: `Select message from ${senderName}`,
        })}
        title={<HitTitle senderName={senderName} conversation={chatTitle} />}
        subline={<SearchSnippet summary={hit.summary} />}
        createdAt={hit.createdAt}
        senderName={senderName}
      />
    );
  }

  /**
   * A channel hit does not say whether it is a thread root or a reply, and
   * only roots can be fetched by id — so the first tick probes, a root then
   * ticks itself, and a reply turns the row into a pointer at its channel.
   */
  function renderChannelHitRow(
    hit: TeamsSearchHit,
    ref: TeamsChannelConversationRef,
    senderName: string,
  ): ReactNode {
    const channel =
      picker.channelList.channelsByKey.get(`${ref.teamId}/${ref.channelId}`) ??
      null;
    const probe = hitProbe.probeFor(ref, hit.messageId);
    const unavailable = picker.channelFetcher === null;

    const selection: TeamsMessageSelection = {
      kind: "message",
      ref,
      messageId: hit.messageId,
      parentMessageId: null,
      conversationTitle: channel?.name ?? "",
      senderName,
      createdAt: hit.createdAt,
    };
    const checked = picker.isSelected(selection);

    const note = unavailable
      ? t({
          id: "officeAddin.teams.picker.channelHitUnavailable",
          message:
            "Channel messages can't be attached — channel access hasn't been granted.",
        })
      : probe?.state === "probing"
        ? t({
            id: "officeAddin.teams.picker.channelHitProbing",
            message: "Checking whether this message can be attached…",
          })
        : probe?.state === "reply"
          ? t({
              id: "officeAddin.teams.picker.channelHitIsReply",
              message:
                "A reply can't be attached from search — open the channel to pick it.",
            })
          : probe?.state === "failed"
            ? t({
                id: "officeAddin.teams.picker.channelHitProbeFailed",
                message:
                  "Couldn't check this message. Select it again to retry.",
              })
            : undefined;

    const onToggle = () => {
      if (checked) {
        picker.toggle(selection);
        return;
      }
      if (unavailable || probe?.state === "probing" || probe?.state === "reply")
        return;
      if (probe?.state === "root") {
        picker.toggle({ ...selection, message: probe.message ?? undefined });
        return;
      }
      void hitProbe.probe(ref, hit.messageId).then((result) => {
        if (result.state === "root" && aliveRef.current)
          picker.toggle({ ...selection, message: result.message ?? undefined });
      });
    };

    const openChannel = channel
      ? () => {
          setQuery("");
          setActiveChannel({
            teamId: channel.teamId,
            channelId: channel.channelId,
            name: channel.name,
            teamName: channel.teamName,
          });
        }
      : undefined;

    return (
      <TeamsPickerRow
        key={`${conversationKey(ref)}:${hit.messageId}`}
        checked={checked}
        onToggle={onToggle}
        disabled={
          unavailable ||
          probe?.state === "probing" ||
          probe?.state === "reply" ||
          (!checked && picker.isMessageSelectionFull)
        }
        selectLabel={t({
          id: "officeAddin.teams.picker.selectMessage",
          message: `Select message from ${senderName}`,
        })}
        title={
          <HitTitle senderName={senderName} conversation={channel?.name} />
        }
        subline={<SearchSnippet summary={hit.summary} />}
        note={note}
        onOpen={probe?.state === "reply" ? openChannel : undefined}
        openLabel={
          channel
            ? t({
                id: "officeAddin.teams.picker.openChannel",
                message: `Open ${channel.name}`,
              })
            : undefined
        }
        createdAt={hit.createdAt}
        senderName={senderName}
      />
    );
  }

  function renderFooter(): ReactNode {
    const selectedCount = picker.selection.size;
    const messageLimit = picker.messageLimit;
    const partial = picker.partialOutcome;
    const chatsCompleted = partial?.chatsCompleted ?? 0;
    const chatsTotal = partial?.chatsTotal ?? 0;
    const hasWholeSelection = [...picker.selection.values()].some(
      (selection) => selection.kind === "conversation",
    );

    return (
      <div className="shrink-0 space-y-3 border-t border-theme-border pt-3">
        {picker.isBuilding && picker.progress && (
          <BuildProgress picker={picker} />
        )}

        {picker.attachError === "nothing-to-attach" && (
          <Alert type="error">
            {t({
              id: "officeAddin.teams.picker.nothingToAttach",
              message:
                "Nothing to attach — the selected messages have no readable content.",
            })}
          </Alert>
        )}
        {picker.attachError === "upload-failed" && (
          <Alert type="error">
            {t({
              id: "officeAddin.teams.picker.uploadFailed",
              message: "Couldn't attach the transcript. Try again.",
            })}
          </Alert>
        )}

        {partial && (
          <Alert type="warning">
            <div className="space-y-2">
              <p>
                {t({
                  id: "officeAddin.teams.picker.partialBuild",
                  message: `Loaded ${chatsCompleted} of ${chatsTotal} conversations. Attach what was loaded?`,
                })}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="primary"
                  onClick={() => void picker.attachPartial()}
                >
                  {t({
                    id: "officeAddin.teams.picker.attachAnyway",
                    message: "Attach anyway",
                  })}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => void picker.attach()}
                >
                  {t({
                    id: "officeAddin.teams.picker.retry",
                    message: "Retry",
                  })}
                </Button>
              </div>
            </div>
          </Alert>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-theme-fg-muted">
          <span>
            {t({
              id: "officeAddin.teams.picker.wholeChatBound",
              message: `Whole chats add the last ${messageLimit} messages.`,
            })}
          </span>
          {/* The window only binds whole-conversation ticks; offering to raise
              it with none selected reads as a second list-paging control. */}
          {picker.canRaiseMessageLimit && hasWholeSelection && (
            <Button
              variant="ghost"
              onClick={picker.raiseMessageLimit}
              disabled={picker.isBuilding}
            >
              {t({
                id: "officeAddin.teams.picker.includeEarlier",
                message: "Include earlier",
              })}
            </Button>
          )}
        </div>

        {picker.isMessageSelectionFull && (
          <p className="text-xs text-theme-fg-muted" role="status">
            {t({
              id: "officeAddin.teams.picker.messageCapReached",
              message: `You can attach up to ${MAX_SELECTED_MESSAGES} individual messages at a time.`,
            })}
          </p>
        )}

        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-theme-fg-muted" role="status">
            {t({
              id: "officeAddin.teams.picker.selectionCount",
              message: plural(selectedCount, {
                one: "# item selected",
                other: "# items selected",
              }),
            })}
          </span>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={picker.isBuilding ? picker.cancelBuild : picker.close}
            >
              {t({
                id: "officeAddin.teams.picker.cancel",
                message: "Cancel",
              })}
            </Button>
            <Button
              variant="primary"
              loading={picker.isBuilding}
              disabled={selectedCount === 0}
              onClick={() => void picker.attach()}
            >
              {t({
                id: "officeAddin.teams.picker.attach",
                message: "Attach",
              })}
            </Button>
          </div>
        </div>
      </div>
    );
  }
}

function BuildProgress({ picker }: { picker: TeamsChatPickerContextValue }) {
  const progress = picker.progress;
  if (!progress) return null;
  const total = Math.max(1, progress.requestsTotal);
  const percent = Math.min(
    100,
    Math.round((progress.requestsCompleted / total) * 100),
  );
  const chatsCompleted = progress.chatsCompleted;
  const chatsTotal = progress.chatsTotal;
  const messagesFetched = progress.messagesFetched;
  const oldest = formatDay(progress.oldestCreatedDateTime);
  const titles = progress.inFlightTitles
    .filter((title) => title.length > 0)
    .join(", ");

  return (
    <div className="space-y-1">
      <div
        role="progressbar"
        aria-valuenow={progress.requestsCompleted}
        aria-valuemin={0}
        aria-valuemax={progress.requestsTotal}
        aria-label={t({
          id: "officeAddin.teams.picker.progressLabel",
          message: "Loading Teams messages",
        })}
        className={FILE_PREVIEW_STYLES.progress.container}
      >
        <div
          className={FILE_PREVIEW_STYLES.progress.bar}
          style={{ width: `${percent}%` }}
        />
      </div>
      <p
        className="text-xs text-theme-fg-muted"
        role="status"
        aria-live="polite"
      >
        {oldest
          ? t({
              id: "officeAddin.teams.picker.progressWithDate",
              message: `${chatsCompleted} of ${chatsTotal} conversations loaded — ${messagesFetched} messages, back to ${oldest}`,
            })
          : t({
              id: "officeAddin.teams.picker.progress",
              message: `${chatsCompleted} of ${chatsTotal} conversations loaded — ${messagesFetched} messages`,
            })}
      </p>
      {titles.length > 0 && (
        <p className="truncate text-xs text-theme-fg-muted" role="status">
          {t({
            id: "officeAddin.teams.picker.progressLoading",
            message: `Loading: ${titles}…`,
          })}
        </p>
      )}
    </div>
  );
}

/**
 * One compact chip per file shared with the message. With the file grant the
 * bytes come through our own token into a tab-local blob — no SharePoint
 * session needed, which a dev browser profile rarely has. Without the grant
 * the chip falls back to the file's SharePoint page.
 */
function SharedFileChips({
  files,
  fileFetcher,
  maxFileBytes,
}: {
  files: readonly TeamsSharedFileRef[];
  fileFetcher: TeamsFileFetcher | null;
  maxFileBytes: number;
}) {
  if (files.length === 0) return null;

  const openFile = (file: TeamsSharedFileRef) => {
    if (!fileFetcher) {
      window.open(file.contentUrl, "_blank", "noopener,noreferrer");
      return;
    }
    // The tab must open synchronously with the click or the popup blocker
    // eats it; the content streams in afterwards.
    const viewer = window.open("about:blank", "_blank");
    if (!viewer) return;
    void fileFetcher
      .downloadSharedFile(file.contentUrl, maxFileBytes, {})
      .then((result) => {
        if (result.state === "ok") {
          viewer.location.href = URL.createObjectURL(
            new Blob([result.content.bytes], {
              type: result.content.contentType,
            }),
          );
        } else {
          // Oversized or unresolvable here — let SharePoint have it.
          viewer.location.href = file.contentUrl;
        }
      })
      .catch(() => {
        viewer.location.href = file.contentUrl;
      });
  };

  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {files.map((file) => (
        <button
          key={file.attachmentId}
          type="button"
          onClick={() => openFile(file)}
          title={file.name}
          aria-label={t({
            id: "officeAddin.teams.picker.openSharedFile",
            message: `Open ${file.name}`,
          })}
          className="theme-transition flex max-w-44 items-center gap-1 rounded-full border border-theme-border bg-theme-bg-accent px-2 py-0.5 text-[11px] text-theme-fg-muted hover:bg-theme-bg-hover hover:text-theme-fg-primary"
        >
          <PageIcon className="size-3 shrink-0" aria-hidden />
          <span className="truncate">{file.name}</span>
        </button>
      ))}
    </div>
  );
}

function HitTitle({
  senderName,
  conversation,
}: {
  senderName: string;
  conversation?: string | null;
}) {
  return (
    <>
      {senderName}
      {conversation && (
        <span className="font-normal text-theme-fg-muted">
          {" · "}
          {conversation}
        </span>
      )}
    </>
  );
}

function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <p className="px-3 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-theme-fg-muted">
      {children}
    </p>
  );
}

function SearchSnippet({ summary }: { summary: string }) {
  const segments = splitSearchSummaryHighlights(summary);
  return (
    <>
      {segments.map((segment, index) => (
        <span
          key={index}
          className={
            segment.highlighted
              ? "font-medium text-theme-fg-primary"
              : undefined
          }
        >
          {segment.text}
        </span>
      ))}
    </>
  );
}

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: SKELETON_ROWS }, (_, index) => (
        <TeamsPickerRowSkeleton key={index} />
      ))}
    </>
  );
}

/**
 * Channels land a beat after the chats — one call for the teams, then one per
 * team — so the list holds their place instead of growing without warning.
 */
function ChannelListLoading() {
  return (
    <div
      role="status"
      aria-label={t({
        id: "officeAddin.teams.picker.channelsLoading",
        message: "Loading channels…",
      })}
    >
      <TeamsPickerRowSkeleton />
      <TeamsPickerRowSkeleton />
    </div>
  );
}

function EmptyState({
  icon,
  message,
  hint,
}: {
  icon: ReactNode;
  message: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      {icon}
      <p className="text-sm text-theme-fg-muted">{message}</p>
      {hint && <p className="mt-1 text-xs text-theme-fg-muted">{hint}</p>}
    </div>
  );
}

/** Both lists drop unrenderable entries, so a page can arrive with no rows. */
function emptyPageMessage(): string {
  return t({
    id: "officeAddin.teams.picker.emptyPage",
    message: "Nothing to show on this page — load more to keep looking.",
  });
}

function ListError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="space-y-2 py-4">
      <Alert type="error">{message}</Alert>
      <Button variant="secondary" onClick={onRetry}>
        {t({ id: "officeAddin.teams.picker.retry", message: "Retry" })}
      </Button>
    </div>
  );
}

function PartialNote() {
  return (
    <p className="px-2 py-2 text-xs text-theme-fg-muted" role="status">
      {t({
        id: "officeAddin.teams.picker.partialList",
        message: "Showing partial results — Teams is rate-limiting.",
      })}
    </p>
  );
}

function LoadMoreRow({
  visible,
  busy,
  onClick,
  label,
}: {
  visible: boolean;
  busy: boolean;
  onClick: () => void;
  label: string;
}) {
  if (!visible) return null;
  return (
    <div className="px-2 py-2">
      <Button variant="secondary" loading={busy} onClick={onClick}>
        {label}
      </Button>
    </div>
  );
}

function formatDay(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "long",
  }).format(date);
}
