import { i18n } from "@lingui/core";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OfficeProvider } from "../OfficeProvider";

const spies = vi.hoisted(() => ({
  beforeReload: null as (() => void) | null,
  /** What the Toaster would show, with the store's dedupe-slot rules. */
  toasts: [] as Array<{ title?: string; dedupeKey?: string }>,
}));

vi.mock("@erato/frontend/library", () => ({
  installAudioCaptureAccessPolicy: () => () => {},
  restoreComposeReloadState: () => {},
  saveComposeReloadState: () => {
    const error = new Error("Attachments are still staged");
    error.name = "ComposeReloadBlockedError";
    throw error;
  },
  toast: {
    error: (input: { title?: string; dedupeKey?: string }) => {
      spies.toasts = [
        ...spies.toasts.filter(
          (toast) => !input.dedupeKey || toast.dedupeKey !== input.dedupeKey,
        ),
        input,
      ];
    },
  },
}));
vi.mock("../officeAudioAccess", () => ({
  createOfficeAudioAccess: ({ beforeReload }: { beforeReload: () => void }) => {
    spies.beforeReload = beforeReload;
    return {};
  },
  isOfficeAudioCaptureSupported: () => true,
}));
vi.mock("../../utils/activateHostLocale", () => ({
  activateHostLocale: async () => {},
}));
vi.mock("../../utils/detectExchangeOnPrem", () => ({
  detectExchangeOnPrem: () => false,
}));

describe("OfficeProvider", () => {
  beforeEach(() => {
    i18n.activate("en");
    spies.beforeReload = null;
    spies.toasts = [];
    vi.stubGlobal("Office", {
      onReady: () => Promise.resolve({ host: "Word", platform: "PC" }),
      context: { displayLanguage: "en-US" },
    });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("keeps one reload error however often the microphone asks for the reload", async () => {
    render(
      <OfficeProvider>
        <p>ready</p>
      </OfficeProvider>,
    );
    await screen.findByText("ready");

    expect(() => spies.beforeReload?.()).toThrow("Attachments are still");
    expect(() => spies.beforeReload?.()).toThrow("Attachments are still");

    expect(spies.toasts).toHaveLength(1);
    expect(spies.toasts[0]?.title).toContain("Finish uploading");
  });
});
