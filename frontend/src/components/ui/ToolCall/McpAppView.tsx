import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import clsx from "clsx";
import { useEffect, useMemo, useRef, useState } from "react";

import { useOptionalTheme } from "@/components/providers/ThemeProvider";
import { browserTimeZone } from "@/hooks/profile/useClientLocaleReport";
import { getClientPlatform } from "@/lib/clientPlatform";
import { useGetMcpServerAppView } from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { viewHostContext } from "@/lib/mcpApps/hostContext";
import { isRecord } from "@/lib/toolCallGist/serverText";

import type { ToolUse } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { ViewConnection } from "@/lib/mcpApps/viewHost";
import type { CallToolResult } from "@modelcontextprotocol/client";

/**
 * Where a sandbox origin serves the page that shows a view: the frontend
 * build ships it as `frontend/public/mcp-apps-sandbox.html`.
 */
// eslint-disable-next-line lingui/no-unlocalized-strings -- URL path
const SANDBOX_PAGE_PATH = "/public/common/mcp-apps-sandbox.html";

/** A view's height until it asks for one, as an iframe has by default. */
const DEFAULT_VIEW_HEIGHT = 150;

/**
 * The sandbox page on `origin`, or none when `origin` is not a bare origin or
 * is the app's own: a view must never run on the app's origin.
 */
const sandboxPageUrl = (origin: string): string | undefined => {
  try {
    const url = new URL(SANDBOX_PAGE_PATH, origin);
    return url.origin === origin && url.origin !== window.location.origin
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
};

/**
 * The call's result as a view receives it: the tool's text, as stored, and
 * its `structuredContent`, which views take their data from.
 */
const toolResultOf = (
  output: unknown,
  structuredContent: unknown,
): CallToolResult => ({
  content:
    output == null
      ? []
      : [
          {
            type: "text",
            text: typeof output === "string" ? output : JSON.stringify(output),
          },
        ],
  ...(isRecord(structuredContent) ? { structuredContent } : {}),
});

interface McpAppFrameProps {
  part: ToolUse;
  serverId: string;
  uri: string;
  onShown?: () => void;
}

const McpAppFrame = ({ part, serverId, uri, onShown }: McpAppFrameProps) => {
  const { data } = useGetMcpServerAppView(
    { pathParams: { serverId }, queryParams: { uri } },
    { staleTime: Infinity, retry: false },
  );
  const themeContext = useOptionalTheme();
  const theme = themeContext?.effectiveTheme ?? "light";
  const appTheme = themeContext?.theme;
  const { i18n } = useLingui();
  const locale = i18n.locale || undefined;
  const frameRef = useRef<HTMLIFrameElement>(null);
  // Unset until the view has initialized: a view that never does stays out
  // of sight, and the call's files show as they always have.
  const [height, setHeight] = useState<number>();
  const [failed, setFailed] = useState(false);
  // The width the message column gives the view, followed as it changes.
  const [width, setWidth] = useState<number>();
  const pageUrl = data ? sandboxPageUrl(data.sandbox_origin) : undefined;
  const hostContext = useMemo(
    () =>
      viewHostContext({
        theme,
        appTheme,
        width,
        locale,
        timeZone: browserTimeZone(),
      }),
    [theme, appTheme, width, locale],
  );
  // The call has settled by the time it names a view; what it was called
  // with and returned is read once, when the view connects.
  const structuredContent = part.result_details?.view?.structured_content;
  const call = useRef({
    input: part.input,
    output: part.output,
    structuredContent,
    hostContext,
    onShown,
  });
  call.current = {
    input: part.input,
    output: part.output,
    structuredContent,
    hostContext,
    onShown,
  };
  const connection = useRef<ViewConnection>(undefined);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const measure = (next: number) => {
      if (next > 0) setWidth(Math.round(next));
    };
    measure(frame.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => {
      measure(entry.contentRect.width);
    });
    observer.observe(frame);
    return () => {
      observer.disconnect();
    };
  }, [data, pageUrl]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!data || !pageUrl || !frame) return;
    let connected: ViewConnection | undefined;
    let cancelled = false;
    // Loaded with the first view, so the SDK stays out of the main bundle.
    // eslint-disable-next-line lingui/no-unlocalized-strings -- module path
    import("@/lib/mcpApps/viewHost")
      .then(({ connectView }) => {
        if (cancelled) return;
        const { input, output, structuredContent, hostContext } = call.current;
        const csp: unknown = data.ui?.csp;
        connected = connectView(
          frame,
          pageUrl,
          {
            html: data.html,
            csp: isRecord(csp) ? csp : undefined,
            input: isRecord(input) ? input : {},
            result: toolResultOf(output, structuredContent),
          },
          hostContext,
          {
            onInitialized: () => {
              setHeight((current) => current ?? DEFAULT_VIEW_HEIGHT);
              call.current.onShown?.();
            },
            onHeight: setHeight,
          },
        );
        connection.current = connected;
      })
      .catch(() => {
        setFailed(true);
      });
    return () => {
      cancelled = true;
      connected?.disconnect();
      if (connection.current === connected) connection.current = undefined;
    };
  }, [data, pageUrl]);

  // The width, theme or language changed: the view is told.
  useEffect(() => {
    connection.current?.setHostContext(hostContext);
  }, [hostContext]);

  if (!data || !pageUrl || failed) return null;

  const toolName = part.tool_name ?? "";
  return (
    <iframe
      ref={frameRef}
      data-testid="mcp-app-view"
      title={t({
        id: "trace.tool.appView.title",
        message: `Interactive view of ${toolName}`,
      })}
      // The spec's sandbox for the frame on the sandbox origin; the page
      // there gives the view's own frame no more than these.
      sandbox="allow-scripts allow-same-origin"
      // The sandbox page takes messages from, and sends them to, this origin.
      referrerPolicy="origin"
      aria-hidden={height === undefined}
      // On the message's own background like its text: no frame, padding or
      // card around the view. The theme's color scheme, which the sandbox
      // page takes from the host context too: where they differ, the
      // browser paints an opaque backdrop behind the page.
      className={clsx("block w-full", height !== undefined && "my-2")}
      style={{ height: height ?? 0, colorScheme: theme }}
    />
  );
};

export interface McpAppViewProps {
  part: ToolUse;
  /** Called once the view has initialized and shows. */
  onShown?: () => void;
}

/**
 * The interactive view (MCP Apps) a tool call names in
 * `result_details.view`, in a sandboxed frame from the server's sandbox
 * origin. Only the web app shows it; elsewhere, and when the view cannot be
 * fetched or loaded, nothing shows here and the call's files stay as they are.
 */
export const McpAppView = ({ part, onShown }: McpAppViewProps) => {
  const view = part.result_details?.view;
  if (!view || getClientPlatform() !== "web") return null;
  return (
    <McpAppFrame
      part={part}
      serverId={view.server_id}
      uri={view.uri}
      onShown={onShown}
    />
  );
};
