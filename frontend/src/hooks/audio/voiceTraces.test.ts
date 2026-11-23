import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchReplySpeechStyle = vi.hoisted(() => vi.fn());
const fetchApprovalSpeechStyle = vi.hoisted(() => vi.fn());
vi.mock("@/lib/generated/v1betaApi/v1betaApiComponents", () => ({
  fetchReplySpeechStyle,
  fetchApprovalSpeechStyle,
}));

import { useSpeechPlayback } from "./speechPlayback";
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
  beforeEach(() => {
    fetchReplySpeechStyle.mockReset();
    fetchApprovalSpeechStyle.mockReset();
    fetchApprovalSpeechStyle.mockResolvedValue({ spoken: true });
  });

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

  it("applies whether replies are spoken and cards read aloud", async () => {
    fetchReplySpeechStyle.mockResolvedValue({
      show_in_chat: false,
      spoken: false,
    });
    fetchApprovalSpeechStyle.mockResolvedValue({ spoken: false });
    await refreshVoiceTraces();
    expect(useSpeechPlayback.getState()).toMatchObject({
      enabled: false,
      cards: false,
    });

    // Another user starts from the defaults until their own answer is in.
    const later = deferred();
    fetchReplySpeechStyle.mockReturnValueOnce(later.promise);
    primeVoiceTraces("user-c");
    expect(useSpeechPlayback.getState()).toMatchObject({
      enabled: true,
      cards: true,
    });
  });

  it("keeps cards read aloud when only their answer fails", async () => {
    useSpeechPlayback.setState({ enabled: true, cards: true });
    fetchReplySpeechStyle.mockResolvedValue({
      show_in_chat: true,
      spoken: true,
    });
    fetchApprovalSpeechStyle.mockRejectedValue(new Error("offline"));
    await refreshVoiceTraces();
    expect(useVoiceTraces.getState().shown).toBe(true);
    expect(useSpeechPlayback.getState().cards).toBe(true);
  });
});
