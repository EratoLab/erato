import { test, expect, type Page } from "@playwright/test";

import { chatIsReadyToChat } from "./shared";
import {
  assertExpandedInvariants,
  assertSlimInvariants,
  assertStationaryTrajectory,
  collapseSidebar,
  ensureAChatExists,
  expandSidebar,
  expectAligned,
  forceSlimCollapsedMode,
  measureExpanded,
  measureRailWidth,
  measureSlim,
  recordToggleTrajectory,
  settleSidebar,
  setThemeVars,
  sidebarMode,
} from "./sidebarGeometry";
import { TAG_CI } from "./tags";

/**
 * Sidebar geometry contract (ERMAIN-608). Measurement helpers and invariant
 * definitions live in ./sidebarGeometry.ts:
 *
 * I1 expanded: nav rows, chat rows, section headers and the divider share one
 *    left inset; chat text, nav icons and section titles share one column;
 *    icon controls share the rail centerline; header band == footer band.
 * I2 slim: every rail item is centered on the rail.
 * I3 skeleton rows carry the same container inset + row padding as real rows.
 * I4 nav-row and chat-row hover surfaces have equal width (modulo the chat
 *    scroller's scrollbar gutter, which is measured, not guessed).
 * I5 rail-column: icons keep one x position across expanded/slim, so nothing
 *    moves horizontally while the width animates.
 */

