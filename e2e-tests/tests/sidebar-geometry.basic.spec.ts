import { test, expect, type Page } from "@playwright/test";

import { chatIsReadyToChat, sendFirstMessage } from "./shared";
import { TAG_CI } from "./tags";

/**
 * Sidebar geometry contract (ERMAIN-608).
 *
 * The invariants are relational, not pixel-absolute: they must hold for ANY
 * theme-token values, so every stage re-asserts the same relations after
 * runtime token perturbation.
 *
 * I1 expanded: nav rows, chat rows, section headers and the divider share one
 *    left inset; chat text, nav icons and section titles share one column;
 *    the header toggle icon sits on that column; header band == footer band.
 * I2 slim: every rail item is centered on the rail.
 * I3 skeleton rows carry the same container inset + row padding as real rows.
 * I4 nav-row and chat-row hover surfaces have equal width (modulo the chat
 *    scroller's scrollbar gutter, which is measured, not guessed).
 */

/**
 * Wait until the sidebar's width has stopped changing (the width/margin
 * transitions run 300ms); a 150ms two-sample window inside the page avoids
 * a fixed sleep.
 */
const settleSidebar = async (page: Page) => {
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            new Promise<number>((resolve) => {
              const aside = document.querySelector('[data-ui="sidebar"]');
              if (!aside) {
                resolve(Number.NaN);
                return;
              }
              const before = aside.getBoundingClientRect().width;
              setTimeout(() => {
                resolve(Math.abs(aside.getBoundingClientRect().width - before));
              }, 150);
            }),
        ),
      { timeout: 5000 },
    )
    .toBeLessThan(0.1);
};

interface Box {
  left: number;
  right: number;
  width: number;
  center: number;
}

interface ExpandedMeasurement {
  asideWidth: number;
  headerHeight: number;
  footerHeight: number;
  headerIconBox: Box | null;
  navRows: Box[];
  navIcons: Box[];
  navLabels: Box[];
  sectionButtons: Box[];
  sectionTitles: Box[];
  divider: Box | null;
  chatRows: Box[];
  chatTitles: Box[];
  chatScrollbarWidth: number;
  footerTrigger: Box | null;
}

interface SlimMeasurement {
  asideWidth: number;
  railCenters: { label: string; center: number }[];
}

const forceSlimCollapsedMode = async (page: Page) => {
  await page.addInitScript(() => {
    (window as { SIDEBAR_COLLAPSED_MODE?: string }).SIDEBAR_COLLAPSED_MODE =
      "slim";
  });
};

const sidebarMode = (page: Page) =>
  page.locator('[data-ui="sidebar"]').getAttribute("data-sidebar-mode");

const expandSidebar = async (page: Page) => {
  await expect(page.locator('[data-ui="sidebar"]')).toBeVisible();
  if ((await sidebarMode(page)) !== "expanded") {
    await page.getByLabel("expand sidebar").click();
    await settleSidebar(page);
  }
  expect(await sidebarMode(page)).toBe("expanded");
};

const collapseSidebar = async (page: Page) => {
  await expect(page.locator('[data-ui="sidebar"]')).toBeVisible();
  if ((await sidebarMode(page)) === "expanded") {
    await page.getByLabel("collapse sidebar").click();
    await settleSidebar(page);
  }
};

/** At least one chat row must exist for the chat-column invariants. */
const ensureAChatExists = async (page: Page) => {
  if ((await page.locator('[data-ui="chat-history-item"]').count()) > 0) {
    return;
  }
  await sendFirstMessage(page, "Sidebar geometry probe chat");
  await chatIsReadyToChat(page, { expectAssistantResponse: true });
  await expect(
    page.locator('[data-ui="chat-history-item"]').first(),
  ).toBeVisible();
};

