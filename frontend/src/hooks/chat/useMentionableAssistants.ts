import { skipToken } from "@tanstack/react-query";
import { useMemo } from "react";

import {
  useAssistantHubConfig,
  useFrequentAssistants,
  useListAssistantHubAssistants,
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

type AssistantCandidate = Pick<
  Assistant,
  "id" | "name" | "description" | "owner_email" | "archived_at"
>;

function toMentionable(assistant: AssistantCandidate): MentionableAssistant {
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
  assistants: AssistantCandidate[],
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
 * Assistants the composer may @-mention. Queries stay unissued while the
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
  const { data: hubConfig } = useAssistantHubConfig(
    isGateOpen ? {} : skipToken,
  );
  const { data: hubAssistants } = useListAssistantHubAssistants(
    isGateOpen && hubConfig?.enabled ? {} : skipToken,
  );
  // One over the display limit, so excluding the chat's own assistant still
  // leaves a full set of suggestions.
  const { data: frequentAssistants } = useFrequentAssistants(
    isGateOpen
      ? { queryParams: { limit: MENTION_SUGGESTION_LIMIT + 1 } }
      : skipToken,
  );

  return useMemo(() => {
    // The generic listing excludes Hub versions. The Hub listing supplies only
    // current published versions accessible to this user; delegation needs the
    // version's assistant ID, rather than the stable Hub ID.
    const hubCandidates: AssistantCandidate[] = hubConfig?.enabled
      ? (hubAssistants?.versions ?? []).map((version) => ({
          id: version.assistant_id,
          name: version.assistant.name,
          description: version.assistant.description ?? undefined,
        }))
      : [];
    const all = toOfferableMentions(
      [...(allAssistants ?? []), ...hubCandidates],
      boundAssistantId,
    );
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
  }, [
    allAssistants,
    hubAssistants,
    hubConfig?.enabled,
    frequentAssistants,
    boundAssistantId,
    isGateOpen,
  ]);
}
