import {
  escapeODataString,
  GRAPH_BASE,
  graphFetch,
  makeGraphTokenSource,
} from "./fetchOutlookMessageGraph";

import type { CalendarFetchOptions } from "./fetchOutlookCalendar";
import type { AcquireGraphToken } from "./fetchOutlookMessageGraph";

/**
 * EXO display-name → SMTP resolution over OPTIONAL directory permissions
 * (ERMAIN-434 follow-on; the EWS sibling is ResolveNames). The Entra scopes
 * involved — People.Read for `/me/people`, User.ReadBasic.All for `/users` —
 * are deliberately OPTIONAL: some orgs won't consent them (directory-wide
 * name search can leak the GAL). Resilience contract: every failure mode
 * (scope not consented → token acquisition throws, tenant policy → 401/403,
 * transient errors) collapses to `kind: "unavailable"` — never a thrown
 * error, so a missing consent can only ever cost the name-lookup nicety,
 * never the calendar fetch it rides in.
 *
 * The two scopes are acquired via SEPARATE prebound token sources: a tenant
 * may grant either one alone, and bundling them into one token request would
 * fail both when one is missing.
 */

/** Prebound acquirers for the optional directory scopes; omit what the
 * deployment doesn't hold. */
export interface GraphDirectoryTokenSources {
  /** Bound to People.Read → `/me/people` relevance search. */
  people?: AcquireGraphToken;
  /** Bound to User.ReadBasic.All → `/users` GAL prefix search. */
  users?: AcquireGraphToken;
}

export interface DirectoryCandidate {
  name: string;
  smtp: string;
}

export type GraphNameResolution =
  | { kind: "resolved"; smtp: string; name?: string }
  /** Several plausible people — surfaced so the USER can pick an address. */
  | { kind: "ambiguous"; candidates: DirectoryCandidate[] }
  | { kind: "not-found" }
  | { kind: "unavailable"; detail: string };

/** Cap the candidate list a reason string carries (GAL courtesy + tokens). */
export const MAX_DIRECTORY_CANDIDATES = 5;
const SEARCH_PAGE_SIZE = 10;

interface GraphPerson {
  displayName?: string;
  personType?: { class?: string; subclass?: string };
  scoredEmailAddresses?: { address?: string }[];
}

interface GraphUser {
  displayName?: string;
  mail?: string | null;
}

type LegOutcome =
  | { kind: "candidates"; candidates: DirectoryCandidate[] }
  | { kind: "unavailable"; detail: string };

