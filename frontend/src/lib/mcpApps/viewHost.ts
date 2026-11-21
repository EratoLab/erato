import { JSONRPCMessageSchema } from "@modelcontextprotocol/core";
import { AppBridge } from "@modelcontextprotocol/ext-apps/app-bridge";

import { viewDownloadOf } from "./download";
import { MAX_VIEW_HEIGHT } from "./hostContext";

import type { ViewDownload } from "./download";
import type {
  CallToolResult,
  JSONRPCMessage,
  Transport,
} from "@modelcontextprotocol/client";
import type { McpUiHostContext } from "@modelcontextprotocol/ext-apps/app-bridge";

// eslint-disable-next-line lingui/no-unlocalized-strings -- protocol identity, not UI text
const HOST_INFO = { name: "Erato", version: "1.0.0" };

/* eslint-disable lingui/no-unlocalized-strings -- protocol methods */
const INITIALIZE = "ui/initialize";
const PROXY_READY = "ui/notifications/sandbox-proxy-ready";
/**
 * Not in the spec: the sandbox page sends it when the view's document has
 * loaded in its frame.
 */
const RESOURCE_LOADED = "ui/notifications/sandbox-resource-loaded";
/* eslint-enable lingui/no-unlocalized-strings */

/**
 * How long after the frame has loaded a page the page may take to announce
 * itself as the sandbox page (`sandbox-proxy-ready`). The sandbox page sends
 * it as it loads, but it can reach the app just after the frame's load event.
 */
export const PAGE_READY_GRACE_MS = 1_000;

/**
 * How long after the view's document has loaded the view may take to send
 * its `ui/initialize`.
 */
export const VIEW_INITIALIZE_GRACE_MS = 5_000;

/**
 * The SDK's `PostMessageTransport`, bound to the frame both ways: it takes
 * messages only from the frame's window on the sandbox origin and posts only
 * to that origin, so a frame that navigated elsewhere is neither heard nor
 * told anything.
 */
class SandboxFrameTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  /** Sees every message the frame sends, before the bridge does. */
  onreceive?: (message: JSONRPCMessage) => void;

  private readonly frame: HTMLIFrameElement;
  private readonly origin: string;

  constructor(frame: HTMLIFrameElement, origin: string) {
    this.frame = frame;
    this.origin = origin;
  }

  private readonly listener = (event: MessageEvent) => {
    if (
      event.source === null ||
      event.source !== this.frame.contentWindow ||
      event.origin !== this.origin
    ) {
      return;
    }
    const parsed = JSONRPCMessageSchema.safeParse(event.data);
    if (!parsed.success) return;
    this.onreceive?.(parsed.data);
    this.onmessage?.(parsed.data);
  };

  start() {
    window.addEventListener("message", this.listener);
    return Promise.resolve();
  }

  send(message: JSONRPCMessage) {
    this.frame.contentWindow?.postMessage(message, this.origin);
    return Promise.resolve();
  }

  close() {
    window.removeEventListener("message", this.listener);
    this.onclose?.();
    return Promise.resolve();
  }
}

export interface ViewCall {
  /** The view document, as the server serves it. */
  html: string;
  /**
   * The view's `_meta.ui.csp` as the server declared it; the sandbox page
   * keeps only well-formed domains.
   */
  csp?: Record<string, unknown>;
  /** The call's arguments. */
  input: Record<string, unknown>;
  /** The call's result. */
  result: CallToolResult;
}

export interface ViewConnection {
  /**
   * Hands the view a new host context. The view is told what changed once it
   * has initialized; before that, it gets the latest context right after its
   * handshake.
   */
  setHostContext: (hostContext: McpUiHostContext) => void;
  /** Disconnects the view. */
  disconnect: () => void;
}

export interface ViewEvents {
  /** The view finished its handshake and was sent the call. */
  onInitialized: () => void;
  /** The view asked for a new height, already capped. */
  onHeight: (height: number) => void;
  /**
   * The view asked to save `file`, already checked: resolves to whether the
   * user confirmed and it was saved.
   */
  onDownload: (file: ViewDownload) => Promise<boolean>;
  /**
   * The view has not started and gives no sign that it will: the frame
   * loaded a page that did not announce itself as the sandbox page within
   * `PAGE_READY_GRACE_MS` (another page or an error page, a page the browser
   * would not frame, or a sandbox page that refused to run), or the view's
   * document loaded and the view sent no `ui/initialize` within
   * `VIEW_INITIALIZE_GRACE_MS`. Said once at most, and never once the view
   * has initialized; a view that starts later still initializes.
   */
  onStalled: () => void;
}

