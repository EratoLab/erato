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

/** Files approved in the native review that a "never allow" setting blocked. */
export interface ClientToolBlockedFilesNotice {
  toolCallId: string;
  /** The message that shows it: for a task's call, the one that started the task. */
  messageId: string;
  fileNames: string[];
}

// Local File objects must never be persisted or sent to the server before approval.
export const useClientToolFileApprovalStore = create<{
  requests: ClientToolFileApprovalRequest[];
  blockedAfterReview: ClientToolBlockedFilesNotice[];
}>(() => ({ requests: [], blockedAfterReview: [] }));
