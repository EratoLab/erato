/**
 * useCloudData hook
 *
 * Fetches drives and items from cloud provider API
 * For Storybook, uses mocked data
 */

import { useCallback, useEffect, useState } from "react";

import type {
  CloudProvider,
  CloudProviderAPI,
  CloudDrive,
  CloudItem,
} from "@/lib/api/cloudProviders/types";

interface UseCloudDataOptions {
  /** Cloud provider API instance */
  api: CloudProviderAPI;
  /** Provider type */
  provider: CloudProvider;
  /** Current drive ID */
  driveId: string | null;
  /** Current item ID (folder) */
  itemId: string | null;
}

interface UseCloudDataResult {
  /** Available drives */
  drives: CloudDrive[];
  /** Items in current location */
  items: CloudItem[];
  /** Loading state */
  isLoading: boolean;
  /** Error state */
  error: Error | null;
  /** Refetch drives */
  refetchDrives: () => void;
  /** Refetch items */
  refetchItems: () => void;
}

export function useCloudData({
  api,
  provider,
  driveId,
  itemId,
}: UseCloudDataOptions): UseCloudDataResult {
  const [drives, setDrives] = useState<CloudDrive[]>([]);
  const [items, setItems] = useState<CloudItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Fetch drives
  const fetchDrives = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await api.getAllDrives();
      setDrives(response.drives);
    } catch (err) {
      setError(
        err instanceof Error ? err : new Error("Failed to fetch drives"),
      );
    } finally {
      setIsLoading(false);
    }
  }, [api]);

  // Fetch items
  const fetchItems = useCallback(async () => {
    if (!driveId) {
      setItems([]);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      let response;
      if (itemId) {
        // Fetch folder children
        response = await api.getDriveItemChildren(driveId, itemId);
      } else {
        // Fetch drive root
        response = await api.getDriveRoot(driveId);
      }

      setItems(response.items);
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Failed to fetch items"));
    } finally {
      setIsLoading(false);
    }
  }, [api, driveId, itemId]);

  // Fetch drives on mount
  useEffect(() => {
    void fetchDrives();
  }, [fetchDrives]);

  // Fetch items when navigation changes
  useEffect(() => {
    void fetchItems();
  }, [fetchItems]);

  return {
    drives,
    items,
    isLoading,
    error,
    refetchDrives: () => void fetchDrives(),
    refetchItems: () => void fetchItems(),
  };
}
