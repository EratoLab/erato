import { useFacets } from "@erato/frontend/library";
import { useMemo } from "react";

/**
 * The set of action-facet ids the backend currently advertises via
 * `GET /me/facets`. Used to gate **config-defined** facets (e.g. `compose_email`,
 * which lives only in `erato.toml`) before attaching one to a send: an unknown
 * facet id hard-400s the whole chat request, so a facet is only ever sent when
 * the backend reports it as available.
 *
 * Degrades safely: a backend that predates the `action_facets` field, or a
 * customer who simply hasn't defined the facet, yields an empty set — so the
 * add-in attaches nothing new and behaves exactly as before.
 */
export function useAvailableActionFacetIds(): Set<string> {
  const { data } = useFacets({});
  return useMemo(
    () => new Set((data?.action_facets ?? []).map((facet) => facet.id)),
    [data],
  );
}

/**
 * Map of action-facet id → the `client_actions` the backend allows for it
 * (from `GET /me/facets`). This list is the server-side gate for what the
 * model may propose via `propose_client_action`; the add-in additionally
 * intersects it with the actions it actually implements before offering
 * anything to the user. Facets without client actions are omitted.
 */
export function useActionFacetClientActions(): Map<string, string[]> {
  const { data } = useFacets({});
  return useMemo(
    () =>
      new Map(
        (data?.action_facets ?? []).flatMap((facet) =>
          facet.client_actions && facet.client_actions.length > 0
            ? [[facet.id, facet.client_actions] as const]
            : [],
        ),
      ),
    [data],
  );
}
