import { expect, test, type Locator, type Page } from "@playwright/test";

const SHELL = '[data-ui="chat-input-shell"]';
const PANE = '[data-ui="story-pane"]';
const ABOVE = '[data-ui="welcome-above"]';
const BELOW = '[data-ui="welcome-below"]';
const ADVISORY = '[data-ui="chat-usage-advisory"]';
const WELCOME_LOWER = '[data-testid="welcome-screen-lower"]';
const STARTER_PROMPTS = '[data-testid^="starter-prompt-"]';
const WELCOME_HEADING = "Welcome to AI Assistant";
const CONVERSATIONS_HEADING = "Your conversations with this assistant";
// Mirrors the seeded prompts in the story file.
const STARTER_SUBTITLES: Record<string, string> = {
  "starter-prompt-research_topic": "Find sources and summarise what they say",
  "starter-prompt-draft_email": "Write a first version you can edit",
  "starter-prompt-summarize_notes": "Turn raw notes into a short summary",
};
const COMPOSER_MAX_WIDTH = 896;

const storyUrl = (story: string) =>
  `/iframe.html?id=chat-emptystatelayout--${story}&viewMode=story`;

const openStory = async (
  page: Page,
  story: string,
  viewport: { width: number; height: number },
) => {
  await page.setViewportSize(viewport);
  await page.goto(storyUrl(story));
  // The first request compiles the story bundle; later ones are instant.
  await expect(page.locator(PANE)).toBeVisible({ timeout: 60_000 });
};

const box = async (locator: Locator) => {
  const rect = await locator.boundingBox();
  if (!rect) {
    throw new Error("element has no bounding box");
  }
  return {
    ...rect,
    centerY: rect.y + rect.height / 2,
    bottom: rect.y + rect.height,
    right: rect.x + rect.width,
  };
};

const expectShellOnMidline = async (page: Page, label: string) => {
  const shell = await box(page.locator(SHELL));
  const pane = await box(page.locator(PANE));
  const delta = shell.centerY - pane.centerY;
  console.log(
    `${label}: shell center ${shell.centerY.toFixed(1)}, pane center ${pane.centerY.toFixed(1)}, delta ${delta.toFixed(1)}px`,
  );
  expect(Math.abs(delta)).toBeLessThanOrEqual(2);
  return { shell, pane };
};

const expectInsidePane = async (page: Page) => {
  const shell = await box(page.locator(SHELL));
  const pane = await box(page.locator(PANE));
  expect(shell.y).toBeGreaterThanOrEqual(pane.y);
  expect(shell.bottom).toBeLessThanOrEqual(pane.bottom);
  expect(shell.x).toBeGreaterThanOrEqual(pane.x);
  expect(shell.right).toBeLessThanOrEqual(pane.right);
};

const scrollMetrics = (locator: Locator) =>
  locator.evaluate((element) => ({
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
    scrollTop: element.scrollTop,
  }));

