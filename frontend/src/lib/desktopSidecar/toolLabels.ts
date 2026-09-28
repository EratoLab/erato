import { t } from "@lingui/core/macro";

import {
  GET_SIDECAR_DOCUMENT_TOOL,
  GET_SIDECAR_FOLDER_HIERARCHY_TOOL,
  GET_SIDECAR_SEARCH_FIELDS_TOOL,
  LIST_SIDECAR_MAILBOXES_TOOL,
  READ_SIDECAR_CONVERSATION_TOOL,
  SEARCH_SIDECAR_INDEX_TOOL,
} from "./chatTools";

/**
 * Shared by the settings list and the in-chat confirmation so the two cannot
 * drift. An unknown tool falls back to its model-facing name.
 */
export const sidecarToolLabel = (name: string): string => {
  switch (name) {
    case SEARCH_SIDECAR_INDEX_TOOL:
      return t({
        id: "desktopSidecar.tools.search.label",
        message: "Search local emails and files",
      });
    case READ_SIDECAR_CONVERSATION_TOOL:
      return t({
        id: "desktopSidecar.tools.readConversation.label",
        message: "Read an email conversation",
      });
    case GET_SIDECAR_DOCUMENT_TOOL:
      return t({
        id: "desktopSidecar.tools.getDocument.label",
        message: "Retrieve a document or attachment",
      });
    case GET_SIDECAR_SEARCH_FIELDS_TOOL:
      return t({
        id: "desktopSidecar.tools.searchFields.label",
        message: "List searchable fields",
      });
    case LIST_SIDECAR_MAILBOXES_TOOL:
      return t({
        id: "desktopSidecar.tools.listMailboxes.label",
        message: "List mailboxes on this device",
      });
    case GET_SIDECAR_FOLDER_HIERARCHY_TOOL:
      return t({
        id: "desktopSidecar.tools.folderHierarchy.label",
        message: "Read the folder structure",
      });
    default:
      return name;
  }
};
