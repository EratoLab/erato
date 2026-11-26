/* eslint-disable lingui/no-unlocalized-strings -- module paths and route prefixes */
import { useQueryClient } from "@tanstack/react-query";
import { lazy, useEffect, useState } from "react";

import { startingAssistantQuery } from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { useV1betaApiContext } from "@/lib/generated/v1betaApi/v1betaApiContext";

import type { StartingAssistantResponse } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { ComponentType } from "react";

/**
 * A route whose code can load before it renders. Once loaded it renders
 * directly: `lazy` alone would suspend once anyway, and React then holds the
 * page back for its fallback's minimum time (about 300 ms).
 */
const preloadableRoute = (load: () => Promise<{ default: ComponentType }>) => {
  let loaded: ComponentType | undefined;
  let loading: Promise<{ default: ComponentType }> | undefined;
  const preload = () =>
    (loading ??= load().then((module) => {
      loaded = module.default;
      return module;
    }));
  const Lazy = lazy(preload);
  function PreloadableRoute() {
    // Fixed per mount, so a module that arrives later never remounts the page.
    const [Component] = useState(() => loaded ?? Lazy);
    return <Component />;
  }
  return { Route: PreloadableRoute, preload };
};

export const chatLayout = preloadableRoute(
  () => import("@/layouts/ChatLayout"),
);
export const assistantChatLayout = preloadableRoute(
  () => import("@/layouts/AssistantChatLayout"),
);
export const assistantChatSpacePage = preloadableRoute(
  () => import("@/pages/AssistantChatSpacePage"),
);

const preloadAssistantSpace = () => {
  void assistantChatLayout.preload();
  void assistantChatSpacePage.preload();
};

/**
 * Starts, beside the translations and the theme, what the first page waits
 * for: which page the start lands on, and that page's code. Without it each
 * waited for the one before. Renders nothing.
 */
export function StartPreload() {
  const queryClient = useQueryClient();
  const { fetcherOptions } = useV1betaApiContext();

  useEffect(() => {
    const path = window.location.pathname;
    if (path === "/") {
      void chatLayout.preload();
      const query = startingAssistantQuery(fetcherOptions);
      void queryClient
        .prefetchQuery({ ...query, retry: false })
        .then(() => {
          const answer = queryClient.getQueryData<StartingAssistantResponse>(
            query.queryKey,
          );
          if (answer?.starting_assistant?.assistant_id) preloadAssistantSpace();
        });
    } else if (path.startsWith("/chat")) {
      void chatLayout.preload();
    } else if (path.startsWith("/a/")) {
      preloadAssistantSpace();
    }
    // Once per page load: later navigations load their code as they go.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