test.describe("centered layout", () => {
  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 1280, height: 600 },
  ]) {
    test(`shell sits on the pane midline at ${viewport.width}x${viewport.height}`, async ({
      page,
    }) => {
      await openStory(page, "centered-default", viewport);
      await expect(page.locator(SHELL)).toBeVisible();
      await expectShellOnMidline(
        page,
        `centered-default ${viewport.width}x${viewport.height}`,
      );
    });
  }

  test("splits the welcome around the shell with the lower part under the advisory", async ({
    page,
  }) => {
    await openStory(page, "centered-default", { width: 1280, height: 800 });
    await expect(page.locator(SHELL)).toBeVisible();
    const { shell } = await expectShellOnMidline(
      page,
      "centered-default split 1280x800",
    );

    const heading = await box(
      page.getByRole("heading", { level: 1, name: WELCOME_HEADING }),
    );
    console.log(
      `heading bottom ${heading.bottom.toFixed(1)}, shell top ${shell.y.toFixed(1)}`,
    );
    expect(heading.bottom).toBeLessThanOrEqual(shell.y);

    const advisory = await box(page.locator(ADVISORY));
    const lower = await box(page.locator(WELCOME_LOWER));
    console.log(
      `advisory bottom ${advisory.bottom.toFixed(1)}, lower top ${lower.y.toFixed(1)}, lower width ${lower.width.toFixed(1)}`,
    );
    expect(lower.y).toBeGreaterThanOrEqual(advisory.bottom);
    expect(lower.width).toBeLessThanOrEqual(COMPOSER_MAX_WIDTH);
    expect(page.locator(BELOW).locator(WELCOME_LOWER)).toHaveCount(1);
    expect(page.locator(ABOVE).locator(WELCOME_LOWER)).toHaveCount(0);
  });

  test("starter prompts are compact buttons on the control radius with the subtitle as title", async ({
    page,
  }) => {
    await openStory(page, "centered-default", { width: 1280, height: 800 });
    const buttons = page.locator(STARTER_PROMPTS);
    await expect(buttons).toHaveCount(Object.keys(STARTER_SUBTITLES).length);

    for (const button of await buttons.all()) {
      const testId = await button.getAttribute("data-testid");
      const rect = await box(button);
      const radius = await button.evaluate(
        (element) => getComputedStyle(element).borderRadius,
      );
      const title = await button.getAttribute("title");
      console.log(
        `${testId}: height ${rect.height.toFixed(1)}, radius ${radius}, title "${title}"`,
      );
      expect(radius).toBe("8px");
      expect(rect.height).toBeGreaterThanOrEqual(36);
      expect(title).toBe(STARTER_SUBTITLES[testId ?? ""]);
    }
  });

  test("composer and welcome heading stay reachable on a phone viewport", async ({
    page,
  }) => {
    await openStory(page, "centered-default", { width: 390, height: 700 });
    await expect(page.locator(SHELL)).toBeVisible();
    await expectInsidePane(page);
    const shell = await box(page.locator(SHELL));
    console.log(
      `centered-default 390x700: shell y ${shell.y.toFixed(1)}..${shell.bottom.toFixed(1)}, x ${shell.x.toFixed(1)}..${shell.right.toFixed(1)}`,
    );
    await expect(
      page.getByRole("heading", { level: 1, name: WELCOME_HEADING }),
    ).toBeInViewport();
  });

  test("each half scrolls on its own without moving the shell", async ({
    page,
  }) => {
    await openStory(page, "centered-long-content", {
      width: 1280,
      height: 800,
    });
    await expect(page.locator(SHELL)).toBeVisible();
    const { shell: before } = await expectShellOnMidline(
      page,
      "centered-long-content 1280x800",
    );
    // A flex row that overflows shrinks fixed-height children unless they
    // opt out, which would fold the advisory to zero height.
    const advisory = await box(page.locator(ADVISORY));
    console.log(
      `advisory: top ${advisory.y.toFixed(1)}, height ${advisory.height.toFixed(1)}`,
    );
    expect(advisory.height).toBeGreaterThan(0);
    expect(advisory.y).toBeGreaterThanOrEqual(before.bottom);

    for (const [label, selector] of [
      ["above", ABOVE],
      ["below", BELOW],
    ] as const) {
      const row = page.locator(selector);
      const initial = await scrollMetrics(row);
      expect(initial.scrollHeight).toBeGreaterThan(initial.clientHeight);
      await row.evaluate((element) => {
        element.scrollTop = 200;
      });
      const scrolled = await scrollMetrics(row);
      console.log(
        `${label} row: scrollHeight ${initial.scrollHeight}, clientHeight ${initial.clientHeight}, scrollTop ${initial.scrollTop} -> ${scrolled.scrollTop}`,
      );
      expect(scrolled.scrollTop).not.toBe(initial.scrollTop);
      const after = await box(page.locator(SHELL));
      expect(Math.abs(after.centerY - before.centerY)).toBeLessThanOrEqual(1);
    }
  });

  test("a tall draft grows the composer around the midline", async ({
    page,
  }) => {
    await openStory(page, "centered-default", { width: 1280, height: 800 });
    const textbox = page.locator(`${SHELL} textarea`);
    await expect(textbox).toBeVisible();
    const before = await box(page.locator(SHELL));

    await textbox.fill(
      Array.from({ length: 12 }, (_, index) => `line ${index + 1}`).join("\n"),
    );
    await expect
      .poll(async () => (await box(page.locator(SHELL))).height)
      .toBeGreaterThan(before.height);

    const { shell } = await expectShellOnMidline(
      page,
      "centered-default after 12 lines",
    );
    console.log(
      `shell height ${before.height.toFixed(1)} -> ${shell.height.toFixed(1)}`,
    );
    await expectInsidePane(page);
  });

  test("read-only story renders the message and no composer", async ({
    page,
  }) => {
    await openStory(page, "centered-read-only", { width: 1280, height: 800 });
    await expect(page.getByText("Loading shared chat...")).toBeVisible();
    await expect(page.getByRole("textbox")).toHaveCount(0);
    await expect(page.locator(SHELL)).toHaveCount(0);
  });
});

