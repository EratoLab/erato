import { skipToken } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import {
  useProfile,
  useStartingAssistant,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";
import {
  reportDrawnWhenSettled,
  setStartMayResume,
  shellKeepsStartPage,
} from "@/lib/shellStartScreen";

import type {
  StartingAssistantResponse,
  UserProfile,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";

/** The person's own start choice, as one comparable value. */
function ownStartChoice(profile: UserProfile): string {
  return JSON.stringify([
    profile.preference_starting_assistant_cleared === true,
    profile.preference_starting_assistant_id ?? null,
    profile.preference_starting_hub_assistant_id ?? null,
  ]);
}

/**
 * Whether a start may reopen the last page: only when neither the person nor
 * the organization chose what a start shows. The person's choice is in the
 * profile (an assistant, or the welcome screen kept on purpose, which the
 * resolved answer cannot tell from no choice at all); the organization's
 * default assistant is in the resolved answer. Unknown counts as chosen.
 */
export function startMayResume(
  profile: UserProfile | undefined,
  startingAssistant: StartingAssistantResponse | undefined,
): boolean {
  if (!profile || !startingAssistant) return false;
  const ownChoice =
    profile.preference_starting_assistant_cleared === true ||
    Boolean(profile.preference_starting_assistant_id) ||
    Boolean(profile.preference_starting_hub_assistant_id);
  return !ownChoice && !startingAssistant.starting_assistant;
}

/**
 * Mounted with the app's layout: tells a host app that covers the starting
 * page (`startScreen`) once the layout and its first data are on screen, and
 * whether its next start may reopen this page.
 */
export function ShellStartScreenReady() {
  const [keepsPages] = useState(shellKeepsStartPage);
  const variables = keepsPages ? {} : skipToken;
  // The last good answers count: a failed refresh says nothing new.
  const profileQuery = useProfile(variables, { retry: false });
  const answerQuery = useStartingAssistant(variables, { retry: false });
  const profile = profileQuery.data;

  // After a save the profile arrives before the resolved answer, which still
  // reflects the old choice and could hide the organization's default; it
  // counts again once fetched after the change.
  const choice = profile ? ownStartChoice(profile) : undefined;
  const [lastChoice, setLastChoice] = useState({ choice, since: 0 });
  if (choice !== undefined && choice !== lastChoice.choice) {
    setLastChoice({
      choice,
      since: lastChoice.choice === undefined ? 0 : profileQuery.dataUpdatedAt,
    });
  }
  const answerCurrent = answerQuery.dataUpdatedAt > lastChoice.since;
  const mayResume =
    keepsPages && answerCurrent && startMayResume(profile, answerQuery.data);

  useEffect(() => {
    if (keepsPages) setStartMayResume(mayResume);
  }, [keepsPages, mayResume]);

  useEffect(() => reportDrawnWhenSettled(), []);
  return null;
}
