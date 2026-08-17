import { skipToken } from "@tanstack/react-query";
import { useMemo } from "react";

import {
  useFrequentAssistants,
  useListAssistants,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { useAssistantsFeature } from "@/providers/FeatureConfigProvider";

import type { Assistant } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

export interface MentionableAssistant {
  id: string;
  name: string;
  description?: string;
  ownerEmail?: string;
}

/** Rows offered without a search term, on every surface. */
export const MENTION_SUGGESTION_LIMIT = 5;

export interface MentionableAssistants {
  /** Every mention affordance is gated on this. */
  isAvailable: boolean;
  /** Most-used first, falling back to list order when usage is unknown. */
  suggested: MentionableAssistant[];
  /** Everything the user may delegate to, for the browse surface. */
  all: MentionableAssistant[];
}

function toMentionable(assistant: Assistant): MentionableAssistant {
  return {
    id: assistant.id,
    name: assistant.name,
    description: assistant.description,
    ownerEmail: assistant.owner_email,
  };
}

/**
 * A mention is plain text, so two assistants sharing a name are
 * indistinguishable once typed — only the first of a name is offered.
 */
function toOfferableMentions(
  assistants: Assistant[],
  excludedAssistantId: string | undefined,
): MentionableAssistant[] {
  const seenNames = new Set<string>();
  const offerable: MentionableAssistant[] = [];
  for (const assistant of assistants) {
    if (assistant.id === excludedAssistantId || assistant.archived_at) {
      continue;
    }
    if (seenNames.has(assistant.name)) {
      continue;
    }
    seenNames.add(assistant.name);
    offerable.push(toMentionable(assistant));
  }
  return offerable;
}

/**
 * Assistants the composer may @-mention. Both queries stay unissued while the
 * feature is off, so a deployment without delegation pays nothing for it.
 */
export function useMentionableAssistants(
  boundAssistantId?: string,
): MentionableAssistants {
  const { enabled, delegationEnabled } = useAssistantsFeature();
  const isGateOpen = enabled && delegationEnabled;

  const { data: allAssistants } = useListAssistants(
    isGateOpen ? {} : skipToken,
  );
  // One over the display limit, so excluding the chat's own assistant still
  // leaves a full set of suggestions.
  const { data: frequentAssistants } = useFrequentAssistants(
    isGateOpen
      ? { queryParams: { limit: MENTION_SUGGESTION_LIMIT + 1 } }
      : skipToken,
  );

  return useMemo(() => {
    const all = toOfferableMentions(allAssistants ?? [], boundAssistantId);
    const frequent = toOfferableMentions(
      frequentAssistants?.assistants ?? [],
      boundAssistantId,
    );
    const browsable = all.length > 0 ? all : frequent;

    return {
      isAvailable: isGateOpen && browsable.length > 0,
      suggested: (frequent.length > 0 ? frequent : all).slice(
        0,
        MENTION_SUGGESTION_LIMIT,
      ),
      all: browsable,
    };
  }, [allAssistants, frequentAssistants, boundAssistantId, isGateOpen]);
}
