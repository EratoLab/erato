import { create } from "zustand";

import type { ClientToolCallContext } from "../clientToolExecutors";
import type { OutlookFileProvenance } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

export interface ClientToolFileApprovalRequest {
  id: number;
  context: ClientToolCallContext;
  files: File[];
  /** Validated source identities, available locally before upload consent. */
  outlookProvenance?: ReadonlyMap<File, OutlookFileProvenance>;
  selected: ReadonlySet<File>;
  finish: (approved: ReadonlySet<File>) => void;
}

// Local File objects must never be persisted or sent to the server before approval.
export const useClientToolFileApprovalStore = create<{
  requests: ClientToolFileApprovalRequest[];
}>(() => ({ requests: [] }));
