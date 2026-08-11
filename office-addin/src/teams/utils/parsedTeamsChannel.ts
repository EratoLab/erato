import { channelRef } from "./teamsConversationRef";

import type { GraphChannel, GraphTeam } from "./teamsChatGraph";
import type { TeamsConversationRef } from "./teamsConversationRef";

export interface ParsedTeamsChannel {
  ref: TeamsConversationRef;
  teamId: string;
  channelId: string;
  name: string;
  teamName: string;
  /** `private` and `shared` channels are badged: their audience is not the team. */
  membershipType: string;
  /** Post-layout channels nest replies under a post; chat-layout ones do not. */
  isThreaded: boolean;
}

export function isRestrictedChannel(channel: ParsedTeamsChannel): boolean {
  return (
    channel.membershipType === "private" || channel.membershipType === "shared"
  );
}

/**
 * Flattens one team's channels into picker rows. Archived channels are dropped
 * rather than badged — they cannot receive new messages, so offering them as a
 * context source only invites a dead end.
 */
export function parseTeamChannels(
  team: GraphTeam,
  channels: readonly GraphChannel[],
): ParsedTeamsChannel[] {
  const teamId = team.id;
  if (!teamId) return [];
  const teamName = team.displayName?.trim() || "";
  const parsed: ParsedTeamsChannel[] = [];
  for (const channel of channels) {
    if (!channel.id) continue;
    if (channel.isArchived) continue;
    parsed.push({
      ref: channelRef(teamId, channel.id),
      teamId,
      channelId: channel.id,
      name: channel.displayName?.trim() || "",
      teamName,
      membershipType: channel.membershipType ?? "standard",
      isThreaded: (channel.layoutType ?? "post") === "post",
    });
  }
  return parsed;
}

/** Team first, then channel name — the only stable order Graph gives us. */
export function sortTeamsChannels(
  channels: readonly ParsedTeamsChannel[],
): ParsedTeamsChannel[] {
  return [...channels].sort(
    (a, b) =>
      a.teamName.localeCompare(b.teamName) || a.name.localeCompare(b.name),
  );
}
