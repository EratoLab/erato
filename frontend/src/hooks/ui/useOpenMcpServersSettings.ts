import { useCallback } from "react";
import { useInRouterContext, useSearchParams } from "react-router-dom";

import { useUserPreferencesFeature } from "@/providers/FeatureConfigProvider";
import {
  useMcpSettingsHostOpener,
  type McpSettingsOpener,
} from "@/providers/McpSettingsOpenProvider";

const useOpenMcpServersSettingsUnderRouter = (): McpSettingsOpener => {
  const [searchParams, setSearchParams] = useSearchParams();

  return useCallback(
    (serverId?: string) => {
      /* eslint-disable lingui/no-unlocalized-strings -- URL query parameter keys */
      const nextParams = new URLSearchParams(searchParams);
      nextParams.set("preferencesDialog", "open");
      nextParams.set("preferencesTab", "serversTools");
      if (serverId) {
        nextParams.set("mcpServerId", serverId);
      } else {
        nextParams.delete("mcpServerId");
      }
      /* eslint-enable lingui/no-unlocalized-strings */
      setSearchParams(nextParams);
    },
    [searchParams, setSearchParams],
  );
};

/**
 * Opens the settings dialog on the MCP servers tab, expanded on one server
 * when an id is given. The dialog opener lives in `UserProfileDropdown`, which
 * watches exactly these query params wherever the sidebar chrome is mounted —
 * every "connect this server" affordance must mint the same spelling, so this
 * hook is the single place it is written.
 *
 * A host that mounts a `McpSettingsOpenProvider` (the add-in pane, which has a
 * Router but no such dialog) opens its own way instead.
 *
 * Returns `null` when the MCP tab is hidden, or when there is neither a host
 * opener nor a react-router `Router` (component-kit hosts). Consumers must
 * treat `null` as "no settings shortcut available" and drop their affordance
 * instead of rendering a dead button.
 */
export const useOpenMcpServersSettings = (): McpSettingsOpener | null => {
  const hostOpener = useMcpSettingsHostOpener();
  const isRouterMounted = useInRouterContext();
  const { mcpServersTabEnabled } = useUserPreferencesFeature();

  // Router presence cannot change for a mounted component instance, so hook
  // order stays stable across renders despite the conditional call.
  const openSettings = isRouterMounted
    ? // eslint-disable-next-line react-hooks/rules-of-hooks
      useOpenMcpServersSettingsUnderRouter()
    : null;
  if (!mcpServersTabEnabled) {
    return null;
  }
  return hostOpener ?? openSettings;
};
