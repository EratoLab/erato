import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { toast } from "../toast";
import { useToastStore } from "../toastStore";
import { usePageErrorToast } from "../usePageErrorToast";

const titles = () => useToastStore.getState().toasts.map((t) => t.title);

describe("usePageErrorToast", () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
  });

  it("dismisses the page's errors when it unmounts, but not other toasts", () => {
    const page = renderHook(() => usePageErrorToast());

    act(() => {
      page.result.current({ title: "Could not save" });
      toast.success({ title: "Saved elsewhere" });
      toast.error({ title: "Another surface failed" });
    });
    page.unmount();

    expect(titles()).toEqual(["Saved elsewhere", "Another surface failed"]);
  });

  it("keeps a success that replaced the page's error in its slot", () => {
    const page = renderHook(() => usePageErrorToast());

    act(() => {
      page.result.current({ dedupeKey: "save", title: "Could not save" });
      toast.success({ dedupeKey: "save", title: "Saved" });
    });
    page.unmount();

    expect(titles()).toEqual(["Saved"]);
  });

  it("keeps an error raised after the page is gone", () => {
    const page = renderHook(() => usePageErrorToast());
    const showError = page.result.current;

    page.unmount();
    act(() => {
      showError({ title: "Could not save" });
    });

    expect(titles()).toEqual(["Could not save"]);
  });
});
