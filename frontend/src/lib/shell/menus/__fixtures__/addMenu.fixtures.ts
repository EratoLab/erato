/* eslint-disable lingui/no-unlocalized-strings -- fixture data standing in for what a server sends */
import { everyValue } from "@/utils/everyValue";

import { MODELS } from "./modelMenu.fixtures";

import type { AddMenuFileSource, AddMenuState } from "../describeAddMenu";
import type {
  FacetInfo,
  McpServerStatus,
  McpServerStatusValue,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const FACETS: FacetInfo[] = [
  {
    id: "web_search",
    display_name: "Web search",
    icon: "iconoir-globe",
    default_enabled: false,
  },
  {
    id: "image_generation",
    display_name: "Image generation",
    icon: "iconoir-media-image",
    default_enabled: false,
  },
  {
    id: "deep_research",
    display_name: "Deep research",
    default_enabled: false,
  },
];

const connectionStatuses = everyValue<McpServerStatusValue>()(
  "SUCCESS",
  "FAILURE",
  "NEEDS_AUTHENTICATION",
);

const SERVERS: McpServerStatus[] = connectionStatuses.map((status, index) => ({
  id: `server-${index}`,
  display_name: ["Ticket tracker", "Shared drive", "Code host"][index],
  connection_status: status,
  authentication_mode: status === "NEEDS_AUTHENTICATION" ? "oauth2" : "none",
}));

const fileSources = everyValue<AddMenuFileSource>()("computer", "sharepoint");

const plain: AddMenuState = {
  fileSources: ["computer"],
  uploadLimitReached: false,
  facets: FACETS,
  selectedFacetIds: ["web_search"],
  onlySingleFacet: false,
  hostContent: false,
};

const fixture = (state: Partial<AddMenuState> = {}): AddMenuState => ({
  ...plain,
  ...state,
});

export const ADD_MENU_FIXTURES = {
  tools: fixture(),
  noTools: fixture({ facets: [], selectedFacetIds: [] }),
  uploadsOff: fixture({ fileSources: [] }),
  cloudUpload: fixture({ fileSources }),
  uploadLimitReached: fixture({ uploadLimitReached: true }),
  toolsLocked: fixture({
    toolsLocked: { reason: "This assistant sets the tools for its chats." },
  }),
  // On a composer wide enough for tool chips, the chips say it instead.
  toolsLockedQuietly: fixture({ toolsLocked: {} }),
  oneToolAtATime: fixture({ onlySingleFacet: true }),
  connectors: fixture({
    connectors: { servers: SERVERS, writeToolsEnabled: true },
  }),
  connectorsOffAndReadOnly: fixture({
    connectors: {
      servers: SERVERS,
      disabledServerIds: ["server-0"],
      writeToolsEnabled: false,
    },
  }),
  assistants: fixture({
    assistants: {
      suggested: [
        { id: "a-1", name: "Contract reviewer" },
        { id: "a-2", name: "Travel planner" },
      ],
    },
  }),
  assistantsUnranked: fixture({
    assistants: {
      suggested: [
        { id: "a-1", name: "Contract reviewer" },
        { id: "a-2", name: "Travel planner" },
      ],
      suggestedFromUsage: false,
    },
  }),
  compaction: fixture({
    compaction: {
      description:
        "Future replies will use a summary of this chat. Some details may be lost.",
      pending: false,
    },
  }),
  compactionPending: fixture({
    compaction: {
      description:
        "Future replies will use a summary of this chat. Some details may be lost.",
      pending: true,
    },
  }),
  oneModel: fixture({
    model: {
      models: MODELS.slice(0, 1),
      selectedId: MODELS[0].chat_provider_id,
      ready: true,
    },
  }),
  models: fixture({
    model: { models: MODELS, selectedId: "claude-sonnet", ready: true },
  }),
  // The chat's settings are still loading: the models wait.
  modelsNotReady: fixture({
    model: { models: MODELS, selectedId: "claude-sonnet", ready: false },
  }),
  everything: fixture({
    fileSources,
    connectors: { servers: SERVERS, writeToolsEnabled: true },
    assistants: { suggested: [{ id: "a-1", name: "Contract reviewer" }] },
    compaction: {
      description: "Future replies will use a summary.",
      pending: false,
    },
    model: { models: MODELS, selectedId: null, ready: true },
  }),
  hostContent: fixture({ hostContent: true }),
} satisfies Record<string, AddMenuState>;

/** Each setting of the menu, so the matrix gains a fixture when one is added. */
export const ADD_MENU_STATE_KEYS = everyValue<keyof AddMenuState>()(
  "fileSources",
  "uploadLimitReached",
  "facets",
  "selectedFacetIds",
  "onlySingleFacet",
  "toolsLocked",
  "connectors",
  "assistants",
  "compaction",
  "model",
  "hostContent",
);
