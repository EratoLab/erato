import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchReplySpeechStyle = vi.hoisted(() => vi.fn());
vi.mock("@/lib/generated/v1betaApi/v1betaApiComponents", () => ({
  fetchReplySpeechStyle,
}));

import {
  primeVoiceTraces,
  refreshVoiceTraces,
  useVoiceTraces,
} from "./voiceTraces";

const deferred = () => {
  let resolve!: (value: { show_in_chat: boolean }) => void;
  const promise = new Promise<{ show_in_chat: boolean }>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe("voice traces setting", () => {
  beforeEach(() => fetchReplySpeechStyle.mockReset());

  it("keeps the answer to the latest question, not an earlier one still in flight", async () => {
    const before = deferred();
    const after = deferred();
    fetchReplySpeechStyle
      .mockReturnValueOnce(before.promise)
      .mockReturnValueOnce(after.promise);
    primeVoiceTraces("user-a");
    const refreshed = refreshVoiceTraces();
    after.resolve({ show_in_chat: true });
    before.resolve({ show_in_chat: false });
    await refreshed;
    await before.promise;
    expect(useVoiceTraces.getState().shown).toBe(true);
  });

  it("starts hidden for another user and asks again", async () => {
    fetchReplySpeechStyle.mockResolvedValueOnce({ show_in_chat: false });
    primeVoiceTraces("user-b");
    expect(useVoiceTraces.getState().shown).toBe(false);
    await vi.waitFor(() =>
      expect(fetchReplySpeechStyle).toHaveBeenCalledTimes(1),
    );
  });
});
