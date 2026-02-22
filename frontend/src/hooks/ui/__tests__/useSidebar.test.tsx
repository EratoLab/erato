import { renderHook, act } from "@testing-library/react";
import { vi } from "vitest";

// Mock the env function
vi.mock("@/app/env", () => ({
  env: vi.fn(),
}));

// Import the mocked env
import { env } from "@/app/env";

import { FeatureConfigProvider } from "../../../providers/FeatureConfigProvider";
import { useUIStore } from "../../../state/uiStore";
import { useSidebar } from "../useSidebar";

import type { ReactNode } from "react";

const mockEnv = env as ReturnType<typeof vi.fn>;

// Helper to create wrapper with provider
function createWrapper() {
  // eslint-disable-next-line react/display-name
  return ({ children }: { children: ReactNode }) => (
    <FeatureConfigProvider>{children}</FeatureConfigProvider>
  );
}

// Reset the store and mock env before each test
beforeEach(() => {
  vi.clearAllMocks();

  // Set up default env mock
  mockEnv.mockReturnValue({
    apiRootUrl: "/api/",
    themeCustomerName: null,
    themePath: null,
    themeConfigPath: null,
    themeLogoPath: null,
    themeLogoDarkPath: null,
    themeAssistantAvatarPath: null,
    disableUpload: false,
    disableChatInputAutofocus: false,
    disableLogout: false,
    assistantsEnabled: false,
    sharepointEnabled: false,
    messageFeedbackEnabled: false,
    messageFeedbackCommentsEnabled: false,
    userPreferencesEnabled: true,
    messageFeedbackEditTimeLimitSeconds: null,
    maxUploadSizeBytes: 20971520,
    sidebarCollapsedMode: "hidden",
    sidebarLogoPath: null,
    sidebarLogoDarkPath: null,
  });

  act(() => {
    useUIStore.setState({ isSidebarOpen: true });
  });
});

describe("useSidebar", () => {
  it("should return the current sidebar state", () => {
    const { result } = renderHook(() => useSidebar(), {
      wrapper: createWrapper(),
    });

    expect(result.current.isOpen).toBe(true);
  });

  it("should toggle the sidebar state", () => {
    const { result } = renderHook(() => useSidebar(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.toggle();
    });

    expect(result.current.isOpen).toBe(false);

    act(() => {
      result.current.toggle();
    });

    expect(result.current.isOpen).toBe(true);
  });

  it("should set the sidebar state explicitly", () => {
    const { result } = renderHook(() => useSidebar(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.setOpen(false);
    });

    expect(result.current.isOpen).toBe(false);

    act(() => {
      result.current.setOpen(true);
    });

    expect(result.current.isOpen).toBe(true);
  });

  it("should update all hook instances when state changes", () => {
    const wrapper = createWrapper();
    const { result: result1 } = renderHook(() => useSidebar(), { wrapper });
    const { result: result2 } = renderHook(() => useSidebar(), { wrapper });

    expect(result1.current.isOpen).toBe(true);
    expect(result2.current.isOpen).toBe(true);

    act(() => {
      result1.current.toggle();
    });

    expect(result1.current.isOpen).toBe(false);
    expect(result2.current.isOpen).toBe(false);
  });
});
