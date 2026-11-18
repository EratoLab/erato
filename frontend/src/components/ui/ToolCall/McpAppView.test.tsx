import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { defaultTheme } from "@/config/theme";
import { browserTimeZone } from "@/hooks/profile/useClientLocaleReport";
import { setClientPlatform } from "@/lib/clientPlatform";
import { viewStyleVariables } from "@/lib/mcpApps/hostContext";
import { messages as enMessages } from "@/locales/en/messages.json";

import { McpAppView } from "./McpAppView";

import type {
  McpAppViewResponse,
  ToolUse,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Messages } from "@lingui/core";

const SANDBOX_ORIGIN = "https://sandbox.example.com";
const SANDBOX_PAGE = `${SANDBOX_ORIGIN}/public/common/mcp-apps-sandbox.html`;
const VIEW_HTML = "<!doctype html><p>counter</p>";
const CSP = { connectDomains: [], resourceDomains: [] };

const call = (
  withView = true,
  structuredContent?: Record<string, unknown>,
): ToolUse =>
  ({
    tool_call_id: "call-1",
    tool_name: "show_counter",
    status: "success",
    input: { start: 41 },
    output: "Counter started at 41.",
    result_details: withView
      ? {
          view: {
            server_id: "apps",
            uri: "ui://mock/counter",
            structured_content: structuredContent,
          },
        }
      : undefined,
  }) as unknown as ToolUse;

const viewResponse = (
  overrides: Partial<McpAppViewResponse> = {},
): McpAppViewResponse => ({
  uri: "ui://mock/counter",
  html: VIEW_HTML,
  ui: { csp: CSP, prefersBorder: true },
  sandbox_origin: SANDBOX_ORIGIN,
  ...overrides,
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const renderView = (
  part: ToolUse,
  {
    onShown,
    withTheme = false,
  }: { onShown?: () => void; withTheme?: boolean } = {},
) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = (
    <QueryClientProvider client={queryClient}>
      <McpAppView part={part} onShown={onShown} />
    </QueryClientProvider>
  );
  return render(
    <I18nProvider i18n={i18n}>
      {withTheme ? (
        <ThemeProvider
          enableCustomTheme={false}
          initialThemeMode="light"
          persistThemeMode={false}
        >
          {view}
        </ThemeProvider>
      ) : (
        view
      )}
    </I18nProvider>,
  );
};

/**
 * Stands in for the browser's ResizeObserver: `resize` reports a new width
 * for every observed frame.
 */
const stubResizeObserver = () => {
  const callbacks: ResizeObserverCallback[] = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeObserverCallback) {
        callbacks.push(callback);
      }
      observe() {
        // Reports only through `resize`.
      }
      unobserve() {
        // Nothing observed.
      }
      disconnect() {
        // Nothing observed.
      }
    },
  );
  return (width: number) => {
    act(() => {
      callbacks.forEach((callback) => {
        callback(
          [{ contentRect: { width } } as ResizeObserverEntry],
          {} as ResizeObserver,
        );
      });
    });
  };
};

/**
 * The frame once its sandbox page is loading, with what it is sent. The
 * window is read after `src` is set: unlike a browser, jsdom gives the frame
 * a new window when it navigates.
 */
const loadedFrame = async () => {
  const frame = await screen.findByTestId<HTMLIFrameElement>("mcp-app-view");
  await waitFor(() => {
    expect(frame).toHaveAttribute("src", SANDBOX_PAGE);
  });
  const frameWindow = frame.contentWindow;
  if (!frameWindow) throw new Error("The frame has no window.");
  const posted = vi.spyOn(frameWindow, "postMessage");
  const sent = () =>
    posted.mock.calls.map(([message]) => message as Record<string, unknown>);
  const fromFrame = (data: unknown, origin = SANDBOX_ORIGIN) => {
    window.dispatchEvent(
      new MessageEvent("message", { data, origin, source: frameWindow }),
    );
  };
  return { frame, posted, sent, fromFrame };
};

const PROXY_READY = {
  jsonrpc: "2.0",
  method: "ui/notifications/sandbox-proxy-ready",
  params: {},
};

const initialize = {
  jsonrpc: "2.0",
  id: 1,
  method: "ui/initialize",
  params: {
    protocolVersion: "2026-01-26",
    appCapabilities: {},
    appInfo: { name: "mock-counter", version: "1.0.0" },
  },
};