test.describe("sidebar geometry contract", () => {
  test.beforeEach(async ({ page }) => {
    await forceSlimCollapsedMode(page);
  });

  test(
    "expanded columns, bands and hover surfaces align (I1, I4)",
    { tag: TAG_CI },
    async ({ page }) => {
      await page.goto("/");
      await chatIsReadyToChat(page);
      await ensureAChatExists(page);
      await expandSidebar(page);

      assertExpandedInvariants(
        await measureExpanded(page),
        await measureRailWidth(page),
      );
    },
  );

  test(
    "slim rail centers every item (I2)",
    { tag: TAG_CI },
    async ({ page }) => {
      await page.goto("/");
      await chatIsReadyToChat(page);
      await expandSidebar(page);
      await collapseSidebar(page);
      expect(await sidebarMode(page)).toBe("slim");

      assertSlimInvariants(await measureSlim(page));
    },
  );

  test(
    "icons do not move horizontally while the width animates (I5)",
    { tag: TAG_CI },
    async ({ page }) => {
      await page.goto("/");
      await chatIsReadyToChat(page);
      await expandSidebar(page);

      assertStationaryTrajectory(
        await recordToggleTrajectory(page, "collapse"),
      );
      expect(await sidebarMode(page)).toBe("slim");

      assertStationaryTrajectory(await recordToggleTrajectory(page, "expand"));
      expect(await sidebarMode(page)).toBe("expanded");
    },
  );

  test(
    "logo rail plate keeps bands equal and sections still (I1, I5)",
    { tag: TAG_CI },
    async ({ page }) => {
      // Runtime logo channel: the app resolves window.SIDEBAR_LOGO_PATH when
      // no build-time value is set, and the app serves its own favicon.
      await page.addInitScript(() => {
        (window as { SIDEBAR_LOGO_PATH?: string }).SIDEBAR_LOGO_PATH =
          "/favicon.svg";
      });
      await page.goto("/");
      await chatIsReadyToChat(page);
      await expandSidebar(page);

      const expanded = await measureExpanded(page);
      expectAligned(
        [expanded.headerHeight, expanded.footerHeight],
        "bands with a logo configured",
      );

      assertStationaryTrajectory(
        await recordToggleTrajectory(page, "collapse"),
      );
      expect(await sidebarMode(page)).toBe("slim");

      // The slim header hosts the logo plate; it must stay centered on the
      // rail and must not grow the band past the expanded state's height.
      const slim = await measureSlim(page);
      assertSlimInvariants(slim);
      await expect(
        page.locator('[data-ui="sidebar-header"] button img'),
      ).toBeVisible();
      expectAligned(
        [slim.headerHeight, expanded.headerHeight],
        "slim vs expanded header band with a logo",
      );

      assertStationaryTrajectory(await recordToggleTrajectory(page, "expand"));
    },
  );

  test(
    "skeleton rows share the real rows' inset and padding (I3)",
    { tag: TAG_CI },
    async ({ page }) => {
      // Hold the recent-chats response so the skeleton is observable.
      let releaseRecentChats = () => {};
      const held = new Promise<void>((resolve) => {
        releaseRecentChats = resolve;
      });
      await page.route("**/api/v1beta/me/recent_chats*", async (route) => {
        await held;
        await route.continue();
      });

      await page.goto("/");
      await expandSidebar(page);

      const skeletonRow = page
        .getByTestId("chat-history-skeleton-item")
        .first();
      await expect(skeletonRow).toBeVisible();
      const skeleton = await skeletonRow.evaluate((el) => {
        const aside = el.closest('[data-ui="sidebar"]')!;
        const asideRect = aside.getBoundingClientRect();
        const rect = el.getBoundingClientRect();
        return {
          left: Math.round((rect.x - asideRect.x) * 10) / 10,
          paddingLeft: parseFloat(getComputedStyle(el).paddingLeft),
        };
      });

      releaseRecentChats();
      await chatIsReadyToChat(page);
      await ensureAChatExists(page);
      const real = await measureExpanded(page);

      expectAligned(
        [skeleton.left, real.chatRows[0].left],
        "skeleton vs real row surface",
      );
      expectAligned(
        [skeleton.left + skeleton.paddingLeft, real.chatTitles[0].left],
        "skeleton vs real row text",
      );
    },
  );

  test(
    "token perturbations cannot break the contract (Stage 2)",
    { tag: TAG_CI },
    async ({ page }) => {
      await page.goto("/");
      await chatIsReadyToChat(page);
      await ensureAChatExists(page);
      await expandSidebar(page);

      const expandedPerturbations: Record<string, string>[] = [
        { "--theme-spacing-shell-compact-padding-x": "0.625rem" },
        { "--theme-spacing-shell-compact-padding-x": "1.5rem" },
        { "--theme-layout-sidebar-width": "22rem" },
        { "--theme-layout-sidebar-slim-width": "5rem" },
        { "--theme-spacing-control-min-height": "2rem" },
      ];
      for (const vars of expandedPerturbations) {
        await setThemeVars(page, vars);
        await test.step(`expanded with ${JSON.stringify(vars)}`, async () => {
          assertExpandedInvariants(
            await measureExpanded(page),
            await measureRailWidth(page),
          );
        });
        await setThemeVars(
          page,
          Object.fromEntries(Object.keys(vars).map((k) => [k, null])),
        );
      }

      await collapseSidebar(page);
      expect(await sidebarMode(page)).toBe("slim");

      const slimPerturbations: Record<string, string>[] = [
        { "--theme-layout-sidebar-slim-width": "5rem" },
        { "--theme-spacing-shell-compact-padding-x": "1.5rem" },
        { "--theme-spacing-control-min-height": "2rem" },
      ];
      for (const vars of slimPerturbations) {
        await setThemeVars(page, vars);
        await test.step(`slim with ${JSON.stringify(vars)}`, async () => {
          assertSlimInvariants(await measureSlim(page));
        });
        await setThemeVars(
          page,
          Object.fromEntries(Object.keys(vars).map((k) => [k, null])),
        );
      }
    },
  );

  test(
    "search page content margin follows the slim-width token",
    { tag: TAG_CI },
    async ({ page }) => {
      await page.goto("/search");
      await expect(page.locator('[data-ui="sidebar"]')).toBeVisible();
      await expandSidebar(page);
      await collapseSidebar(page);
      expect(await sidebarMode(page)).toBe("slim");

      const marginMatchesRail = () =>
        page.evaluate(() => {
          const aside = document.querySelector('[data-ui="sidebar"]')!;
          const shell = document.querySelector('[data-ui="page-shell"]')!;
          const railWidth = aside.getBoundingClientRect().width;
          // The content div is the page-shell child that is not the sidebar
          // wrapper; the fixed sidebar sits at viewport left, so the
          // content's viewport offset equals its margin.
          const contentEl = Array.from(shell.children).find(
            (el) => !el.contains(aside) && el !== aside,
          );
          if (!contentEl) throw new Error("content shell not found");
          const offset = contentEl.getBoundingClientRect().x;
          return { railWidth, offset };
        });

      const before = await marginMatchesRail();
      expect(Math.abs(before.offset - before.railWidth)).toBeLessThanOrEqual(
        0.5,
      );

      await setThemeVars(page, {
        "--theme-layout-sidebar-slim-width": "5rem",
      });
      const after = await marginMatchesRail();
      expect(after.railWidth).toBeCloseTo(80, 0);
      expect(Math.abs(after.offset - after.railWidth)).toBeLessThanOrEqual(0.5);
    },
  );
});

