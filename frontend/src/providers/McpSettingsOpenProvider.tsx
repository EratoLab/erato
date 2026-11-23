import { createContext, useContext } from "react";

import type { ReactNode } from "react";

/** Opens the MCP server settings, on one server when an id is given. */
export type McpSettingsOpener = (serverId?: string) => void;

const McpSettingsOpenContext = createContext<McpSettingsOpener | null>(null);

/**
 * How the host opens the MCP server settings from the composer and the message
 * notices, to connect a server or manage them all. Web surfaces mount no
 * provider and open their settings dialog through the URL; a host without that
 * dialog (the add-in pane) supplies its own opener instead.
 */
export function McpSettingsOpenProvider({
  onOpen,
  children,
}: {
  onOpen: McpSettingsOpener;
  children: ReactNode;
}) {
  return (
    <McpSettingsOpenContext.Provider value={onOpen}>
      {children}
    </McpSettingsOpenContext.Provider>
  );
}

export const useMcpSettingsHostOpener = () =>
  useContext(McpSettingsOpenContext);
