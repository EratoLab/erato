import { expect, Page, Browser, test } from "@playwright/test";
import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const login = async (page: Page, email: string, password = "admin") => {
  await page.getByRole("button", { name: "Sign in with" }).click();
  await page.waitForURL((url) => url.pathname.includes("auth"));
  await page.getByRole("textbox", { name: "email address" }).fill(email);
  await page.getByRole("textbox", { name: "Password" }).fill(password);
  await page.getByRole("textbox", { name: "Password" }).press("Enter");
  await page.getByRole("button", { name: "Grant Access" }).click();
};

/**
 * Login via Azure Entra ID (Microsoft) authentication
 * This handles the Microsoft login flow which redirects to login.microsoftonline.com
 */
export const loginWithEntraId = async (
  page: Page,
  email: string,
  password: string,
) => {
  console.log(`[ENTRA_ID_LOGIN] Starting Entra ID login for: ${email}`);

  await page.getByRole("button", { name: "Sign in with" }).click();

  // Wait for redirect to Microsoft login page
  await page.waitForURL(
    (url) => url.hostname.includes("login.microsoftonline.com"),
    {
      timeout: 10000,
    },
  );
  console.log(`[ENTRA_ID_LOGIN] Redirected to Microsoft login page`);

  // Fill in email
  const emailInput = page.getByPlaceholder("Email, phone, or Skype");
  await emailInput.waitFor({ state: "visible", timeout: 10000 });
  await emailInput.fill(email);
  await emailInput.press("Enter");
  console.log(`[ENTRA_ID_LOGIN] Email submitted`);

  // Wait for password page and fill in password
  const passwordInput = page.getByPlaceholder("Password");
  await passwordInput.waitFor({ state: "visible", timeout: 10000 });
  await passwordInput.fill(password);
  await passwordInput.press("Enter");
  console.log(`[ENTRA_ID_LOGIN] Password submitted`);

  // Handle "Stay signed in?" prompt if it appears
  try {
    const staySignedInButton = page.getByRole("button", { name: "Yes" });
    await staySignedInButton.waitFor({ state: "visible", timeout: 5000 });
    await staySignedInButton.click();
    console.log(`[ENTRA_ID_LOGIN] Clicked 'Stay signed in' button`);
  } catch (e) {
    console.log(`[ENTRA_ID_LOGIN] No 'Stay signed in' prompt (this is okay)`);
  }

  // Wait for redirect back to the app
  await page.waitForURL(
    (url) => !url.hostname.includes("login.microsoftonline.com"),
    {
      timeout: 15000,
    },
  );
  console.log(`[ENTRA_ID_LOGIN] Redirected back to app, login complete`);
};

/**
 * Creates a new authenticated context for a different user
 * Use this when you need to test with a different user than the default admin@example.com
 */
export const createAuthenticatedContext = async (
  browser: Browser,
  email: string,
  password = "admin",
) => {
  // Create a fresh context without any stored authentication state
  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  });
  const page = await context.newPage();
  const chatTextbox = page.getByRole("textbox", { name: "Type a message..." });
  const localAuthUsername = email.split("@")[0];

  // Local nginx-jwt environments support direct auth via ?user=<username>.
  // Fall back to the interactive login flow for environments that use oauth.
  await page.goto(`/?user=${encodeURIComponent(localAuthUsername)}`);

  try {
    await expect(chatTextbox).toBeVisible({ timeout: 5000 });
    return { context, page };
  } catch {
    await page.goto("/");
    await login(page, email, password);
  }

  // Wait for successful login
  await expect(chatTextbox).toBeVisible();

  return { context, page };
};

export const chatIsReadyToChat = async (
  page: Page,
  args?: { expectAssistantResponse?: boolean; loadingTimeoutMs?: number },
) => {
  await test.step(`Wait for chat to be ready to Chat (either initial or to wait for finish message streaming)`, async () => {
    const textbox = page.getByRole("textbox", { name: "Type a message..." });
    // Expect that assistant message is visible during or after the stream
    if (args?.expectAssistantResponse) {
      await expect(page.getByTestId("message-assistant")).toBeVisible();
    }
    const loadingOpts = args?.loadingTimeoutMs
      ? { timeout: args?.loadingTimeoutMs }
      : {};
    await expect(page.getByText("Loading")).toHaveCount(0, loadingOpts);
    // Expect that assistant message is visible after the loading indicator has been removed (after stream finished)
    if (args?.expectAssistantResponse) {
      await expect(page.getByTestId("message-assistant")).toBeVisible();
    }
    await expect(textbox).toBeVisible();
    // The "Loading" text disappears as soon as any content has streamed in
    // (the loader is suppressed once content is present), so it does not mark
    // the end of a turn. The composer textarea no longer does either: since
    // ERMAIN-466 it stays enabled *while* a response streams (only Send/Enter
    // are blocked). The Stop button is present iff a turn is in flight
    // (isPendingResponse), so waiting for it to disappear is what now covers
    // the full streaming window — including multi-step tool calls, which stay
    // in a single pending turn. For the initial-ready call there is no turn in
    // flight, so it is already absent and this passes immediately.
    await expect(page.getByTestId("chat-input-stop-generation")).toHaveCount(
      0,
      loadingOpts,
    );
    // The textarea can still be disabled for non-streaming reasons (an upload
    // or recording in progress); keep guarding those.
    await expect(textbox).toBeEnabled(loadingOpts);
  });
};

