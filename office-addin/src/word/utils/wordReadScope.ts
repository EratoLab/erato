import type {
  WordAuthoringSnapshot,
  WordDocumentPlan,
} from "./wordDocumentPlan";
import type { WordTableCellScope } from "./wordTableCellScope";

export interface WordScopeTarget {
  ref: string;
  kind: string;
  text: string;
  bodyRef?: string;
  storyId?: string;
  sectionId?: string;
  objectTarget?: string;
  objectRef?: string;
  detail: Record<string, unknown>;
}

export interface WordObjectScope {
  kind: "objects";
  snapshot: string;
  identity: string;
  fingerprint: string;
  targets: WordScopeTarget[];
  /** Exact host-materialized proposals; never supplied by the model. */
  plans: Set<string>;
}
export type WordReadScope = WordTableCellScope | WordObjectScope;
export const MAX_WORD_SCOPES = 16;
export const MAX_WORD_SCOPE_BYTES = 24 * 1024;
export const MAX_WORD_SCOPE_TARGETS = 16;

export function wordReadScope(snapshot: WordAuthoringSnapshot, token: unknown) {
  const scope =
    typeof token === "string" ? snapshot.readScopes?.get(token) : undefined;
  return scope &&
    scope.snapshot === snapshot.token &&
    scope.identity === snapshot.identity &&
    scope.fingerprint === snapshot.fingerprint &&
    !snapshot.revoked &&
    !snapshot.used &&
    !snapshot.issue
    ? scope
    : undefined;
}

export function canonicalWordPlan(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item).sort(([a], [b]) => a.localeCompare(b)),
        )
      : item,
  );
}

export function wordPlanMatchesObjectScope(
  plan: WordDocumentPlan,
  snapshot: WordAuthoringSnapshot,
): boolean {
  const scope = wordReadScope(snapshot, plan.readToken);
  return scope?.kind === "objects" && scope.plans.has(canonicalWordPlan(plan));
}
