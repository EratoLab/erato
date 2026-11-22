import {
  Browser,
  BrowserContextOptions,
  expect,
  Locator,
  Page,
  test,
} from "@playwright/test";
import Sharp from "sharp";
import { chatIsReadyToChat, ensureOpenSidebar, login } from "./shared";
import { TAG_CI } from "./tags";

// The scenario's `mock_mcp_apps` server enables MCP Apps for the group of
// mcp-apps@example.com and mcp-apps-approval@example.com; `mock_mcp_apps_off`
// serves the same tools without it for mcp-apps-off@example.com.
const SANDBOX_PAGE =
  "https://mcp-apps.erato.internal:8443/public/common/mcp-apps-sandbox.html";

const selectMockModel = async (page: Page) => {
  const modelSelectorButton = page.locator(
    'button[aria-controls="model-selector-dropdown"]',
  );
  await expect(modelSelectorButton).toBeVisible();
  await modelSelectorButton.click();
  await page.getByRole("menuitem", { name: "Mock-LLM", exact: true }).click();
  await expect(modelSelectorButton).toContainText("Mock-LLM");
};

const createDexAuthenticatedContext = async (
  browser: Browser,
  email: string,
  options: BrowserContextOptions = {},
) => {
  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] },
    ...options,
  });
  const page = await context.newPage();

  await page.goto("/");
  await login(page, email);
  await chatIsReadyToChat(page);

  return { context, page };
};

/** Sends `prompt` to the mock LLM in a new chat. */
const sendPrompt = async (page: Page, prompt: string) => {
  await page.goto("/");
  await chatIsReadyToChat(page);
  await selectMockModel(page);

  const textbox = page.getByRole("textbox", { name: "Type a message..." });
  await expect(textbox).toBeVisible();
  await textbox.fill(prompt);
  await textbox.press("Enter");
};

/**
 * Asks the mock LLM to call `show_counter` with `start` 41, or with
 * `prompt` another tool of the apps server, and waits for the turn to end.
 */
const callCounterTool = async (
  page: Page,
  { prompt = "mcp apps counter", toolName = "show_counter" } = {},
) => {
  await sendPrompt(page, prompt);

  const latestAssistantMessage = page.getByTestId("message-assistant").last();
  await expect(latestAssistantMessage).toBeVisible({ timeout: 15000 });
  const toolCallCard = latestAssistantMessage.locator(
    `[data-testid="tool-call-item"][data-tool-name="${toolName}"]`,
  );
  await expect(toolCallCard).toHaveAttribute("data-tool-status", "success", {
    timeout: 15000,
  });
  await chatIsReadyToChat(page, {
    expectAssistantResponse: true,
    loadingTimeoutMs: 15000,
  });
  return latestAssistantMessage;
};

/** The counter the view shows, inside the sandbox page's frame. */
const viewCount = (message: Locator) =>
  message
    .frameLocator('[data-testid="mcp-app-view"]')
    .frameLocator("iframe")
    .locator("#count");

/**
 * The colour of the message just inside the view's frame, at its bottom
 * right where the counter view draws nothing, and just below the frame.
 */
const coloursInsideAndBelowView = async (message: Locator) => {
  const shot = await message.screenshot();
  const [messageBox, frameBox] = await Promise.all([
    message.boundingBox(),
    message.getByTestId("mcp-app-view").boundingBox(),
  ]);
  if (!messageBox || !frameBox) throw new Error("The view is not shown");
  const { data, info } = await Sharp(shot)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const scale = info.width / messageBox.width;
  const at = (x: number, y: number) => {
    const offset =
      (Math.round(y * scale) * info.width + Math.round(x * scale)) *
      info.channels;
    return [...data.subarray(offset, offset + 3)];
  };
  const right = frameBox.x - messageBox.x + frameBox.width - 4;
  const bottom = frameBox.y - messageBox.y + frameBox.height;
  return { inside: at(right, bottom - 4), below: at(right, bottom + 3) };
};

/** A domain a view may declare; the test answers its requests itself. */
const THIRD_PARTY = "https://third-party.example.net";

/**
 * A view that fetches the user's profile from the app, with the user's
 * cookies, and a file from the third-party domain, and writes what each fetch
 * got onto its root element.
 */
