import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useDesktopSidecar } from "@/providers/DesktopSidecarProvider";

import type {
  IndexingStatusV1Result,
  OutlookMailbox,
  SidecarConfiguration,
} from "@erato/desktop-sidecar-protocol";
import type { UseQueryResult } from "@tanstack/react-query";

interface IndexingData {
  status: IndexingStatusV1Result;
  mailboxes: OutlookMailbox[];
}

type SidecarIndexingState = UseQueryResult<IndexingData, Error> & {
  supported: boolean;
  save: (patch: Partial<SidecarConfiguration>) => void;
  saving: boolean;
  saveError: Error | null;
};

export function useSidecarIndexing(): SidecarIndexingState {
  const { client, snapshot } = useDesktopSidecar();
  const queryClient = useQueryClient();
  const supported =
    snapshot.state === "ready" &&
    !!client?.supports("indexing.status.v1") &&
    client.supports("outlook.list_mailboxes.v1") &&
    client.supports("sidecar.configure.v1");
  const queryKey = ["sidecar-indexing", snapshot.instanceId];
  const query = useQuery<IndexingData, Error>({
    queryKey,
    enabled: supported,
    refetchInterval: 5_000,
    queryFn: async ({ signal }) => {
      if (!client) throw new Error("Sidecar unavailable");
      const [status, { mailboxes }] = await Promise.all([
        client.invoke(
          "indexing.status.v1",
          { includeSourceBreakdowns: true, includeFileTypeBreakdowns: false },
          { signal },
        ),
        client.invoke("outlook.list_mailboxes.v1", {}, { signal }),
      ]);
      return { status, mailboxes };
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
  return {
    ...query,
    supported,
    save: mutation.mutate,
    saving: mutation.isPending,
    saveError: mutation.error,
  };
}
