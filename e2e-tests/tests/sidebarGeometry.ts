import { expect, type Page } from "@playwright/test";

import { chatIsReadyToChat, sendFirstMessage } from "./shared";

/**
 * Shared measurement harness for the sidebar geometry contract (ERMAIN-608).
 *
 * The invariants are relational, not pixel-absolute: they must hold for ANY
 * theme-token values. The rail-column geometry additionally pins every icon
 * control's center to the slim rail's centerline (slim-width / 2) in BOTH
 * states, so nothing moves horizontally while the width animates.
 */

export interface Box {
  left: number;
  right: number;
  width: number;
  center: number;
}

export interface ExpandedMeasurement {
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

export interface SlimMeasurement {
  asideWidth: number;
  railCenters: { label: string; center: number }[];
}

export const forceSlimCollapsedMode = async (page: Page) => {
  await page.addInitScript(() => {
    (window as { SIDEBAR_COLLAPSED_MODE?: string }).SIDEBAR_COLLAPSED_MODE =
      "slim";
  });
};

export const sidebarMode = (page: Page) =>
  page.locator('[data-ui="sidebar"]').getAttribute("data-sidebar-mode");

/**
 * Wait until the sidebar's width has stopped changing (the width/margin
 * transitions run 300ms); a 150ms two-sample window inside the page avoids
 * a fixed sleep.
 */
export const settleSidebar = async (page: Page) => {
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

export const expandSidebar = async (page: Page) => {
  await expect(page.locator('[data-ui="sidebar"]')).toBeVisible();
  if ((await sidebarMode(page)) !== "expanded") {
    await page.getByLabel("expand sidebar").click();
    await settleSidebar(page);
  }
  expect(await sidebarMode(page)).toBe("expanded");
};

export const collapseSidebar = async (page: Page) => {
  await expect(page.locator('[data-ui="sidebar"]')).toBeVisible();
  if ((await sidebarMode(page)) === "expanded") {
    await page.getByLabel("collapse sidebar").click();
    await settleSidebar(page);
  }
};

/** At least one chat row must exist for the chat-column invariants. */
export const ensureAChatExists = async (page: Page) => {
  if ((await page.locator('[data-ui="chat-history-item"]').count()) > 0) {
    return;
  }
  await sendFirstMessage(page, "Sidebar geometry probe chat");
  await chatIsReadyToChat(page, { expectAssistantResponse: true });
  await expect(
    page.locator('[data-ui="chat-history-item"]').first(),
  ).toBeVisible();
};

export const setThemeVars = async (
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

/** The slim rail width in px, resolved from the token via a probe element. */
export const measureRailWidth = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.cssText =
      "position:absolute;visibility:hidden;width:var(--theme-layout-sidebar-slim-width)";
    document.body.appendChild(probe);
    const width = probe.getBoundingClientRect().width;
    probe.remove();
    return width;
  });

export const measureExpanded = (page: Page): Promise<ExpandedMeasurement> =>
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

export const measureSlim = (page: Page): Promise<SlimMeasurement> =>
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

export const expectAligned = (
  values: number[],
  label: string,
  tolerance = 0.5,
) => {
  const [first, ...rest] = values;
  for (const value of rest) {
    expect
      .soft(Math.abs(value - first), `${label}: ${values.join(", ")}`)
      .toBeLessThanOrEqual(tolerance);
  }
};

export const assertExpandedInvariants = (
  m: ExpandedMeasurement,
  railWidth?: number,
) => {
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

  // I1: the header toggle icon shares the nav icons' center line (rail-column
  // geometry aligns mixed-size icon controls by center, not left edge).
  expect(m.headerIconBox).not.toBeNull();
  expectAligned(
    [m.headerIconBox!.center, m.navIcons[0].center],
    "header toggle icon vs nav icon center line",
  );

  // Rail-column: icon controls sit on the slim rail's centerline even while
  // expanded, so nothing moves horizontally when the width animates.
  if (railWidth !== undefined) {
    expectAligned(
      [
        railWidth / 2,
        ...m.navIcons.map((b) => b.center),
        m.headerIconBox!.center,
        ...(m.footerTrigger ? [m.footerTrigger.center] : []),
      ],
      "rail centerline in expanded state",
    );
  }

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

export const assertSlimInvariants = (m: SlimMeasurement) => {
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

export interface TrajectoryElementReport {
  label: string;
  startX: number;
  endX: number;
  maxFrameDelta: number;
  totalPath: number;
}

/**
 * Toggle the sidebar while sampling icon x-positions every animation frame,
 * then report per-element motion. Under rail-column geometry the icons must
 * not move at all while the width animates.
 */
export const recordToggleTrajectory = async (
  page: Page,
  action: "collapse" | "expand",
): Promise<TrajectoryElementReport[]> => {
  await page.evaluate(() => {
    const trace: {
      frames: Record<string, number | null>[];
      done: boolean;
    } = { frames: [], done: false };
    (window as unknown as { __geoTrace: typeof trace }).__geoTrace = trace;
    const pick = (sel: string) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return Math.round((r.x + r.width / 2) * 10) / 10;
    };
    const capture = () => {
      trace.frames.push({
        toggle: pick('[data-ui="sidebar-header"] button'),
        newChat: pick('div[aria-label="New Chat"] svg'),
        search: pick('[data-ui="sidebar-search-item"] svg'),
        avatar: pick('[data-ui="sidebar-footer"] button[aria-haspopup="menu"]'),
      });
    };
    const start = performance.now();
    const loop = () => {
      capture();
      if (performance.now() - start > 700) {
        trace.done = true;
        return;
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });

  await page
    .getByLabel(action === "collapse" ? "collapse sidebar" : "expand sidebar")
    .click();
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (window as unknown as { __geoTrace: { done: boolean } }).__geoTrace
              .done,
        ),
      { timeout: 5000 },
    )
    .toBe(true);
  const frames = await page.evaluate(
    () =>
      (
        window as unknown as {
          __geoTrace: { frames: Record<string, number | null>[] };
        }
      ).__geoTrace.frames,
  );

  const labels = ["toggle", "newChat", "search", "avatar"];
  return labels.map((label) => {
    const xs = frames
      .map((frame) => frame[label])
      .filter((x): x is number => x !== null);
    expect(xs.length, `${label}: sampled frames`).toBeGreaterThan(10);
    let maxFrameDelta = 0;
    let totalPath = 0;
    for (let i = 1; i < xs.length; i++) {
      const delta = Math.abs(xs[i] - xs[i - 1]);
      maxFrameDelta = Math.max(maxFrameDelta, delta);
      totalPath += delta;
    }
    return {
      label,
      startX: xs[0],
      endX: xs[xs.length - 1],
      maxFrameDelta,
      totalPath,
    };
  });
};

export const assertStationaryTrajectory = (
  reports: TrajectoryElementReport[],
) => {
  for (const report of reports) {
    expect
      .soft(
        report.maxFrameDelta,
        `${report.label} max per-frame movement (start ${report.startX}, end ${report.endX})`,
      )
      .toBeLessThanOrEqual(1);
    expect
      .soft(
        Math.abs(report.endX - report.startX),
        `${report.label} resting shift between states`,
      )
      .toBeLessThanOrEqual(0.5);
    expect
      .soft(report.totalPath, `${report.label} total horizontal path`)
      .toBeLessThanOrEqual(2);
  }
};