const setThemeVars = async (
  page: Page,
  vars: Record<string, string | null>,
) => {
  await page.evaluate((entries) => {
    for (const [name, value] of Object.entries(entries)) {
      if (value === null) {
        document.documentElement.style.removeProperty(name);
      } else {
        document.documentElement.style.setProperty(name, value);
      }
    }
  }, vars);
  await settleSidebar(page);
};

const measureExpanded = (page: Page): Promise<ExpandedMeasurement> =>
  page.evaluate(() => {
    const aside = document.querySelector('[data-ui="sidebar"]');
    if (!aside) throw new Error("sidebar not found");
    const asideRect = aside.getBoundingClientRect();
    const toBox = (el: Element | null | undefined) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const round = (v: number) => Math.round(v * 10) / 10;
      return {
        left: round(r.x - asideRect.x),
        right: round(r.x + r.width - asideRect.x),
        width: round(r.width),
        center: round(r.x + r.width / 2 - asideRect.x),
      };
    };
    const requireBoxes = (els: (Element | null)[]) =>
      els.filter((el): el is Element => el !== null).map((el) => toBox(el)!);

    // The nav "New Chat" item is a div (InteractiveContainer); untitled chat
    // rows can carry the same aria-label on their <a>, hence the tag prefix.
    const navRowEls = [
      'div[aria-label="New Chat"]',
      '[data-ui="sidebar-search-item"]',
      '[data-ui="sidebar-assistants-item"]',
    ]
      .map((sel) => aside.querySelector(sel))
      .filter((el): el is Element => el !== null);

    const sectionButtons = Array.from(
      aside.querySelectorAll("button[aria-expanded]"),
    ).filter((b) => b.querySelector("h3"));

    const chatRowEls = Array.from(
      aside.querySelectorAll('[data-ui="chat-history-item"]'),
    );
    const scroller = chatRowEls[0]?.closest<HTMLElement>(".overflow-y-auto");

    const header = aside.querySelector('[data-ui="sidebar-header"]');
    const headerButton = header?.querySelector("button");
    const footer = aside.querySelector('[data-ui="sidebar-footer"]');

    return {
      asideWidth: Math.round(asideRect.width * 10) / 10,
      headerHeight: header
        ? Math.round(header.getBoundingClientRect().height * 10) / 10
        : 0,
      footerHeight: footer
        ? Math.round(footer.getBoundingClientRect().height * 10) / 10
        : 0,
      headerIconBox: toBox(
        headerButton?.querySelector('[aria-hidden="true"]') ??
          headerButton?.querySelector("svg"),
      ),
      navRows: requireBoxes(navRowEls),
      navIcons: requireBoxes(navRowEls.map((el) => el.querySelector("svg"))),
      navLabels: requireBoxes(navRowEls.map((el) => el.querySelector("span"))),
      sectionButtons: requireBoxes(sectionButtons),
      sectionTitles: requireBoxes(
        sectionButtons.map((b) => b.querySelector("h3")),
      ),
      divider: toBox(aside.querySelector('[data-ui="sidebar-nav-divider"]')),
      chatRows: requireBoxes(chatRowEls),
      chatTitles: requireBoxes(
        chatRowEls.map((el) => el.querySelector("span[title]")),
      ),
      chatScrollbarWidth: scroller
        ? scroller.offsetWidth - scroller.clientWidth
        : 0,
      footerTrigger: toBox(
        footer?.querySelector('button[aria-haspopup="menu"]'),
      ),
    };
  });

