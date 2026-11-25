import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { StrictMode } from "react";
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
import { CONTENT_RESIZED_EVENT } from "@/hooks/useScrollToBottom";
import { setClientPlatform } from "@/lib/clientPlatform";
import { MAX_VIEW_DOWNLOAD_BYTES } from "@/lib/mcpApps/download";
import { viewStyleVariables } from "@/lib/mcpApps/hostContext";
import { resetViewHeightsForTests } from "@/lib/mcpApps/viewHeights";
import {
  PAGE_READY_GRACE_MS,
  VIEW_INITIALIZE_GRACE_MS,
  VIEW_TEARDOWN_TIMEOUT_MS,
} from "@/lib/mcpApps/viewHost";
import { messages as enMessages } from "@/locales/en/messages.json";
import { installHostShell, removeHostShell } from "@/test/hostShellStub";

import {
  McpAppView,
  VIEW_HEIGHT_TIMEOUT_MS,
  VIEW_PLACEHOLDER_DELAY_MS,
  VIEW_START_TIMEOUT_MS,
} from "./McpAppView";

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
  meta?: Record<string, unknown>,
  toolCallId = "call-1",
): ToolUse =>
  ({
    tool_call_id: toolCallId,
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
            meta,
          },
        }
      : undefined,
  }) as unknown as ToolUse;

/** A call whose view Erato refused or could not read. */
const refusedCall = (): ToolUse => ({
  ...call(false),
  result_details: { view_unavailable: true },
});

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
    withFiles,
    strict = false,
  }: {
    onShown?: () => void;
    withTheme?: boolean;
    withFiles?: boolean;
    /** In StrictMode, as the app runs, which runs effects twice on mount. */
    strict?: boolean;
  } = {},
) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = (
    <QueryClientProvider client={queryClient}>
      <McpAppView part={part} onShown={onShown} withFiles={withFiles} />
    </QueryClientProvider>
  );
  const tree = (
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
    </I18nProvider>
  );
  return {
    ...render(strict ? <StrictMode>{tree}</StrictMode> : tree),
    queryClient,
  };
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

const RESOURCE_LOADED = {
  jsonrpc: "2.0",
  method: "ui/notifications/sandbox-resource-loaded",
  params: {},
};

const sizeChanged = (height: number) => ({
  jsonrpc: "2.0",
  method: "ui/notifications/size-changed",
  params: { height },
});

/** Lets `ms` pass on the fake clock, with what each timer starts. */
const elapse = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

/** The height the views in these tests measure themselves at. */
const VIEW_HEIGHT = 240;

/**
 * What a view built with the MCP Apps SDK sends as it starts: its handshake,
 * then the height it measured.
 */
const startView = (
  fromFrame: (data: unknown) => void,
  height = VIEW_HEIGHT,
) => {
  fromFrame(PROXY_READY);
  fromFrame(initialize);
  fromFrame({ jsonrpc: "2.0", method: "ui/notifications/initialized" });
  fromFrame(sizeChanged(height));
};

/** The box that holds the view's place, and the placeholder in it. */
const viewBox = () => screen.getByTestId("mcp-app-view-box");
const placeholder = () => screen.queryByTestId("mcp-app-view-placeholder");
const notice = () => screen.queryByTestId("mcp-app-view-not-shown");

/** The first bytes of a PNG, as base64. */
const PNG_BASE64 = globalThis.btoa("\x89PNG\r\n\x1a\n");

/** A view's `ui/download-file` request for `resource`. */
const downloadRequest = (id: number, resource: Record<string, unknown>) => ({
  jsonrpc: "2.0",
  id,
  method: "ui/download-file",
  params: { contents: [{ type: "resource", resource }] },
});

/** The view, started, with the files it had saved and their bytes. */
const startedView = async () => {
  const view = await loadedFrame();
  startView(view.fromFrame);
  await waitFor(() => {
    expect(view.frame).toHaveAttribute("aria-hidden", "false");
  });
  const blobs: Blob[] = [];
  vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
    blobs.push(blob as Blob);
    return "blob:view-download";
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  const saved: { name: string; href: string }[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    saved.push({ name: this.download, href: this.href });
  });
  /** What the view was answered to its request `id`. */
  const answer = (id: number) =>
    view.sent().find((message) => message.id === id);
  return { ...view, saved, blobs, answer };
};

