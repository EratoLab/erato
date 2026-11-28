import { t } from "@lingui/core/macro";

import {
  ASSISTANT_MENTION_OPEN_ITEM_ID,
  buildAssistantMentionSection,
} from "@/components/ui/Chat/assistantMentionSection";
import { getFacetDisplayName } from "@/components/ui/Chat/facetDisplayName";
import {
  MCP_TOOLS_OPEN_ITEM_ID,
  buildMcpToolsSection,
} from "@/components/ui/Chat/mcpToolsSection";

import { compactChatLabel, uploadSourceLabel } from "./addMenuTexts";
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
  /** The composer is locked or files are being uploaded: every row waits. */
  busy: boolean;
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

const TOOL_ID_PREFIX = "tool:";
export const toolEntryId = (facetId: string) => `${TOOL_ID_PREFIX}${facetId}`;
export const toolChoice = (itemId: string): string | null =>
  itemId.startsWith(TOOL_ID_PREFIX)
    ? itemId.slice(TOOL_ID_PREFIX.length)
    : null;

// The web menu's own section builders and labels hold the rows' texts, so
// the two drawings cannot word a row differently.
const textOf = (node: React.ReactNode, what: string): string => {
  if (typeof node !== "string") {
    throw new Error(`describeAddMenu: the ${what} is drawn, not text`);
  }
  return node;
};

const sectionRow = (
  section: AddMenuSection,
  id: string,
  disabled: boolean,
): MenuEntry => {
  const row = section.items[0];
  const description =
    "description" in row && row.description != null
      ? textOf(row.description, `${id} description`)
      : undefined;
  return {
    id,
    label: textOf(row.label, `${id} label`),
    ...(description ? { subtitle: description } : {}),
    ...(disabled ? { disabled: true } : {}),
  };
};

const noop = () => {};

/**
 * The composer's "+" menu: uploads, the tools as toggles that keep the menu
 * open, connectors, assistants, compaction and, on a one-line composer, the
 * model. `null` while a host draws rows of its own into it.
 */
export function describeAddMenu(state: AddMenuState): MenuDescription {
  if (state.hostContent) return null;
  const { busy } = state;
  const sections: MenuEntry[] = [];

  if (state.fileSources.length > 0) {
    const disabled = busy || state.uploadLimitReached;
    sections.push({
      id: "section:uploads",
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
        ...(disabled ? { disabled: true } : {}),
      })),
    });
  }

  if (state.facets.length > 0) {
    const selected = new Set(state.selectedFacetIds);
    const locked = state.toolsLocked;
    const disabled = busy || locked !== undefined;
    sections.push({
      id: "section:tools",
      inline: true,
      label: t({ id: "chatInput.addMenu.toolsHeader", message: "Tools" }),
      selection: state.onlySingleFacet ? "single" : "multiple",
      children: state.facets.map((facet) => ({
        id: toolEntryId(facet.id),
        label: getFacetDisplayName(facet),
        icon: facet.icon ? { iconId: facet.icon } : { name: "tool" },
        state: selected.has(facet.id) ? "on" : "off",
        keepOpen: true,
        ...(disabled ? { disabled: true } : {}),
        ...(locked?.reason ? { disabledReason: locked.reason } : {}),
      })),
    });
  }

  if (state.connectors) {
    const section = buildMcpToolsSection({ ...state.connectors, onOpen: noop });
    sections.push({
      id: "section:connectors",
      inline: true,
      children: [sectionRow(section, ADD_MENU_ID.connectors, busy)],
    });
  }

  if (state.assistants) {
    const section = buildAssistantMentionSection({
      ...state.assistants,
      onOpen: noop,
    });
    sections.push({
      id: "section:assistants",
      inline: true,
      children: [sectionRow(section, ADD_MENU_ID.assistants, busy)],
    });
  }

  if (state.compaction) {
    const disabled = busy || state.compaction.pending;
    sections.push({
      id: "section:compaction",
      inline: true,
      children: [
        {
          id: ADD_MENU_ID.compact,
          label: compactChatLabel(),
          subtitle: state.compaction.description,
          ...(disabled ? { disabled: true } : {}),
        },
      ],
    });
  }

  if (state.model && state.model.models.length > 0) {
    // The composer draws its "+" models without descriptions.
    const rows = describeModelMenu(
      { ...state.model, ready: state.model.ready && !busy },
      { descriptions: false },
    );
    const header = t({ id: "chatInput.addMenu.modelHeader", message: "Model" });
    const selected = state.model.models.find(
      (model) => model.chat_provider_id === state.model?.selectedId,
    );
    // A list of models outgrows the menu, so it opens as its own menu; a
    // single model stays one row, there is nothing to choose between.
    sections.push(
      rows.length > 1
        ? {
            id: "section:model",
            inline: true,
            children: [
              {
                id: ADD_MENU_ID.model,
                label: header,
                ...(selected ? { subtitle: selected.model_display_name } : {}),
                selection: "single",
                ...(busy ? { disabled: true } : {}),
                children: rows,
              },
            ],
          }
        : {
            id: "section:model",
            inline: true,
            label: header,
            selection: "single",
            children: rows,
          },
    );
  }

  return sections;
}
