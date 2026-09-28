import { create } from "zustand";

import type { ClientToolCallContext } from "../clientToolExecutors";

export interface ClientToolCallApprovalRequest {
  id: number;
  context: ClientToolCallContext;
  /** Qualified `namespace/name`, the key a standing decision is stored under. */
  qualifiedName: string;
  input: unknown;
  finish: (approved: boolean) => void;
}

export const useClientToolCallApprovalStore = create<{
  requests: ClientToolCallApprovalRequest[];
}>(() => ({ requests: [] }));
