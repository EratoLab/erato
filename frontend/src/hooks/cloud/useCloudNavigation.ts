/**
 * useCloudNavigation hook
 *
 * Manages navigation stack for cloud file picker breadcrumb trail
 */

import { useCallback, useState } from "react";

import type { BreadcrumbSegment } from "@/lib/api/cloudProviders/types";

interface NavigationState {
  driveId: string | null;
  itemId: string | null;
  breadcrumbs: BreadcrumbSegment[];
}

interface UseCloudNavigationResult {
  /** Current drive ID */
  driveId: string | null;
  /** Current item/folder ID (null if at drive root) */
  itemId: string | null;
  /** Breadcrumb trail for current location */
  breadcrumbs: BreadcrumbSegment[];
  /** Navigate to a specific drive (resets to root) */
  goToDrive: (driveId: string, driveName: string) => void;
  /** Navigate into a folder */
  navigateToFolder: (folderId: string, folderName: string) => void;
  /** Navigate to a specific breadcrumb segment */
  navigateToBreadcrumb: (segmentId: string) => void;
  /** Go back one level */
  goBack: () => void;
  /** Reset navigation to initial state */
  reset: () => void;
  /** Check if we can go back */
  canGoBack: boolean;
}

const initialState: NavigationState = {
  driveId: null,
  itemId: null,
  breadcrumbs: [],
};

export function useCloudNavigation(): UseCloudNavigationResult {
  const [state, setState] = useState<NavigationState>(initialState);

  const goToDrive = useCallback((driveId: string, driveName: string) => {
    setState({
      driveId,
      itemId: null,
      breadcrumbs: [
        {
          id: driveId,
          name: driveName,
          type: "drive",
        },
      ],
    });
  }, []);

  const navigateToFolder = useCallback(
    (folderId: string, folderName: string) => {
      setState((prev) => ({
        ...prev,
        itemId: folderId,
        breadcrumbs: [
          ...prev.breadcrumbs,
          {
            id: folderId,
            name: folderName,
            type: "folder",
          },
        ],
      }));
    },
    [],
  );

  const navigateToBreadcrumb = useCallback((segmentId: string) => {
    setState((prev) => {
      const segmentIndex = prev.breadcrumbs.findIndex(
        (seg) => seg.id === segmentId,
      );

      if (segmentIndex === -1) {
        return prev;
      }

      const newBreadcrumbs = prev.breadcrumbs.slice(0, segmentIndex + 1);
      const targetSegment = newBreadcrumbs[newBreadcrumbs.length - 1];

      return {
        ...prev,
        itemId: targetSegment.type === "folder" ? targetSegment.id : null,
        breadcrumbs: newBreadcrumbs,
      };
    });
  }, []);

  const goBack = useCallback(() => {
    setState((prev) => {
      if (prev.breadcrumbs.length <= 1) {
        // Can't go back from drive root, reset to initial state
        return initialState;
      }

      const newBreadcrumbs = prev.breadcrumbs.slice(0, -1);
      const parentSegment = newBreadcrumbs[newBreadcrumbs.length - 1];

      return {
        ...prev,
        itemId: parentSegment.type === "folder" ? parentSegment.id : null,
        breadcrumbs: newBreadcrumbs,
      };
    });
  }, []);

  const reset = useCallback(() => {
    setState(initialState);
  }, []);

  const canGoBack = state.breadcrumbs.length > 0;

  return {
    driveId: state.driveId,
    itemId: state.itemId,
    breadcrumbs: state.breadcrumbs,
    goToDrive,
    navigateToFolder,
    navigateToBreadcrumb,
    goBack,
    reset,
    canGoBack,
  };
}
