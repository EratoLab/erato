import { useCallback } from "react";
import { useInRouterContext, useSearchParams } from "react-router-dom";

const useOpenMcpServersSettingsUnderRouter = () => {
  const [searchParams, setSearchParams] = useSearchParams();

  return useCallback(() => {
    /* eslint-disable lingui/no-unlocalized-strings -- URL query parameter keys */
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("preferencesDialog", "open");
    nextParams.set("preferencesTab", "serversTools");
    /* eslint-enable lingui/no-unlocalized-strings */
    setSearchParams(nextParams);
  }, [searchParams, setSearchParams]);
};

/**
 * Opens the settings dialog on the MCP servers tab. The dialog opener lives in
 * `UserProfileDropdown`, which watches exactly this query-param pair wherever
 * the sidebar chrome is mounted — every "connect this server" affordance must
 * mint the same spelling, so this hook is the single place it is written.
 *
 * Returns `null` where no react-router `Router` is mounted (component-kit and
 * add-in hosts): nothing watches the query params there, so consumers must
 * treat `null` as "no settings shortcut available" and drop their affordance
 * instead of rendering a dead button.
 */
export const useOpenMcpServersSettings = (): (() => void) | null => {
  const isRouterMounted = useInRouterContext();

  // Router presence cannot change for a mounted component instance, so hook
  // order stays stable across renders despite the conditional call.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return isRouterMounted ? useOpenMcpServersSettingsUnderRouter() : null;
};