test.describe("sidebar resize", () => {
  test.beforeEach(async ({ page }) => {
    await forceSlimCollapsedMode(page);
  });

  const handle = (page: Page) =>
    page.getByRole("separator", { name: "Resize sidebar" });

  const asideWidth = (page: Page) =>
    page
      .locator('[data-ui="sidebar"]')
      .evaluate((el) => el.getBoundingClientRect().width);

  const dragHandleBy = async (page: Page, dx: number) => {
    const box = (await handle(page).boundingBox())!;
    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + dx, startY, { steps: 8 });
    await page.mouse.up();
  };

  test(
    "drag resizes and clamps; content margin follows; reload restores; double-click resets",
    { tag: TAG_CI },
    async ({ page }) => {
      await page.goto("/");
      await chatIsReadyToChat(page);
      await expandSidebar(page);

      const themeWidth = await asideWidth(page);
      await expect(handle(page)).toBeAttached();

      // Cursor: SVG data-URI with the ew-resize keyword fallback.
      const cursor = await handle(page).evaluate(
        (el) => getComputedStyle(el).cursor,
      );
      expect(cursor).toContain("ew-resize");

      // Drag right beyond the max: clamps at 2× the theme width.
      await dragHandleBy(page, themeWidth * 2);
      expect(await asideWidth(page)).toBeCloseTo(themeWidth * 2, 0);

      // Content margin follows the dragged width (the sidebar is fixed at
      // viewport left, so the content's viewport offset equals its margin).
      await settleSidebar(page);
      const margin = await page
        .locator('[data-ui="chat-conversation-dropzone"]')
        .evaluate((el) => el.getBoundingClientRect().x);
      expect(margin).toBeCloseTo(themeWidth * 2, 0);

      // Drag far left: clamps at the theme's own width.
      await dragHandleBy(page, -themeWidth * 3);
      expect(await asideWidth(page)).toBeCloseTo(themeWidth, 0);

      // A mid-range width persists across reload.
      await dragHandleBy(page, 120);
      const draggedWidth = await asideWidth(page);
      expect(draggedWidth).toBeCloseTo(themeWidth + 120, 0);
      await page.reload();
      await chatIsReadyToChat(page);
      await expandSidebar(page);
      // The persisted width applies via a mount effect and then animates,
      // so poll rather than sampling once.
      await expect.poll(() => asideWidth(page)).toBeCloseTo(draggedWidth, 0);

      // Keyboard: arrow keys resize in steps. Keyboard resizes animate, so
      // poll until the transition lands on the target width.
      await handle(page).focus();
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("ArrowRight");
      await expect
        .poll(() => asideWidth(page))
        .toBeCloseTo(draggedWidth + 32, 0);
      await page.keyboard.press("ArrowLeft");
      await expect
        .poll(() => asideWidth(page))
        .toBeCloseTo(draggedWidth + 16, 0);

      // Double-click resets to the theme width.
      await handle(page).dblclick();
      await settleSidebar(page);
      expect(await asideWidth(page)).toBeCloseTo(themeWidth, 0);

      // No handle on the slim rail.
      await collapseSidebar(page);
      await expect(handle(page)).toHaveCount(0);
    },
  );

  test(
    "expanded alignment still holds at maximum width",
    { tag: TAG_CI },
    async ({ page }) => {
      await page.goto("/");
      await chatIsReadyToChat(page);
      await ensureAChatExists(page);
      await expandSidebar(page);

      const themeWidth = await asideWidth(page);
      await dragHandleBy(page, themeWidth * 2);
      expect(await asideWidth(page)).toBeCloseTo(themeWidth * 2, 0);

      const m = await measureExpanded(page);
      assertExpandedInvariants(m, await measureRailWidth(page));
      expect(m.asideWidth).toBeCloseTo(themeWidth * 2, 0);
    },
  );
});
