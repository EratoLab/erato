import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";

import { getFileQuery } from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { useV1betaApiContext } from "@/lib/generated/v1betaApi/v1betaApiContext";

import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

/** Share attachment metadata with every consumer, including Markdown links. */
export const useResolvedFiles = (
  fileIds: readonly string[],
  filesById: Record<string, FileUploadItem>,
): Record<string, FileUploadItem> => {
  const { queryOptions, fetcherOptions } = useV1betaApiContext({});

  const missingIds = useMemo(
    () => [...new Set(fileIds)].filter((fileId) => !(fileId in filesById)),
    [fileIds, filesById],
  );

  const fetched = useQueries({
    queries: missingIds.map((fileId) => ({
      ...getFileQuery({ ...fetcherOptions, pathParams: { fileId } }),
      ...queryOptions,
      staleTime: Infinity,
    })),
  });

  return useMemo<Record<string, FileUploadItem>>(() => {
    const map: Record<string, FileUploadItem> = {};
    missingIds.forEach((fileId, index) => {
      const file = fetched[index]?.data;
      if (file) {
        map[fileId] = file;
      }
    });
    // The conversation's own records are the freshest, so they win.
    return { ...map, ...filesById };
  }, [missingIds, fetched, filesById]);
};
