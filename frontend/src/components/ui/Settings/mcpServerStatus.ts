import { t } from "@lingui/core/macro";

import type { EntityRowStatus } from "./EntityRow";
import type { McpServerStatus } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

/**
 * One server's connection state as an entity-row status. Shared by every
 * surface that lists servers — the settings pane and the composer's tool
 * browser — so a status never reads differently between them.
 */
export const mcpServerStatus = (server: McpServerStatus): EntityRowStatus => {
  switch (server.connection_status) {
    case "SUCCESS":
      return {
        tone: "success",
        label: t({
          id: "preferences.dialog.mcpServers.status.success.label",
          message: "Connected",
        }),
      };
    case "NEEDS_AUTHENTICATION":
      return {
        tone: "warning",
        label: t({
          id: "preferences.dialog.mcpServers.status.needsAuthentication.label",
          message: "Needs authentication",
        }),
      };
    default:
      return {
        tone: "error",
        label: t({
          id: "preferences.dialog.mcpServers.status.failure.label",
          message: "Connection failed",
        }),
      };
  }
};

/**
 * Detail sentence only where it adds something beyond the header's status
 * word: what to do (authorize) or what failed. A healthy connection needs no
 * restatement.
 */
export const mcpServerDescription = (
  server: McpServerStatus,
): string | null => {
  switch (server.connection_status) {
    case "SUCCESS":
      return null;
    case "NEEDS_AUTHENTICATION":
      return t({
        id: "preferences.dialog.mcpServers.status.needsAuthentication.description",
        message: "Authorization is required before this server can be used.",
      });
    default:
      return t({
        id: "preferences.dialog.mcpServers.status.failure.description",
        message:
          "The server is configured, but the backend could not connect to it.",
      });
  }
};
