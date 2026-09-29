import type { ActionFacetRequest } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

/**
 * Host work that has to finish before the request is built but must not delay
 * the optimistic message, e.g. capturing the open Office document.
 */
export interface SendMessagePreparation {
  /** Shown on the pending reply while `run` is in flight. */
  label?: string;
  /** Resolving null drops the send and removes the optimistic message. */
  run: (
    signal: AbortSignal,
  ) => Promise<{ actionFacet?: ActionFacetRequest } | null>;
  /** Called once when the send is dropped before it reaches the server. */
  onAbandoned?: () => void;
}
