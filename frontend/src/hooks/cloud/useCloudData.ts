/**
 * useCloudData hook
 *
 * Fetches drives and items using generated React Query hooks
 * Supports only Sharepoint for now (future: Google Drive)
 */

import { useMemo } from "react";

import {
  useAllDrives,
  useGetDriveRoot,
  useGetDriveItemChildren,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";

import type { CloudProvider } from "@/lib/api/cloudProviders/types";
import type {
  Drive,
  DriveItem,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";

interface UseCloudDataOptions {
  /** Provider type (currently only "sharepoint" supported) */
  provider: CloudProvider;
  /** Current drive ID */
  driveId: string | null;
  /** Current item ID (folder) */
  itemId: string | null;
}

interface UseCloudDataResult {
  /** Available drives */
  drives: (Drive & { provider: CloudProvider })[];
  /** Items in current location */
  items: (DriveItem & { provider: CloudProvider; drive_id: string })[];
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
  provider,
  driveId,
  itemId,
}: UseCloudDataOptions): UseCloudDataResult {
  // Only Sharepoint is supported for now
  if (provider !== "sharepoint") {
    throw new Error(`Unsupported cloud provider: ${provider}`);
  }

  // Fetch all drives using generated hook
  const {
    data: drivesData,
    isLoading: isDrivesLoading,
    error: drivesError,
    refetch: refetchDrives,
  } = useAllDrives({});

  // Fetch items from current location
  // Use getDriveRoot if no itemId, otherwise getDriveItemChildren
  const shouldFetchRoot = !!driveId && !itemId;
  const shouldFetchChildren = !!driveId && !!itemId;

  const {
    data: rootData,
    isLoading: isRootLoading,
    error: rootError,
    refetch: refetchRoot,
  } = useGetDriveRoot(
    { pathParams: { driveId: driveId ?? "" } },
    { enabled: shouldFetchRoot },
  );

  const {
    data: childrenData,
    isLoading: isChildrenLoading,
    error: childrenError,
    refetch: refetchChildren,
  } = useGetDriveItemChildren(
    { pathParams: { driveId: driveId ?? "", itemId: itemId ?? "" } },
    { enabled: shouldFetchChildren },
  );

  // Combine drives data with provider field
  const drives = useMemo(() => {
    if (!drivesData) return [];
    return drivesData.drives.map((drive) => ({
      ...drive,
      provider,
    }));
  }, [drivesData, provider]);

  // Combine items data with provider and drive_id fields
  const items = useMemo(() => {
    // Use the appropriate data based on which query is enabled
    let itemsData: DriveItem[] = [];

    if (shouldFetchChildren && childrenData) {
      itemsData = childrenData.items;
    } else if (shouldFetchRoot && rootData) {
      itemsData = rootData.items;
    }

    return itemsData.map((item) => ({
      ...item,
      provider,
      drive_id: driveId ?? "",
    }));
  }, [
    shouldFetchChildren,
    childrenData,
    shouldFetchRoot,
    rootData,
    provider,
    driveId,
  ]);

  // Combine loading states
  const isLoading = isDrivesLoading || isRootLoading || isChildrenLoading;

  // Combine errors (prioritize drives error since it's always needed)
  // Convert React Query error types to standard Error
  const error =
    (drivesError ? new Error(String(drivesError)) : null) ??
    (rootError ? new Error(String(rootError)) : null) ??
    (childrenError ? new Error(String(childrenError)) : null) ??
    null;

  // Refetch items based on current state
  const refetchItems = () => {
    if (shouldFetchRoot) {
      void refetchRoot();
    } else if (shouldFetchChildren) {
      void refetchChildren();
    }
  };

  return {
    drives,
    items,
    isLoading,
    error,
    refetchDrives: () => void refetchDrives(),
    refetchItems,
  };
}
