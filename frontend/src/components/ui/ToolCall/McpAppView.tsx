import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import clsx from "clsx";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { useOptionalTheme } from "@/components/providers/ThemeProvider";
import { ConfirmationDialog } from "@/components/ui/Modal/ConfirmationDialog";
import { browserTimeZone } from "@/hooks/profile/useClientLocaleReport";
import { CONTENT_RESIZED_EVENT } from "@/hooks/useScrollToBottom";
import { getClientPlatform } from "@/lib/clientPlatform";
import { useGetMcpServerAppView } from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { saveViewDownload } from "@/lib/mcpApps/download";
import { viewHostContext } from "@/lib/mcpApps/hostContext";
import {
  forgetViewHeight,
  rememberViewHeight,
  rememberedViewHeight,
} from "@/lib/mcpApps/viewHeights";
import { isRecord } from "@/lib/toolCallGist/serverText";
import { shownToolName } from "@/lib/toolCallGist/toolName";

import type { ToolUse } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { ViewDownload } from "@/lib/mcpApps/download";
import type { ViewConnection } from "@/lib/mcpApps/viewHost";
import type { CallToolResult } from "@modelcontextprotocol/client";

/**
 * Where a sandbox origin serves the page that shows a view: the frontend
 * build ships it as `frontend/public/mcp-apps-sandbox.html`.
 */
// eslint-disable-next-line lingui/no-unlocalized-strings -- URL path
const SANDBOX_PAGE_PATH = "/public/common/mcp-apps-sandbox.html";

/**
 * A view's height until it asks for one, as an iframe has by default, and
 * its placeholder's when the view's last height is not known.
 */
const DEFAULT_VIEW_HEIGHT = 150;

/** How long a view may take to show before a placeholder stands in for it. */
export const VIEW_PLACEHOLDER_DELAY_MS = 1_000;

/**
 * How long a view that has initialized may take to ask for a height before
 * it shows at the height its frame has.
 */
export const VIEW_HEIGHT_TIMEOUT_MS = 1_000;

/**
 * How long a view may take to start, from the moment it is placed, before it
 * counts as not shown when nothing has said so sooner. A view that starts
 * later still shows.
 */
export const VIEW_START_TIMEOUT_MS = 30_000;

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
 * The call's result as a view receives it: the tool's text, as stored, its
 * `structuredContent`, which views take their data from, and its `_meta` as
 * the server returned it.
 */
const toolResultOf = (
  output: unknown,
  structuredContent: unknown,
  meta: unknown,
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
  ...(isRecord(meta) ? { _meta: meta } : {}),
});

/** An element that moves a child without reloading it, as `moveBefore` does. */
interface MovingParent extends Element {
  moveBefore: (node: Node, child: Node | null) => void;
}

const movesWithoutReload = (parent: Element): parent is MovingParent =>
  "moveBefore" in parent;

/**
 * Tears down the view in `frame` while the frame is still in the page: the
 * view is told right away, and the frame moves out of sight, still loaded
 * and inert, until the view has answered or its time is up. A browser that
 * cannot move a frame without reloading it leaves the frame in place, so the
 * view cannot answer when React then removes it. Resolves once the view is
 * disconnected.
 */
const tearDownView = (
  frame: HTMLIFrameElement,
  connection: ViewConnection,
): Promise<void> => {
  const disconnected = connection.disconnect();
  const holder = document.createElement("div");
  if (!movesWithoutReload(holder) || !frame.isConnected) return disconnected;
  holder.setAttribute("inert", "");
  // Its width, so the view does not lay itself out anew while it ends.
  holder.style.cssText = `position:fixed;top:0;left:0;width:${frame.offsetWidth}px;height:0;overflow:hidden`;
  document.body.append(holder);
  holder.moveBefore(frame, null);
  return disconnected.finally(() => {
    holder.remove();
  });
};

/**
 * In place of a view that does not show, for a call that returned no files
 * to show instead: a line that says so.
 */
