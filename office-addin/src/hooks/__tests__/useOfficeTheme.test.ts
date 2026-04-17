import { renderHook } from "@testing-library/react";
import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("../../providers/OfficeProvider", () => ({
  useOffice: vi.fn(() => ({
    isReady: false,
    host: null,
    platform: null,
    mailboxUser: null,
  })),
}));

import { useOffice } from "../../providers/OfficeProvider";
import {
  installMockMailbox,
  uninstallMockMailbox,
} from "../../test/mocks/outlook/mailbox";
import { useOfficeTheme } from "../useOfficeTheme";

const mockUseOffice = useOffice as ReturnType<typeof vi.fn>;

type OfficeThemeLike = {
  bodyBackgroundColor: string;
  bodyForegroundColor: string;
  controlBackgroundColor: string;
  controlForegroundColor: string;
  isDarkTheme: boolean;
};

const darkTheme: OfficeThemeLike = {
  bodyBackgroundColor: "#1F1F1F",
  bodyForegroundColor: "#FFFFFF",
  controlBackgroundColor: "#2B2B2B",
  controlForegroundColor: "#FFFFFF",
  isDarkTheme: true,
};

const lightTheme: OfficeThemeLike = {
  bodyBackgroundColor: "#FFFFFF",
  bodyForegroundColor: "#000000",
  controlBackgroundColor: "#F3F3F3",
  controlForegroundColor: "#222222",
  isDarkTheme: false,
};

function installOfficeTheme(theme: OfficeThemeLike) {
  (Office.context as unknown as Record<string, unknown>).officeTheme = theme;
}

function uninstallOfficeTheme() {
  delete (Office.context as unknown as Record<string, unknown>).officeTheme;
}

function setOfficeReady(host: string | null) {
  mockUseOffice.mockReturnValue({
    isReady: true,
    host,
    platform: null,
    mailboxUser: null,
  });
}

describe("useOfficeTheme", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    uninstallOfficeTheme();
    uninstallMockMailbox();
    mockUseOffice.mockReturnValue({
      isReady: false,
      host: null,
      platform: null,
      mailboxUser: null,
    });
  });

  it("returns null mode/colors before the Office provider is ready", () => {
    installMockMailbox();
    installOfficeTheme(darkTheme);

    const { result } = renderHook(() => useOfficeTheme());

    expect(result.current).toEqual({ mode: null, colors: null });
    expect(Office.context.mailbox.addHandlerAsync).not.toHaveBeenCalled();
  });

  it("derives dark mode from Outlook bodyBackgroundColor and installs the subscription", () => {
    const mailbox = installMockMailbox();
    installOfficeTheme({ ...darkTheme, isDarkTheme: false });
    setOfficeReady("Outlook");

    const { result } = renderHook(() => useOfficeTheme());

    expect(result.current.mode).toBe("dark");
    expect(result.current.colors).toEqual({
      bodyBackground: "#1F1F1F",
      bodyForeground: "#FFFFFF",
      controlBackground: "#2B2B2B",
      controlForeground: "#FFFFFF",
    });
    expect(mailbox.addHandlerAsync).toHaveBeenCalledTimes(1);
  });

  it("reads isDarkTheme for non-Outlook hosts and does not install a subscription", () => {
    const mailbox = installMockMailbox();
    installOfficeTheme(lightTheme);
    setOfficeReady("Excel");

    const { result } = renderHook(() => useOfficeTheme());

    expect(result.current.mode).toBe("light");
    expect(mailbox.addHandlerAsync).not.toHaveBeenCalled();
  });

  it("calls removeHandlerAsync when the hook unmounts on Outlook", () => {
    const mailbox = installMockMailbox();
    installOfficeTheme(darkTheme);
    setOfficeReady("Outlook");

    const { unmount } = renderHook(() => useOfficeTheme());

    expect(mailbox.removeHandlerAsync).not.toHaveBeenCalled();

    unmount();

    expect(mailbox.removeHandlerAsync).toHaveBeenCalledTimes(1);
  });

  it("returns null mode/colors when officeTheme is missing", () => {
    installMockMailbox();
    setOfficeReady("Outlook");

    const { result } = renderHook(() => useOfficeTheme());

    expect(result.current).toEqual({ mode: null, colors: null });
  });
});
