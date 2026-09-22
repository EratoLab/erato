import type { ClientToolValidationIssue } from "@erato/frontend/library";

/** Parser diagnostics contain paths and constraints, never document contents. */
export type WordPlanDiagnostics = ClientToolValidationIssue[];

export function wordPlanError(
  issues: WordPlanDiagnostics | undefined,
  path: string,
  code: string,
  message: string,
): null {
  if (issues && issues.length < 16) issues.push({ path, code, message });
  return null;
}
