import {
  ASSISTANT_MENTION_OPEN_ITEM_ID,
  buildAssistantMentionSection,
} from "@/components/ui/Chat/assistantMentionSection";
import { getFacetDisplayName } from "@/components/ui/Chat/facetDisplayName";
import {
  MCP_TOOLS_OPEN_ITEM_ID,
  buildMcpToolsSection,
} from "@/components/ui/Chat/mcpToolsSection";

import {
  compactChatLabel,
  modelHeaderLabel,
  toolsHeaderLabel,
  uploadSourceLabel,
} from "./addMenuTexts";
import { describeModelMenu } from "./describeModelMenu";

import type { AddMenuFileSource } from "./addMenuTexts";
import type { ModelMenuState } from "./describeModelMenu";
import type { MenuDescription, MenuEntry } from "./menuEntry";
import type { AddMenuSection } from "@/components/ui/Chat/ChatInputAddMenu";
import type { MentionableAssistant } from "@/hooks/chat/useMentionableAssistants";
import type {
  FacetInfo,
  McpServerStatus,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type React from "react";

export type { AddMenuFileSource } from "./addMenuTexts";

export interface AddMenuState {
  /** Where files can come from; empty when uploads are off. */
  fileSources: readonly AddMenuFileSource[];
  /** The chat holds as many files as it may. */
  uploadLimitReached: boolean;
  facets: readonly FacetInfo[];
  selectedFacetIds: readonly string[];
  /** The server allows one tool at a time (`only_single_facet`). */
  onlySingleFacet: boolean;
  /** The tools are set for this chat (by its assistant); the reason, where shown. */
  toolsLocked?: { reason?: string };
  connectors?: {
    servers: McpServerStatus[];
    disabledServerIds?: string[];
    writeToolsEnabled: boolean;
  };
  assistants?: {
    suggested: MentionableAssistant[];
    suggestedFromUsage?: boolean;
  };
  compaction?: { description: string; pending: boolean };
  /** Present where the composer has no model picker of its own. */
  model?: ModelMenuState;
  /** A host draws its own rows into the menu (`ChatAddMenuExtraContent`). */
  hostContent: boolean;
}

export const ADD_MENU_ID = {
  uploadComputer: "upload:computer",
  uploadSharepoint: "upload:sharepoint",
  connectors: MCP_TOOLS_OPEN_ITEM_ID,
  assistants: ASSISTANT_MENTION_OPEN_ITEM_ID,
  compact: "compact",
  model: "model",
} as const;

export const ADD_MENU_SECTION = {
  uploads: "section:uploads",
  tools: "section:tools",
  connectors: "section:connectors",
  assistants: "section:assistants",
  compaction: "section:compaction",
  model: "section:model",
} as const;

/** The file source an upload entry names, or null for another entry. */
export const uploadChoice = (itemId: string): AddMenuFileSource | null =>
  itemId === ADD_MENU_ID.uploadComputer
    ? "computer"
    : itemId === ADD_MENU_ID.uploadSharepoint
      ? "sharepoint"
      : null;

const TOOL_ID_PREFIX = "tool:";
const toolEntryId = (facetId: string) => `${TOOL_ID_PREFIX}${facetId}`;
export const toolChoice = (itemId: string): string | null =>
  itemId.startsWith(TOOL_ID_PREFIX)
    ? itemId.slice(TOOL_ID_PREFIX.length)
    : null;

// The web menu's own section builders and labels hold the rows' texts, and
// how the web menu draws them, so no row says or does it differently.
const textOf = (node: React.ReactNode, what: string): string => {
  if (typeof node !== "string") {
    throw new Error(`describeAddMenu: the ${what} is drawn, not text`);
  }
  return node;
};

const sectionRow = (section: AddMenuSection, id: string): MenuEntry => {
  const row = section.items[0];
  const description =
    "description" in row && row.description != null
      ? textOf(row.description, `${id} description`)
      : undefined;
  const closesImmediately = "closesImmediately" in row && row.closesImmediately;
  const twoLineSubtitle =
    "truncateDescription" in row && row.truncateDescription;
  return {
    id,
    label: textOf(row.label, `${id} label`),
    ...(description ? { subtitle: description } : {}),
    ...(closesImmediately || twoLineSubtitle
      ? {
          web: {
            ...(closesImmediately ? { closesImmediately } : {}),
            ...(twoLineSubtitle ? { twoLineSubtitle } : {}),
          },
        }
      : {}),
  };
};

const noop = () => {};

/**
 * The composer's "+" menu: uploads, the tools as toggles that keep the menu
 * open, connectors, assistants, compaction and, on a one-line composer, the
 * model. The web menu draws these entries whatever else it holds.
 */
export function addMenuEntries(state: AddMenuState): MenuEntry[] {
  const sections: MenuEntry[] = [];

  if (state.fileSources.length > 0) {
    sections.push({
      id: ADD_MENU_SECTION.uploads,
      inline: true,
      children: state.fileSources.map((source) => ({
        id:
          source === "computer"
            ? ADD_MENU_ID.uploadComputer
            : ADD_MENU_ID.uploadSharepoint,
        label: uploadSourceLabel(source),
        icon: {
          // eslint-disable-next-line lingui/no-unlocalized-strings -- icon names
          name: source === "computer" ? "uploadComputer" : "uploadCloud",
        },
        ...(state.uploadLimitReached ? { disabled: true } : {}),
      })),
    });
  }

  if (state.facets.length > 0) {
    const selected = new Set(state.selectedFacetIds);
    const locked = state.toolsLocked;
    sections.push({
      id: ADD_MENU_SECTION.tools,
      inline: true,
      label: toolsHeaderLabel(),
      selection: state.onlySingleFacet ? "single" : "multiple",
      children: state.facets.map((facet) => ({
        id: toolEntryId(facet.id),
        label: getFacetDisplayName(facet),
        icon: facet.icon ? { iconId: facet.icon } : { name: "tool" },
        state: selected.has(facet.id) ? "on" : "off",
        keepOpen: true,
        ...(locked ? { disabled: true } : {}),
        ...(locked?.reason ? { disabledReason: locked.reason } : {}),
      })),
    });
  }

  if (state.connectors) {
    const section = buildMcpToolsSection({ ...state.connectors, onOpen: noop });
    sections.push({
      id: ADD_MENU_SECTION.connectors,
      inline: true,
      children: [sectionRow(section, ADD_MENU_ID.connectors)],
    });
  }

  if (state.assistants) {
    const section = buildAssistantMentionSection({
      ...state.assistants,
      onOpen: noop,
    });
    sections.push({
      id: ADD_MENU_SECTION.assistants,
      inline: true,
      children: [sectionRow(section, ADD_MENU_ID.assistants)],
    });
  }

  if (state.compaction) {
    sections.push({
      id: ADD_MENU_SECTION.compaction,
      inline: true,
      children: [
        {
          id: ADD_MENU_ID.compact,
          label: compactChatLabel(),
          subtitle: state.compaction.description,
          ...(state.compaction.pending ? { disabled: true } : {}),
        },
      ],
    });
  }

  if (state.model && state.model.models.length > 0) {
    // The composer draws its "+" models without descriptions.
    const rows = describeModelMenu(state.model, { descriptions: false });
    const header = modelHeaderLabel();
    const selected = state.model.models.find(
      (model) => model.chat_provider_id === state.model?.selectedId,
    );
    // A list of models outgrows the menu, so it opens as its own menu; a
    // single model stays one row, there is nothing to choose between.
    sections.push(
      rows.length > 1
        ? {
            id: ADD_MENU_SECTION.model,
            inline: true,
            children: [
              {
                id: ADD_MENU_ID.model,
                label: header,
                ...(selected ? { subtitle: selected.model_display_name } : {}),
                selection: "single",
                children: rows,
              },
            ],
          }
        : {
            id: ADD_MENU_SECTION.model,
            inline: true,
            label: header,
            selection: "single",
            children: rows,
          },
    );
  }

  return sections;
}

/** The "+" menu for the app: `null` while a host draws rows of its own into it. */
export function describeAddMenu(state: AddMenuState): MenuDescription {
  return state.hostContent ? null : addMenuEntries(state);
}
