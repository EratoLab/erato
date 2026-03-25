import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { v1betaApiFetch } from "@/lib/generated/v1betaApi/v1betaApiFetcher";

const CHAT_SHARE_LINK_QUERY_KEY = "chat-share-link";
const RESOLVE_CHAT_SHARE_LINK_QUERY_KEY = "resolve-chat-share-link";
const CHAT_RESOURCE_TYPE = "chat";

type ShareLink = {
  id: string;
  resource_type: string;
  resource_id: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

type ShareLinkForResourceResponse = {
  share_link: ShareLink | null;
};

type ResolveShareLinkResponse = {
  share_link: ShareLink;
  title_resolved: string | null;
  owner_display_name: string | null;
};

const shareLinkQueryKey = (chatId: string) =>
  [
    CHAT_SHARE_LINK_QUERY_KEY,
    {
      chatId,
    },
  ] as const;

export function useChatShareLink(chatId: string | null) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: chatId
      ? shareLinkQueryKey(chatId)
      : [CHAT_SHARE_LINK_QUERY_KEY, "idle"],
    enabled: !!chatId,
    queryFn: chatId
      ? async () => {
          const response = await v1betaApiFetch<
            ShareLinkForResourceResponse,
            never,
            undefined,
            Record<string, never>,
            { resource_type: string; resource_id: string },
            Record<string, never>
          >({
            // eslint-disable-next-line lingui/no-unlocalized-strings
            url: "/api/v1beta/share-links",
            method: "GET",
            queryParams: {
              resource_type: CHAT_RESOURCE_TYPE,
              resource_id: chatId,
            },
          });

          return response.share_link;
        }
      : skipToken,
  });

  const mutation = useMutation({
    mutationFn: async ({
      chatId,
      enabled,
    }: {
      chatId: string;
      enabled: boolean;
    }) => {
      const response = await v1betaApiFetch<
        { share_link: ShareLink },
        never,
        { resource_type: string; resource_id: string; enabled: boolean },
        Record<string, never>,
        Record<string, never>,
        Record<string, never>
      >({
        // eslint-disable-next-line lingui/no-unlocalized-strings
        url: "/api/v1beta/share-links",
        method: "PUT",
        body: {
          resource_type: CHAT_RESOURCE_TYPE,
          resource_id: chatId,
          enabled,
        },
      });

      return response.share_link;
    },
    onSuccess: async () => {
      if (chatId) {
        await queryClient.invalidateQueries({
          queryKey: shareLinkQueryKey(chatId),
        });
      }
    },
  });

  return {
    shareLink: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
    setEnabled: async (enabled: boolean) => {
      if (!chatId) {
        return null;
      }

      return mutation.mutateAsync({ chatId, enabled });
    },
    isUpdating: mutation.isPending,
  };
}

export function useResolveChatShareLink(shareLinkId: string | null) {
  return useQuery({
    queryKey: [RESOLVE_CHAT_SHARE_LINK_QUERY_KEY, "v2", shareLinkId],
    enabled: !!shareLinkId,
    queryFn: shareLinkId
      ? async () => {
          const response = await v1betaApiFetch<
            ResolveShareLinkResponse,
            never,
            undefined,
            Record<string, never>,
            Record<string, never>,
            { share_link_id: string }
          >({
            // eslint-disable-next-line lingui/no-unlocalized-strings
            url: "/api/v1beta/share-links/{share_link_id}",
            method: "GET",
            pathParams: {
              share_link_id: shareLinkId,
            },
          });

          return {
            ...response.share_link,
            title_resolved: response.title_resolved,
            owner_display_name: response.owner_display_name,
          };
        }
      : skipToken,
  });
}