const probeView = (appOrigin: string) => `<!doctype html><script>
  const record = (name, url, credentials) =>
    fetch(url, { credentials })
      .then((response) => {
        document.documentElement.dataset[name] = String(response.status);
      })
      .catch(() => {
        document.documentElement.dataset[name] = "failed";
      });
  record("app", "${appOrigin}/api/v1beta/me/profile", "include");
  record("thirdParty", "${THIRD_PARTY}/data.json", "omit");
</script>`;

/**
 * A view that nests the sandbox page from its own origin and, as the app
 * would, asks it to show a view that may connect to the app and fetches the
 * user's profile from there. Its root element says "silent" if the nested
 * page has not answered within five seconds, or else what the fetch got. It
 * then fetches the profile through the nested frame's window, which the
 * view's policy would not cover if the frame had loaded, and says what it got.
 */
const nestingView = (appOrigin: string) => {
  const inner = `<script>
    fetch("${appOrigin}/api/v1beta/me/profile", { credentials: "include" })
      .then((response) => String(response.status), () => "failed")
      .then((app) => parent.postMessage({ app }, "*"));
  </script>`;
  // The query string sets the nested page's URL apart from the view's own,
  // which Firefox would take for a frame that loads itself and not load.
  return `<!doctype html><script>
  const root = document.documentElement;
  const nested = document.createElement("iframe");
  nested.src = "${SANDBOX_PAGE}?nested";
  window.addEventListener("message", ({ source, data }) => {
    if (source !== nested.contentWindow) return;
    if (data?.method === "ui/notifications/sandbox-proxy-ready") {
      root.dataset.nested = "ready";
      nested.contentWindow.postMessage({
        jsonrpc: "2.0",
        method: "ui/notifications/sandbox-resource-ready",
        params: {
          html: ${JSON.stringify(inner).replace(/<\//g, "<\\/")},
          csp: { connectDomains: ["${appOrigin}"] },
        },
      }, "*");
    } else if (typeof data?.app === "string") {
      root.dataset.nested = data.app;
    }
  });
  root.appendChild(nested);
  // A timer, not the frame's load event, which Firefox does not fire for a
  // frame the policy blocks.
  setTimeout(() => {
    if (!root.dataset.nested) root.dataset.nested = "silent";
    let through;
    try {
      through = nested.contentWindow
        .fetch("${appOrigin}/api/v1beta/me/profile", { credentials: "include" })
        .then((response) => String(response.status), () => "failed");
    } catch {
      through = Promise.resolve("failed");
    }
    through.then((status) => {
      root.dataset.through = status;
    });
  }, 5000);
</script>`;
};

/** Has the app get `html` with `csp` as the view of the next tool call. */
const replaceView = (page: Page, html: string, csp: Record<string, string[]>) =>
  page.route("**/api/v1beta/me/mcp_servers/*/app_view*", async (route) => {
    const response = await route.fetch();
    const view = (await response.json()) as Record<string, unknown>;
    await route.fulfill({ json: { ...view, html, ui: { csp } } });
  });

test(
  "An MCP Apps view renders in a sandboxed frame from the sandbox origin with the tool input, and again when the chat is reopened",
  { tag: TAG_CI },
  async ({ browser }) => {
    const { context, page } = await createDexAuthenticatedContext(
      browser,
      "mcp-apps@example.com",
    );
    try {
      const sandboxPage = page.waitForResponse(SANDBOX_PAGE);
      const message = await callCounterTool(page);

      const frame = message.getByTestId("mcp-app-view");
      await expect(frame).toBeVisible({ timeout: 15000 });
      await expect(frame).toHaveAttribute(
        "sandbox",
        "allow-scripts allow-same-origin",
      );
      await expect(frame).toHaveAttribute("src", SANDBOX_PAGE);
      await expect(viewCount(message)).toHaveText("41", { timeout: 15000 });
      // On the message's background like its text: no box around the view.
      await expect(frame).toHaveCSS("border-top-width", "0px");
      await expect(frame).toHaveCSS("padding-top", "0px");
      await expect(frame).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      // The backend serves the sandbox page keyed to its origin, and the
      // page never scrolls around the view.
      expect((await sandboxPage).headers()["origin-agent-cluster"]).toBe("?1");
      await expect(
        message.frameLocator('[data-testid="mcp-app-view"]').locator("html"),
      ).toHaveCSS("overflow-y", "hidden");

      await page.reload();
      await chatIsReadyToChat(page, { expectAssistantResponse: true });
      const reopened = page.getByTestId("message-assistant").last();
      await expect(reopened.getByTestId("mcp-app-view")).toBeVisible({
        timeout: 15000,
      });
      await expect(viewCount(reopened)).toHaveText("41", { timeout: 15000 });
    } finally {
      await context.close();
    }
  },
);

