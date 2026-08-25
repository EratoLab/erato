import { describe, expect, it } from "vitest";

import { getModelSwitches } from "./modelSwitches";

describe("getModelSwitches", () => {
  it("marks every user turn whose provider differs from the prior turn", () => {
    const messages = {
      user1: { id: "user1", role: "user" as const },
      assistant1: {
        id: "assistant1",
        role: "assistant" as const,
        chatProviderId: "one",
        previous_message_id: "user1",
      },
      user2: { id: "user2", role: "user" as const },
      assistant2: {
        id: "assistant2",
        role: "assistant" as const,
        chatProviderId: "two",
        previous_message_id: "user2",
      },
      user3: { id: "user3", role: "user" as const },
      assistant3: {
        id: "assistant3",
        role: "assistant" as const,
        chatProviderId: "one",
        previous_message_id: "user3",
      },
    };

    expect(
      getModelSwitches(
        messages,
        ["user1", "assistant1", "user2", "assistant2", "user3", "assistant3"],
        new Map([
          ["one", "Model One"],
          ["two", "Model Two"],
        ]),
      ),
    ).toEqual({
      user2: { fromModel: "Model One", toModel: "Model Two" },
      user3: { fromModel: "Model Two", toModel: "Model One" },
    });
  });

  it("does not infer a switch across missing provider metadata", () => {
    const messages = {
      user1: { id: "user1", role: "user" as const },
      assistant1: {
        id: "assistant1",
        role: "assistant" as const,
        chatProviderId: "one",
        previous_message_id: "user1",
      },
      user2: { id: "user2", role: "user" as const },
      user3: { id: "user3", role: "user" as const },
      assistant3: {
        id: "assistant3",
        role: "assistant" as const,
        chatProviderId: "two",
        previous_message_id: "user3",
      },
    };

    expect(
      getModelSwitches(
        messages,
        ["user1", "assistant1", "user2", "user3", "assistant3"],
        new Map(),
      ),
    ).toEqual({});
  });
});