const measureSlim = (page: Page): Promise<SlimMeasurement> =>
  page.evaluate(() => {
    const aside = document.querySelector('[data-ui="sidebar"]');
    if (!aside) throw new Error("sidebar not found");
    const asideRect = aside.getBoundingClientRect();
    const center = (el: Element) => {
      const r = el.getBoundingClientRect();
      return Math.round((r.x + r.width / 2 - asideRect.x) * 10) / 10;
    };

    const railCenters: { label: string; center: number }[] = [];
    const headerButton = aside.querySelector(
      '[data-ui="sidebar-header"] button',
    );
    if (headerButton) {
      railCenters.push({
        label: "header-toggle",
        center: center(headerButton),
      });
    }
    for (const sel of [
      'div[aria-label="New Chat"]',
      '[data-ui="sidebar-search-item"]',
      '[data-ui="sidebar-assistants-item"]',
    ]) {
      const icon = aside.querySelector(`${sel} svg`);
      if (icon) railCenters.push({ label: sel, center: center(icon) });
    }
    const footerTrigger = aside.querySelector(
      '[data-ui="sidebar-footer"] button[aria-haspopup="menu"]',
    );
    if (footerTrigger) {
      railCenters.push({
        label: "footer-avatar",
        center: center(footerTrigger),
      });
    }

    return {
      asideWidth: Math.round(asideRect.width * 10) / 10,
      railCenters,
    };
  });

const expectAligned = (values: number[], label: string, tolerance = 0.5) => {
  const [first, ...rest] = values;
  for (const value of rest) {
    expect
      .soft(Math.abs(value - first), `${label}: ${values.join(", ")}`)
      .toBeLessThanOrEqual(tolerance);
  }
};

const assertExpandedInvariants = (m: ExpandedMeasurement) => {
  expect(m.navRows.length).toBeGreaterThanOrEqual(2);
  expect(m.sectionButtons.length).toBeGreaterThanOrEqual(1);
  expect(m.chatRows.length).toBeGreaterThanOrEqual(1);

  // I1: one left inset for every row surface (and the divider).
  expectAligned(
    [
      ...m.navRows.map((b) => b.left),
      ...m.sectionButtons.map((b) => b.left),
      ...m.chatRows.map((b) => b.left),
      ...(m.divider ? [m.divider.left] : []),
    ],
    "row-surface left edges",
  );

  // I1: one content column for chat text, nav icons and section titles.
  expectAligned(
    [
      ...m.navIcons.map((b) => b.left),
      ...m.sectionTitles.map((b) => b.left),
      ...m.chatTitles.map((b) => b.left),
    ],
    "content column left edges",
  );

  // I1: the header toggle icon sits on the nav icon column.
  expect(m.headerIconBox).not.toBeNull();
  expectAligned(
    [m.headerIconBox!.left, m.navIcons[0].left],
    "header toggle icon vs nav icon column",
  );

  // I1: header band == footer band.
  expectAligned([m.headerHeight, m.footerHeight], "header vs footer band");

  // I4: equal hover surfaces; the chat scroller may reserve a scrollbar
  // gutter, which is measured and accounted for exactly.
  expectAligned(
    [m.navRows[0].width, m.chatRows[0].width + m.chatScrollbarWidth],
    "nav-row vs chat-row surface width",
  );

  // Nav labels sit at icon + gap, one shared column.
  expectAligned(
    m.navLabels.map((b) => b.left),
    "nav label column",
  );
};

const assertSlimInvariants = (m: SlimMeasurement) => {
  expect(m.railCenters.length).toBeGreaterThanOrEqual(4);
  const railCenter = m.asideWidth / 2;
  for (const item of m.railCenters) {
    expect
      .soft(
        Math.abs(item.center - railCenter),
        `${item.label} center ${item.center} vs rail center ${railCenter}`,
      )
      .toBeLessThanOrEqual(0.5);
  }
};

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

      assertExpandedInvariants(await measureExpanded(page));
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
        { "--theme-spacing-control-min-height": "2rem" },
      ];
      for (const vars of expandedPerturbations) {
        await setThemeVars(page, vars);
        await test.step(`expanded with ${JSON.stringify(vars)}`, async () => {
          assertExpandedInvariants(await measureExpanded(page));
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
      assertExpandedInvariants(m);
      expect(m.asideWidth).toBeCloseTo(themeWidth * 2, 0);
    },
  );
});