test(
  "A reopened chat shows its MCP Apps view again on every reload, never the sandbox page in the view's frame",
  { tag: TAG_CI },
  async ({ browser }) => {
    const { context, page } = await createDexAuthenticatedContext(
      browser,
      "mcp-apps@example.com",
    );
    try {
      const message = await callCounterTool(page);
      await expect(viewCount(message)).toHaveText("41", { timeout: 15000 });

      // The view's frame gets a name of its own on every load, so the
      // browser has no earlier frame to restore it to.
      const viewFrameName = (reopened: Locator) =>
        reopened
          .frameLocator('[data-testid="mcp-app-view"]')
          .locator("iframe")
          .getAttribute("name");
      const names = new Set([await viewFrameName(message)]);
      for (let reload = 1; reload <= 8; reload += 1) {
        await page.reload();
        await chatIsReadyToChat(page, { expectAssistantResponse: true });
        const reopened = page.getByTestId("message-assistant").last();
        await expect(viewCount(reopened), `reload ${reload}`).toHaveText("41", {
          timeout: 15000,
        });
        names.add(await viewFrameName(reopened));
      }
      expect(names.size).toBe(9);
    } finally {
      await context.close();
    }
  },
);

test(
  "An MCP Apps view shows again when its own frame reloads, never the sandbox page in the view's frame",
  { tag: TAG_CI },
  async ({ browser }) => {
    const { context, page } = await createDexAuthenticatedContext(
      browser,
      "mcp-apps@example.com",
    );
    // What the sandbox page throws where it refuses to run.
    const refusals: string[] = [];
    const recordRefusal = (text: string) => {
      if (text.includes("only runs in the frame")) refusals.push(text);
    };
    page.on("pageerror", (error) => recordRefusal(error.message));
    page.on("console", (entry) => recordRefusal(entry.text()));
    try {
      const message = await callCounterTool(page);
      await expect(viewCount(message)).toHaveText("41", { timeout: 15000 });

      const sandbox = message.frameLocator('[data-testid="mcp-app-view"]');
      const viewRoot = sandbox.frameLocator("iframe").locator("html");
      // Marks the view's document, which the reload replaces.
      await viewRoot.evaluate((root) => {
        root.dataset.reloaded = "no";
      });
      await sandbox.locator("iframe").evaluate((frame) => {
        (frame as HTMLIFrameElement).contentWindow?.location.reload();
      });

      await expect(viewRoot).not.toHaveAttribute("data-reloaded", "no", {
        timeout: 15000,
      });
      // The view initializes again and is sent the call once more.
      await expect(viewCount(message)).toHaveText("41", { timeout: 15000 });
      expect(refusals).toEqual([]);
    } finally {
      await context.close();
    }
  },
);

test(
  "An MCP Apps view receives ui/resource-teardown when the user leaves its chat, and its frame then leaves the page",
  { tag: TAG_CI },
  async ({ browser }) => {
    const { context, page } = await createDexAuthenticatedContext(
      browser,
      "mcp-apps@example.com",
    );
    // What the page and its frames log: the counter view logs its teardown.
    const logs: string[] = [];
    page.on("console", (entry) => logs.push(entry.text()));
    try {
      const message = await callCounterTool(page);
      await expect(viewCount(message)).toHaveText("41", { timeout: 15000 });

      // Only what is logged from here on: a new chat without a page load, so
      // the view's message leaves the page.
      logs.length = 0;
      await ensureOpenSidebar(page);
      await page
        .getByRole("complementary")
        .getByRole("link", { name: "New Chat", exact: true })
        .filter({ has: page.locator('[data-ui="sidebar-new-chat-item"]') })
        .click();
      await expect(page).toHaveURL(/\/chat\/new$/);

      await expect.poll(() => logs).toContain("mock-counter-view torn down");
      await expect(page.getByTestId("mcp-app-view")).toHaveCount(0);
    } finally {
      await context.close();
    }
  },
);

