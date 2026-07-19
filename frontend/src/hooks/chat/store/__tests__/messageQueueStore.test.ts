import { beforeEach, describe, expect, it } from "vitest";

import { useMessageQueueStore } from "../messageQueueStore";

describe("messageQueueStore", () => {
  beforeEach(() => {
    useMessageQueueStore.setState({ queuedBySessionId: {} });
  });

  const store = () => useMessageQueueStore.getState();

  it("returns null for a session with nothing queued", () => {
    expect(store().getQueued("session-a")).toBeNull();
  });

  it("stores, reads, and clears a queued message per session", () => {
    store().setQueued("session-a", { message: "queued", attachedFiles: [] });
    expect(store().getQueued("session-a")).toEqual({
      message: "queued",
      attachedFiles: [],
    });

    store().clearQueued("session-a");
    expect(store().getQueued("session-a")).toBeNull();
  });

  it("isolates queues per session", () => {
    store().setQueued("session-a", { message: "a", attachedFiles: [] });
    expect(store().getQueued("session-b")).toBeNull();
    expect(store().getQueued("session-a")?.message).toBe("a");
  });
});
