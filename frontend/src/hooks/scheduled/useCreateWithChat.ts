import { useMemo } from "react";

import { SCHEDULE_FACET_ID } from "@/components/ui/Chat/facetDisplayName";
import { useOpenNewChatWithPreset } from "@/hooks/chat/useComposerPreset";
import { useFacets } from "@/lib/generated/v1betaApi/v1betaApiComponents";

/**
 * "Create with chat": a new chat with the schedule facet selected. Undefined
 * while the user has no such facet, which leaves the menu item disabled.
 */
export function useCreateWithChat(): (() => void) | undefined {
  const { data: facetsData } = useFacets({});
  const openNewChatWithPreset = useOpenNewChatWithPreset();
  const hasScheduleFacet = (facetsData?.facets ?? []).some(
    (facet) => facet.id === SCHEDULE_FACET_ID,
  );

  return useMemo(
    () =>
      hasScheduleFacet
        ? () => openNewChatWithPreset({ facetIds: [SCHEDULE_FACET_ID] })
        : undefined,
    [hasScheduleFacet, openNewChatWithPreset],
  );
}