const NotShownNotice = () => (
  <p
    className="my-2 text-xs text-theme-fg-secondary"
    data-testid="mcp-app-view-not-shown"
  >
    {t({
      id: "trace.tool.appView.notShown",
      message: "The interactive view could not be shown.",
    })}
  </p>
);

/** A file the view asked to save, until the user decides. */
interface PendingDownload {
  file: ViewDownload;
  resolve: (saved: boolean) => void;
}

interface McpAppFrameProps {
  part: ToolUse;
  serverId: string;
  uri: string;
  onShown?: () => void;
  withFiles: boolean;
}

const McpAppFrame = ({
  part,
  serverId,
  uri,
  onShown,
  withFiles,
}: McpAppFrameProps) => {
  const { data, isError } = useGetMcpServerAppView(
    { pathParams: { serverId }, queryParams: { uri } },
    { staleTime: Infinity, retry: false },
  );
  const themeContext = useOptionalTheme();
  const theme = themeContext?.effectiveTheme ?? "light";
  const appTheme = themeContext?.theme;
  const { i18n } = useLingui();
  const locale = i18n.locale || undefined;
  const boxRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [initialized, setInitialized] = useState(false);
  // The height the view asked for last.
  const [reported, setReported] = useState<number>();
  // Initialized without asking for a height within VIEW_HEIGHT_TIMEOUT_MS.
  const [heightLate, setHeightLate] = useState(false);
  const [failed, setFailed] = useState(false);
  // Not started, as the frame tells or VIEW_START_TIMEOUT_MS: it may still
  // start.
  const [late, setLate] = useState(false);
  // Not shown within VIEW_PLACEHOLDER_DELAY_MS.
  const [slow, setSlow] = useState(false);
  // One file at a time: the view is told no for any other until then.
  const [download, setDownload] = useState<PendingDownload>();
  const pendingDownload = useRef<PendingDownload>(undefined);
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
  const meta = part.result_details?.view?.meta;
  const call = useRef({
    input: part.input,
    output: part.output,
    structuredContent,
    meta,
    hostContext,
    onShown,
  });
  call.current = {
    input: part.input,
    output: part.output,
    structuredContent,
    meta,
    hostContext,
    onShown,
  };
  const connection = useRef<ViewConnection>(undefined);
  // What React adds and removes in place of the frame, which a teardown may
  // take out while the view ends.
  const slotRef = useRef<HTMLDivElement>(null);
  // The last teardown, which ends before the frame shows a view again.
  const tornDown = useRef<Promise<void>>(undefined);

  // Out of sight until the view has initialized and asked for a height, or
  // taken too long to: a view that never initializes stays out of sight, and
  // the call's files show as they always have.
  const shown = initialized && (reported !== undefined || heightLate);
  const unavailable = isError || (data !== undefined && !pageUrl) || failed;
  // The view cannot be fetched, is not to be shown or has not started: the
  // call's files show instead, and without files a line says so.
  const notShown = unavailable || (late && !shown);
  const heightKey = useMemo(
    () => ({ callId: part.tool_call_id, serverId, uri, width }),
    [part.tool_call_id, serverId, uri, width],
  );
  // The height the view had last time: its frame starts at it, and its place
  // is kept for it until it shows.
  const remembered = useMemo(
    () => rememberedViewHeight(heightKey),
    [heightKey],
  );
  // Never 0px while out of sight, so that the browser renders the view, which
  // measures itself, as it would in sight.
  const startHeight = remembered ?? DEFAULT_VIEW_HEIGHT;
  const viewHeight = reported ?? startHeight;
  // Until the view shows, its place: its last height, else the placeholder's
  // once the view is slow; none once it has not shown.
  const keptHeight = notShown
    ? 0
    : (remembered ?? (slow ? DEFAULT_VIEW_HEIGHT : 0));
  const loading = !shown && !notShown;
  const boxHeight = shown ? viewHeight : keptHeight;

  // The width the view is given: the box is there before the view's frame.
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const measure = (next: number) => {
      if (next > 0) setWidth(Math.round(next));
    };
    measure(box.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => {
      measure(entry.contentRect.width);
    });
    observer.observe(box);
    return () => {
      observer.disconnect();
    };
  }, [unavailable]);

  // A placeholder stands in for a view slow to show, and a view that has not
  // started in time counts as not shown, when nothing has said so sooner.
  useEffect(() => {
    const placeholderTimer = setTimeout(() => {
      setSlow(true);
    }, VIEW_PLACEHOLDER_DELAY_MS);
    const startTimer = setTimeout(() => {
      setLate(true);
    }, VIEW_START_TIMEOUT_MS);
    return () => {
      clearTimeout(placeholderTimer);
      clearTimeout(startTimer);
    };
  }, []);

  useEffect(() => {
    if (!initialized || reported !== undefined) return;
    const heightTimer = setTimeout(() => {
      setHeightLate(true);
    }, VIEW_HEIGHT_TIMEOUT_MS);
    return () => {
      clearTimeout(heightTimer);
    };
  }, [initialized, reported]);

  useEffect(() => {
    if (shown) call.current.onShown?.();
  }, [shown]);

  useEffect(() => {
    if (shown) rememberViewHeight(heightKey, viewHeight);
  }, [shown, viewHeight, heightKey]);

  // A view that did not show gives up its place, now and next time.
  useEffect(() => {
    if (notShown) forgetViewHeight(heightKey);
  }, [notShown, heightKey]);

  // Before the browser paints, so a list that follows its bottom never shows
  // it moving.
  useLayoutEffect(() => {
    boxRef.current?.dispatchEvent(
      new Event(CONTENT_RESIZED_EVENT, { bubbles: true }),
    );
  }, [boxHeight, notShown]);

  /** The user decided on the file the view asked to save. */
  const settleDownload = (save: boolean) => {
    const pending = pendingDownload.current;
    if (!pending) return;
    pendingDownload.current = undefined;
    setDownload(undefined);
    // In the click's own handler, which lets the browser start a download.
    if (save) saveViewDownload(pending.file);
    pending.resolve(save);
  };

  // A layout effect, so that React runs its cleanup while the frame is still
  // in the page, and the view can be torn down there.
  useLayoutEffect(() => {
    const frame = frameRef.current;
    const slot = slotRef.current;
    if (!data || !pageUrl || !frame || !slot) return;
    // Run again (new inputs, or shown again by a Suspense boundary) while a
    // teardown has the frame: it comes back.
    if (frame.parentNode !== slot) {
      if (movesWithoutReload(slot) && frame.isConnected) {
        slot.moveBefore(frame, null);
      } else {
        slot.append(frame);
      }
    }
    let connected: ViewConnection | undefined;
    let cancelled = false;
    // Loaded with the first view, so the SDK stays out of the main bundle.
    Promise.all([
      // eslint-disable-next-line lingui/no-unlocalized-strings -- module path
      import("@/lib/mcpApps/viewHost"),
      tornDown.current,
    ])
      .then(([{ connectView }]) => {
        if (cancelled) return;
        const { input, output, structuredContent, meta, hostContext } =
          call.current;
        const csp: unknown = data.ui?.csp;
        connected = connectView(
          frame,
          pageUrl,
          {
            html: data.html,
            csp: isRecord(csp) ? csp : undefined,
            input: isRecord(input) ? input : {},
            result: toolResultOf(output, structuredContent, meta),
          },
          hostContext,
          {
            onInitialized: () => {
              setInitialized(true);
            },
            onHeight: setReported,
            onStalled: () => {
              setLate(true);
            },
            onDownload: (file) =>
              new Promise<boolean>((resolve) => {
                // One at a time, and none from a view being torn down.
                if (cancelled || pendingDownload.current) {
                  resolve(false);
                  return;
                }
                pendingDownload.current = { file, resolve };
                setDownload(pendingDownload.current);
              }),
          },
        );
        connection.current = connected;
      })
      .catch(() => {
        setFailed(true);
      });
    return () => {
      cancelled = true;
      pendingDownload.current?.resolve(false);
      pendingDownload.current = undefined;
      setDownload(undefined);
      if (connected) tornDown.current = tearDownView(frame, connected);
      if (connection.current === connected) connection.current = undefined;
    };
  }, [data, pageUrl]);

  // The width, theme or language changed: the view is told.
  useEffect(() => {
    connection.current?.setHostContext(hostContext);
  }, [hostContext]);

  const notice = notShown && !withFiles && <NotShownNotice />;
  if (unavailable) return notice || null;

  const toolName = shownToolName(part);
  const fileName = download?.file.name ?? "";
  return (
    <>
      {notice}
      <div
        ref={boxRef}
        data-testid="mcp-app-view-box"
        aria-busy={loading || undefined}
        className={clsx("relative", boxHeight > 0 && "my-2")}
        style={shown ? undefined : { height: keptHeight }}
      >
        {loading && slow && (
          <div
            aria-hidden
            data-testid="mcp-app-view-placeholder"
            className="absolute inset-0 animate-pulse rounded bg-theme-bg-accent motion-reduce:animate-none"
          />
        )}
        {data && pageUrl && (
          <div ref={slotRef} className="contents">
            <iframe
              ref={frameRef}
              data-testid="mcp-app-view"
              title={t({
                id: "trace.tool.appView.title",
                message: `Interactive view of ${toolName}`,
              })}
              // The spec's sandbox for the frame on the sandbox origin; the
              // page there gives the view's own frame no more than these.
              sandbox="allow-scripts allow-same-origin"
              // The sandbox page takes messages from, and sends them to, this
              // origin.
              referrerPolicy="origin"
              aria-hidden={!shown}
              // On the message's own background like its text: no frame,
              // padding or card around the view. Until it shows, laid over
              // its place, or what is above it, and transparent. The theme's
              // color scheme, which the sandbox page takes from the host
              // context too: where they differ, the browser paints an opaque
              // backdrop behind the page.
              className={clsx(
                "block w-full",
                !shown &&
                  "pointer-events-none absolute inset-x-0 bottom-0 opacity-0",
              )}
              style={{
                height: shown ? viewHeight : startHeight,
                colorScheme: theme,
              }}
            />
          </div>
        )}
      </div>
      <ConfirmationDialog
        isOpen={download !== undefined}
        onClose={() => {
          settleDownload(false);
        }}
        onConfirm={() => {
          settleDownload(true);
        }}
        title={t({
          id: "trace.tool.appView.download.title",
          message: `Save ${fileName}?`,
        })}
        message={t({
          id: "trace.tool.appView.download.message",
          message: `The interactive view of ${toolName} asks to save this file on your device.`,
        })}
        confirmButtonText={t({
          id: "trace.tool.appView.download.save",
          message: "Save",
        })}
      />
    </>
  );
};

