import { t } from "@lingui/core/macro";
import { skipToken, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { useLocation, useSearchParams } from "react-router-dom";

import { useListMcpServers } from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { completeMcpAuthorization } from "@/lib/mcpAuthorization";
import {
  clearMcpOauthCallback,
  getMcpOauthCallback,
  getMcpOauthServerId,
} from "@/lib/mcpOauthCallback";
import { useUserPreferencesFeature } from "@/providers/FeatureConfigProvider";

import { Button } from "../ui/Controls/Button";
import { Alert } from "../ui/Feedback/Alert";
import { SpinnerIcon } from "../ui/Feedback/SpinnerIcon";

import type { PropsWithChildren } from "react";

/** Consume the callback before loading chat/settings. Its request belongs to
 * the runtime controller, so remounting this boundary doesn't exchange twice.
 */
export function McpOauthCallbackBoundary({ children }: PropsWithChildren) {
  const [params, setParams] = useSearchParams();
  const { pathname } = useLocation();
  const queryClient = useQueryClient();
  const { mcpServersTabEnabled } = useUserPreferencesFeature();
  const callback = useMemo(() => getMcpOauthCallback(params), [params]);
  const associatedServerId = useMemo(
    () => getMcpOauthServerId(params.get("state") ?? ""),
    [params],
  );
  /* eslint-disable lingui/no-unlocalized-strings -- OAuth query parameter keys */
  const isReturn =
    mcpServersTabEnabled &&
    pathname === "/" &&
    (associatedServerId !== null || params.has("mcpOauthServerId")) &&
    params.has("state") &&
    (params.has("code") || params.has("error"));
  // Only legacy URLs need a list lookup. Normal redirects already carry the
  // association saved when this browser started the flow. URL-supplied IDs
  // must belong to an available OAuth server before creating runtime state.
  const validateServer = isReturn && !!callback && !associatedServerId;
  const { data: servers, isError } = useListMcpServers(
    validateServer ? {} : skipToken,
    { retry: false, refetchOnWindowFocus: false },
  );
  const knownServer = servers?.servers.some(
    (server) =>
      server.id === callback?.serverId &&
      server.authentication_mode === "oauth2",
  );
  const canComplete = !validateServer || (!isError && knownServer);
  const invalidCallback =
    !callback || (validateServer && (isError || (servers && !knownServer)));

  useEffect(() => {
    if (!isReturn || !callback || !canComplete) return;
    let mounted = true;
    void completeMcpAuthorization(queryClient, callback).finally(() => {
      if (!mounted) return;
      clearMcpOauthCallback(callback.state);
      setParams(
        (current) => {
          if (current.get("state") !== callback.state) return current;
          const next = new URLSearchParams(current);
          for (const key of [
            "code",
            "state",
            "iss",
            "error",
            "error_description",
            "error_uri",
            "mcpOauthServerId",
          ])
            next.delete(key);
          next.set("preferencesDialog", "open");
          next.set("preferencesTab", "serversTools");
          next.set("mcpServerId", callback.serverId);
          return next;
        },
        { replace: true },
      );
    });
    return () => {
      mounted = false;
    };
  }, [callback, canComplete, isReturn, queryClient, setParams]);

  if (!isReturn) return children;
  if (invalidCallback) {
    return (
      <div className="m-auto max-w-md space-y-4 p-6">
        <Alert type="error">
          {t({
            id: "mcp.callback.missingReturn",
            message:
              "This authorization could not be matched to a connection. Open settings to check the server or try again.",
          })}
        </Alert>
        {/* The only way out of a dead end deserves the primary weight. */}
        <Button
          variant="primary"
          onClick={() => {
            const next = new URLSearchParams(params);
            for (const key of [
              "code",
              "state",
              "iss",
              "error",
              "error_description",
              "error_uri",
              "mcpOauthServerId",
            ])
              next.delete(key);
            next.set("preferencesDialog", "open");
            next.set("preferencesTab", "serversTools");
            setParams(next, { replace: true });
          }}
        >
          {t({
            id: "mcp.callback.openSettings",
            message: "Open settings",
          })}
        </Button>
      </div>
    );
  }
  /* eslint-enable lingui/no-unlocalized-strings */
  const server = callback.serverId;
  return (
    <div className="m-auto p-6 text-center">
      {/* The ring's own caption slot: one component owns the pairing, so this
          wait is spaced and typed like every other full-surface wait — and the
          ring carries the live region, so nothing announces it twice. */}
      <SpinnerIcon
        size="lg"
        label={t({
          id: "mcp.callback.finishing",
          message: `Finishing connection to ${server}…`,
        })}
      />
    </div>
  );
}
