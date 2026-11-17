import { JSONRPCMessageSchema } from "@modelcontextprotocol/core";
import { AppBridge } from "@modelcontextprotocol/ext-apps/app-bridge";

import { MAX_VIEW_HEIGHT } from "./hostContext";

import type {
  CallToolResult,
  JSONRPCMessage,
  Transport,
} from "@modelcontextprotocol/client";
import type { McpUiHostContext } from "@modelcontextprotocol/ext-apps/app-bridge";

// eslint-disable-next-line lingui/no-unlocalized-strings -- protocol identity, not UI text
const HOST_INFO = { name: "Erato", version: "1.0.0" };

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
    if (parsed.success) this.onmessage?.(parsed.data);
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
}

/**
 * Shows a call's view in `frame`: loads the sandbox page at `sandboxPageUrl`
 * into it, hands it the view, answers the view's `ui/initialize` with
 * `hostContext`, then sends the call's input and result and follows the
 * view's size changes. Render-only: the bridge has no MCP client, declares no
 * capabilities and drops the two requests the SDK answers on its own (`ping`
 * and `ui/request-display-mode`), so every request the view makes (tool
 * calls, messages, links, and anything else) is refused with an error.
 */
export function connectView(
  frame: HTMLIFrameElement,
  sandboxPageUrl: string,
  call: ViewCall,
  hostContext: McpUiHostContext,
  events: ViewEvents,
): ViewConnection {
  const bridge = new AppBridge(null, HOST_INFO, {}, { hostContext });
  bridge.removeRequestHandler("ping");
  // eslint-disable-next-line lingui/no-unlocalized-strings -- protocol method
  bridge.removeRequestHandler("ui/request-display-mode");
  let initialized = false;
  let closed = false;
  // A context handed over before the handshake, sent once it is done.
  let pending: McpUiHostContext | undefined;

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
  void bridge
    .connect(transport)
    .then(() => {
      // Loaded only once the bridge listens, so the page's ready message is
      // never missed. A bridge that cannot connect leaves the frame empty,
      // and it stays out of sight.
      if (!closed) frame.src = sandboxPageUrl;
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
