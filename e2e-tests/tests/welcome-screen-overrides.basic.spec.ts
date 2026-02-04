import { expect, test, type Page } from "@playwright/test";

const PROMPT_TEMPLATE = "What do you know about our products?";

const getFirstFacetId = async (page: Page) => {
  const response = await page.request.get("/api/v1beta/me/facets");
  if (!response.ok()) {
    return null;
  }
  const data = (await response.json()) as { facets?: Array<{ id: string }> };
  return data.facets?.[0]?.id ?? null;
};

test.describe("Chat welcome screen overrides", () => {
  test("shows default chat welcome screen behavior", async ({ page }) => {
    await page.goto("/");

    await expect(
      page.getByRole("textbox", { name: /type a message/i }),
    ).toBeVisible();

    await expect(page.getByTestId("welcome-screen-example")).toHaveCount(0);
  });

  test("shows override chat welcome screen with variant", async ({ page }) => {
    await page.addInitScript(() => {
      (
        window as Window & { __E2E_COMPONENT_VARIANT__?: string }
      ).__E2E_COMPONENT_VARIANT__ = "welcome-screen-example";
    });

    await page.goto("/");

    await expect(page.getByTestId("welcome-screen-example")).toBeVisible();
    await page.getByTestId("welcome-screen-template-button").click();
    await expect(
      page.getByRole("textbox", { name: /type a message/i }),
    ).toHaveValue(PROMPT_TEMPLATE);
    const facetId = await getFirstFacetId(page);
    if (!facetId) {
      test.skip(true, "No facets configured in this environment");
      return;
    }
    const resolvedFacetId = facetId;
    await page.evaluate((id) => {
      (window as Window & { __E2E_FACET_ID__?: string }).__E2E_FACET_ID__ = id;
    }, resolvedFacetId);
    await page.getByTestId("welcome-screen-tool-a-button").click();
    await expect(
      page.getByTestId(`selected-facet-${resolvedFacetId}`),
    ).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: /type a message/i }),
    ).toBeFocused();
  });
});
