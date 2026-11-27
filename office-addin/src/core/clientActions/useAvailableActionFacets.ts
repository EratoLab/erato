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

export interface ActionFacetClientActionInfo {
  /** Human readable facet name, for settings UIs. */
  displayName: string;
  /** Server-allowed client actions for this facet. */
  clientActions: string[];
  /**
   * Per action: `device` (default) or `session_document`; from `GET /me/facets`. Read only to carry
   * the pane's old decisions over to the server.
   */
  grantScope: Record<string, string>;
}

/**
 * Map of action-facet id → its client-action config from `GET /me/facets`.
 * `clientActions` is the server-side gate for what the model may propose via
 * `propose_client_action`; the add-in additionally intersects it with the
 * actions it actually implements before offering anything to the user.
 * Facets without client actions are omitted.
 */
export function useActionFacetClientActions(): Map<
  string,
  ActionFacetClientActionInfo
> {
  const { data } = useFacets({});
  return useMemo(
    () =>
      new Map(
        (data?.action_facets ?? []).flatMap((facet) =>
          facet.client_actions && facet.client_actions.length > 0
            ? [
                [
                  facet.id,
                  {
                    displayName: facet.display_name,
                    clientActions: facet.client_actions,
                    grantScope: facet.grant_scope ?? {},
                  },
                ] as const,
              ]
            : [],
        ),
      ),
    [data],
  );
}

/** Missing argument metadata on an older server means optional args are omitted. */
export function useAvailableActionFacetArgs(): Map<string, Set<string>> {
  const { data } = useFacets({});
  return useMemo(
    () =>
      new Map(
        (data?.action_facets ?? []).map((facet) => [
          facet.id,
          new Set(facet.allowed_args ?? []),
        ]),
      ),
    [data],
  );
}
