/**
 * Custom hook for managing share grants
 *
 * Provides a unified interface for CRUD operations on share grants
 * while handling query invalidation after mutations.
 */
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import {
  useListShareGrants,
  useCreateShareGrant,
  useDeleteShareGrant,
  listShareGrantsQuery,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";

import type {
  ShareGrant,
  CreateShareGrantRequest,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";

interface UseShareGrantsOptions {
  resourceType: string;
  resourceId: string;
}

interface UseShareGrantsResult {
  grants: ShareGrant[] | undefined;
  isLoading: boolean;
  error: unknown;
  createGrant: (
    input: Omit<CreateShareGrantRequest, "resource_type" | "resource_id">,
  ) => Promise<void>;
  deleteGrant: (grantId: string) => Promise<void>;
  refetch: () => Promise<void>;
}

/**
 * Hook for managing share grants for a specific resource
 */
export function useShareGrants({
  resourceType,
  resourceId,
}: UseShareGrantsOptions): UseShareGrantsResult {
  const queryClient = useQueryClient();

  // Fetch share grants for the resource
  const {
    data,
    isLoading,
    error,
    refetch: refetchQuery,
  } = useListShareGrants({
    queryParams: {
      resource_type: resourceType,
      resource_id: resourceId,
    },
  });

  // Create share grant mutation
  const createMutation = useCreateShareGrant();

  // Delete share grant mutation
  const deleteMutation = useDeleteShareGrant();

  // Create a new share grant
  const createGrant = useCallback(
    async (
      input: Omit<CreateShareGrantRequest, "resource_type" | "resource_id">,
    ) => {
      await createMutation.mutateAsync({
        body: {
          resource_type: resourceType,
          resource_id: resourceId,
          subject_type: input.subject_type,
          subject_id_type: input.subject_id_type,
          subject_id: input.subject_id,
          role: input.role,
        },
      });

      // Invalidate the list query to refetch
      await queryClient.invalidateQueries({
        queryKey: listShareGrantsQuery({
          queryParams: {
            resource_type: resourceType,
            resource_id: resourceId,
          },
        }).queryKey,
      });
    },
    // createMutation.mutateAsync is stable from react-query
    // queryClient is stable from react-query context
    // resourceType and resourceId are props (should be stable in practice)
    [createMutation, queryClient, resourceType, resourceId],
  );

  // Delete a share grant
  const deleteGrant = useCallback(
    async (grantId: string) => {
      await deleteMutation.mutateAsync({
        pathParams: { grantId },
      });

      // Invalidate the list query to refetch
      await queryClient.invalidateQueries({
        queryKey: listShareGrantsQuery({
          queryParams: {
            resource_type: resourceType,
            resource_id: resourceId,
          },
        }).queryKey,
      });
    },
    // deleteMutation.mutateAsync is stable from react-query
    // queryClient is stable from react-query context
    // resourceType and resourceId are props (should be stable in practice)
    [deleteMutation, queryClient, resourceType, resourceId],
  );

  // Refetch share grants
  const refetch = useCallback(async () => {
    await refetchQuery();
  }, [refetchQuery]);

  return {
    grants: data?.grants,
    isLoading,
    error,
    createGrant,
    deleteGrant,
    refetch,
  };
}