test(
  "An MCP Apps view shows again when the sandbox page reloads itself, which never takes itself for the app",
  { tag: TAG_CI },
  async ({ browser }) => {
    const { context, page } = await createDexAuthenticatedContext(
      browser,
      "mcp-apps@example.com",
    );
    const refusals: string[] = [];
    const recordRefusal = (text: string) => {
      if (/only runs in the frame|origin of the embedding app/.test(text)) {
        refusals.push(text);
      }
    };
    page.on("pageerror", (error) => recordRefusal(error.message));
    page.on("console", (entry) => recordRefusal(entry.text()));
    try {
      const message = await callCounterTool(page);
      await expect(viewCount(message)).toHaveText("41", { timeout: 15000 });

      const sandbox = message.frameLocator('[data-testid="mcp-app-view"]');
      const sandboxRoot = sandbox.locator("html");
      // Marks the sandbox page's document, which the reload replaces. A reload
      // the page starts itself sends its own URL as the referrer in Chromium.
      await sandboxRoot.evaluate((root) => {
        root.dataset.reloaded = "no";
        window.location.reload();
      });

      await expect(sandboxRoot).not.toHaveAttribute("data-reloaded", "no", {
        timeout: 15000,
      });
      // The page announces itself again and the app sends it the view anew.
      await expect(viewCount(message)).toHaveText("41", { timeout: 15000 });
      expect(refusals).toEqual([]);
    } finally {
      await context.close();
    }
  },
);

test(
  "A reopened chat keeps the place of its MCP Apps view at the view's height, with a placeholder while the view is slow to show",
  { tag: TAG_CI },
  async ({ browser }) => {
    const { context, page } = await createDexAuthenticatedContext(
      browser,
      "mcp-apps@example.com",
    );
    try {
      const message = await callCounterTool(page);
      await expect(viewCount(message)).toHaveText("41", { timeout: 15000 });
      const box = message.getByTestId("mcp-app-view-box");
      await expect(box).not.toHaveAttribute("aria-busy");
      const height = await box.evaluate(
        (element) => element.getBoundingClientRect().height,
      );
      expect(height).toBeGreaterThan(0);

      // The view is slow to arrive after the reload.
      await page.route(
        "**/api/v1beta/me/mcp_servers/*/app_view*",
        async (route) => {
          await new Promise((resolve) => setTimeout(resolve, 3000));
          await route.continue();
        },
      );
      await page.reload();
      const reopened = page.getByTestId("message-assistant").last();
      const keptBox = reopened.getByTestId("mcp-app-view-box");
      await expect(keptBox).toHaveAttribute("aria-busy", "true", {
        timeout: 15000,
      });
      const keptHeight = await keptBox.evaluate(
        (element) => element.getBoundingClientRect().height,
      );
      expect(Math.abs(keptHeight - height)).toBeLessThanOrEqual(1);
      await expect(
        reopened.getByTestId("mcp-app-view-placeholder"),
      ).toBeVisible();

      await expect(viewCount(reopened)).toHaveText("41", { timeout: 15000 });
      await expect(
        reopened.getByTestId("mcp-app-view-placeholder"),
      ).toHaveCount(0);
      await expect(keptBox).not.toHaveAttribute("aria-busy");
    } finally {
      await context.close();
    }
  },
);

test(
  "A step says within seconds that its MCP Apps view could not be shown when the sandbox origin does not serve the sandbox page",
  { tag: TAG_CI },
  async ({ browser }) => {
    const { context, page } = await createDexAuthenticatedContext(
      browser,
      "mcp-apps@example.com",
    );
    try {
      await page.route(SANDBOX_PAGE, (route) =>
        route.fulfill({
          status: 404,
          contentType: "text/plain",
          body: "Not found",
        }),
      );

      const message = await callCounterTool(page);

      // Long before the last fallback of 30 seconds.
      await expect(message.getByTestId("mcp-app-view-not-shown")).toBeVisible({
        timeout: 10000,
      });
      await expect(message.getByTestId("mcp-app-view-box")).toHaveCSS(
        "height",
        "0px",
      );
    } finally {
      await context.close();
    }
  },
);

test(
  "A step says within seconds that its MCP Apps view could not be shown when the view loads but never initializes",
  { tag: TAG_CI },
  async ({ browser }) => {
    const { context, page } = await createDexAuthenticatedContext(
      browser,
      "mcp-apps@example.com",
    );
    try {
      await replaceView(page, "<!doctype html><p>No handshake.</p>", {});

      const message = await callCounterTool(page);

      await expect(message.getByTestId("mcp-app-view-not-shown")).toBeVisible({
        timeout: 15000,
      });
      const view = message
        .frameLocator('[data-testid="mcp-app-view"]')
        .frameLocator("iframe")
        .locator("p");
      await expect(view).toHaveText("No handshake.");
    } finally {
      await context.close();
    }
  },
);

