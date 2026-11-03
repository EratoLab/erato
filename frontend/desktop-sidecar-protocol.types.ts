import type {
  JobStatus,
  JobToolCall,
  SourceDescriptor,
  SourcesListV1Result,
} from "../desktop-sidecar-protocol/typescript/src/generated/index.js";

const source: SourceDescriptor = {
  sourceId: "11111111-1111-4111-8111-111111111111",
  sourceKind: "outlook",
  sourceKey: "mailbox-a",
  locator: { mailboxId: "mailbox-a", providerRevision: 2 },
  enabled: true,
  discoveryCursor: { cursorRevision: 2 },
  completedScanId: null,
  lastSuccessAt: null,
  lastErrorCode: null,
  displayName: "Work mailbox",
  indexingEnabled: true,
  product: "outlook",
  product_variant: "outlook_classic",
  providerExtension: { revision: 2 },
};

const teamsSource: SourceDescriptor = {
  ...source,
  sourceKind: "teams",
  product: "teams",
  product_variant: "teams_new",
  account: {
    tenantId: "tenant-1",
    userId: "user-1",
    email: "jane@home.example",
    tenantName: "Contoso Ltd",
    userType: "Guest",
    accountExtension: { revision: 2 },
  },
};

const response: SourcesListV1Result = {
  sources: [source, teamsSource],
  responseRevision: 2,
};

const call: JobToolCall = {
  server: "sidecar",
  name: "search_sidecar_index",
  arguments: { query: "quarterly report" },
  callExtension: { revision: 2 },
};

const status: JobStatus = {
  handle: "h".repeat(32),
  state: "ready_for_review",
  statusExtension: true,
};

void [response, call, status];

// @ts-expect-error Known fields must keep their declared types.
const invalidSource: SourceDescriptor = { ...source, enabled: "yes" };
void invalidSource;

// @ts-expect-error Explicit enum contracts stay restrictive.
const invalidStatus: JobStatus = { ...status, state: "future_state" };
void invalidStatus;
