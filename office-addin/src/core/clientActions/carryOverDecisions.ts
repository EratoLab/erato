/**
 * The pane's own Ask, Always and Never, as it kept them per facet and action before the server took
 * them over. Read only to carry them over; kept for two more releases after the pane stopped
 * deciding.
 */
type ClientActionDecision = "ask" | "always" | "never";

const isClientActionDecision = (
  value: unknown,
): value is ClientActionDecision =>
  value === "ask" || value === "always" || value === "never";

/** Facet ids may contain `/`, action ids never do: the last separator splits the stored key. */
function parseDecisionKey(
  key: string,
): { facetId: string; action: string } | null {
  const separator = key.lastIndexOf("/");
  if (separator <= 0 || separator === key.length - 1) return null;
  return { facetId: key.slice(0, separator), action: key.slice(separator + 1) };
}

/** Which pane actions a server-applied tool carries out, as the server lists them. */
export interface CarryOverMapping {
  /** The tool's qualified name, the key of its server decision. */
  serverKey: string;
  actions: readonly string[];
}

export const CLIENT_DECISIONS_CARRIED_OVER_KEY =
  "erato.addin.clientDecisionsCarriedOver";

export type CarriedDecision = "always_allow" | "never_allow";

/**
 * The server decisions a pane's stored choices become. Only explicit choices count:
 * - Never only when every stored entry for the key says never and every action of the key has
 *   one, so one action's Never does not turn the others off and one facet's Never does not win
 *   over another facet's Ask or Always;
 * - Always only from entries the pane honoured on every document (not a grant it kept for one
 *   session and document), and only when no entry for the key says never;
 * - anything else stays unset, so the server asks.
 */
export function carriedOverDecisions({
  stored,
  mappings,
  sessionOnly,
}: {
  stored: Readonly<Record<string, ClientActionDecision>>;
  mappings: readonly CarryOverMapping[];
  /** The pane kept Always for this facet's action only per session and document. */
  sessionOnly: (facetId: string, action: string) => boolean;
}): Record<string, CarriedDecision> {
  const carried: Record<string, CarriedDecision> = {};
  for (const { serverKey, actions } of mappings) {
    const entries = Object.entries(stored).flatMap(([key, decision]) => {
      const parsed = parseDecisionKey(key);
      return parsed && actions.includes(parsed.action)
        ? [{ ...parsed, decision }]
        : [];
    });
    if (entries.length === 0) continue;
    const anyNever = entries.some((entry) => entry.decision === "never");
    if (
      entries.every((entry) => entry.decision === "never") &&
      actions.every((action) =>
        entries.some((entry) => entry.action === action),
      )
    )
      carried[serverKey] = "never_allow";
    else if (
      !anyNever &&
      entries.some(
        (entry) =>
          entry.decision === "always" &&
          !sessionOnly(entry.facetId, entry.action),
      )
    )
      carried[serverKey] = "always_allow";
  }
  return carried;
}

function readJson(key: string): unknown {
  const raw = globalThis.localStorage.getItem(key);
  return raw ? (JSON.parse(raw) as unknown) : undefined;
}

/** The server keys of a host whose choices this browser already carried over. */
export function clientDecisionsCarriedOver(host: string): ReadonlySet<string> {
  try {
    const marker = readJson(CLIENT_DECISIONS_CARRIED_OVER_KEY);
    const keys =
      typeof marker === "object" && marker !== null
        ? (marker as Record<string, unknown>)[host]
        : undefined;
    return new Set(
      Array.isArray(keys)
        ? keys.filter((key): key is string => typeof key === "string")
        : [],
    );
  } catch {
    return new Set();
  }
}

/**
 * Carries a host's stored choices over to the server once per browser and server key, the first
 * time the facets list that key: only keys the server has no decision for, in one save. The old store stays, so a rollback keeps the user's choices. A
 * failure is tried again on the next load.
 */
export async function carryOverClientDecisions({
  host,
  storageKey,
  mappings,
  offered,
  sessionOnly,
  save,
}: {
  host: string;
  storageKey: string;
  mappings: readonly CarryOverMapping[];
  /** The server-applied tools the facets list; the others wait for a later load. */
  offered: ReadonlySet<string>;
  sessionOnly: (facetId: string, action: string) => boolean;
  /** Writes the decisions the server has none for; resolves once saved. */
  save: (decisions: Record<string, CarriedDecision>) => Promise<unknown>;
}): Promise<boolean> {
  const done = clientDecisionsCarriedOver(host);
  const listed = mappings.filter(
    (mapping) => offered.has(mapping.serverKey) && !done.has(mapping.serverKey),
  );
  if (listed.length === 0) return false;
  let stored: Record<string, ClientActionDecision>;
  try {
    const raw = readJson(storageKey);
    stored =
      typeof raw === "object" && raw !== null
        ? Object.fromEntries(
            Object.entries(raw as Record<string, unknown>).filter(
              (entry): entry is [string, ClientActionDecision] =>
                isClientActionDecision(entry[1]),
            ),
          )
        : {};
  } catch {
    return false;
  }
  const decisions = carriedOverDecisions({
    stored,
    mappings: listed,
    sessionOnly,
  });
  try {
    if (Object.keys(decisions).length) await save(decisions);
    const marker = readJson(CLIENT_DECISIONS_CARRIED_OVER_KEY);
    globalThis.localStorage.setItem(
      CLIENT_DECISIONS_CARRIED_OVER_KEY,
      JSON.stringify({
        ...(typeof marker === "object" && marker !== null ? marker : {}),
        [host]: [...done, ...listed.map((mapping) => mapping.serverKey)],
      }),
    );
    return true;
  } catch {
    return false;
  }
}
