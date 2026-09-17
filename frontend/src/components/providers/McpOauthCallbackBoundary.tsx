import { t } from "@lingui/core/macro";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";

import { completeMcpAuthorization } from "@/lib/mcpAuthorization";
import {
  clearMcpOauthCallback,
  getMcpOauthCallback,
} from "@/lib/mcpOauthCallback";
import { useUserPreferencesFeature } from "@/providers/FeatureConfigProvider";

import { Button } from "../ui/Controls/Button";
import { SpinnerIcon } from "../ui/Feedback/SpinnerIcon";

import type { PropsWithChildren } from "react";

/** Consume the callback before loading chat/settings. Its request belongs to
 * the runtime controller, so remounting this boundary doesn't exchange twice.
 */
export function McpOauthCallbackBoundary({ children }: PropsWithChildren) {
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { mcpServersTabEnabled } = useUserPreferencesFeature();
  const callback = useMemo(() => getMcpOauthCallback(params), [params]);
  /* eslint-disable lingui/no-unlocalized-strings -- OAuth query parameter keys */
  const isReturn =
    mcpServersTabEnabled &&
    params.has("state") &&
    (params.has("code") || params.has("error"));

  useEffect(() => {
    if (!isReturn || !callback) return;
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
  }, [callback, isReturn, queryClient, setParams]);

  if (!isReturn) return children;
  if (!callback) {
    return (
      <div className="m-auto max-w-md space-y-4 p-6">
        <p role="alert">
          {t({
            id: "mcp.authorization.missingReturn",
            message:
              "This authorization could not be matched to a connection. Open settings to check the server or try again.",
          })}
        </p>
        <Button
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
            id: "mcp.authorization.openSettings",
            message: "Open settings",
          })}
        </Button>
      </div>
    );
  }
  /* eslint-enable lingui/no-unlocalized-strings */
  const server = callback.serverId;
  return (
    <div
      className="m-auto space-y-3 p-6 text-center"
      role="status"
      aria-atomic="true"
    >
      <SpinnerIcon size="lg" aria-hidden="true" />
      <p>
        {t({
          id: "mcp.authorization.finishingNamed",
          message: `Finishing connection to ${server}…`,
        })}
      </p>
    </div>
  );
}