/**
 * Select a specific model by display name from the model dropdown
 */
export const selectModel = async (page: Page, modelDisplayName: string) => {
  const modelSelector = page.locator(
    'button[aria-controls="model-selector-dropdown"]',
  );
  await modelSelector.click();

  const menu = page.locator("#model-selector-dropdown");
  await expect(menu).toBeVisible();
  await menu
    .getByRole("menuitem", { name: modelDisplayName, exact: true })
    .click();

  // Wait a moment for the selection to take effect
  await page.waitForTimeout(500);
};

export const ensureOpenSidebar = async (page: Page) => {
  const expandButton = page.getByLabel("expand sidebar");
  if (await expandButton.isVisible()) {
    await expandButton.click();
  }
};

/**
 * Install a browser-side abort hook that can cancel active streaming requests.
 * Intended for resilience tests that interrupt submitstream/resumestream.
 */
export const setupStreamingRequestAbortHook = async (page: Page) => {
  page.on("console", (message) => {
    if (message.text().includes("STREAM_ABORT_TEST_BROWSER")) {
      console.log(message.text());
    }
  });

  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    const streamingControllers: AbortController[] = [];

    const isStreamingUrl = (url: string): boolean =>
      url.includes("/api/v1beta/me/messages/submitstream") ||
      url.includes("/api/v1beta/me/messages/resumestream");

    (
      window as Window & {
        __abortActiveStreamRequest?: () => void;
      }
    ).__abortActiveStreamRequest = () => {
      console.log(
        `[STREAM_ABORT_TEST_BROWSER] aborting ${streamingControllers.length} active stream request(s)`,
      );
      while (streamingControllers.length > 0) {
        const controller = streamingControllers.pop();
        controller?.abort();
      }
    };

    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      if (!isStreamingUrl(url)) {
        return originalFetch(input, init);
      }

      const abortController = new AbortController();
      const callerSignal = init?.signal;
      const combinedSignal =
        callerSignal && typeof AbortSignal.any === "function"
          ? AbortSignal.any([callerSignal, abortController.signal])
          : abortController.signal;

      streamingControllers.push(abortController);
      console.log(
        `[STREAM_ABORT_TEST_BROWSER] tracking stream request: ${url}`,
      );

      // Keep controller registered until test-triggered abort; this ensures we
      // can still cancel long-lived streaming responses after headers are received.
      return originalFetch(input, { ...init, signal: combinedSignal });
    };
  });
};

/**
 * Trigger cancellation of active streaming requests previously registered by
 * setupStreamingRequestAbortHook.
 */
export const abortActiveStreamingRequest = async (page: Page) => {
  console.log("[STREAM_ABORT_TEST] aborting active stream request");
  await page.evaluate(() => {
    (
      window as Window & {
        __abortActiveStreamRequest?: () => void;
      }
    ).__abortActiveStreamRequest?.();
  });
};

/**
 * Wait for Erato page to be properly loaded by checking for API_ROOT_URL.
 */
async function waitForEratoPageReady(page: Page): Promise<void> {
  // Wait until either API_ROOT_URL is set or [data-testid="message-list"] exists
  await Promise.race([
    page.waitForFunction(() => (window as any).API_ROOT_URL !== undefined, {
      timeout: 10000,
    }),
    page.getByTestId("message-list").waitFor({ timeout: 10000 }),
  ]);
}

/**
 * Check if the test is running against a k3d environment.
 * K3d environments expose the K3D_TEST_SCENARIO variable via window.
 */
async function isK3dEnvironment(page: Page): Promise<boolean> {
  try {
    const scenario = await page.evaluate(() => {
      return (window as any).K3D_TEST_SCENARIO;
    });
    return scenario !== undefined;
  } catch (error) {
    console.warn(`[K3D_SCENARIO] Error checking k3d environment: ${error}`);
    return false;
  }
}

