import { Browser, expect, Locator, Page, test } from "@playwright/test";
import { chatIsReadyToChat, login } from "./shared";
import { TAG_CI } from "./tags";

// The scenario's `mock_mcp_apps` server enables MCP Apps for the group of
// mcp-apps@example.com; `mock_mcp_apps_off` serves the same tools without it
// for mcp-apps-off@example.com.
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
) => {
  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  });
  const page = await context.newPage();

  await page.goto("/");
  await login(page, email);
  await chatIsReadyToChat(page);

  return { context, page };
};

/** Asks the mock LLM to call `show_counter` with `start` 41. */
const callCounterTool = async (page: Page) => {
  await page.goto("/");
  await chatIsReadyToChat(page);
  await selectMockModel(page);

  const textbox = page.getByRole("textbox", { name: "Type a message..." });
  await expect(textbox).toBeVisible();
  await textbox.fill("mcp apps counter");
  await textbox.press("Enter");

  const latestAssistantMessage = page.getByTestId("message-assistant").last();
  await expect(latestAssistantMessage).toBeVisible({ timeout: 15000 });
  const toolCallCard = latestAssistantMessage.locator(
    `[data-testid="tool-call-item"][data-tool-name="show_counter"]`,
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
      const message = await callCounterTool(page);

      const frame = message.getByTestId("mcp-app-view");
      await expect(frame).toBeVisible({ timeout: 15000 });
      await expect(frame).toHaveAttribute(
        "sandbox",
        "allow-scripts allow-same-origin",
      );
      await expect(frame).toHaveAttribute("src", SANDBOX_PAGE);
      await expect(viewCount(message)).toHaveText("41", { timeout: 15000 });

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