test(
  "In dark mode, an MCP Apps view sits on the message's background too, with no backdrop behind it",
  { tag: TAG_CI },
  async ({ browser }) => {
    // Dark from the system, and the app's own dark theme on a light system.
    const darkModes = [
      { colorScheme: "dark", appThemeMode: undefined },
      { colorScheme: "light", appThemeMode: "dark" },
    ] as const;
    for (const { colorScheme, appThemeMode } of darkModes) {
      const { context, page } = await createDexAuthenticatedContext(
        browser,
        "mcp-apps@example.com",
        { colorScheme },
      );
      try {
        if (appThemeMode) {
          await page.evaluate((mode) => {
            localStorage.setItem("theme-mode", mode);
          }, appThemeMode);
        }
        const message = await callCounterTool(page);
        await expect(page.locator("html")).toHaveAttribute(
          "data-theme",
          "dark",
        );
        await expect(viewCount(message)).toHaveText("41", { timeout: 15000 });

        const { inside, below } = await coloursInsideAndBelowView(message);
        expect(inside).toEqual(below);
      } finally {
        await context.close();
      }
    }
  },
);

test(
  "An MCP Apps view renders in the live turn when its call waited for approval",
  { tag: TAG_CI },
  async ({ browser }) => {
    // A user of its own: the tool stays on "ask" for this user, so the other
    // tests, which share theirs, never meet an approval card.
    const { context, page } = await createDexAuthenticatedContext(
      browser,
      "mcp-apps-approval@example.com",
    );
    try {
      const ask = await page.request.post(
        "/api/v1beta/me/mcp-tool-approval-settings",
        {
          data: {
            mcp_server_id: "mock_mcp_apps",
            tool_name: "show_counter",
            decision: "ask",
          },
        },
      );
      expect(ask.ok()).toBe(true);

      await sendPrompt(page, "mcp apps counter");
      const approval = page.getByTestId("mcp-tool-approval");
      await expect(approval).toBeVisible({ timeout: 15000 });
      await expect(approval).toHaveAttribute("data-tool-name", "show_counter");
      await page
        .getByRole("button", { name: "Allow once", exact: true })
        .click();

      // Without a reload.
      const message = page.getByTestId("message-assistant").last();
      await expect(message.getByTestId("mcp-app-view")).toBeVisible({
        timeout: 15000,
      });
      await expect(viewCount(message)).toHaveText("41", { timeout: 15000 });
    } finally {
      await context.close();
    }
  },
);

test(
  "Once a call's view renders, the call's files show as file chips instead of a second full image; without views the image shows",
  { tag: TAG_CI },
  async ({ browser }) => {
    const image = {
      prompt: "mcp apps image",
      toolName: "show_counter_with_image",
    };
    const { context, page } = await createDexAuthenticatedContext(
      browser,
      "mcp-apps@example.com",
    );
    try {
      const message = await callCounterTool(page, image);
      await expect(viewCount(message)).toHaveText("41", { timeout: 15000 });
      const chip = message.locator('[data-ui="attachment-tile"]');
      await expect(chip).toContainText("counter.png");
      await expect(
        message.getByRole("img", { name: "Message attachment" }),
      ).toHaveCount(0);

      // The chip opens the file.
      await chip.click();
      await expect(page.getByRole("dialog")).toBeVisible();
    } finally {
      await context.close();
    }

    const off = await createDexAuthenticatedContext(
      browser,
      "mcp-apps-off@example.com",
    );
    try {
      const message = await callCounterTool(off.page, image);
      await expect(
        message.getByRole("img", { name: "Message attachment" }),
      ).toBeVisible({ timeout: 15000 });
      await expect(message.locator('[data-ui="attachment-tile"]')).toHaveCount(
        0,
      );
    } finally {
      await off.context.close();
    }
  },
);