/**
 * Stands in for `Element.moveBefore`, which jsdom lacks. A browser keeps a
 * frame it moves this way loaded; jsdom moves it as `insertBefore` does and
 * gives it a new window, so the view answers from the frame's window as it
 * is then.
 */
const stubMoveBefore = () => {
  const moveBefore = vi.fn(function (
    this: Element,
    node: Node,
    child: Node | null,
  ) {
    this.insertBefore(node, child);
  });
  Object.defineProperty(Element.prototype, "moveBefore", {
    configurable: true,
    writable: true,
    value: moveBefore,
  });
  return moveBefore;
};

/**
 * Gives a frame out of the document no window, as a browser does. jsdom
 * keeps the window, and its `postMessage` throws.
 */
const dropWindowsOfRemovedFrames = () => {
  const contentWindow = Object.getOwnPropertyDescriptor(
    HTMLIFrameElement.prototype,
    "contentWindow",
  )?.get;
  if (!contentWindow) throw new Error("jsdom has no contentWindow getter.");
  Object.defineProperty(HTMLIFrameElement.prototype, "contentWindow", {
    configurable: true,
    get(this: HTMLIFrameElement) {
      return this.isConnected ? contentWindow.call(this) : null;
    },
  });
};

/** A message from the view, from the window its frame has now. */
const fromFrameNow = (frame: HTMLIFrameElement, data: unknown) => {
  window.dispatchEvent(
    new MessageEvent("message", {
      data,
      origin: SANDBOX_ORIGIN,
      source: frame.contentWindow,
    }),
  );
};

type LoadedFrame = Awaited<ReturnType<typeof loadedFrame>>;

/**
 * For each `ui/resource-teardown` the view is sent from now on: whether its
 * frame was then still in its place in the page.
 */
const framePlaceAtTeardown = (view: LoadedFrame) => {
  const inPlace: boolean[] = [];
  view.posted.mockImplementation((message: unknown) => {
    if ((message as { method?: unknown }).method === "ui/resource-teardown") {
      inPlace.push(
        view.frame.isConnected && view.frame.closest("[inert]") === null,
      );
    }
  });
  return inPlace;
};

const teardownOf = (view: LoadedFrame) =>
  view.sent().find((message) => message.method === "ui/resource-teardown");

