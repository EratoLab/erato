import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useThinkingGap } from "./useThinkingGap";

import type { TraceablePart } from "../types";

const tool = (
  status: "preparing" | "in_progress" | "success",
): TraceablePart => ({
  content_type: "tool_use",
  tool_call_id: "draft",
  tool_name: "submit_draft",
  status,
});

afterEach(() => vi.useRealTimers());

describe("useThinkingGap", () => {
  it.each(["preparing", "in_progress"] as const)(
    "keeps the named %s tool active through a quiet interval",
    (status) => {
      vi.useFakeTimers();
      const { result } = renderHook(() =>
        useThinkingGap([tool(status)], true, false),
      );
      act(() => vi.advanceTimersByTime(10_000));
      expect(result.current).toBe(false);
    },
  );

  it("clears a reasoning gap when argument generation arrives, and resumes it after the tool finishes", () => {
    vi.useFakeTimers();
    const reasoning: TraceablePart = {
      content_type: "reasoning",
      text: "Planning",
    };
    const initialProps: { parts: TraceablePart[] } = { parts: [reasoning] };
    const { result, rerender } = renderHook(
      ({ parts }: { parts: TraceablePart[] }) =>
        useThinkingGap(parts, true, false),
      { initialProps },
    );
    act(() => vi.advanceTimersByTime(1600));
    expect(result.current).toBe(true);
    rerender({ parts: [reasoning, tool("preparing")] });
    expect(result.current).toBe(false);
    act(() => vi.advanceTimersByTime(10_000));
    expect(result.current).toBe(false);
    rerender({ parts: [reasoning, tool("success")] });
    act(() => vi.advanceTimersByTime(1600));
    expect(result.current).toBe(true);
  });
});
