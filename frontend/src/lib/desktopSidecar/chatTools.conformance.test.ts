import { DesktopSidecarClient } from "@erato/desktop-sidecar-protocol";
import { render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { clientToolHostAdapterConformanceFailures } from "@/conformance/clientToolHostAdapter";
import { resetClientToolRegistryForTests } from "@/hooks/chat/clientToolExecutors";
import { useClientToolFileApprovalStore } from "@/hooks/chat/store/clientToolFileApprovalStore";
import { useConfirmationRegistryStore } from "@/hooks/chat/store/confirmationRegistryStore";
import {
  fetchProfile,
  fetchUploadFile,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { DesktopSidecarClientTools } from "@/providers/DesktopSidecarClientTools";

import {
  GET_SIDECAR_DOCUMENT_TOOL,
  GET_SIDECAR_FOLDER_HIERARCHY_TOOL,
  GET_SIDECAR_SEARCH_FIELDS_TOOL,
  LIST_SIDECAR_MAILBOXES_TOOL,
  READ_SIDECAR_CONVERSATION_TOOL,
  SEARCH_SIDECAR_INDEX_TOOL,
} from "./chatTools";

import type { ClientToolHostTurn } from "@/conformance/clientToolHostAdapter";
import type { UserProfile } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { SearchQueryV1Result } from "@erato/desktop-sidecar-protocol";

type Coverage = NonNullable<SearchQueryV1Result["coverage"]>;
type Source = Coverage["sources"][number];

const sidecar = vi.hoisted((): { client?: DesktopSidecarClient } => ({}));

vi.mock("@/lib/generated/v1betaApi/v1betaApiComponents", () => ({
  fetchProfile: vi.fn(),
  fetchUploadFile: vi.fn(),
}));
vi.mock("@/providers/DesktopSidecarProvider", () => ({
  useDesktopSidecar: () => ({
    client: sidecar.client,
    snapshot: sidecar.client?.getSnapshot(),
  }),
}));
vi.mock("@/providers/FeatureConfigProvider", () => ({
  useUploadFeature: () => ({ enabled: true, maxSizeBytes: 100_000 }),
  useChatInputFeature: () => ({ maxFiles: 10 }),
}));

const mailboxId = "a".repeat(32);
const sourceId = "00000000-0000-4000-8000-000000000001";

/** Every source observed after any read of this run and nothing queued. */
const caughtUp = (): Source => ({
  sourceId,
  mailboxId: null,
  product: "outlook",
  displayName: "Work",
  accountEmail: "jane@example.com",
  from: { at: "2026-01-01T00:00:00Z", inclusive: true },
  through: null,
  observedAt: "2099-01-01T00:00:00Z",
  pendingNewer: 0,
  olderPending: 0,
  unsearchable: 0,
  undated: 0,
  dateBasis: "emailReceivedAtThenSentAt",
  inventory: "localStore",
  unavailableReason: null,
});

let coverage: Coverage | undefined;

const responses = (): Record<string, unknown> => ({
  "search.query.v1": {
    hits: [],
    elapsedMs: 0,
    blocksRead: 0,
    candidatesScored: 0,
    ...(coverage ? { coverage, limitReached: false } : {}),
  },
  "outlook.get_conversation.v1": {
    state: "ok",
    messages: [
      {
        internetMessageId: "<mail@example.test>",
        conversationIndex: `01d7a1b2c3d4${"ab".repeat(16)}`,
        body: { contentType: "text/plain", content: "Hello" },
        attachments: [],
      },
    ],
  },
  "outlook.list_mailboxes.v1": {
    mailboxes: [
      {
        id: mailboxId,
        displayName: "Work",
        emailAddress: "jane@example.com",
        source: "ost",
      },
    ],
    warnings: [],
  },
  "sources.list.v1": { sources: [] },
  "sources.get_folder_hierarchy.v1": { sourceId, nodes: [] },
  "search.metadata_fields.v1": { fields: [] },
  "sources.get_document.v1": {
    filename: "contract.txt",
    mimeType: "text/plain",
    contentBase64: globalThis.btoa("contract"),
  },
});

beforeEach(() => {
  coverage = {
    sampledAt: "2099-01-01T00:00:00Z",
    basis: "index",
    sources: [caughtUp()],
  };
  const client = new DesktopSidecarClient({
    transport: {
      request: async (body: string) => {
        const { id, method } = JSON.parse(body) as {
          id: string;
          method: string;
        };
        return JSON.stringify({
          jsonrpc: "2.0",
          id,
          result: responses()[method],
        });
      },
    },
    clientInfo: {
      name: "test",
      version: "1",
      host: { application: "test", runtime: "test" },
      os: { name: "test" },
    },
  });
  vi.spyOn(client, "supports").mockReturnValue(true);
  const ready = { ...client.getSnapshot(), state: "ready" as const };
  vi.spyOn(client, "getSnapshot").mockReturnValue(ready);
  sidecar.client = client;
  vi.mocked(fetchProfile).mockResolvedValue({
    client_tool_file_approval: "ask",
  } as UserProfile);
  vi.mocked(fetchUploadFile).mockResolvedValue({
    files: [{ id: "uploaded-file" }],
  } as Awaited<ReturnType<typeof fetchUploadFile>>);
});

afterEach(() => {
  resetClientToolRegistryForTests();
  useClientToolFileApprovalStore.setState({ requests: [] });
  useConfirmationRegistryStore.setState({ pendingIdsByChatId: {} });
  vi.clearAllMocks();
});

const withSource = (overrides: Partial<Source>) => () => {
  coverage = {
    sampledAt: "2099-01-01T00:00:00Z",
    basis: "index",
    sources: [{ ...caughtUp(), ...overrides }],
  };
};

it("keeps the client tool host contract for delegated tasks", async () => {
  render(createElement(DesktopSidecarClientTools));
  let turns = 0;
  const failures = await clientToolHostAdapterConformanceFailures({
    hostContext: "desktop_sidecar",
    lossCode: "context_unavailable",
    ownerCheck: "server",
    startTurn: async (): Promise<ClientToolHostTurn> => {
      turns += 1;
      withSource({})();
      return { ownerChatId: "owner-chat", ownerMessageId: `owner-${turns}` };
    },
    coordinatorState: () => ({}),
    reads: [
      { tool: SEARCH_SIDECAR_INDEX_TOOL, input: { text: "contract" } },
      {
        tool: READ_SIDECAR_CONVERSATION_TOOL,
        input: { mailboxId, internetMessageId: "<mail@example.test>" },
      },
      { tool: LIST_SIDECAR_MAILBOXES_TOOL, input: {} },
      { tool: GET_SIDECAR_FOLDER_HIERARCHY_TOOL, input: { sourceId } },
      { tool: GET_SIDECAR_SEARCH_FIELDS_TOOL, input: {} },
    ],
    writes: [],
    writeMarkers: { fields: [], phrases: [] },
    blindSpots: [
      {
        name: "a source observed before the read",
        apply: withSource({ observedAt: "2000-01-01T00:00:00Z" }),
      },
      {
        name: "newer items still being indexed",
        apply: withSource({
          pendingNewer: 3,
          through: { at: "2026-10-01T00:00:00Z", inclusive: true },
        }),
      },
      {
        name: "an unavailable source",
        apply: withSource({ unavailableReason: "not_configured" }),
      },
      {
        name: "a sidecar that reports no coverage",
        apply: () => {
          coverage = undefined;
        },
      },
    ],
    deviceApproval: {
      read: {
        tool: GET_SIDECAR_DOCUMENT_TOOL,
        input: { documentId: "11111111-1111-4111-8111-111111111111" },
      },
      answer: (approved) => {
        const request = useClientToolFileApprovalStore
          .getState()
          .requests.at(-1);
        request?.finish(approved ? new Set(request.files) : new Set());
      },
    },
  });
  expect(failures).toEqual([]);
});
