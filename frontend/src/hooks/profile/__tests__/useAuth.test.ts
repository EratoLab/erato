import { renderHook } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

import { useAuth } from "../useAuth";
import { useProfile } from "../useProfile";

// Mock dependencies
vi.mock("../useProfile");
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    invalidateQueries: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn(),
  }),
}));

// Mock window.location
const originalHref = window.location.href;
let hrefMock = "";

// Jest doesn't allow direct modification of window.location.href
// So we use this workaround
Object.defineProperty(window, "location", {
  value: {
    get href() {
      return hrefMock;
    },
    set href(value) {
      hrefMock = value;
    },
  },
  writable: true,
});

afterEach(() => {
  hrefMock = originalHref;
});

// Mock implementations
const mockUseProfile = useProfile as unknown as ReturnType<typeof vi.fn>;

describe("useAuth", () => {
  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    // Default mock implementations
    mockUseProfile.mockReturnValue({
      profile: undefined,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
  });

  it("should detect authenticated state when profile exists", () => {
    // Mock an authenticated user
    mockUseProfile.mockReturnValue({
      profile: { id: "user1", name: "Test User" } as any,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    const { result } = renderHook(() => useAuth());

    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.profile).toEqual({ id: "user1", name: "Test User" });
  });

  it("should detect unauthenticated state when profile is undefined", () => {
    // Mock an unauthenticated user (no profile)
    mockUseProfile.mockReturnValue({
      profile: undefined,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    const { result } = renderHook(() => useAuth());

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.profile).toBeUndefined();
  });

  it("should handle loading state", () => {
    // Mock loading state
    mockUseProfile.mockReturnValue({
      profile: undefined,
      isLoading: true,
      error: null,
      refetch: vi.fn(),
    });

    const { result } = renderHook(() => useAuth());

    expect(result.current.isLoading).toBe(true);
  });

  it("should handle error state", () => {
    const testError = new Error("Auth error");

    // Mock error state
    mockUseProfile.mockReturnValue({
      profile: undefined,
      isLoading: false,
      isError: true,
      error: testError,
      refetch: vi.fn(),
    });

    const { result } = renderHook(() => useAuth());

    expect(result.current.error).toBe(testError);
    expect(result.current.error).toBeTruthy();
  });

  it("should handle logout", async () => {
    // Setup authenticated user first
    mockUseProfile.mockReturnValue({
      profile: { id: "user1" } as any,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    const { result, rerender } = renderHook(() => useAuth());

    // Verify user is authenticated initially
    expect(result.current.isAuthenticated).toBe(true);

    // Prepare for logout state
    mockUseProfile.mockReturnValue({
      profile: undefined,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    // Call logout
    await result.current.logout();

    // Force re-render to get updated state
    rerender();

    // Now the user should be logged out
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.profile).toBeUndefined();
    expect(hrefMock).toBe("/");
  });
});
