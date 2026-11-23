/**
 * The submissions this pane accepted, by call id, so the server's apply call for one finds the
 * plan the pane checked. Pane memory only: after a reload the apply finds none and reads again.
 */
export interface WordAcceptedPlan {
  callId: string;
  chatId: string;
  messageId: string;
  /** The complete plan as JSON, as the plan card shows it. */
  content: string;
  snapshotToken: string;
  /** Parts the receipt says the plan leaves out. */
  leftOut: readonly string[];
}

const MAX_ACCEPTED = 32;
const accepted = new Map<string, WordAcceptedPlan>();

export function rememberWordAcceptedPlan(plan: WordAcceptedPlan): void {
  accepted.delete(plan.callId);
  accepted.set(plan.callId, plan);
  while (accepted.size > MAX_ACCEPTED)
    accepted.delete(accepted.keys().next().value!);
}

export function wordAcceptedPlan(callId: string): WordAcceptedPlan | undefined {
  return accepted.get(callId);
}

export function forgetWordAcceptedPlansForTests(): void {
  accepted.clear();
}
