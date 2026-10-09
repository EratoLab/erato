import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useGenerationStatusStore } from "@/hooks/chat/store/generationStatusStore";
import { useMessagingStore } from "@/hooks/chat/store/messagingStore";
import { resetBaseIconCache } from "@/lib/favicon/composeBadgedIcon";

import { TabChatIndicator } from "./TabChatIndicator";

const ticks: Array<() => void> = [];

vi.mock("@/lib/favicon/blinkDriver", () => ({
  shouldBlink: () => true,
  startBlink: (onTick: () => void) => {
    ticks.push(onTick);
    return { stop: () => {} };
  },
}));

const iconHrefs = () =>
  Array.from(
    document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]'),
  ).map((link) => link.getAttribute("href"));

const setHidden = (hidden: boolean) => {
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () => hidden,
  });
  document.dispatchEvent(new Event("visibilitychange"));
};

const setStreaming = (isStreaming: boolean) => {
  useMessagingStore.setState({
    streaming: {
      isStreaming,
      isFinalizing: false,
      currentMessageId: null,
      content: [],
      createdAt: null,
    },
  });
};

describe("TabChatIndicator", () => {
  beforeEach(() => {
    ticks.length = 0;
    resetBaseIconCache();
    document.head.innerHTML =
      '<link rel="icon" href="/favicon.ico" sizes="any">' +
      '<link rel="icon" href="/favicon.svg" type="image/svg+xml">';
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          '<svg viewBox="0 0 21 22"><path d="M0 0h21v22H0z"/></svg>',
          {
            status: 200,
            headers: { "content-type": "image/svg+xml" },
          },
        ),
      ),
    );
    setHidden(false);
    setStreaming(false);
    useGenerationStatusStore.setState({
      statusByChatId: {},
      currentChatId: null,
    });
  });

  afterEach(() => {
    delete window.FAVICON_PATH;
    vi.unstubAllGlobals();
  });

  it("uses the configured image for badges and restores it when visible", async () => {
    window.FAVICON_PATH = "/public/common/custom-theme/acme/icon.png";
    setStreaming(true);
    const { unmount } = render(<TabChatIndicator />);
    expect(iconHrefs()).toEqual([window.FAVICON_PATH, window.FAVICON_PATH]);
    const svgLink = document.querySelector('link[rel="icon"][type]');
    expect(svgLink).toBeNull();

    setHidden(true);
    await waitFor(() => {
      expect(iconHrefs()[0]).toContain("circle");
    });
    expect(fetch).toHaveBeenCalledWith(window.FAVICON_PATH);

    setHidden(false);
    await waitFor(() => {
      expect(iconHrefs()).toEqual([window.FAVICON_PATH, window.FAVICON_PATH]);
    });
    unmount();
    expect(iconHrefs()).toEqual([window.FAVICON_PATH, window.FAVICON_PATH]);
  });

  it("leaves the original icons alone while the tab is visible", async () => {
    setStreaming(true);
    render(<TabChatIndicator />);

    await waitFor(() => {
      expect(iconHrefs()).toEqual(["/favicon.ico", "/favicon.svg"]);
    });
  });

  it("badges the icon and alternates frames while hidden and generating", async () => {
    setStreaming(true);
    setHidden(true);
    render(<TabChatIndicator />);

    await waitFor(() => {
      expect(ticks).toHaveLength(1);
    });
    const badged = iconHrefs()[0];
    expect(badged).toContain("circle");

    ticks[0]();
    const off = iconHrefs()[0];
    expect(off).not.toContain("circle");

    ticks[0]();
    expect(iconHrefs()[0]).toBe(badged);
  });

  it("holds a solid icon for a finished chat rather than blinking", async () => {
    setStreaming(true);
    setHidden(true);
    render(<TabChatIndicator />);
    await waitFor(() => {
      expect(ticks).toHaveLength(1);
    });

    setStreaming(false);

    await waitFor(() => {
      expect(iconHrefs()[0]).toContain("%231f9d55");
    });
    expect(ticks).toHaveLength(1);
  });

  it("restores the original icons when the tab is looked at", async () => {
    setStreaming(true);
    setHidden(true);
    render(<TabChatIndicator />);
    await waitFor(() => {
      expect(iconHrefs()[0]).toContain("circle");
    });

    setHidden(false);

    await waitFor(() => {
      expect(iconHrefs()).toEqual(["/favicon.ico", "/favicon.svg"]);
    });
  });
});
