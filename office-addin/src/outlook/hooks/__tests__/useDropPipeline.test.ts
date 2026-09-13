import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useDropPipeline } from "../useDropPipeline";

describe("useDropPipeline", () => {
  it("starts idle", () => {
    const { result } = renderHook(() => useDropPipeline());

    expect(result.current).toMatchObject({ phase: "idle", done: 0, total: 0 });
  });

  it("enters receiving with the dropped count on begin and returns to idle on end", () => {
    const { result } = renderHook(() => useDropPipeline());

    act(() => {
      result.current.begin(3);
    });
    expect(result.current).toMatchObject({
      phase: "receiving",
      done: 0,
      total: 3,
    });

    act(() => {
      result.current.end();
    });
    expect(result.current.phase).toBe("idle");
  });

  it("walks through the phases with progress and stage", () => {
    const { result } = renderHook(() => useDropPipeline());

    act(() => {
      result.current.begin(2);
    });
    act(() => {
      result.current.progress({
        stage: "reading",
        index: 1,
        total: 2,
        name: "a.eml",
      });
    });
    expect(result.current).toMatchObject({
      phase: "reading",
      done: 1,
      total: 2,
      name: "a.eml",
    });

    act(() => {
      result.current.progress({ stage: "resolving", index: 2, total: 2 });
    });
    expect(result.current).toMatchObject({
      phase: "resolving",
      done: 2,
      total: 2,
      name: undefined,
    });

    act(() => {
      result.current.stage("staging");
    });
    expect(result.current).toMatchObject({
      phase: "staging",
      done: 2,
      total: 2,
    });
  });

  it("stays busy until every queued drop has ended", () => {
    const { result } = renderHook(() => useDropPipeline());

    act(() => {
      result.current.begin(1);
    });
    act(() => {
      result.current.progress({ stage: "reading", index: 1, total: 1 });
    });
    act(() => {
      result.current.begin(4);
    });
    // The running drop keeps the display; the second one only queues.
    expect(result.current).toMatchObject({ phase: "reading", total: 1 });

    act(() => {
      result.current.end();
    });
    expect(result.current.phase).toBe("reading");

    act(() => {
      result.current.end();
    });
    expect(result.current.phase).toBe("idle");
  });

  it("releases a span once even when its release is called twice", () => {
    const { result } = renderHook(() => useDropPipeline());

    let releaseFirst: () => void = () => {};
    act(() => {
      releaseFirst = result.current.begin(1);
      result.current.begin(1);
    });
    act(() => {
      releaseFirst();
      releaseFirst();
    });
    expect(result.current.phase).toBe("receiving");

    act(() => {
      result.current.end();
    });
    expect(result.current.phase).toBe("idle");
  });

  it("ignores end, progress and stage while idle", () => {
    const { result } = renderHook(() => useDropPipeline());

    act(() => {
      result.current.end();
      result.current.progress({ stage: "reading", index: 1, total: 1 });
      result.current.stage("staging");
    });
    expect(result.current.phase).toBe("idle");

    // A stray end must not put the counter below zero and swallow a begin.
    act(() => {
      result.current.begin(1);
    });
    expect(result.current.phase).toBe("receiving");
  });
});
