import { renderHook } from "@testing-library/react";
import { expect, it } from "vitest";

import { useModelSwitches } from "./useModelSwitches";

import type { Message } from "@/types/chat";

it("uses archived provider names from historical messages without exposing them as selectable models", () => {
  const message = (id: string, role: Message["role"]): Message => ({
    id,
    role,
    content: [],
    createdAt: "2026-01-01T00:00:00Z",
  });
  const messages: Record<string, Message> = {
    u1: message("u1", "user"),
    a1: {
      ...message("a1", "assistant"),
      previous_message_id: "u1",
      chatProviderId: "old",
      chatProviderDisplayName: "Old Model",
    },
    u2: message("u2", "user"),
    a2: {
      ...message("a2", "assistant"),
      previous_message_id: "u2",
      chatProviderId: "new",
    },
  };
  const { result } = renderHook(() =>
    useModelSwitches(
      messages,
      ["u1", "a1", "u2", "a2"],
      [{ chat_provider_id: "new", model_display_name: "New Model" }],
    ),
  );
  expect(result.current.u2).toEqual({
    fromModel: "Old Model",
    toModel: "New Model",
  });
});
