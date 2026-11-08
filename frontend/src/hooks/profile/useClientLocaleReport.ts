import { i18n } from "@lingui/core";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import {
  fetchUpdateProfilePreferences,
  profileQuery,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";

import type {
  UpdateProfilePreferencesRequest,
  UserProfile,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";

export interface ClientLocale {
  timeZone: string | undefined;
  language: string | undefined;
}

export function browserTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

/**
 * The preference write that brings the profile in line with this client, or
 * null when the profile already says the same. The server stores languages in
 * BCP 47 casing, so they compare without case.
 */
export function clientLocaleUpdate(
  profile: Pick<UserProfile, "preference_time_zone" | "preference_language">,
  { timeZone, language }: ClientLocale,
): UpdateProfilePreferencesRequest | null {
  const update: UpdateProfilePreferencesRequest = {};
  if (timeZone && profile.preference_time_zone !== timeZone) {
    update.preference_time_zone = timeZone;
  }
  if (
    language &&
    profile.preference_language?.toLowerCase() !== language.toLowerCase()
  ) {
    update.preference_language = language;
  }
  return Object.keys(update).length > 0 ? update : null;
}

// Every layout mounts its own profile provider, so the guard lives at module
// level to keep it to one write per page load.
let reportedThisLoad = false;

export function resetClientLocaleReportForTests() {
  reportedThisLoad = false;
}

/**
 * Reports the browser's time zone and the UI language to the profile once per
 * page load, when the profile lacks them or says something else. Times the
 * user enters for scheduled items are read in the stored zone, and messages
 * Erato sends later use the stored language. A failed write is left for the
 * next load.
 */
export function useClientLocaleReport(profile: UserProfile | undefined) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!profile || reportedThisLoad) return;
    reportedThisLoad = true;
    const update = clientLocaleUpdate(profile, {
      timeZone: browserTimeZone(),
      language: i18n.locale || undefined,
    });
    if (!update) return;
    fetchUpdateProfilePreferences({ body: update })
      .then(() =>
        queryClient.invalidateQueries({
          queryKey: profileQuery({}).queryKey,
        }),
      )
      .catch((error: unknown) => {
        console.warn("Could not report the time zone and language:", error);
      });
  }, [profile, queryClient]);
}
