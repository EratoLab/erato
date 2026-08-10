/**
 * Capability seam over the Teams chat wire layer. One backend exists today
 * (Graph); the seam is what lets the hooks be exercised without stubbing
 * `fetch`, mirroring `fetchOutlookMessage.ts`.
 */

import {
  getChannelMessage,
  getChatMessage,
  getTeamsChat,
  listChannelMessagesPage,
  listChatMessagesPage,
  listJoinedTeams,
  listTeamChannels,
  listTeamsChatsPage,
  searchChatMessages,
} from "./teamsChatGraph";
import {
  pageChannelMessagesBackwards,
  pageChatMessagesBackwards,
} from "./teamsChatPager";
import { makeGraphTokenSource } from "../../utils/graph/graphClient";

import type {
  GraphChat,
  GraphChatMessage,
  ListChatMessagesPageResult,
  ListJoinedTeamsResult,
  ListTeamChannelsResult,
  ListTeamsChatsResult,
  SearchChatMessagesResult,
  TeamsGraphCallOptions,
} from "./teamsChatGraph";
import type {
  ChatPagingProgress,
  PageChatMessagesResult,
} from "./teamsChatPager";
import type { AcquireGraphToken } from "../../utils/graph/graphClient";

export interface TeamsChatFetcher {
  listChats(
    options?: TeamsGraphCallOptions & { nextLink?: string | null },
  ): Promise<ListTeamsChatsResult>;
  getChat(
    chatId: string,
    options?: TeamsGraphCallOptions,
  ): Promise<GraphChat | null>;
  listMessagesPage(
    chatId: string,
    options?: TeamsGraphCallOptions & { nextLink?: string | null },
  ): Promise<ListChatMessagesPageResult>;
  searchMessages(
    query: string,
    options?: TeamsGraphCallOptions & { from?: number; size?: number },
  ): Promise<SearchChatMessagesResult>;
  pageChatBackwards(
    args: {
      chatId: string;
      limit?: number;
      startingAfterLink?: string | null;
      onProgress?: (progress: ChatPagingProgress) => void;
    } & TeamsGraphCallOptions,
  ): Promise<PageChatMessagesResult>;
  getMessage(
    chatId: string,
    messageId: string,
    options?: TeamsGraphCallOptions,
  ): Promise<GraphChatMessage | null>;
}

export function createGraphTeamsChatFetcher(
  acquireToken: AcquireGraphToken,
): TeamsChatFetcher {
  // One token source per operation, matching the Outlook backends: a
  // multi-request operation acquires once and force-refreshes once on 401.
  const tokenSource = () => makeGraphTokenSource(acquireToken);
  return {
    listChats: (options = {}) => listTeamsChatsPage(tokenSource(), options),
    getChat: (chatId, options = {}) =>
      getTeamsChat(chatId, tokenSource(), options),
    listMessagesPage: (chatId, options = {}) =>
      listChatMessagesPage(chatId, tokenSource(), options),
    searchMessages: (query, options = {}) =>
      searchChatMessages(query, tokenSource(), options),
    pageChatBackwards: (args) =>
      pageChatMessagesBackwards({ ...args, tokenSource: tokenSource() }),
    getMessage: (chatId, messageId, options = {}) =>
      getChatMessage(chatId, messageId, tokenSource(), options),
  };
}

/**
 * Channels are a separate seam because they are a separate consent decision:
 * `ChannelMessage.Read.All` needs an admin, so a tenant can have working chats
 * and no channels. Callers treat a null channel fetcher as "chats only".
 */
export interface TeamsChannelFetcher {
  listJoinedTeams(
    options?: TeamsGraphCallOptions,
  ): Promise<ListJoinedTeamsResult>;
  listChannels(
    teamId: string,
    options?: TeamsGraphCallOptions,
  ): Promise<ListTeamChannelsResult>;
  listMessagesPage(
    teamId: string,
    channelId: string,
    options?: TeamsGraphCallOptions & { nextLink?: string | null },
  ): Promise<ListChatMessagesPageResult>;
  getMessage(
    teamId: string,
    channelId: string,
    messageId: string,
    options?: TeamsGraphCallOptions,
  ): Promise<GraphChatMessage | null>;
  pageChannelBackwards(
    args: {
      teamId: string;
      channelId: string;
      limit?: number;
      startingAfterLink?: string | null;
      onProgress?: (progress: ChatPagingProgress) => void;
    } & TeamsGraphCallOptions,
  ): Promise<PageChatMessagesResult>;
}

export function createGraphTeamsChannelFetcher(
  acquireToken: AcquireGraphToken,
): TeamsChannelFetcher {
  const tokenSource = () => makeGraphTokenSource(acquireToken);
  return {
    listJoinedTeams: (options = {}) => listJoinedTeams(tokenSource(), options),
    listChannels: (teamId, options = {}) =>
      listTeamChannels(teamId, tokenSource(), options),
    listMessagesPage: (teamId, channelId, options = {}) =>
      listChannelMessagesPage(teamId, channelId, tokenSource(), options),
    getMessage: (teamId, channelId, messageId, options = {}) =>
      getChannelMessage(teamId, channelId, messageId, tokenSource(), options),
    pageChannelBackwards: (args) =>
      pageChannelMessagesBackwards({ ...args, tokenSource: tokenSource() }),
  };
}