test.describe("assistant welcome", () => {
  test("identity sits above the shell and conversations below it", async ({
    page,
  }) => {
    await openStory(page, "centered-assistant", { width: 1280, height: 800 });
    await expect(page.locator(SHELL)).toBeVisible();
    const { shell } = await expectShellOnMidline(
      page,
      "centered-assistant 1280x800",
    );

    const name = await box(
      page.getByRole("heading", { level: 1, name: "Research Assistant" }),
    );
    const conversations = await box(
      page.getByRole("heading", { level: 2, name: CONVERSATIONS_HEADING }),
    );
    console.log(
      `assistant name bottom ${name.bottom.toFixed(1)}, shell ${shell.y.toFixed(1)}..${shell.bottom.toFixed(1)}, conversations top ${conversations.y.toFixed(1)}`,
    );
    expect(name.bottom).toBeLessThanOrEqual(shell.y);
    expect(conversations.y).toBeGreaterThanOrEqual(shell.bottom);
    await expect(
      page.getByRole("tab", { name: "Delegated runs" }),
    ).toBeVisible();
    await expect(
      page.getByText("Start typing below to begin a new conversation"),
    ).toHaveCount(0);
  });
});

test.describe("legacy welcome override", () => {
  test("override renders whole above the shell and the below row holds only the advisory", async ({
    page,
  }) => {
    await openStory(page, "centered-legacy-override", {
      width: 1280,
      height: 800,
    });
    await expect(page.locator(SHELL)).toBeVisible();
    const override = page.locator('[data-testid="welcome-screen-example"]');
    await expect(override).toHaveCount(1);
    await expect(page.locator(ABOVE).locator(override)).toHaveCount(1);

    const below = page.locator(BELOW);
    const children = await below.evaluate((element) =>
      Array.from(element.children).map(
        (child) => child.getAttribute("data-ui") ?? child.tagName,
      ),
    );
    console.log(`below row children: ${JSON.stringify(children)}`);
    expect(children).toEqual(["chat-usage-advisory"]);
    await expect(page.locator(WELCOME_LOWER)).toHaveCount(0);
    await expect(page.locator(STARTER_PROMPTS)).toHaveCount(0);
  });
});

test.describe("bottom layout", () => {
  test("shell hugs the pane bottom with the welcome above it", async ({
    page,
  }) => {
    await openStory(page, "bottom-default", { width: 1280, height: 800 });
    await expect(page.locator(SHELL)).toBeVisible();
    const shell = await box(page.locator(SHELL));
    const pane = await box(page.locator(PANE));
    const gap = pane.bottom - shell.bottom;
    console.log(
      `bottom-default 1280x800: shell bottom ${shell.bottom.toFixed(1)}, pane bottom ${pane.bottom.toFixed(1)}, gap ${gap.toFixed(1)}px`,
    );
    expect(gap).toBeGreaterThanOrEqual(0);
    expect(gap).toBeLessThanOrEqual(80);

    const heading = page.getByRole("heading", {
      level: 1,
      name: WELCOME_HEADING,
    });
    await expect(heading).toBeInViewport();
    const headingBox = await box(heading);
    expect(headingBox.bottom).toBeLessThanOrEqual(shell.y);

    const lower = await box(page.locator(ABOVE).locator(WELCOME_LOWER));
    console.log(
      `bottom-default: lower part ${lower.y.toFixed(1)}..${lower.bottom.toFixed(1)}, shell top ${shell.y.toFixed(1)}`,
    );
    expect(lower.bottom).toBeLessThanOrEqual(shell.y);
    await expect(page.locator(BELOW).locator(WELCOME_LOWER)).toHaveCount(0);
    await expect(page.locator(STARTER_PROMPTS)).toHaveCount(3);
  });
});