test(
  "An answer's image of the call's file shows as the same file chip once the call's view renders",
  { tag: TAG_CI },
  async ({ browser }) => {
    const { context, page } = await createDexAuthenticatedContext(
      browser,
      "mcp-apps@example.com",
    );
    try {
      const message = await callCounterTool(page, {
        prompt: "mcp apps image in answer",
        toolName: "show_counter_with_image",
      });
      await expect(viewCount(message)).toHaveText("41", { timeout: 15000 });
      await expect(message).toContainText("Here is the file:");
      // One chip under the view, one where the answer placed the image.
      const chips = message.locator('[data-ui="attachment-tile"]');
      await expect(chips).toHaveCount(2);
      await expect(chips.last()).toContainText("counter.png");
      await expect(
        message.getByRole("img", { name: "File", exact: true }),
      ).toHaveCount(0);
    } finally {
      await context.close();
    }
  },
);

test(
  "A view's policy drops every declared domain on the app's host, so the view cannot fetch from the app, and keeps a declared third-party domain",
  { tag: TAG_CI },
  async ({ browser }) => {
    const { context, page } = await createDexAuthenticatedContext(
      browser,
      "mcp-apps@example.com",
    );
    try {
      const appOrigin = new URL(page.url()).origin;
      const appHost = new URL(appOrigin).hostname;
      // The app's host with any scheme or port, a wildcard over it and a
      // network scheme on its own, beside the third party, in every list.
      const declared = [
        appOrigin,
        `http://${appHost}`,
        `wss://${appHost}:9443`,
        `${appHost}:*`,
        appHost.replace(/^[^.]+/, "*"),
        "*",
        "https:",
        THIRD_PARTY,
      ];
      await replaceView(page, probeView(appOrigin), {
        connectDomains: declared,
        resourceDomains: declared,
        frameDomains: declared,
        baseUriDomains: declared,
      });
      await page.route(`${THIRD_PARTY}/**`, (route) =>
        route.fulfill({
          json: {},
          headers: { "access-control-allow-origin": "*" },
        }),
      );

      const message = await callCounterTool(page);

      const sandbox = message.frameLocator('[data-testid="mcp-app-view"]');
      await expect(
        sandbox.locator('meta[http-equiv="Content-Security-Policy"]'),
      ).toHaveAttribute(
        "content",
        [
          "default-src 'none'",
          `script-src 'self' 'unsafe-inline' ${THIRD_PARTY}`,
          `style-src 'self' 'unsafe-inline' ${THIRD_PARTY}`,
          `img-src 'self' data: ${THIRD_PARTY}`,
          `font-src 'self' ${THIRD_PARTY}`,
          `media-src 'self' data: ${THIRD_PARTY}`,
          `connect-src ${THIRD_PARTY}`,
          `frame-src ${THIRD_PARTY}`,
          "object-src 'none'",
          `base-uri ${THIRD_PARTY}`,
          "form-action 'none'",
        ].join("; "),
        { timeout: 15000 },
      );
      const view = sandbox.frameLocator("iframe").locator("html");
      await expect(view).toHaveAttribute("data-third-party", "200", {
        timeout: 15000,
      });
      await expect(view).toHaveAttribute("data-app", "failed");
    } finally {
      await context.close();
    }
  },
);

test(
  "A view cannot frame its own sandbox origin, so it gets neither a policy of its making nor a page outside its policy to fetch from the app",
  { tag: TAG_CI },
  async ({ browser }) => {
    const { context, page } = await createDexAuthenticatedContext(
      browser,
      "mcp-apps@example.com",
    );
    try {
      const appOrigin = new URL(page.url()).origin;
      await replaceView(page, nestingView(appOrigin), {
        frameDomains: [new URL(SANDBOX_PAGE).origin],
      });

      const message = await callCounterTool(page);

      const view = message
        .frameLocator('[data-testid="mcp-app-view"]')
        .frameLocator("iframe")
        .locator("html");
      await expect(view).toHaveAttribute("data-nested", "silent", {
        timeout: 15000,
      });
      await expect(view).toHaveAttribute("data-through", "failed");
    } finally {
      await context.close();
    }
  },
);

test(
  "Without MCP Apps enabled for the server, the same tool call shows no view frame",
  { tag: TAG_CI },
  async ({ browser }) => {
    const { context, page } = await createDexAuthenticatedContext(
      browser,
      "mcp-apps-off@example.com",
    );
    try {
      const message = await callCounterTool(page);

      await expect(message).toContainText(
        "The secret content has been read successfully.",
      );
      await expect(page.getByTestId("mcp-app-view")).toHaveCount(0);
    } finally {
      await context.close();
    }
  },
);
