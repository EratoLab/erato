import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useConversationKey } from "../useConversationKey";

interface Props {
  chatId: string | null;
  identity: string;
}

function renderKey(initialProps: Props) {
  return renderHook(
    ({ chatId, identity }: Props) => useConversationKey(chatId, identity),
    { initialProps },
  );
}

afterEach(cleanup);

describe("useConversationKey", () => {
  it("keeps the key while nothing changes", () => {
    const { result, rerender } = renderKey({ chatId: "c1", identity: "doc" });
    const key = result.current;

    rerender({ chatId: "c1", identity: "doc" });

    expect(result.current).toBe(key);
  });

  it("keeps the key when a new chat receives its ID", () => {
    const { result, rerender } = renderKey({ chatId: null, identity: "doc" });
    const key = result.current;

    rerender({ chatId: "c1", identity: "doc" });

    expect(result.current).toBe(key);
  });

  it("changes the key when switching to another chat", () => {
    const { result, rerender } = renderKey({ chatId: "c1", identity: "doc" });
    const key = result.current;

    rerender({ chatId: "c2", identity: "doc" });

    expect(result.current).not.toBe(key);
  });

  it("changes the key when leaving a chat for a new one", () => {
    const { result, rerender } = renderKey({ chatId: null, identity: "doc" });
    const firstNewChat = result.current;
    rerender({ chatId: "c1", identity: "doc" });

    rerender({ chatId: null, identity: "doc" });

    expect(result.current).not.toBe(firstNewChat);
  });

  it("changes the key when the host identity changes", () => {
    const { result, rerender } = renderKey({ chatId: "c1", identity: "doc-a" });
    const key = result.current;

    rerender({ chatId: "c1", identity: "doc-b" });

    expect(result.current).not.toBe(key);
  });

  it("changes the key when the ID arrives together with another identity", () => {
    const { result, rerender } = renderKey({ chatId: null, identity: "doc-a" });
    const key = result.current;

    rerender({ chatId: "c1", identity: "doc-b" });

    expect(result.current).not.toBe(key);
  });
});