describe("McpAppView", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeAll(() => {
    i18n.load("en", enMessages as unknown as Messages);
    i18n.activate("en");
    // Kept for the whole file: a teardown may time out after its test.
    dropWindowsOfRemovedFrames();
  });

  beforeEach(() => {
    fetchMock = vi.fn(() => Promise.resolve(json(viewResponse())));
    vi.stubGlobal("fetch", fetchMock);
    window.sessionStorage.clear();
    resetViewHeightsForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    Reflect.deleteProperty(Element.prototype, "moveBefore");
    document.querySelectorAll("[inert]").forEach((holder) => {
      holder.remove();
    });
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
    renderView(refusedCall());

    expect(screen.queryByTestId("mcp-app-view")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("mcp-app-view-not-shown"),
    ).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows nothing when the view cannot be fetched and the call's files show instead", async () => {
    fetchMock.mockResolvedValue(json({ message: "Bad gateway" }, 502));
    renderView(call(), { withFiles: true });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByTestId("mcp-app-view")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("mcp-app-view-not-shown"),
    ).not.toBeInTheDocument();
  });

  it("says the view could not be shown when it cannot be fetched and the call returned no files", async () => {
    fetchMock.mockResolvedValue(json({ message: "Bad gateway" }, 502));
    renderView(call());

    expect(
      await screen.findByTestId("mcp-app-view-not-shown"),
    ).toHaveTextContent("The interactive view could not be shown.");
    expect(screen.queryByTestId("mcp-app-view")).not.toBeInTheDocument();
  });

  it("says the view could not be shown when Erato refused it and the call returned no files, without fetching it", () => {
    const refused = refusedCall();
    const { unmount } = renderView(refused);

    expect(screen.getByTestId("mcp-app-view-not-shown")).toHaveTextContent(
      "The interactive view could not be shown.",
    );

    // With files, they show instead, as for a view that cannot be fetched.
    unmount();
    renderView(refused, { withFiles: true });
    expect(
      screen.queryByTestId("mcp-app-view-not-shown"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("mcp-app-view")).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("says the view could not be shown when it does not start in time, until it does", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderView(call());
    const { frame, fromFrame } = await loadedFrame();
    // The sandbox page runs, but the view's document never loads.
    fireEvent.load(frame);
    fromFrame(PROXY_READY);
    // Counted from when the view was placed, a moment before.
    await elapse(VIEW_START_TIMEOUT_MS - 1_000);
    expect(notice()).not.toBeInTheDocument();

    await elapse(1_000);
    expect(notice()).toBeInTheDocument();
    // Its place is given up, and its frame stays for a view that starts late.
    expect(viewBox().style.height).toBe("0px");
    expect(placeholder()).not.toBeInTheDocument();

    // A view that starts late still shows, and the line goes.
    startView(fromFrame);
    await waitFor(() => {
      expect(notice()).not.toBeInTheDocument();
    });
    expect(screen.getByTestId("mcp-app-view")).toHaveAttribute(
      "aria-hidden",
      "false",
    );
  });

  it("says at once that the view could not be shown when the frame loads a page that is not the sandbox page, until a view shows", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderView(call());
    const { frame, fromFrame } = await loadedFrame();

    // Another page, an error page or one the browser would not frame loads
    // without announcing itself.
    fireEvent.load(frame);
    await elapse(PAGE_READY_GRACE_MS - 1);
    expect(notice()).not.toBeInTheDocument();
    await elapse(1);
    expect(notice()).toBeInTheDocument();
    expect(viewBox().style.height).toBe("0px");

    startView(fromFrame);
    await waitFor(() => {
      expect(notice()).not.toBeInTheDocument();
    });
    expect(frame).toHaveAttribute("aria-hidden", "false");
  });

  it("waits for a sandbox page that announces itself only after its load event", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderView(call());
    const { frame, fromFrame } = await loadedFrame();

    fireEvent.load(frame);
    await elapse(PAGE_READY_GRACE_MS / 2);
    fromFrame(PROXY_READY);
    await elapse(VIEW_START_TIMEOUT_MS / 2);
    expect(notice()).not.toBeInTheDocument();
  });

  it("says that the view could not be shown when its document loads and it does not initialize, until it does", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderView(call());
    const { frame, fromFrame } = await loadedFrame();
    fromFrame(PROXY_READY);
    fireEvent.load(frame);
    fromFrame(RESOURCE_LOADED);

    await elapse(VIEW_INITIALIZE_GRACE_MS - 1);
    expect(notice()).not.toBeInTheDocument();
    await elapse(1);
    expect(notice()).toBeInTheDocument();

    startView(fromFrame);
    await waitFor(() => {
      expect(notice()).not.toBeInTheDocument();
    });
    expect(frame).toHaveAttribute("aria-hidden", "false");
  });

  it("does not hurry a view that has sent its ui/initialize when its document loads", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderView(call());
    const { fromFrame } = await loadedFrame();
    fromFrame(PROXY_READY);
    fromFrame(initialize);
    fromFrame(RESOURCE_LOADED);

    await elapse(VIEW_INITIALIZE_GRACE_MS * 2);
    expect(notice()).not.toBeInTheDocument();
  });

  it("holds the view's place with a placeholder once it is slow to show, until it shows at its height", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderView(call());
    const { frame, fromFrame } = await loadedFrame();
    // A fast view takes no place before it shows.
    expect(viewBox().style.height).toBe("0px");
    expect(viewBox()).toHaveAttribute("aria-busy", "true");
    expect(placeholder()).not.toBeInTheDocument();

    await elapse(VIEW_PLACEHOLDER_DELAY_MS);
    expect(placeholder()).toBeInTheDocument();
    expect(viewBox().style.height).toBe("150px");
    expect(frame).toHaveAttribute("aria-hidden", "true");

    // Its handshake is not enough: the view shows once it has a height.
    fromFrame(PROXY_READY);
    fromFrame(initialize);
    fromFrame({ jsonrpc: "2.0", method: "ui/notifications/initialized" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(placeholder()).toBeInTheDocument();

    fromFrame(sizeChanged(320));
    await waitFor(() => {
      expect(placeholder()).not.toBeInTheDocument();
    });
    expect(frame).toHaveAttribute("aria-hidden", "false");
    expect(frame.style.height).toBe("320px");
    expect(viewBox()).not.toHaveAttribute("aria-busy");
    expect(viewBox().style.height).toBe("");
  });

  it("shows a view that never asks for a height at the default height, and keeps its place next time", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const first = renderView(call());
    const { frame, sent, fromFrame } = await loadedFrame();
    fromFrame(PROXY_READY);
    fromFrame(initialize);
    fromFrame({ jsonrpc: "2.0", method: "ui/notifications/initialized" });
    // Initialized: it is sent the call.
    await waitFor(() => {
      expect(sent()).toContainEqual(
        expect.objectContaining({ method: "ui/notifications/tool-input" }),
      );
    });
    await elapse(VIEW_HEIGHT_TIMEOUT_MS - 100);
    expect(frame).toHaveAttribute("aria-hidden", "true");

    await elapse(200);
    expect(frame).toHaveAttribute("aria-hidden", "false");
    expect(frame.style.height).toBe("150px");
    first.unmount();

    renderView(call());
    expect(viewBox().style.height).toBe("150px");
  });

  it("starts a call's view at the height it showed at last, also after a reload, and a call of the same view at that width", async () => {
    const resize = stubResizeObserver();
    const first = renderView(call());
    resize(640);
    startView((await loadedFrame()).fromFrame, 320);
    await waitFor(() => {
      expect(screen.getByTestId("mcp-app-view").style.height).toBe("320px");
    });
    first.unmount();

    // As after a reload: the heights come from the tab's session storage.
    resetViewHeightsForTests();
    // Its place is kept before the view is fetched, without a placeholder.
    let answer: (response: Response) => void = () => undefined;
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        answer = resolve;
      }),
    );
    const again = renderView(call());
    expect(viewBox().style.height).toBe("320px");
    expect(placeholder()).not.toBeInTheDocument();
    answer(json(viewResponse()));
    const { frame } = await loadedFrame();
    // Its frame starts at that height, out of sight.
    expect(frame.style.height).toBe("320px");
    expect(frame).toHaveAttribute("aria-hidden", "true");
    again.unmount();

    // Another call of the server's view, at the same width.
    renderView(call(true, undefined, undefined, "call-2"));
    resize(650);
    await waitFor(() => {
      expect(viewBox().style.height).toBe("320px");
    });
  });

  it("gives up the place it kept for a view that does not show, now and next time", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const first = renderView(call());
    startView((await loadedFrame()).fromFrame, 320);
    await waitFor(() => {
      expect(screen.getByTestId("mcp-app-view").style.height).toBe("320px");
    });
    first.unmount();

    const again = renderView(call());
    const { frame } = await loadedFrame();
    expect(viewBox().style.height).toBe("320px");
    fireEvent.load(frame);
    await elapse(PAGE_READY_GRACE_MS);
    expect(notice()).toBeInTheDocument();
    expect(viewBox().style.height).toBe("0px");
    again.unmount();

    renderView(call());
    expect(viewBox().style.height).toBe("0px");
  });

  it("tells the list it sits in whenever the place it takes changes", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const heights: string[] = [];
    const record = (event: Event) => {
      heights.push((event.target as HTMLElement).style.height || "auto");
    };
    document.addEventListener(CONTENT_RESIZED_EVENT, record);
    try {
      renderView(call());
      const { frame, fromFrame } = await loadedFrame();
      await elapse(VIEW_PLACEHOLDER_DELAY_MS);
      startView(fromFrame, 320);
      await waitFor(() => {
        expect(frame).toHaveAttribute("aria-hidden", "false");
      });
      fromFrame(sizeChanged(400));
      await waitFor(() => {
        expect(frame.style.height).toBe("400px");
      });
      // Bubbling from the view's box: none, the placeholder's place, then
      // the view at each height it asks for.
      expect(heights).toEqual(["0px", "150px", "auto", "auto"]);
    } finally {
      document.removeEventListener(CONTENT_RESIZED_EVENT, record);
    }
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

  it("loads the sandbox page from the server's sandbox origin in a sandboxed frame, out of sight until the view shows", async () => {
    renderView(call());

    const { frame } = await loadedFrame();

    expect(String(fetchMock.mock.calls[0][0])).toContain(
      "/api/v1beta/me/mcp_servers/apps/app_view?uri=ui%3A%2F%2Fmock%2Fcounter",
    );
    expect(frame).toHaveAttribute("sandbox", "allow-scripts allow-same-origin");
    expect(frame).toHaveAttribute("referrerpolicy", "origin");
    expect(frame).toHaveAttribute("aria-hidden", "true");
    // Transparent and laid over what is above it, taking no place, at a
    // height at which the browser renders the view as it would in sight.
    expect(frame.className).toBe(
      "block w-full pointer-events-none absolute inset-x-0 bottom-0 opacity-0",
    );
    expect(frame.style.height).toBe("150px");
    expect(viewBox().style.height).toBe("0px");
    expect(frame).toHaveAttribute("title", "Interactive view of show_counter");
  });

  it("names the frame by the tool's own name when the model called it by a qualified one", async () => {
    renderView({
      ...call(),
      tool_name: "apps__show_counter",
      display: {
        title: "Counter",
        description_truncated: false,
        server_name: "Apps",
        tool_name: "show_counter",
      },
    });

    const { frame } = await loadedFrame();

    expect(frame).toHaveAttribute("title", "Interactive view of show_counter");
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
            hostCapabilities: { downloadFile: {} },
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
    // Out of sight until it asks for a height.
    expect(frame).toHaveAttribute("aria-hidden", "true");

    fromFrame(sizeChanged(320));
    await waitFor(() => {
      expect(frame.style.height).toBe("320px");
    });
    expect(frame).toHaveAttribute("aria-hidden", "false");
    // On the message's background: no border, padding or card around it.
    expect(frame.className).toBe("block w-full");
    expect(viewBox().className).toBe("relative my-2");

    fromFrame(sizeChanged(480));
    await waitFor(() => {
      expect(frame.style.height).toBe("480px");
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

  it("hands the view the result's _meta unchanged, as the server returned it", async () => {
    const meta = {
      "io.example/chart": { svg: "<svg/>", kind: "bar" },
      note: "for the view only",
    };
    renderView(call(true, { start: 41 }, meta));
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
            _meta: meta,
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

  it("says when the view shows, once it has initialized and asked for a height", async () => {
    const onShown = vi.fn();
    renderView(call(), { onShown });
    const { fromFrame } = await loadedFrame();
    fromFrame(PROXY_READY);
    fromFrame(initialize);
    fromFrame({ jsonrpc: "2.0", method: "ui/notifications/initialized" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onShown).not.toHaveBeenCalled();

    fromFrame(sizeChanged(320));
    await waitFor(() => {
      expect(onShown).toHaveBeenCalledTimes(1);
    });
    fromFrame(sizeChanged(400));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onShown).toHaveBeenCalledTimes(1);
  });

  it("refuses every request the view makes but a download", async () => {
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

  it("saves a PNG the view asks to download once the user confirms", async () => {
    renderView(call());
    const view = await startedView();

    view.fromFrame(
      downloadRequest(20, {
        uri: "ui://charts/Revenue%20by%20region.png",
        mimeType: "image/png",
        blob: PNG_BASE64,
      }),
    );
    expect(
      await screen.findByText("Save Revenue by region.png?"),
    ).toBeInTheDocument();
    // Nothing is saved, and the view is not answered, before the user decides.
    expect(view.saved).toEqual([]);
    expect(view.answer(20)).toBeUndefined();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(view.answer(20)).toMatchObject({ result: {} });
    });
    expect(view.answer(20)?.result).toEqual({});
    expect(view.saved).toEqual([
      { name: "Revenue by region.png", href: "blob:view-download" },
    ]);
    expect(view.blobs).toHaveLength(1);
    expect(view.blobs[0].size).toBe(8);
    expect(screen.queryByText("Save Revenue by region.png?")).toBeNull();
  });

  it("hands a file the view asks to save to a host app that offers files", async () => {
    const request = installHostShell({ files: 1 });
    try {
      renderView(call());
      const view = await startedView();

      view.fromFrame(
        downloadRequest(22, {
          uri: "ui://charts/Revenue%20by%20region.png",
          mimeType: "image/png",
          blob: PNG_BASE64,
        }),
      );
      fireEvent.click(await screen.findByRole("button", { name: "Save" }));

      await waitFor(() => {
        expect(request).toHaveBeenCalledExactlyOnceWith(
          "files.share",
          expect.objectContaining({
            fileName: "Revenue by region.png",
            data: PNG_BASE64,
          }),
        );
      });
      expect(view.saved).toEqual([]);
      await waitFor(() => {
        expect(view.answer(22)).toMatchObject({ result: {} });
      });
    } finally {
      removeHostShell();
    }
  });

  it("saves nothing and tells the view so when the user cancels", async () => {
    renderView(call());
    const view = await startedView();

    view.fromFrame(
      downloadRequest(21, {
        uri: "ui://charts/chart.svg",
        mimeType: "image/svg+xml",
        text: "<svg xmlns='http://www.w3.org/2000/svg'/>",
      }),
    );
    expect(await screen.findByText("Save chart.svg?")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(view.answer(21)).toMatchObject({ result: { isError: true } });
    });
    expect(view.saved).toEqual([]);
    expect(screen.queryByText("Save chart.svg?")).toBeNull();
  });

  it("refuses, without asking the user, a file of another type, one too large and one the app would have to fetch", async () => {
    renderView(call());
    const view = await startedView();

    view.fromFrame(
      downloadRequest(30, {
        uri: "ui://charts/chart.html",
        mimeType: "text/html",
        text: "<p>chart</p>",
      }),
    );
    view.fromFrame(
      downloadRequest(31, {
        uri: "ui://charts/chart.svg",
        mimeType: "image/svg+xml",
        text: "x".repeat(MAX_VIEW_DOWNLOAD_BYTES + 1),
      }),
    );
    view.fromFrame({
      jsonrpc: "2.0",
      id: 32,
      method: "ui/download-file",
      params: {
        contents: [
          {
            type: "resource_link",
            uri: "https://charts.example.com/chart.png",
            name: "chart.png",
            mimeType: "image/png",
          },
        ],
      },
    });

    await waitFor(() => {
      for (const id of [30, 31, 32]) {
        expect(view.answer(id)).toMatchObject({ result: { isError: true } });
      }
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(view.saved).toEqual([]);
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

  it("tells the view it is torn down while its frame is in the page, and keeps the frame loaded out of sight until the view answers", async () => {
    const moveBefore = stubMoveBefore();
    const { unmount } = renderView(call(), { strict: true });
    const view = await startedView();
    const inPlace = framePlaceAtTeardown(view);

    unmount();

    const teardown = teardownOf(view);
    expect(teardown).toMatchObject({ jsonrpc: "2.0", params: {} });
    expect(inPlace).toEqual([true]);
    // Moved out of the message, which React has removed, but still in the
    // page, inert, and out of sight...
    expect(moveBefore).toHaveBeenCalledWith(view.frame, null);
    expect(view.frame.isConnected).toBe(true);
    const holder = view.frame.closest<HTMLElement>("[inert]");
    expect(holder?.style.height).toBe("0px");
    expect(holder?.style.overflow).toBe("hidden");

    // ...until the view answers.
    fromFrameNow(view.frame, { jsonrpc: "2.0", id: teardown?.id, result: {} });
    await waitFor(() => {
      expect(view.frame.isConnected).toBe(false);
    });
    expect(document.querySelector("[inert]")).toBeNull();
  });

  it("removes the frame of a view that does not answer its teardown in time", async () => {
    stubMoveBefore();
    const { unmount } = renderView(call());
    const view = await startedView();
    vi.useFakeTimers();
    try {
      unmount();
      expect(teardownOf(view)).toBeDefined();

      await vi.advanceTimersByTimeAsync(VIEW_TEARDOWN_TIMEOUT_MS - 1);
      expect(view.frame.isConnected).toBe(true);

      await vi.advanceTimersByTimeAsync(1);
      await vi.waitFor(() => {
        expect(view.frame.isConnected).toBe(false);
      });
      expect(document.querySelector("[inert]")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("removes the frame of a view that never initialized at once, without a teardown", async () => {
    stubMoveBefore();
    const { unmount } = renderView(call());
    const view = await loadedFrame();
    view.fromFrame(PROXY_READY);

    // No timer may run before the frame is gone.
    vi.useFakeTimers();
    try {
      unmount();
      await vi.advanceTimersByTimeAsync(0);

      expect(view.frame.isConnected).toBe(false);
      expect(teardownOf(view)).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("sends the teardown while the frame is in the page and lets the frame go with the message where the browser cannot move a frame without reloading it", async () => {
    const { unmount } = renderView(call());
    const view = await startedView();
    const inPlace = framePlaceAtTeardown(view);

    unmount();

    expect(inPlace).toEqual([true]);
    // The frame goes with the message: the view cannot answer.
    expect(view.frame.isConnected).toBe(false);
  });

  it("tears the view down in its place when its view changes, and shows the new one in the same frame after the old one answered", async () => {
    const moveBefore = stubMoveBefore();
    const { queryClient } = renderView(call());
    const view = await startedView();
    const nextHtml = "<!doctype html><p>counter, again</p>";

    act(() => {
      queryClient.setQueriesData({}, () => viewResponse({ html: nextHtml }));
    });

    await waitFor(() => {
      expect(teardownOf(view)).toBeDefined();
    });
    const teardown = teardownOf(view);
    // Back in its place in the message, in the same commit: moved out to the
    // holder and back into its slot, both times without a reload.
    expect(screen.getByTestId("mcp-app-view")).toBe(view.frame);
    expect(view.frame.closest("[inert]")).toBeNull();
    expect(moveBefore).toHaveBeenCalledTimes(2);
    expect(moveBefore.mock.contexts[1]).toBe(view.frame.parentElement);
    expect(viewBox().contains(view.frame)).toBe(true);

    // The old view, which is being torn down, cannot ask to save a file.
    const tornDownWindow = view.frame.contentWindow;
    if (!tornDownWindow) throw new Error("The frame has no window.");
    const answeredLate = vi.spyOn(tornDownWindow, "postMessage");
    fromFrameNow(
      view.frame,
      downloadRequest(40, {
        uri: "ui://charts/late.png",
        mimeType: "image/png",
        blob: PNG_BASE64,
      }),
    );
    await waitFor(() => {
      expect(answeredLate).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 40,
          result: expect.objectContaining({ isError: true }),
        }),
        SANDBOX_ORIGIN,
      );
    });
    expect(screen.queryByText("Save late.png?")).toBeNull();

    const answeredFrom = view.frame.contentWindow;
    fromFrameNow(view.frame, { jsonrpc: "2.0", id: teardown?.id, result: {} });
    // The new view loads the sandbox page anew, which in jsdom is a new
    // window, and is handed the new HTML.
    await waitFor(() => {
      expect(view.frame.contentWindow).not.toBe(answeredFrom);
    });
    const frameWindow = view.frame.contentWindow;
    if (!frameWindow) throw new Error("The frame has no window.");
    const posted = vi.spyOn(frameWindow, "postMessage");
    fromFrameNow(view.frame, PROXY_READY);
    await waitFor(() => {
      expect(posted).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "ui/notifications/sandbox-resource-ready",
          params: { html: nextHtml, csp: CSP },
        }),
        SANDBOX_ORIGIN,
      );
    });
  });

  it("tells a view that has initialized but not shown yet that it is torn down, while its frame is in its place behind the placeholder", async () => {
    stubMoveBefore();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { unmount } = renderView(call());
    const view = await loadedFrame();
    await elapse(VIEW_PLACEHOLDER_DELAY_MS);
    view.fromFrame(PROXY_READY);
    view.fromFrame(initialize);
    view.fromFrame({ jsonrpc: "2.0", method: "ui/notifications/initialized" });
    await waitFor(() => {
      expect(view.sent()).toContainEqual(
        expect.objectContaining({ method: "ui/notifications/tool-input" }),
      );
    });
    // Initialized, without a height yet: out of sight, its place held.
    expect(view.frame).toHaveAttribute("aria-hidden", "true");
    expect(placeholder()).toBeInTheDocument();
    expect(viewBox().contains(view.frame)).toBe(true);
    const inPlace = framePlaceAtTeardown(view);

    unmount();

    const teardown = teardownOf(view);
    expect(teardown).toMatchObject({ jsonrpc: "2.0", params: {} });
    expect(inPlace).toEqual([true]);
    expect(view.frame.isConnected).toBe(true);
    expect(view.frame.closest("[inert]")).not.toBeNull();

    fromFrameNow(view.frame, { jsonrpc: "2.0", id: teardown?.id, result: {} });
    await waitFor(() => {
      expect(view.frame.isConnected).toBe(false);
    });
    expect(document.querySelector("[inert]")).toBeNull();
  });
});
