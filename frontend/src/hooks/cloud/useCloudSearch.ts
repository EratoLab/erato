import { useMemo } from "react";

import { useSearchSharepoint } from "@/lib/generated/v1betaApi/v1betaApiComponents";

import type { CloudProvider } from "@/lib/api/cloudProviders/types";

export function useCloudSearch({
  provider,
  query,
  enabled,
}: {
  provider: CloudProvider;
  query: string;
  enabled: boolean;
}) {
  const search = useSearchSharepoint(
    { queryParams: { query: query.trim() } },
    {
      enabled: enabled && provider === "sharepoint" && !!query.trim(),
      retry: false,
    },
  );
  const drives = useMemo(
    () => (search.data?.drives ?? []).map((drive) => ({ ...drive, provider })),
    [search.data, provider],
  );
  const files = useMemo(
    () =>
      (search.data?.files ?? []).map((file) => ({
        ...file,
        provider,
        location: [
          file.site_name,
          file.drive_name,
          file.parent_path?.replace(/^\/+/, ""),
        ]
          .filter(Boolean)
          .join(" / "),
      })),
    [search.data, provider],
  );
  return {
    drives,
    files,
    isLoading: search.isLoading,
    error: search.error,
    partial: search.data?.partial ?? false,
    truncated: search.data?.truncated ?? false,
    refetch: () => {
      void search.refetch();
    },
  };
}