function dedupeBySmtp(candidates: DirectoryCandidate[]): DirectoryCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((c) => {
    const key = c.smtp.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function runLeg(
  acquireToken: AcquireGraphToken,
  url: string,
  scopeLabel: string,
  mapValue: (payload: unknown) => DirectoryCandidate[],
  options: CalendarFetchOptions,
): Promise<LegOutcome> {
  try {
    const response = await graphFetch(
      url,
      makeGraphTokenSource(acquireToken),
      "application/json",
      options.signal,
      options.transport,
    );
    if (!response.ok) {
      return {
        kind: "unavailable",
        detail: `${scopeLabel}: ${response.status} ${response.statusText}`,
      };
    }
    return {
      kind: "candidates",
      candidates: dedupeBySmtp(mapValue(await response.json())),
    };
  } catch (error) {
    // Abort must propagate — resilience is for consent/policy/transport
    // failures, not for cancellation.
    if (options.signal?.aborted) throw error;
    return {
      kind: "unavailable",
      detail: `${scopeLabel}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

function peopleLegUrl(name: string): string {
  // People $search takes a quoted phrase; strip embedded quotes from input.
  const phrase = `"${name.replace(/"/g, "")}"`;
  return (
    `${GRAPH_BASE}/me/people` +
    `?$search=${encodeURIComponent(phrase)}` +
    `&$select=displayName,scoredEmailAddresses,personType` +
    `&$top=${SEARCH_PAGE_SIZE}`
  );
}

function peopleCandidates(payload: unknown): DirectoryCandidate[] {
  const value = (payload as { value?: GraphPerson[] }).value ?? [];
  const candidates: DirectoryCandidate[] = [];
  for (const person of value) {
    // People search spans contacts/groups too; keep persons (missing class
    // tolerated — some tenants omit it).
    const cls = person.personType?.class;
    if (cls !== undefined && cls !== "Person") continue;
    // class Person also spans Personal/ImplicitContacts (auto-created from
    // mail traffic, often stale/external addresses) which relevance ranks
    // ABOVE org users — a same-name contact would shadow the GAL colleague
    // and this leg short-circuits `/users`. Org users only; missing subclass
    // tolerated.
    const subclass = person.personType?.subclass;
    if (subclass !== undefined && subclass !== "OrganizationUser") continue;
    const smtp = person.scoredEmailAddresses?.[0]?.address;
    if (!smtp || !smtp.includes("@")) continue;
    candidates.push({ name: person.displayName ?? smtp, smtp });
  }
  return candidates;
}

function usersLegUrl(name: string): string {
  const escaped = escapeODataString(name);
  const filter = `startswith(displayName,'${escaped}') or startswith(mail,'${escaped}')`;
  return (
    `${GRAPH_BASE}/users` +
    `?$filter=${encodeURIComponent(filter)}` +
    `&$select=displayName,mail` +
    `&$top=${SEARCH_PAGE_SIZE}`
  );
}

function userCandidates(payload: unknown): DirectoryCandidate[] {
  const value = (payload as { value?: GraphUser[] }).value ?? [];
  const candidates: DirectoryCandidate[] = [];
  for (const user of value) {
    if (!user.mail || !user.mail.includes("@")) continue;
    candidates.push({ name: user.displayName ?? user.mail, smtp: user.mail });
  }
  return candidates;
}

function settle(
  candidates: DirectoryCandidate[],
  name: string,
): GraphNameResolution {
  if (candidates.length === 0) return { kind: "not-found" };
  // A fuzzy search can return near-misses alongside the person meant; an
  // exact display-name hit (case-insensitive) wins outright.
  const exact = candidates.filter(
    (c) => c.name.trim().toLowerCase() === name.trim().toLowerCase(),
  );
  // ≥2 exacts stay ambiguous but must NOT fall back to the fuzzy pool: the
  // 5-cap could then drop a genuine namesake behind near-misses.
  const pool = exact.length >= 1 ? exact : candidates;
  if (pool.length === 1)
    return { kind: "resolved", smtp: pool[0].smtp, name: pool[0].name };
  return {
    kind: "ambiguous",
    candidates: pool.slice(0, MAX_DIRECTORY_CANDIDATES),
  };
}

/**
 * Resolve one display name against the directory: People search first
 * (relevance-ranked, includes frequent contacts), `/users` prefix search as
 * the fallback when People finds nothing or isn't permitted. Only when BOTH
 * legs are unavailable does the result say so.
 */
export async function resolveAttendeeNameViaGraph(
  directory: GraphDirectoryTokenSources,
  name: string,
  options: CalendarFetchOptions = {},
): Promise<GraphNameResolution> {
  const unavailable: string[] = [];
  let anyLegRanClean = false;

  if (directory.people) {
    const outcome = await runLeg(
      directory.people,
      peopleLegUrl(name),
      "People.Read",
      peopleCandidates,
      options,
    );
    if (outcome.kind === "candidates") {
      anyLegRanClean = true;
      if (outcome.candidates.length > 0)
        return settle(outcome.candidates, name);
    } else {
      unavailable.push(outcome.detail);
    }
  }

  if (directory.users) {
    const outcome = await runLeg(
      directory.users,
      usersLegUrl(name),
      "User.ReadBasic.All",
      userCandidates,
      options,
    );
    if (outcome.kind === "candidates") {
      anyLegRanClean = true;
      if (outcome.candidates.length > 0)
        return settle(outcome.candidates, name);
    } else {
      unavailable.push(outcome.detail);
    }
  }

  // A leg that ran cleanly and found nothing outranks an unavailable
  // sibling: "not in the directory" is the truthful answer then.
  if (anyLegRanClean) return { kind: "not-found" };
  return {
    kind: "unavailable",
    detail:
      unavailable.join("; ") ||
      "no directory permissions configured (People.Read / User.ReadBasic.All)",
  };
}
