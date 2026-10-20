import { expect, test, type Page } from "@playwright/test";

import { chatIsReadyToChat, selectModel } from "./shared";
import { TAG_CI } from "./tags";

// Below 768 px the composer folds the file button and the Tools dropdown into
// one "+" menu, as the add-ins do; the selected tools then show as chips next
// to it instead of a count on +.
test.use({ viewport: { width: 760, height: 900 } });

type FacetsResponse = {
  facets?: Array<{ id: string; display_name?: string }>;
};

const firstFacet = async (page: Page) => {
  const response = await page.request.get("/api/v1beta/me/facets");
  expect(response.ok()).toBeTruthy();
  const facet = ((await response.json()) as FacetsResponse).facets?.[0];
  expect(facet, "the scenario offers at least one tool").toBeTruthy();
  return { id: facet!.id, name: facet!.display_name ?? facet!.id };
};

const messageBox = (page: Page) =>
  page.getByRole("textbox", { name: "Type a message..." });

test(
  "a tool picked from + is a chip that goes with the message and leaves with its (x)",
  { tag: TAG_CI },
  async ({ page }) => {
    test.setTimeout(90000);

    await page.goto("/");
    await chatIsReadyToChat(page);
    await selectModel(page, "Mock-LLM");
    const facet = await firstFacet(page);

    const bodies: Record<string, unknown>[] = [];
    await page.route(
      "**/api/v1beta/me/messages/submitstream",
      async (route) => {
        const postData = route.request().postData();
        if (postData) {
          bodies.push(JSON.parse(postData) as Record<string, unknown>);
        }
        await route.continue();
      },
    );

    await page.getByTestId("chat-input-add-menu-trigger").click();
    const item = page.getByTestId(`chat-input-add-menu-tool-${facet.id}`);
    await expect(item).toHaveAttribute("aria-checked", "false");
    await item.click();
    await expect(item).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);

    const controls = page.locator('[data-ui="chat-input-controls"]');
    const chip = controls.getByTestId(`selected-facet-${facet.id}`);
    await expect(
      controls.getByRole("group", { name: "Selected tools" }),
    ).toBeVisible();
    await expect(chip).toBeVisible();
    await expect(chip).toHaveAccessibleName(`Deselect ${facet.name}`);
    await expect(chip).toHaveAttribute("data-ui", "composer-tool-chip");
    await expect(page.getByTestId("chat-input-add-menu-badge")).toHaveCount(0);

    await messageBox(page).fill("First question");
    await messageBox(page).press("Enter");
    await chatIsReadyToChat(page, {
      expectAssistantResponse: true,
      loadingTimeoutMs: 30000,
    });
    expect(bodies).toHaveLength(1);
    expect(bodies[0].selected_facet_ids).toContain(facet.id);

    // The chip stays for the chat until the user takes it out.
    await expect(chip).toBeVisible();
    await chip.click();
    await expect(chip).toHaveCount(0);
    await expect(page.locator('[data-ui="composer-tool-live"]')).toHaveText(
      `${facet.name} deselected.`,
    );
    await expect(page.getByTestId("chat-input-add-menu-trigger")).toBeFocused();

    await messageBox(page).fill("Second question");
    await messageBox(page).press("Enter");
    await chatIsReadyToChat(page, { loadingTimeoutMs: 30000 });
    await expect(page.getByTestId("message-assistant")).toHaveCount(2);
    expect(bodies).toHaveLength(2);
    expect(bodies[1].selected_facet_ids ?? []).not.toContain(facet.id);
  },
);
