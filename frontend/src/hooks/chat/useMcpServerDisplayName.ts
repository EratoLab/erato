import { QueryClientContext } from "@tanstack/react-query";
import { useCallback, useContext, useMemo, useSyncExternalStore } from "react";

import { listMcpServersQuery } from "@/lib/generated/v1betaApi/v1betaApiComponents";

import type { ListMcpServersResponse } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const noSubscription = () => () => {};

/**
 * Resolves a server id to the name people see, from the listing the composer
 * already loaded. It never fetches: the listing probes every server, which a
 * footnote under an old message must not set off. It reads the query cache
 * directly rather than through a query hook, so a message rendered without a
 * query client (a kit's or a test's) still shows its footnotes. Without a
 * loaded listing, or for a server no longer listed, the id is shown as it is.
 */
export function useMcpServerDisplayName(): (serverId: string) => string {
  const queryClient = useContext(QueryClientContext);

  const subscribe = useCallback(
    (onChange: () => void) =>
      queryClient ? queryClient.getQueryCache().subscribe(onChange) : () => {},
    [queryClient],
  );
  const listing = useSyncExternalStore(
    queryClient ? subscribe : noSubscription,
    () =>
      queryClient?.getQueryData<ListMcpServersResponse>(
        listMcpServersQuery({}).queryKey,
      ),
  );

  const names = useMemo(
    () =>
      new Map(
        (listing?.servers ?? []).map((server) => [
          server.id,
          server.display_name,
        ]),
      ),
    [listing],
  );

  return useCallback(
    (serverId: string) => names.get(serverId) ?? serverId,
    [names],
  );
}
