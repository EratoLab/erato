import { create } from "zustand";

import type { ClientToolCallContext } from "../clientToolExecutors";

export interface ClientToolFileApprovalRequest {
  id: number;
  context: ClientToolCallContext;
  files: File[];
  selected: ReadonlySet<File>;
  finish: (approved: ReadonlySet<File>) => void;
}

// Local File objects must never be persisted or sent to the server before approval.
export const useClientToolFileApprovalStore = create<{
  requests: ClientToolFileApprovalRequest[];
}>(() => ({ requests: [] }));
