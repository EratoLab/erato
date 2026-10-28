import {
  getSupportedFileTypes,
  useFileCapabilitiesContext,
} from "@erato/frontend/library";

import { useTeamsChatFetcher } from "./useTeamsChatFetcher";

export interface TeamsPickerAvailability {
  /** Graph is reachable, so there are chats to offer at all. */
  available: boolean;
  capabilitiesReady: boolean;
  /** The workspace accepts the markdown a transcript is. */
  supportsMarkdown: boolean;
  /** All three: the picker can build and attach a transcript. */
  canPick: boolean;
}

/** Shared by the "+" row and the chip's "Edit selection". */
export function useTeamsPickerAvailability(): TeamsPickerAvailability {
  const { unavailableReason } = useTeamsChatFetcher();
  const { capabilities, isLoading, error } = useFileCapabilitiesContext();
  const available = unavailableReason === null;
  const capabilitiesReady = !isLoading && !error && capabilities.length > 0;
  // An explicit wildcard permission allows transcripts too. The upload accept
  // list represents this as [], which can also mean capability data is missing.
  const supportsMarkdown =
    capabilities.some(
      (capability) => capability.id === "other" && capability.upload_allowed,
    ) || getSupportedFileTypes(capabilities).includes("text");
  return {
    available,
    capabilitiesReady,
    supportsMarkdown,
    canPick: available && capabilitiesReady && supportsMarkdown,
  };
}
