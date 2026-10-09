import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useDesktopSidecar } from "@/providers/DesktopSidecarProvider";

import type {
  IndexingStatusV1Result,
  OutlookListingWarning,
  OutlookMailbox,
  SidecarConfiguration,
  SourcesListV1Result,
} from "@erato/desktop-sidecar-protocol";
import type { UseQueryResult } from "@tanstack/react-query";

interface IndexingData {
  status: IndexingStatusV1Result;
  mailboxes: OutlookMailbox[];
  /** Local Outlook data that could not be inspected, or looks out of date. */
  mailboxWarnings: OutlookListingWarning[];
  sources?: SourcesListV1Result["sources"];
}

type SidecarIndexingState = UseQueryResult<IndexingData, Error> & {
  supported: boolean;
  save: (patch: Partial<SidecarConfiguration>) => Promise<void>;
  reset: () => void;
  resetSupported: boolean;
  resetting: boolean;
  resetError: Error | null;
  resetSucceeded: boolean;
  saving: boolean;
  saveError: Error | null;
};

export function useSidecarIndexing(): SidecarIndexingState {
  const { client, snapshot } = useDesktopSidecar();
  const queryClient = useQueryClient();
  const supported =
    snapshot.state === "ready" &&
    !!client?.supports("indexing.status.v1") &&
    (client.supports("sources.list.v1") ||
      client.supports("outlook.list_mailboxes.v1")) &&
    client.supports("sidecar.configure.v1");
  const queryKey = ["sidecar-indexing", snapshot.instanceId];
  const query = useQuery<IndexingData, Error>({
    queryKey,
    enabled: supported,
    refetchInterval: 5_000,
    queryFn: async ({ signal }) => {
      if (!client) throw new Error("Sidecar unavailable");
      const [status, { mailboxes, warnings }, sourceResult] = await Promise.all(
        [
          client.invoke(
            "indexing.status.v1",
            { includeSourceBreakdowns: true, includeFileTypeBreakdowns: false },
            { signal },
          ),
          client.supports("outlook.list_mailboxes.v1")
            ? client.invoke("outlook.list_mailboxes.v1", {}, { signal })
            : Promise.resolve({ mailboxes: [], warnings: [] }),
          client.supports("sources.list.v1")
            ? client.invoke("sources.list.v1", {}, { signal })
            : Promise.resolve(undefined),
        ],
      );
      return {
        status,
        mailboxes,
        mailboxWarnings: warnings,
        sources: sourceResult?.sources,
      };
    },
  });
  const mutation = useMutation({
    mutationFn: async (patch: Partial<SidecarConfiguration>) => {
      if (!client || !query.data?.status.configuration)
        throw new Error("Sidecar configuration unavailable");
      // Read immediately before a whole-layer replacement to preserve other settings.
      const { configuration } = await client.invoke("indexing.status.v1", {});
      if (!configuration) throw new Error("Sidecar configuration unavailable");
      await client.invoke("sidecar.configure.v1", {
        ...configuration,
        user_configuration: { ...configuration.user_configuration, ...patch },
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey });
    },
  });
  const resetMutation = useMutation({
    mutationFn: async () => {
      if (!client) throw new Error("Sidecar unavailable");
      await client.invoke("indexing.reset.v1", {});
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey });
    },
  });
  return {
    ...query,
    reset: resetMutation.mutate,
    resetSupported: !!client?.supports("indexing.reset.v1"),
    resetting: resetMutation.isPending,
    resetError: resetMutation.error,
    resetSucceeded: resetMutation.isSuccess,
    supported,
    save: mutation.mutateAsync,
    saving: mutation.isPending,
    saveError: mutation.error,
  };
}