export interface McpAppViewProps {
  part: ToolUse;
  /**
   * Called once the view shows: it has initialized and asked for a height,
   * or VIEW_HEIGHT_TIMEOUT_MS passed after it initialized without asking.
   */
  onShown?: () => void;
  /**
   * Whether the call returned files, which show when the view does not.
   * Without them, a line says the view could not be shown.
   */
  withFiles?: boolean;
}

/**
 * The interactive view (MCP Apps) a tool call names in
 * `result_details.view`, in a sandboxed frame from the server's sandbox
 * origin. Only the web app shows it; elsewhere nothing shows here and the
 * call's files stay as they are. Until it shows, its place is kept at the
 * height it last had, and a placeholder stands in for a view slow to show.
 * When the view cannot be fetched or does not start, or the server's view was
 * refused (`result_details.view_unavailable`), the call's files show as
 * before, and a call without files says that the view could not be shown.
 */
export const McpAppView = ({
  part,
  onShown,
  withFiles = false,
}: McpAppViewProps) => {
  if (getClientPlatform() !== "web") return null;
  const view = part.result_details?.view;
  if (!view) {
    return part.result_details?.view_unavailable && !withFiles ? (
      <NotShownNotice />
    ) : null;
  }
  return (
    <McpAppFrame
      part={part}
      serverId={view.server_id}
      uri={view.uri}
      onShown={onShown}
      withFiles={withFiles}
    />
  );
};