/**
 * Shows a call's view in `frame`: loads the sandbox page at `sandboxPageUrl`
 * into it, hands it the view, answers the view's `ui/initialize` with
 * `hostContext`, then sends the call's input and result and follows the
 * view's size changes, and says early when the view stalls on its way there
 * (`events.onStalled`). Render-only but for saving a file: the bridge has no
 * MCP client and declares one capability, `downloadFile`. It answers
 * `ui/download-file` for a PNG or SVG the view holds, which the user
 * confirms in `events.onDownload`, with `isError` for any other file or when
 * the user declines. It drops the two requests the SDK answers on its own
 * (`ping` and `ui/request-display-mode`), so every other request the view
 * makes (tool calls, messages, links, and anything else) is refused with an
 * error.
 */
export function connectView(
  frame: HTMLIFrameElement,
  sandboxPageUrl: string,
  call: ViewCall,
  hostContext: McpUiHostContext,
  events: ViewEvents,
): ViewConnection {
  const bridge = new AppBridge(
    null,
    HOST_INFO,
    { downloadFile: {} },
    { hostContext },
  );
  bridge.removeRequestHandler("ping");
  // eslint-disable-next-line lingui/no-unlocalized-strings -- protocol method
  bridge.removeRequestHandler("ui/request-display-mode");
  bridge.ondownloadfile = async ({ contents }) => {
    const file = viewDownloadOf(contents);
    const saved = file !== undefined && (await events.onDownload(file));
    return saved ? {} : { isError: true };
  };
  let initialized = false;
  let closed = false;
  // A context handed over before the handshake, sent once it is done.
  let pending: McpUiHostContext | undefined;
  // What the view has shown of itself so far, for `events.onStalled`.
  let pageReady = false;
  let viewStarted = false;
  let stalled = false;
  /** Says the view stalled, unless `started` holds after `ms`. */
  const stallUnless = (started: () => boolean, ms: number) => {
    setTimeout(() => {
      if (closed || initialized || stalled || started()) return;
      stalled = true;
      events.onStalled();
    }, ms);
  };

  bridge.onsandboxready = () => {
    void bridge
      .sendSandboxResourceReady({ html: call.html, csp: call.csp })
      .catch(() => undefined);
  };
  bridge.oninitialized = () => {
    initialized = true;
    if (pending) bridge.setHostContext(pending);
    pending = undefined;
    events.onInitialized();
    void bridge
      .sendToolInput({ arguments: call.input })
      .then(() => bridge.sendToolResult(call.result))
      .catch(() => undefined);
  };
  bridge.onsizechange = ({ height }) => {
    if (height !== undefined) {
      events.onHeight(Math.min(Math.max(height, 0), MAX_VIEW_HEIGHT));
    }
  };

  const transport = new SandboxFrameTransport(
    frame,
    new URL(sandboxPageUrl).origin,
  );
  // As each message comes in, before the bridge handles it.
  transport.onreceive = (message) => {
    if (!("method" in message)) return;
    if (message.method === PROXY_READY) {
      pageReady = true;
    } else if (message.method === INITIALIZE) {
      viewStarted = true;
    } else if (message.method === RESOURCE_LOADED && !viewStarted) {
      stallUnless(() => viewStarted, VIEW_INITIALIZE_GRACE_MS);
    }
  };
  // Every page the frame loads once it is pointed at the sandbox page.
  const onPageLoad = () => {
    if (closed) {
      frame.removeEventListener("load", onPageLoad);
    } else if (!pageReady) {
      stallUnless(() => pageReady, PAGE_READY_GRACE_MS);
    }
  };
  void bridge
    .connect(transport)
    .then(() => {
      // Loaded only once the bridge listens, so the page's ready message is
      // never missed. A bridge that cannot connect leaves the frame empty,
      // and it stays out of sight.
      if (closed) return;
      frame.addEventListener("load", onPageLoad);
      frame.src = sandboxPageUrl;
    })
    .catch(() => undefined);

  return {
    setHostContext: (next) => {
      if (closed) return;
      // Sends only the fields that changed, as host-context-changed.
      if (initialized) bridge.setHostContext(next);
      else pending = next;
    },
    disconnect: () => {
      closed = true;
      if (initialized) {
        void bridge.teardownResource({}).catch(() => undefined);
      }
      void bridge.close();
    },
  };
}
