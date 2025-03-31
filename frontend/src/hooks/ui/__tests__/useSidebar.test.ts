import { renderHook, act } from "@testing-library/react";

import { useUIStore } from "../../../state/uiStore";
import { useSidebar } from "../useSidebar";

// Reset the store before each test
beforeEach(() => {
  act(() => {
    useUIStore.setState({ isSidebarOpen: true });
  });
});

describe("useSidebar", () => {
  it("should return the current sidebar state", () => {
    const { result } = renderHook(() => useSidebar());

    expect(result.current.isOpen).toBe(true);
  });

  it("should toggle the sidebar state", () => {
    const { result } = renderHook(() => useSidebar());

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
    const { result } = renderHook(() => useSidebar());

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
    const { result: result1 } = renderHook(() => useSidebar());
    const { result: result2 } = renderHook(() => useSidebar());

    expect(result1.current.isOpen).toBe(true);
    expect(result2.current.isOpen).toBe(true);

    act(() => {
      result1.current.toggle();
    });

    expect(result1.current.isOpen).toBe(false);
    expect(result2.current.isOpen).toBe(false);
  });
});