/**
 * Get the currently deployed test scenario.
 * Returns null if not in a k3d environment or if the scenario is not set.
 */
async function getCurrentScenario(page: Page): Promise<string | null> {
  try {
    const scenario = await page.evaluate(() => {
      return (window as any).K3D_TEST_SCENARIO;
    });
    return scenario || null;
  } catch (error) {
    console.warn(`[K3D_SCENARIO] Error getting current scenario: ${error}`);
    return null;
  }
}

/**
 * Get scenario-specific data from the E2E scenario data server.
 * This endpoint is publicly accessible (bypasses oauth2-proxy) to allow
 * E2E tests to retrieve authentication credentials before logging in.
 *
 * Returns null if the data cannot be fetched or parsed.
 *
 * Example usage:
 * ```typescript
 * const scenarioData = await getScenarioData(page);
 * if (scenarioData?.entraid_user1_email) {
 *   await loginWithEntraId(page, scenarioData.entraid_user1_email, scenarioData.entraid_user1_password);
 * }
 * ```
 */
export async function getScenarioData(
  page: Page,
): Promise<Record<string, any> | null> {
  try {
    // Fetch scenario data from the public endpoint
    const response = await page.request.get(
      "/e2e-scenario-data/scenario-data.toml",
    );

    if (!response.ok()) {
      console.warn(
        `[SCENARIO_DATA] Failed to fetch scenario data: ${response.status()} ${response.statusText()}`,
      );
      return null;
    }

    const tomlContent = await response.text();

    // Parse TOML content - we need to extract the [frontend.additional_environment] section
    // and specifically the SCENARIO_DATA inline table
    const scenarioDataMatch = tomlContent.match(
      /SCENARIO_DATA\s*=\s*\{([^}]+)\}/,
    );

    if (!scenarioDataMatch) {
      console.warn(`[SCENARIO_DATA] No SCENARIO_DATA found in TOML content`);
      return null;
    }

    // Parse the inline table: { key1 = "value1", key2 = "value2" }
    const inlineTableContent = scenarioDataMatch[1];
    const data: Record<string, any> = {};

    const keyValuePairs = inlineTableContent.split(",");
    for (const pair of keyValuePairs) {
      const [key, value] = pair.split("=").map((s) => s.trim());
      if (key && value) {
        // Remove quotes from value
        data[key] = value.replace(/^["']|["']$/g, "");
      }
    }

    console.log(
      `[SCENARIO_DATA] Successfully fetched scenario data with ${Object.keys(data).length} keys`,
    );
    return data;
  } catch (error) {
    console.warn(`[SCENARIO_DATA] Error getting scenario data: ${error}`);
    return null;
  }
}

/**
 * Ensure the correct test scenario is deployed before running a test.
 * This function works independently of the current page state by creating
 * a temporary page to check and switch scenarios.
 *
 * If not in k3d, emits a warning that manual setup is required.
 * If in k3d but wrong scenario, switches to the required scenario.
 *
 * @param page - The Playwright page object (used to get browser context)
 * @param requiredScenario - The scenario that this test requires ('basic', 'tight-budget', 'assistants', 'many-models', or 'entra_id')
 */
export async function ensureTestScenario(
  page: Page,
  requiredScenario:
    | "basic"
    | "tight-budget"
    | "assistants"
    | "many-models"
    | "entra_id",
): Promise<void> {
  await test.step(`Ensure test scenario: ${requiredScenario}`, async () => {
    // Create a new page for scenario detection/switching, independent of current page state
    const context = page.context();
    const helperPage = await context.newPage();

    try {
      await test.step(`Navigate to Erato and check environment`, async () => {
        // Navigate to root and wait for Erato to be properly loaded
        await helperPage.goto("/");

        // Wait for Erato page to be ready (API_ROOT_URL should be present)
        await waitForEratoPageReady(helperPage);

        console.log(`[K3D_SCENARIO] Erato page loaded and ready`);
      });

      const isK3d = await isK3dEnvironment(helperPage);

      if (!isK3d) {
        console.warn(
          `[K3D_SCENARIO] ⚠️ Not running in k3d environment. ` +
            `Manual scenario setup required for: ${requiredScenario}`,
        );
        return;
      }

      const currentScenario = await getCurrentScenario(helperPage);

      if (currentScenario === requiredScenario) {
        console.log(
          `[K3D_SCENARIO] ✅ Already on scenario: ${requiredScenario}`,
        );
        return;
      }

      await test.step(`Switch from '${currentScenario}' to '${requiredScenario}'`, async () => {
        console.log(`[K3D_SCENARIO] 🔄 Switching scenarios...`);

        // Path to the switch-test-scenario script
        const scriptPath = path.resolve(
          __dirname,
          "../../infrastructure/scripts/switch-test-scenario",
        );

        try {
          // Run the switch script
          await test.step(`Run switch-test-scenario script`, async () => {
            const output = execSync(
              `${scriptPath} --scenario ${requiredScenario}`,
              {
                encoding: "utf-8",
                stdio: "pipe",
                timeout: 120000, // 2 minute timeout
              },
            );

            console.log(`[K3D_SCENARIO] Script output:\n${output}`);
          });

          // Wait for the scenario to actually switch by polling
          await test.step(`Wait for scenario switch to take effect`, async () => {
            const maxWaitTime = 120000; // 2 minutes
            const pollInterval = 2000; // 2 seconds
            const startTime = Date.now();

            while (Date.now() - startTime < maxWaitTime) {
              // Reload the helper page to get fresh environment variables
              await helperPage.reload();
              await waitForEratoPageReady(helperPage);

              // Check if scenario has changed
              const newScenario = await getCurrentScenario(helperPage);

              if (newScenario === requiredScenario) {
                console.log(
                  `[K3D_SCENARIO] ✅ Successfully switched to: ${requiredScenario}`,
                );
                return;
              }

              console.log(
                `[K3D_SCENARIO] ⏳ Waiting for scenario switch... ` +
                  `Current: ${newScenario}, Target: ${requiredScenario}`,
              );

              await helperPage.waitForTimeout(pollInterval);
            }

            throw new Error(
              `Timeout: Scenario did not switch to '${requiredScenario}' within ${maxWaitTime}ms`,
            );
          });
        } catch (error) {
          console.error(
            `[K3D_SCENARIO] ❌ Failed to switch scenario: ${error}`,
          );
          throw error;
        }
      });
    } finally {
      // Always close the helper page when done
      await helperPage.close();
    }
  });
}

/**
 * Install a browser-side tap on the submitstream SSE response that can inject
 * a mid-stream `error` event (the same frame the backend emits when a provider
 * fails, see message_streaming.rs StreamingEvent::Error) and then end the
 * stream. Lets tests exercise the "turn errors mid-stream" path at an exact
 * moment, which no mock behaviour currently offers.
 *
 * The injected event runs the client's `case "error"` handler, which resets
 * the streaming state — so the stream end that follows is treated as a normal
 * close and does NOT trigger a resumestream that would revive the turn.
 */
export const installStreamErrorTap = async (page: Page) => {
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);

    const tapWindow = window as Window & {
      __injectStreamError?: () => void;
    };

    let pendingInjection: (() => void) | null = null;
    tapWindow.__injectStreamError = () => {
      pendingInjection?.();
    };

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      const response = await originalFetch(input, init);
      if (
        !url.includes("/api/v1beta/me/messages/submitstream") ||
        !response.body
      ) {
        return response;
      }

      const upstream = response.body.getReader();
      let injectRequested = false;
      let resolveInjectSignal: (() => void) | null = null;
      pendingInjection = () => {
        injectRequested = true;
        resolveInjectSignal?.();
      };

      const tapped = new ReadableStream<Uint8Array>({
        async pull(controller) {
          if (!injectRequested) {
            // Wake up either on the next upstream chunk or on injection, so
            // the error lands without waiting out a quiet stream.
            const read = upstream.read();
            const injectSignal = new Promise<void>((resolve) => {
              resolveInjectSignal = resolve;
            });
            const winner = await Promise.race([
              read.then((result) => ({ kind: "read" as const, result })),
              injectSignal.then(() => ({ kind: "inject" as const })),
            ]);
            resolveInjectSignal = null;
            if (winner.kind === "read") {
              if (winner.result.done) {
                controller.close();
                return;
              }
              controller.enqueue(winner.result.value);
              return;
            }
          }
          const frame = `event: error\ndata: ${JSON.stringify({
            message_type: "error",
            error_type: "internal_error",
            error_description: "Injected provider failure (e2e stream tap)",
          })}\n\n`;
          controller.enqueue(new TextEncoder().encode(frame));
          controller.close();
          void upstream.cancel().catch(() => {});
        },
        cancel(reason) {
          void upstream.cancel(reason).catch(() => {});
        },
      });

      return new Response(tapped, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    };
  });
};

/** Inject the tapped stream error installed by installStreamErrorTap. */
export const injectStreamError = async (page: Page) => {
  await page.evaluate(() => {
    (
      window as Window & { __injectStreamError?: () => void }
    ).__injectStreamError?.();
  });
};
