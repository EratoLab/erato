import { expect, test, type Page } from "@playwright/test";

import { TAG_NO_CI } from "./tags";

type FacetsResponse = {
  facets?: Array<{ id: string; display_name?: string }>;
  global_facet_settings?: {
    only_single_facet?: boolean;
    show_facet_indicator_with_display_name?: boolean;
  };
};

const buildAssistantName = (prefix: string) => {
  const randomSuffix = Math.floor(Math.random() * 16777215)
    .toString(16)
    .padStart(6, "0");
  return `${prefix}-${randomSuffix}`;
};

const getFacets = async (page: Page): Promise<FacetsResponse> => {
  const response = await page.request.get("/api/v1beta/me/facets");
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as FacetsResponse;
};

const createAssistantWithFacet = async (
  page: Page,
  assistantName: string,
  facet: { id: string; display_name?: string },
  options?: { enforceFacetSettings?: boolean },
) => {
  await page.goto("/assistants/new");

  await expect(
    page.getByRole("heading", { name: /create assistant/i }),
  ).toBeVisible();

  await page.getByLabel(/name/i).fill(assistantName);
  await page
    .getByLabel(/system prompt/i)
    .fill("You are a helpful assistant that relies on configured tools.");

  await page.locator('button[aria-controls="facet-selector-dropdown"]').click();
  await page
    .getByRole("menuitem", {
      name: facet.display_name ?? facet.id,
      exact: true,
    })
    .click();

  await expect(page.getByTestId(`selected-facet-${facet.id}`)).toBeVisible();

  if (options?.enforceFacetSettings) {
    await page
      .getByLabel(/lock tool selection in chats started from this assistant/i)
      .check();
  }

  await page.getByRole("button", { name: /create assistant/i }).click();
  await expect(page.getByText(/assistant created successfully/i)).toBeVisible({
    timeout: 5000,
  });
  await page.waitForURL("/assistants", { timeout: 5000 });
};

const openAssistantChat = async (page: Page, assistantName: string) => {
  const assistantButton = page.getByRole("button", {
    name: new RegExp(assistantName),
  });
  await expect(assistantButton).toBeVisible();
  await assistantButton.click();
  await expect(
    page.getByRole("textbox", { name: /type a message/i }),
  ).toBeVisible();
};

const getAssistantIdByName = async (
  page: Page,
  assistantName: string,
): Promise<string> => {
  const response = await page.request.get(
    "/api/v1beta/assistants?sharing_relation=owned_by_user",
  );
  expect(response.ok()).toBeTruthy();
  const assistants = (await response.json()) as Array<{
    id: string;
    name: string;
  }>;
  const assistant = assistants.find((item) => item.name === assistantName);
  expect(assistant).toBeDefined();
  return assistant!.id;
};

test.describe("Assistant facets", () => {
  // These tests are currently NO_CI because no E2E scenario with facet
  // configuration exists yet. Enable them in CI once such a scenario is added.
  test(
    "assistant facet defaults are applied to chats and remain editable by default",
    { tag: TAG_NO_CI },
    async ({ page }) => {
    const facetsResponse = await getFacets(page);
    const facet = facetsResponse.facets?.[0];
    expect(facet).toBeDefined();

    const assistantName = buildAssistantName("Assistant-facets-editable");
    await createAssistantWithFacet(page, assistantName, facet!);
    await openAssistantChat(page, assistantName);

    const selectedFacet = page.getByTestId(`selected-facet-${facet!.id}`);
    await expect(selectedFacet).toBeVisible();
    await expect(selectedFacet).toBeEnabled();

    await selectedFacet.click();
    await expect(selectedFacet).toHaveCount(0);
    },
  );

  test(
    "assistant facet enforcement locks facet selection in derived chats",
    { tag: TAG_NO_CI },
    async ({ page }) => {
    const facetsResponse = await getFacets(page);
    const facet = facetsResponse.facets?.[0];
    expect(facet).toBeDefined();

    const assistantName = buildAssistantName("Assistant-facets-locked");
    await createAssistantWithFacet(page, assistantName, facet!, {
      enforceFacetSettings: true,
    });
    await openAssistantChat(page, assistantName);

    await expect(page.getByTestId(`selected-facet-${facet!.id}`)).toBeDisabled();
    await expect(
      page.locator('button[aria-controls="facet-selector-dropdown"]'),
    ).toBeDisabled();
    },
  );

  test(
    "assistant edit handles removed configured facets gracefully",
    { tag: TAG_NO_CI },
    async ({ page }) => {
    const facetsResponse = await getFacets(page);
    const facet = facetsResponse.facets?.[0];
    expect(facet).toBeDefined();

    const assistantName = buildAssistantName("Assistant-facets-missing");
    await createAssistantWithFacet(page, assistantName, facet!);
    const assistantId = await getAssistantIdByName(page, assistantName);

    await page.route("**/api/v1beta/me/facets", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...facetsResponse,
          facets: (facetsResponse.facets ?? []).filter(
            (candidateFacet) => candidateFacet.id !== facet!.id,
          ),
        }),
      });
    });

    await page.goto(`/assistants/${assistantId}/edit`);

    await expect(
      page.getByText(
        /some previously configured tools are no longer available and were removed from this assistant/i,
      ),
    ).toBeVisible();

    await page.getByRole("button", { name: /save changes/i }).click();
    await expect(page.getByText(/assistant updated successfully/i)).toBeVisible(
      {
        timeout: 5000,
      },
    );
    },
  );
});