describe("McpAppView", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeAll(() => {
    i18n.load("en", enMessages as unknown as Messages);
    i18n.activate("en");
  });

  beforeEach(() => {
    fetchMock = vi.fn(() => Promise.resolve(json(viewResponse())));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setClientPlatform("web");
  });

  it("shows nothing for a call that names no view", () => {
    renderView(call(false));

    expect(screen.queryByTestId("mcp-app-view")).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows nothing outside the web app", () => {
    setClientPlatform("outlook");
    renderView(call());

    expect(screen.queryByTestId("mcp-app-view")).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows nothing when the view cannot be fetched", async () => {
    fetchMock.mockResolvedValue(json({ message: "Bad gateway" }, 502));
    renderView(call());

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    expect(screen.queryByTestId("mcp-app-view")).not.toBeInTheDocument();
  });

  it("never loads a view from the app's own origin", async () => {
    fetchMock.mockResolvedValue(
      json(viewResponse({ sandbox_origin: window.location.origin })),
    );
    renderView(call());

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    expect(screen.queryByTestId("mcp-app-view")).not.toBeInTheDocument();
  });

  it("loads the sandbox page from the server's sandbox origin in a sandboxed frame, hidden until the view initializes", async () => {
    renderView(call());

    const { frame } = await loadedFrame();

    expect(String(fetchMock.mock.calls[0][0])).toContain(
      "/api/v1beta/me/mcp_servers/apps/app_view?uri=ui%3A%2F%2Fmock%2Fcounter",
    );
    expect(frame).toHaveAttribute("sandbox", "allow-scripts allow-same-origin");
    expect(frame).toHaveAttribute("referrerpolicy", "origin");
    expect(frame).toHaveAttribute("aria-hidden", "true");
    expect(frame.style.height).toBe("0px");
  });

  it("hands the view its HTML and CSP, then the call's input and result, and follows its height", async () => {
    renderView(call());
    const { frame, posted, sent, fromFrame } = await loadedFrame();

    fromFrame(PROXY_READY);
    await waitFor(() => {
      expect(sent()).toContainEqual(
        expect.objectContaining({
          method: "ui/notifications/sandbox-resource-ready",
          params: { html: VIEW_HTML, csp: CSP },
        }),
      );
    });

    fromFrame(initialize);
    await waitFor(() => {
      expect(sent()).toContainEqual(
        expect.objectContaining({
          id: 1,
          result: expect.objectContaining({
            protocolVersion: "2026-01-26",
            hostCapabilities: {},
            hostContext: expect.objectContaining({
              theme: "light",
              displayMode: "inline",
              containerDimensions: { maxHeight: 6000 },
              locale: "en",
              timeZone: browserTimeZone(),
            }),
          }),
        }),
      );
    });
    expect(
      sent().some(
        (message) => message.method === "ui/notifications/tool-input",
      ),
    ).toBe(false);

    fromFrame({ jsonrpc: "2.0", method: "ui/notifications/initialized" });
    await waitFor(() => {
      expect(sent()).toContainEqual(
        expect.objectContaining({
          method: "ui/notifications/tool-result",
          params: {
            content: [{ type: "text", text: "Counter started at 41." }],
          },
        }),
      );
    });
    expect(sent()).toContainEqual(
      expect.objectContaining({
        method: "ui/notifications/tool-input",
        params: { arguments: { start: 41 } },
      }),
    );
    expect(frame).toHaveAttribute("aria-hidden", "false");
    expect(frame.style.height).toBe("150px");
    // On the message's background: no border, padding or card around it.
    expect(frame.className).toBe("block w-full my-2");

    fromFrame({
      jsonrpc: "2.0",
      method: "ui/notifications/size-changed",
      params: { height: 320 },
    });
    await waitFor(() => {
      expect(frame.style.height).toBe("320px");
    });

    // Everything goes to the sandbox origin only.
    expect(new Set(posted.mock.calls.map(([, origin]) => origin))).toEqual(
      new Set([SANDBOX_ORIGIN]),
    );
  });

  it("hands the view the result's structuredContent beside its text", async () => {
    renderView(call(true, { start: 41 }));
    const { sent, fromFrame } = await loadedFrame();
    fromFrame(PROXY_READY);
    fromFrame(initialize);
    fromFrame({ jsonrpc: "2.0", method: "ui/notifications/initialized" });

    await waitFor(() => {
      expect(sent()).toContainEqual(
        expect.objectContaining({
          method: "ui/notifications/tool-result",
          params: {
            content: [{ type: "text", text: "Counter started at 41." }],
            structuredContent: { start: 41 },
          },
        }),
      );
    });
  });

  it("tells the view the message column's width, the theme's colours and font, and every width it changes to", async () => {
    const resize = stubResizeObserver();
    renderView(call(), { withTheme: true });
    const { frame, sent, fromFrame } = await loadedFrame();
    // The theme's color scheme, which the sandbox page takes from the host
    // context: where they differ, the browser paints a backdrop.
    expect(frame.style.colorScheme).toBe("light");
    const contextChanges = () =>
      sent().filter(
        (message) => message.method === "ui/notifications/host-context-changed",
      );

    // Measured before the view's handshake: it gets the width right after it.
    resize(640);
    fromFrame(PROXY_READY);
    fromFrame(initialize);
    await waitFor(() => {
      expect(sent()).toContainEqual(
        expect.objectContaining({
          id: 1,
          result: expect.objectContaining({
            hostContext: expect.objectContaining({
              theme: "light",
              styles: { variables: viewStyleVariables(defaultTheme) },
              locale: "en",
            }),
          }),
        }),
      );
    });
    expect(contextChanges()).toEqual([]);

    fromFrame({ jsonrpc: "2.0", method: "ui/notifications/initialized" });
    await waitFor(() => {
      expect(contextChanges()).toEqual([
        expect.objectContaining({
          params: {
            containerDimensions: { width: 640, maxHeight: 6000 },
          },
        }),
      ]);
    });

    resize(480);
    await waitFor(() => {
      expect(contextChanges()).toHaveLength(2);
    });
    expect(contextChanges()[1]).toMatchObject({
      params: { containerDimensions: { width: 480, maxHeight: 6000 } },
    });

    // The same width again is nothing new.
    resize(480);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(contextChanges()).toHaveLength(2);
  });

  it("says when the view shows, once it has initialized", async () => {
    const onShown = vi.fn();
    renderView(call(), { onShown });
    const { fromFrame } = await loadedFrame();
    fromFrame(PROXY_READY);
    fromFrame(initialize);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onShown).not.toHaveBeenCalled();

    fromFrame({ jsonrpc: "2.0", method: "ui/notifications/initialized" });
    await waitFor(() => {
      expect(onShown).toHaveBeenCalledTimes(1);
    });
  });

  it("refuses every request the view makes", async () => {
    renderView(call());
    const { sent, fromFrame } = await loadedFrame();
    fromFrame(PROXY_READY);
    fromFrame(initialize);
    fromFrame({ jsonrpc: "2.0", method: "ui/notifications/initialized" });

    const requests = [
      { method: "tools/call", params: { name: "show_counter", arguments: {} } },
      { method: "ui/message", params: { role: "user", content: [] } },
      { method: "ui/open-link", params: { url: "https://example.com" } },
      { method: "ui/update-model-context", params: { content: [] } },
      { method: "resources/read", params: { uri: "ui://mock/counter" } },
      { method: "ui/download-file", params: { contents: [] } },
      // The two the SDK would answer on its own.
      { method: "ui/request-display-mode", params: { mode: "fullscreen" } },
      { method: "ping" },
      { method: "an/unknown-method", params: {} },
    ];
    requests.forEach((request, index) => {
      fromFrame({ jsonrpc: "2.0", id: 10 + index, ...request });
    });

    await waitFor(() => {
      for (const [index] of requests.entries()) {
        expect(sent()).toContainEqual(
          expect.objectContaining({
            id: 10 + index,
            error: expect.objectContaining({ code: -32601 }),
          }),
        );
      }
    });
  });

  it("ignores messages from the frame's window on another origin", async () => {
    renderView(call());
    const { sent, fromFrame } = await loadedFrame();

    fromFrame(PROXY_READY, "https://elsewhere.example.com");
    fromFrame(initialize, "https://elsewhere.example.com");
    // A message from the right origin afterwards is still answered.
    fromFrame(PROXY_READY);
    await waitFor(() => {
      expect(sent()).toHaveLength(1);
    });
    expect(sent()[0]).toMatchObject({
      method: "ui/notifications/sandbox-resource-ready",
    });
  });
});
